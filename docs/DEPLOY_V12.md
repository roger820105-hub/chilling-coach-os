# V12 / 1.0 deployment

## Before deployment

1. Create a Supabase backup.
2. Confirm the deployed Git commit is still the V6 source (`b1ccbb8`) or review newer changes.
3. Keep these Vercel variables: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`.
4. Never expose the Supabase secret to the Mini App.

## Database gate

Run these files in order in Supabase SQL Editor:

1. `202608120001_v12_core.sql`
2. `202608120002_v12_operations.sql`
3. `202608120003_v12_security.sql`

All migrations are additive. They do not rename or remove the V6 tables or columns. If any migration fails, stop and save the exact error; do not rerun partial statements manually.

## Application gate

Deploy the repository to Vercel. Verify `/api/me`, `/api/students`, `/api/packages`, and the LINE webhook before testing new endpoints. Then verify `/api/dashboard`, `/api/student-detail`, and `/api/copilot` from a logged-in LIFF session.

## Acceptance checklist

- V6: remaining sessions, booking, completion/deduction, training write, last/recent/date history, exercise history, progress, training summary, schedules, pending sessions, student status, daily/personal summary
- V12: dashboard values are live; coach cannot open an unassigned student; manager/admin can see authorized management data; body/assessment/plan empty states work
- Duplicate scheduled coach/time is rejected
- Duplicate active coach/student link and duplicate user role are rejected
- Role approval works only through a manager/admin reviewer
- Copilot cites stored sources and does not fabricate medical or payroll rules
- Integration adapters remain inactive until actual field mappings are supplied

## Rollback

Application rollback: redeploy commit `b1ccbb8`. The additive database tables may remain unused. Do not drop V12 tables in production as a routine rollback; restore from backup only if a migration caused confirmed data corruption.
