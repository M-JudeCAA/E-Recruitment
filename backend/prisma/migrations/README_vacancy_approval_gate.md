# No migration for the Vacancy approval-gate schema change

`schema.prisma`'s `Vacancy` model gained `PendingApproval`/`Rejected` on
`VacancyStatus`, a `PendingApproval` default, and `approvedAt` /
`approvedById` / `rejectionReason`, but no migration folder accompanies it.

This is not an oversight. The live database, inspected directly via
`information_schema.columns` before writing anything, already has all of
this exactly as declared:

```
status column:  enum('PendingApproval','Open','PartiallyFilled','Filled','Closed','Rejected')
                 DEFAULT 'PendingApproval'
approvedAt:      datetime(3) NULL
approvedById:    int NULL, with FK Vacancy_approvedById_fkey -> StaffUser.id already in place
rejectionReason: varchar(191) NULL
```

None of this was ever created by a migration in this repo - it predates
every migration currently in this folder. It is the same kind of
untracked drift this project already hit once with `Department.approvedAt`
/ `Department.rejectionReason` (which later got a real migration, in
`20260903144348_add_position_table`, when those columns were genuinely
added) and with the still-undeclared `PendingCandidateRegistration` table
found earlier in this engagement.

Writing an `ALTER TABLE ... ADD COLUMN` or `ALTER TABLE ... MODIFY COLUMN`
migration here would fail the moment `prisma migrate deploy` tried to run
it against this database, since every target already exists. The correct
action, per this project's own established pattern, is to bring
`schema.prisma` in line with reality and stop there.

The `Vacancy` table was empty at the time of this check (0 rows), so there
was also no existing-data migration question to resolve - unlike the
scenario this fix was originally written to anticipate.
