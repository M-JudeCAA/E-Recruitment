# No migration for the two new SlaTaskType enum members

`schema.prisma`'s `SlaTaskType` enum gained `VacancyDeadlinePassed` and
`NewApplicationSubmitted`, but no migration folder accompanies it.

Same situation as `README_vacancy_approval_gate.md`: the live database,
inspected directly via `SHOW COLUMNS`, already had both values on all
three columns that use this enum, before this change was written:

```
SlaPolicy.taskType:      enum('VacancyApproval','DepartmentApproval','OfferApproval','VacancyDeadlinePassed','NewApplicationSubmitted')
TaskEscalation.taskType: enum('VacancyApproval','DepartmentApproval','OfferApproval','VacancyDeadlinePassed','NewApplicationSubmitted')
Notification.taskType:   enum('VacancyApproval','DepartmentApproval','OfferApproval','VacancyDeadlinePassed','NewApplicationSubmitted')
```

Two `Notification` rows (ids 7 and 8) already existed using
`VacancyDeadlinePassed`, both about the same vacancy, six seconds apart -
consistent with someone prototyping the vacancy-deadline notification
directly against this shared dev database (raw `ALTER TABLE` + a script
run twice) without ever committing the schema change or the code that
produces it. No application code anywhere in this repo's git history
(any branch) ever referenced either value before this change.

Writing an `ALTER TABLE ... MODIFY COLUMN` migration here would fail the
moment `prisma migrate deploy` tried to run it, since the target already
exists. Per this project's established pattern, the fix is to bring
`schema.prisma` in line with reality and stop there - see
`README_vacancy_approval_gate.md` for the precedent.

`VacancyDeadlinePassed` now has a real producer:
`scripts/checkVacancyDeadlines.js` (run on a schedule, same as
`checkSlaEscalations.js`). `NewApplicationSubmitted` is declared here
because it's already live on the enum, but nothing in this codebase
produces it yet - there was no orphaned data and no further context to
build against, so it's left for whoever originally started this to pick
back up.
