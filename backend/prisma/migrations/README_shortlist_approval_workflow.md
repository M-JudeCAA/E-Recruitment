# No migration folder for the shortlist propose/approve split

`schema.prisma` gained `ApplicationStatus.ShortlistProposed` and six new
`Application` columns (`shortlistProposedAt`/`shortlistProposedById`,
`shortlistApprovedAt`/`shortlistApprovedById`, plus their `StaffUser`
relations), but no migration folder accompanies them.

Same root cause as `README_analytics_timestamps.md` and
`README_notification_task_types.md`: `npx prisma migrate dev` refuses to
run because the shadow-database replay fails on
`20260915120000_age_flying_hours_exam_grades` (`Unknown column
'minimumEducationLevel' in 'Vacancy'`). That failure traces back to three
migrations recorded as applied in the live database's `_prisma_migrations`
table but never committed as files - `20260902092830_add_pending_candidate_registration`,
`20260902105052_internal_verification_code`, `20260902131141_add_vacancy_approval_gate`
(dated between `20260902055033_init` and `20260903094721_add_application_unique_constraint`).
Writing replacement migrations for those three isn't viable either -
per `README_vacancy_approval_gate.md`, the columns they'd create already
exist on the live database, so a real migration for them would fail the
moment `migrate deploy` tried to run it.

Per this project's established pattern (already used twice for this exact
blocker), the fix is `prisma db push` directly against the real database:
run, confirmed with "Your database is now in sync with your Prisma schema",
then `prisma generate` re-run so the client picks up the new fields/enum
value. All six new columns are nullable with no default - zero data-loss
risk, and every existing application row simply reads `null` for all of
them until `applicationController.shortlist`, `vacancyController.saveRanking`,
and the new `applicationController.approveShortlist` populate them going
forward.
