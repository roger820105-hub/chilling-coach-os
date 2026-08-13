begin;

create table if not exists public.sales_records (
  id uuid primary key default gen_random_uuid(), location_id uuid references public.locations(id),
  student_id uuid references public.students(id), coach_id uuid references public.users(id),
  occurred_on date not null, record_type text not null, amount numeric not null check (amount >= 0),
  currency text not null default 'TWD', status text not null default 'confirmed',
  external_source text, external_ref text, raw_payload jsonb not null default '{}'::jsonb,
  note text, created_by uuid references public.users(id), created_at timestamptz not null default now(),
  unique nulls not distinct (external_source, external_ref)
);

create table if not exists public.group_classes (
  id uuid primary key default gen_random_uuid(), location_id uuid references public.locations(id),
  title text not null, instructor_id uuid references public.users(id), starts_at timestamptz not null,
  ends_at timestamptz, capacity integer check (capacity is null or capacity >= 0),
  status text not null default 'scheduled', metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.group_class_attendance (
  group_class_id uuid not null references public.group_classes(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  status text not null default 'booked', fee numeric, checked_in_at timestamptz, note text,
  primary key (group_class_id, student_id)
);

create table if not exists public.work_logs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id),
  location_id uuid references public.locations(id), started_at timestamptz not null, ended_at timestamptz,
  break_minutes integer not null default 0 check (break_minutes >= 0), category text,
  status text not null default 'submitted', source text not null default 'manual', external_ref text,
  note text, created_at timestamptz not null default now(), unique nulls not distinct (source, external_ref)
);
create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id),
  location_id uuid references public.locations(id), starts_at timestamptz not null, ends_at timestamptz not null,
  status text not null default 'scheduled', note text, created_by uuid references public.users(id),
  created_at timestamptz not null default now(), check (ends_at > starts_at)
);
create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id),
  location_id uuid references public.locations(id), leave_type text not null, starts_at timestamptz not null,
  ends_at timestamptz not null, reason text, status text not null default 'pending',
  reviewed_by uuid references public.users(id), reviewed_at timestamptz, review_note text,
  created_at timestamptz not null default now(), check (ends_at > starts_at)
);

create table if not exists public.payroll_periods (
  id uuid primary key default gen_random_uuid(), location_id uuid references public.locations(id),
  starts_on date not null, ends_on date not null, status text not null default 'draft',
  rule_version text, calculation_input jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id), approved_by uuid references public.users(id), approved_at timestamptz,
  created_at timestamptz not null default now(), check (ends_on >= starts_on),
  unique nulls not distinct (location_id, starts_on, ends_on)
);
create table if not exists public.payroll_records (
  id uuid primary key default gen_random_uuid(), payroll_period_id uuid not null references public.payroll_periods(id) on delete cascade,
  user_id uuid not null references public.users(id), status text not null default 'draft',
  components jsonb not null default '{}'::jsonb, gross_amount numeric, deductions numeric, net_amount numeric,
  note text, created_at timestamptz not null default now(), unique (payroll_period_id, user_id)
);

create table if not exists public.accounting_exports (
  id uuid primary key default gen_random_uuid(), location_id uuid references public.locations(id),
  export_type text not null, period_start date not null, period_end date not null, status text not null default 'draft',
  adapter_key text, adapter_version text, payload jsonb not null default '{}'::jsonb,
  artifact_url text, created_by uuid references public.users(id), created_at timestamptz not null default now(),
  check (period_end >= period_start)
);
create table if not exists public.approval_logs (
  id uuid primary key default gen_random_uuid(), entity_type text not null, entity_id uuid not null,
  action text not null check (action in ('submitted','approved','rejected','cancelled')),
  actor_user_id uuid not null references public.users(id), note text, created_at timestamptz not null default now()
);

create table if not exists public.integration_adapters (
  id uuid primary key default gen_random_uuid(), adapter_key text not null, version text not null,
  provider text not null, direction text not null check (direction in ('import','export','bidirectional')),
  entity_type text not null, field_mapping jsonb not null default '{}'::jsonb,
  config_schema jsonb not null default '{}'::jsonb, is_active boolean not null default false,
  created_by uuid references public.users(id), created_at timestamptz not null default now(),
  unique (adapter_key, version)
);
create table if not exists public.integration_runs (
  id uuid primary key default gen_random_uuid(), adapter_id uuid not null references public.integration_adapters(id),
  status text not null default 'queued', idempotency_key text not null unique,
  cursor jsonb, input_summary jsonb not null default '{}'::jsonb, output_summary jsonb not null default '{}'::jsonb,
  error_detail text, started_at timestamptz, completed_at timestamptz, created_at timestamptz not null default now()
);

commit;
