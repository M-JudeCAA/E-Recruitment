# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

UCAA e-Recruitment System: React (frontend) + Node.js/Express (API) + MySQL via Prisma. Two independent npm projects, `backend/` and `frontend/`, no monorepo tooling. (A root `package.json` exists but only declares `playwright-core` — nothing in the repo uses it; ignore it, run everything from `backend/` or `frontend/`.)

## Commands

### Backend (`backend/`)

```bash
npm install
npm run dev              # nodemon, http://localhost:4000 (predev/prestart hooks auto-run `prisma generate`)
npm start                # plain node, no watch
npm test                 # jest, all suites, mocked Prisma client (no DB needed)
npx jest tests/workflowService.test.js   # single suite
npx jest -t "blocks an internal candidate"  # single test by name
npx prisma generate      # regenerate Prisma client after schema.prisma changes
npx prisma migrate dev   # create + apply a new migration locally
npx prisma migrate deploy  # apply pending migrations (what CI/prod uses)
npx prisma migrate status  # check if schema is up to date
npm run seed              # upsert seeded staff accounts (safe to re-run)
```

Seeded staff accounts (password for all: `ChangeMe123!`): `hro@caa.co.ug` (HR Officer), `phro@caa.co.ug` (Principal HR Officer), `dhra@caa.co.ug` (DHRA / Manager HR).

`backend/.env` is gitignored; required vars are documented in [SETUP.md](SETUP.md) (`DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `INTERNAL_EMAIL_DOMAIN`, `PORT`, `FRONTEND_URL`, `SMTP_*`, `UPLOAD_DIR`). SMTP misconfiguration fails silently (`sendMail` logs and returns `null`) rather than crashing request handling — expect emails to silently not arrive if SMTP env vars are wrong.

One-off maintenance scripts live in `backend/scripts/` (`node scripts/<name>.js`): `cleanupPendingRegistrations.js`, `checkSlaEscalations.js`, `checkVacancyDeadlines.js`, `seedDepartments.js`, `seedSlaPolicies.js`, `migrateEducationLevels.js`, plus two demo-data seeders, `seedPreShortlistDemoData.js` and `seedFullWorkflowDemoData.js`, for populating a dev DB at a given workflow stage.

### Frontend (`frontend/`)

```bash
npm install
npm run dev       # vite, http://localhost:5173 (candidate-facing; staff login is blocked here)
npm run build     # vite build -> dist/
npm run preview   # preview a production build
npm run preview:staff  # same build on http://localhost:4174 — the only port staff can sign in from
```

**Staff vs. candidate port**: it's one SPA build, but `/staff/login`, `/staff/forgot-password` and `/staff/reset-password` only render when `window.location.port` equals `STAFF_PORT` (`4174`, override with `VITE_STAFF_PORT`; see `staffPort.js` and `RequireStaffPort`/`GuestPortGate` in `ProtectedRoute.jsx`). To exercise staff screens locally you must `npm run build` then `npm run preview:staff` — the `:5173` dev server will bounce staff routes back to `/`. Details in [SETUP.md](SETUP.md).

No frontend test suite exists yet.

### CI

`.github/workflows/ci.yml` runs on push/PR to `main`/`develop`: backend job does `npm install && npx prisma generate && npm test`; frontend job does `npm install && npm run build`. Both must pass.

## Architecture

### MVC-ish split, backend and frontend use matching vocabulary

- **Backend** (`backend/src/`): classic MVC — `routes/` (thin URL→controller wiring only) → `controllers/` (request handling) → `models/` (data access, one file per entity, wraps Prisma) → `config/db.js` (the single shared `PrismaClient` instance, imported everywhere as `prisma`).
- **Frontend** (`frontend/src/`): `views/` (page-level screens, one per route, registered in `App.jsx`) use `components/` (reusable UI: `Navbar`, `Button`, `TextField`, `TextArea`, `Select`, `Card`, `StatusBadge`, `Alert`, `PageHeader`, `Modal`, `ProtectedRoute`) and read/write through `models/` (`apiClient.js` for candidate-facing calls, `staffApiClient.js` for HR-facing calls, `AuthContext.jsx` for session state). "Models" here means the data/state layer, not a UI component.
- **`services/` on the backend** is a layer between controllers and models for business logic that spans multiple models — not classic MVC, but load-bearing here: `workflowService.js` (verification gate, self-approval block, vacancy status computation, offer-decline cascade, qualification snapshots, posting-type transition audit), `interviewService.js` (panel score averaging), `panelAccessService.js` (panelist self-service token lifecycle), `screeningService.js` (automated applicant screening against vacancy criteria), `tokenService.js` (verification/reset token issuance), `notificationService.js` (in-app/email notification dispatch).

### Request handling & realtime

- **Async errors**: `server.js` loads `express-async-errors` (so a rejected async handler reaches the error middleware as a 500) and installs process-level `unhandledRejection`/`uncaughtException` handlers that log and keep the server alive. `utils/asyncHandler.js` is the older explicit per-route wrapper (used in `routes/candidates.js`); both patterns are live, don't assume one or the other.
- **Dashboard push channel**: `realtime/dashboardSocket.js` attaches a `ws` WebSocket server (`/ws/dashboard`) to the same HTTP server. It carries *signals, not data* — `broadcastDashboardEvent(event, payload)` tells connected HR dashboards to re-run their own REST fetch (`dashboardController`/`analyticsController` remain the source of truth). Auth is a first-message `{type:'auth', token}` handshake (staff JWTs only), deliberately **not** a `?token=` query param — see the file-access rule below. Frontend counterpart: `useDashboardEvents` in `frontend/src/models/dashboardSocket.js`, which degrades silently if the socket can't connect.
- **CV autofill** (`POST /api/candidates/me/parse-cv`, `cvParser.js` + `cvHeuristics.js` using `pdf-parse`/`mammoth`): parses an uploaded CV into suggested profile fields via `uploadMemory` and persists nothing. It's unrelated to the application-level CV upload in `applicationDraftController.js`, which does store the file.

### Auth & RBAC

Two independent JWT session types, both verified by the same `authenticate` middleware (`backend/src/middleware/auth.js`), distinguished by `req.user.type`: `'candidate'` and `'staff'`. `requireCandidate` gates candidate-only routes; `requireStaffRole(minRole)` gates staff routes by a **cumulative 5-tier role hierarchy**: `HR_Officer < Senior_HR_Officer < Principal_HR_Officer < Manager < Director` (`ROLE_RANK` in `auth.js` — the README's "3-tier" description predates this and is stale, trust the code).

**Delegation**: a staff member can be granted another's role rank for a bounded time window (`Delegation` model). `requireStaffRole` checks for an active delegation only when the requester's own rank fails the gate (avoids a DB query on every request), and if one is used, logs the specific action to `DelegationUsage` — the audit trail shows exactly when a delegation was actually exercised, not merely when it was active. This is distinct from and coexists with an older, simpler `StaffUser.actingAsId` static field; don't conflate the two.

`optionalAuthenticate` fails open to anonymous on a missing/invalid token — used for public browsing endpoints (e.g. job listings) that behave differently for logged-in candidates without requiring login.

### File access

CVs, cover letters, and recommendation letters are served through the authenticated `/api/files/:filename` route (`fileController.js`), never a public `express.static` mount. Staff can view any file; a candidate can only view files attached to their own applications. Since plain `<a href>` downloads can't set an Authorization header, this route also accepts the JWT as a `?token=` query param, scoped only to file downloads — don't extend that query-param acceptance to other routes.

### Org structure model

`Directorate → Department → Position → Vacancy`, each level created/approved by staff and carrying its own `createdById`/`approvedById` audit trail. `Department` has its own approval workflow (`Pending`/`Approved`/`Rejected`, distinct from `Vacancy.status`). `Position.level` is an integer meaningful only *within* the same department (not a global ladder), and a position name is unique per-department, not org-wide, because the same title/department name (e.g. "CWG") legitimately recurs under different directorates — see the `@@unique([name, directorateId])` / `@@unique([name, departmentId])` composite keys in `schema.prisma` before assuming a plain unique constraint.

### Vacancy → Application → Offer lifecycle

- A `Vacancy` is `Internal` or `External` posting type only (never both — `Open` was removed; see the enum comment in `schema.prisma` and `applicationEligibility.js` for the matching bidirectional account/vacancy check). Posting type can transition later, gated at Manager/Director tier and audited via `AuditLog` plus a role/previous-value snapshot on the `Vacancy` row itself.
- `Vacancy.title`, `Application`'s qualification snapshots, and `Vacancy.approvedByRole`/`postingTypeChangedByRole` are all deliberately denormalized snapshots of what was true at the time an action occurred (not live joins) — if you're tempted to "clean up" one of these into a read-through relation, don't; it's an intentional audit-trail pattern used consistently across this schema.
- Shortlisting drag-to-rank UI computes `Primary`/`Reserve` `listStatus` from drag position vs. `positionsRequired`, and **re-runs `workflowService.assertCanShortlist` for every application in the list before committing the rank** — an internal candidate who isn't `HR_Verified` (with evidence: `Comments` or `ManagerRecommendationLetter`) blocks the whole shortlist commit, regardless of department or posting type.
- Interview panel members don't need system accounts (`PanelMember.staffUserId` is optional) — HR proxies scores in on their behalf by default, or can issue a `PanelAccessToken` (single-use, 14-day expiry, same pattern as email confirmation/password-reset tokens) for a panelist to self-submit. Regenerating a link revokes any prior unused link for that panelist first, so two valid links never coexist. `InterviewRound.score` is always the **computed average** of that round's panel scores, never hand-entered; `recommendation` (Shortlist/Hold/Reject) is a separate deliberate action, not derived from the score.
- `recommend-offer` requires the application to be at `Interviewed` **and** a round with `score != null && recommendation === 'Shortlist'` specifically — not merely "some recommendation is present" — and is guarded against double-recommending the same application. Offer accept/decline is restricted to the owning candidate. Declining an offer runs `workflowService.handleOfferDeclined`, which promotes the next-ranked `Reserve` application to `Primary` and recomputes `Vacancy.status` (`Open`/`PartiallyFilled`/`Filled` from accepted-offer count vs. `positionsRequired`) — status computation, not a stored transition.
- Self-approval is blocked at the service layer (`assertNotSelfApproval`): whoever created a vacancy cannot approve it themselves.
- `ApplicationStatus.Rejected` is reachable exactly two ways, both recording `rejectedAt`/`rejectedById`/`rejectionReason` and firing an `ApplicationRejected` candidate notification: an explicit HR action (`PATCH /api/applications/:id/reject`, Senior_HR_Officer+, refused once the application is already `Draft`/`Offered`/`Rejected`/`Withdrawn`) or an interview panel's `recommendation === 'Reject'` at `interviewController.finalizeRecommendation` (routes there instead of to `Interviewed`). Candidates also get notified on shortlisting, an interview being scheduled, submission, and an offer becoming `Approved` — see `candidateNotificationService.notifyCandidate` call sites.

### Candidate application flow

Candidate-facing application is a multi-step wizard (`frontend/src/views/apply-wizard/`: `JobDetailsStep`, `ProfileStep`, `InternalProfileStep`, `QuestionsStep`, `DocumentsStep`, `ReviewStep`, `SubmitStep`), backed by a real draft/submit/withdraw workflow (`applicationDraftController.js`) rather than local-only wizard state — profile fields (`location`, `linkedinUrl`, etc.) persist on `Candidate` across every application; per-application answers (`desiredSalary`, `whyThisRole`, `desirableResponses`, etc.) persist on `Application`. `Vacancy.desirableRequirements` are Yes/No questions with a stable generated `id` per requirement so an applicant's snapshotted answer stays attributable even if the vacancy wording is later edited; a "No" answer is informational only and never fails automated screening (`screeningService.js`), which only evaluates the structured, machine-checked fields (`minimumEducationLevel`, `minimumExperienceYears`).

### Frontend routing/layout

`App.jsx` splits routes into two groups: most routes render inside `PaddedLayout` (adds a padding gutter around `Outlet`); a few self-contained full-bleed pages (`/register`, `/login`, `/apply/:vacancyId`, `/staff/login`) are registered as siblings outside that layout because they manage their own edge-to-edge background and would get an unwanted double inset otherwise. Keep that distinction in mind when adding new routes — decide whether the new view needs the padded shell or manages its own full-bleed layout.

`ProtectedRoute.jsx` exports `RequireCandidate` and `RequireStaff` (the latter taking `minRole`, checked against the same `ROLE_RANK` hierarchy as the backend) — client-side gating only; the backend middleware is the real enforcement.

### Theming

Tailwind is present but **`preflight` is disabled** (`tailwind.config.js`) — older pages were built against plain browser defaults plus `theme.css`, so only Tailwind's utility classes apply (used mainly in newer markup like the apply wizard). Don't re-enable preflight; it would restyle every page. Tailwind directives are imported at the top of `theme.css`.

All brand tokens (colors, spacing, radius, font) live in `frontend/src/theme.css` as CSS variables. Every reusable component reads from these variables rather than hardcoding values, and every view uses these components instead of one-off inline styles or browser dialogs (use themed `Modal`, never `window.prompt`/`window.confirm`). `StatusBadge` centralizes color-per-status-enum (vacancy/application/offer/verification status) in one lookup table — add new status colors there, not per-view. To rebrand: edit `theme.css` variables only.

### SLA / notifications

`SlaPolicy` (per `taskType` + role `tier`, duration in hours) and `TaskEscalation` back an SLA-tracking layer for `VacancyApproval`/`DepartmentApproval`/`OfferApproval`, checked via `scripts/checkSlaEscalations.js`. `Notification` supports `InApp`/`Email` channels per recipient staff user, surfaced in the UI via `NotificationBell.jsx`. A separate script, `scripts/checkVacancyDeadlines.js`, notifies a vacancy's creator exactly once (via `Vacancy.deadlineNotifiedAt`) when its application deadline passes while still `Open`/`PartiallyFilled` - it reuses the same `Notification`/`notify()` plumbing (hence the `VacancyDeadlinePassed` `SlaTaskType` value) but is not part of the escalation-tier machinery above. `applicationDraftController.submit` fires a `NewApplicationSubmitted` notification (same `notify()` plumbing, also not part of the escalation machinery) to the vacancy's creator on every submission, Internal or External - distinct from and in addition to `workflowService.notifySupervisor`, which only ever fires for Internal candidates and notifies their declared supervisor, not HR.

**Candidate-facing notifications** are a separate, parallel system - `CandidateNotification`/`CandidateNotificationType` (not `Notification`/`SlaTaskType` above), dispatched via `candidateNotificationService.notifyCandidate(candidateId, type, message)` and surfaced via `CandidateNotificationBell.jsx`. A distinct model rather than reusing `Notification`, since `Candidate.id` and `StaffUser.id` are independent autoincrement sequences that can collide in value - see the schema comment on `CandidateNotification`. Current types: `ProfileCompleted` (fired once, `profileCompletionService.js`), `ApplicationSubmitted`, `ApplicationShortlisted`, `InterviewScheduled`, `ApplicationRejected`, `OfferReceived` (fired when an offer reaches `Approved`, the point `OfferPanel` in `CandidateApplications.jsx` actually lets the candidate accept/decline it - not at `Recommended`, which they can't yet act on).

## Testing conventions (backend)

Every suite in `backend/tests/` mocks the shared Prisma client via `jest.mock('../src/config/db', () => require('./__mocks__/db'))` — `tests/__mocks__/db.js` is a hand-maintained object of `jest.fn()`s per model/method. **When adding a new Prisma call in application code, add the corresponding mock method to `tests/__mocks__/db.js` first**, or the test will fail with "not a function" rather than a useful assertion failure. Tests never touch a real database. `beforeEach(() => jest.clearAllMocks())` is the standard pattern at the top of each suite.

## Known gaps (intentional, not oversights)

- No end-to-end/integration tests against a real database — unit tests cover business logic only, mocked at the Prisma layer.
- No rate limiting on login/forgot-password endpoints.
- No background job purging expired/used `VerificationToken` rows (cleanup exists only for `PendingCandidateRegistration` via `scripts/cleanupPendingRegistrations.js`).
- `docker-compose.yml` exists but isn't wired up for local dev — use the two-terminal `npm run dev` flow in [SETUP.md](SETUP.md) instead.
- No HRMS/AD/WSO2 integration — `candidateType` (Internal/External) is determined purely by email domain (`INTERNAL_EMAIL_DOMAIN`) at registration, and `InternalProfile` fields are self-declared + HR-verified, not synced from an authoritative system.
