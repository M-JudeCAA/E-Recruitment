# No migration folder for Vacancy.filledAt / Offer.decidedAt

`schema.prisma` gained `Vacancy.filledAt` and `Offer.decidedAt`
(nullable `DateTime` columns) for the Analytics page's time-to-fill and
offer-outcome trend reporting, but no migration folder accompanies it.

`npx prisma migrate dev` refused to run: the shadow-database replay fails
on `20260915120000_age_flying_hours_exam_grades` (`Unknown column
'minimumEducationLevel' in 'Vacancy'`) - pre-existing migration-history
drift unrelated to this change (see the other two READMEs in this folder
for the project's prior history with this same class of problem). The
real database is not affected by that replay failure; only the shadow
database Prisma uses to validate a *new* migration is.

Per this project's own established pattern (`README_vacancy_approval_gate.md`),
the fix is `prisma db push` directly against the real database rather than
fighting migration history: both columns were added via `db push`,
confirmed with `prisma db push` reporting "database is now in sync," and
`prisma generate` re-run afterward so the client picks up the new fields.
Both columns are nullable with no default - zero data-loss risk, and
every existing row simply reads `null` for both until the code paths that
set them (`workflowService.recomputeVacancyStatus`,
`acceptOfferTransactionally`, `handleOfferDeclined`) run again.
