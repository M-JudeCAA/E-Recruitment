# UCAA e-Recruitment System

Full-stack e-recruitment system: React (frontend), Node.js/Express (API), MySQL via Prisma (data layer).

## Structure

```
erecruitment/
  backend/     Express API - MVC layout
    src/
      models/       Data-access layer (one file per entity, wraps Prisma)
      controllers/  Request-handling logic (moved out of routes)
      routes/       Thin URL -> controller wiring only
      services/     Cross-cutting business logic (workflowService, tokenService)
      middleware/   Auth (JWT + RBAC) and file upload
    prisma/         Schema + seed script
    tests/          Jest unit tests

  frontend/    React (Vite) - Views/Components/Models layout
    src/
      views/         Page-level screens (one per route)
      components/    Reusable UI pieces shared across views:
                        Navbar, Button, TextField, TextArea, Select, Card,
                        StatusBadge, Alert, PageHeader, Modal, ProtectedRoute
      models/        Data/state layer - API clients + AuthContext
      theme.css      Central brand tokens (colors, spacing, font) - the one file
                      to edit for a UCAA brand update

  docker-compose.yml
  .github/workflows/ci.yml
```

**A note on "MVC" here**: the backend maps onto classic MVC directly (Models / Controllers / Routes, with JSON responses standing in for Views on an API). The frontend uses the same *idea* but different vocabulary, since React doesn't have a Controller layer - state and logic live in components. "Views" = pages, "Components" = shared reusable UI, "Models" = the data/state layer (API clients, auth context). Both sides keep `services/` as a separate layer for business logic that spans multiple models (e.g. the verification gate, the offer decline cascade) - this sits between controllers and models and isn't part of classic MVC, but is a standard and sensible addition.


## What's implemented

**Data layer**
- Full relational schema (Prisma): Vacancy, Candidate, Application, WorkExperience,
  Education, InternalProfile, InterviewRound, Offer, StaffUser, AuditLog,
  VerificationToken (persisted email-confirmation / password-reset tokens).

**Candidate side**
- Registration with domain-based `candidateType` (Internal if `@caa.co.ug`, else External).
- Email confirmation via a persisted, single-use, expiring token (24h) - not an
  in-memory map, so it survives restarts and works across multiple API instances.
- Forgot/reset password flow (30-minute token), enumeration-safe (same response
  whether or not the email exists).
- Login, job listing filtered by posting-type visibility rules.
- Application submission with CV (required) and cover letter (optional) file upload.
- Candidate dashboard: application status tracking, internal-profile self-declaration form.

**HR/Admin side**
- Staff login (role-based: HR Officer, Principal HR Officer, DHRA/Manager HR) with
  its own forgot/reset password flow.
- Vacancy creation and approval (with self-approval blocking).
- **Drag-to-rank shortlisting UI**: reorder candidates by dragging; saving computes
  Primary/Reserve status automatically from position vs. `positionsRequired` and
  re-runs the mandatory verification gate for every application in the list before
  committing the rank.
- Internal-candidate HR verification (mandatory comments/recommendation-letter evidence).
- Interview scheduling and scoring.
- Offer approval.

**Business logic (`workflowService.js`)**
- Mandatory internal-candidate verification gate before shortlisting.
- Self-approval blocking on vacancy/shortlist approval.
- Multi-position vacancy fill tracking (`positionsAccepted` computed from Offers).
- Reserve-list decline cascade (declining an offer promotes the next-ranked candidate).
- Qualification snapshots into `AuditLog.payload` at submission and at offer acceptance.
- Informational, non-blocking supervisor email notification on internal application submission.

**Auth & files**
- JWT auth with cumulative RBAC, separate sessions for candidates and staff.
- **Authenticated file access**: CVs, cover letters, and recommendation letters are
  served through `/api/files/:filename`, not a public static mount. Staff can view
  any file; a candidate can only view files attached to their own applications.
  Since plain `<a href>` downloads can't send an Authorization header, this route
  also accepts the JWT as a `?token=` query parameter, scoped only to file downloads.

**Temporary panelist access - no account, self-service scoring**
- HR can generate a scoped, single-use link per panelist ("Send scoring link") instead
  of proxying their score - same secure-token pattern as email confirmation and password
  reset (long random token, 14-day expiry, single-use).
- The public link (`/panel-score/:token`, no login) shows only what that panelist needs
  to score fairly - candidate name, vacancy, round details - never the full CV, national
  ID, or other applicants. Submitting consumes the token immediately, so it can't be
  replayed to revise a score later without HR issuing a new link.
- A panelist scored this way is marked `selfSubmitted: true`, visible in the HR view
  ("submitted by panelist" vs "recorded by HR") so the audit trail always shows who
  actually entered a score, not just who's attributed to it.
- HR can revoke an outstanding, unused link if it was sent in error, and can regenerate
  a link at any time - regenerating automatically revokes any prior unused link for that
  panelist first, so there's never a window where an old and new link are both valid
  simultaneously (found and fixed - the first version of this let both stay active).
- Proxy entry (HR transcribes on the panelist's behalf) and self-service links are both
  available side by side - use whichever fits a given panelist.

**Interview panel — accounts optional** (redesigned to handle real-world panels)
- Panel members are captured as lightweight records (`name`, `trade`, optional `email`),
  never requiring a system account - solves the real constraint that panels span many
  trades and often include people who'll never otherwise touch the system.
- Each panelist's score/comments is entered by the coordinating HR Officer on their
  behalf (`recordedById` tracks who actually transcribed it) - a proxy-entry model, since
  requiring every panelist to log in doesn't scale.
- The interview round's overall `score` is **computed automatically** as the average of
  every panelist scored so far - not a single person's summary guess.
- The round's `recommendation` (Shortlist/Hold/Reject) is a separate, deliberate action
  by the coordinating HR Officer once panel scores are in - a judgment call, not an
  average, since recommendations aren't numeric.
- `recommend-offer` now requires both a computed score *and* a finalized recommendation
  before Principal HR Officer+ can act - not just a bare number.
- If a panelist happens to have a staff account, the record can optionally link to it
  (`staffUserId`) - but this is never required.

**Interview-to-offer chain** (fixed end-to-end)
- Round numbers are computed server-side from existing rounds, not sent by the client -
  scheduling multiple rounds no longer collides on "Round 1".
- Application status now distinguishes `InterviewScheduled` (an interview is upcoming)
  from `Interviewed` (a score has actually been recorded) - previously these were
  conflated at the scheduling step.
- Panel members are captured at scheduling and shown against each round.
- **`recommend-offer`**: Principal HR Officer+ reviews a scored interview and formally
  creates the Offer record (this step was previously missing entirely - the "Approve
  offer" button existed with nothing for it to act on). Guarded so an offer can't be
  recommended without a scored interview, and can't be recommended twice for the same
  application.
- Offer accept/decline are now restricted to the candidate who owns the application
  (previously any authenticated user could call these endpoints for any offer).
- Candidate dashboard now lets a candidate accept or decline an Approved offer, which is
  what actually triggers the hire snapshot and vacancy fill recomputation - without this,
  that part of the workflow was unreachable through the UI.

**Automated tests** (`backend/tests/`, Jest)
- `workflowService.test.js` - 16 tests covering the verification gate, self-approval
  blocking, vacancy status computation, the offer decline cascade, and supervisor
  notification, all against a mocked Prisma client (no real database needed to run).
- `auth.middleware.test.js` - 5 tests covering the RBAC role hierarchy.
- `applicationController.test.js` - 6 tests covering the recommend-offer guard (requires
  a finalized interview recommendation, blocks duplicate recommendations) and the offer
  accept/decline ownership check.
- `interviewService.test.js` - 3 tests covering panel score averaging, including that
  unscored panelists are excluded from the average.
- `panelAccessService.test.js` - 8 tests covering the panelist access-link security
  properties: rejects unknown/expired/already-used tokens, rejects re-scoring an
  already-scored panelist, and confirms a token is only marked used on successful submit.
- `panelAccessController.test.js` - 3 tests confirming regenerating a link revokes any
  prior unused link first (no window where both are valid), and that generation is
  refused once a panelist is already scored.
- 42 tests total. Run with `npm test` inside `backend/`. Wired into CI.

## Not yet built

- End-to-end/integration tests against a real test database (unit tests cover the
  business logic; nothing yet exercises the full HTTP request/response cycle)
- Rate limiting on login and forgot-password endpoints
- A background job to purge expired/used VerificationToken rows

## Running locally

`docker-compose.yml` exists but isn't wired up for local dev yet - **see
[SETUP.md](SETUP.md) for how to run the API and frontend directly with
Node**, including database and Gmail SMTP setup.

Once running:
- API: http://localhost:4000
- Frontend: http://localhost:5173

Seeded staff accounts (password for all: `ChangeMe123!`):
- hro@caa.co.ug — HR Officer
- phro@caa.co.ug — Principal HR Officer
- dhra@caa.co.ug — DHRA / Manager HR

## Running tests

```bash
cd backend
npm install
npm test
```

## Hosting

Fully containerised, so the same setup works:

- **On-prem**: `docker compose up` directly on a UCAA server.
- **Cloud**: push the same images to any container platform and point `DATABASE_URL`
  at a managed MySQL instance.
- **Hybrid**: run MySQL on-prem and the API/frontend in the cloud (or vice versa) -
  only `DATABASE_URL` changes.

## Security notes before any real deployment

- Rotate `JWT_SECRET` - the one in `backend/.env` was randomly generated for this
  scaffold but should not be reused once the repo has any wider access.
- Set real SMTP credentials, or registration/notification/reset emails will silently fail.
- `backend/.env` is gitignored - do not remove it from `.gitignore` or commit a
  populated `.env` to the repository.
- Add rate limiting to `/api/candidates/auth/login`, `/forgot-password`, and the
  staff equivalents before production use.

## Theming and reusable components

All brand tokens (colors, spacing, radius, font) live in `frontend/src/theme.css` as CSS
variables. Every reusable component (`Button`, `TextField`, `TextArea`, `Select`, `Card`,
`StatusBadge`, `Alert`, `PageHeader`, `Modal`, `Navbar`) reads from these variables rather
than hardcoding values, and every view uses these components instead of one-off inline
styles or browser dialogs (`VacancyDetail`'s interview scheduling, scoring, and internal-
candidate verification all use themed `Modal` dialogs, not `window.prompt`). To apply
UCAA's real brand:

1. Replace the hex values in `theme.css` (`--color-primary`, `--color-accent`, etc.)
2. Replace `--font-family` if UCAA uses a specific brand typeface
3. Everything - buttons, badges, cards, page headers, the navbar - updates automatically

`StatusBadge` centralizes the color for every status enum in the system (vacancy status,
application status, offer status, verification status) in one lookup table, so status
colors stay consistent everywhere they appear rather than being re-decided per view.

## Deferred by design (per architecture discussion)

- HRMS integration for `InternalProfile` fields - currently self-declared + HR-verified.
- No AD/WSO2 integration - `candidateType` is determined purely by email domain +
  confirmation link.
