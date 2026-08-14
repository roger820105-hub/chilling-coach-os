-- Chilling Coach OS 2.0: student CRM, renewals, reminders and coach performance.
-- This migration intentionally retires staff attendance/payroll features from use.
begin;

alter table public.students add column if not exists birthday date;
alter table public.students add column if not exists gender text;
alter table public.students add column if not exists tags text[] not null default '{}';
alter table public.students add column if not exists archived_at timestamptz;

alter table public.packages add column if not exists payment_status text not null default 'paid';
alter table public.packages add column if not exists paid_amount numeric not null default 0;
alter table public.packages add column if not exists frozen_until date;
alter table public.packages add column if not exists renewed_from_id uuid references public.packages(id);

create table if not exists public.package_adjustments (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.packages(id) on delete cascade,
  delta_sessions integer not null check (delta_sessions <> 0),
  reason text not null,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.renewal_followups (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  coach_id uuid not null references public.users(id),
  package_id uuid references public.packages(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','contacted','interested','confirmed','renewed','lost')),
  probability integer not null default 40 check (probability between 0 and 100),
  expected_amount numeric not null default 0 check (expected_amount >= 0),
  next_contact_at timestamptz,
  last_contact_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (student_id, package_id)
);
create index if not exists renewal_followups_coach_status_idx on public.renewal_followups(coach_id,status,next_contact_at);

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  class_reminders boolean not null default true,
  renewal_reminders boolean not null default true,
  manager_digest boolean not null default false,
  quiet_start time not null default '22:00',
  quiet_end time not null default '08:00',
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.users(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  event_type text not null,
  event_key text not null unique,
  scheduled_for timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','sent','failed','cancelled')),
  attempts integer not null default 0,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists notification_jobs_due_idx on public.notification_jobs(status,scheduled_for);

create table if not exists public.message_usage_monthly (
  month date primary key,
  sent_count integer not null default 0,
  monthly_limit integer not null default 200,
  updated_at timestamptz not null default now()
);

-- Package purchases are the source of truth for coach sales performance.
create or replace function public.capture_package_sale() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into public.sales_records(student_id,coach_id,occurred_on,record_type,amount,status,external_source,external_ref,created_by)
  values(new.student_id,new.coach_id,coalesce(new.purchased_at::date,current_date),
    case when new.renewed_from_id is null then 'package_purchase' else 'renewal' end,
    coalesce(nullif(new.paid_amount,0),new.price,0),'confirmed','packages',new.id::text,new.coach_id)
  on conflict (external_source,external_ref) do update set amount=excluded.amount,status=excluded.status;
  return new;
end $$;
drop trigger if exists capture_package_sale_after_write on public.packages;
create trigger capture_package_sale_after_write after insert or update of price,paid_amount,payment_status on public.packages
for each row when (new.payment_status='paid') execute function public.capture_package_sale();

-- Retire old employee-operation adapters so they cannot continue importing data.
update public.integration_adapters set is_active=false
where entity_type in ('shift','work_log','leave_request','payroll','group_class','accounting');

commit;
