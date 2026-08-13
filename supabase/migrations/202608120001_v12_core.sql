-- Chilling Coach OS 1.0 / V12
-- Additive migration: preserves every V6 table and column.
begin;

create extension if not exists pgcrypto;

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  timezone text not null default 'Asia/Taipei',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.users add column if not exists default_location_id uuid references public.locations(id);
alter table public.students add column if not exists location_id uuid references public.locations(id);

create table if not exists public.user_location_access (
  user_id uuid not null references public.users(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, location_id)
);

create table if not exists public.role_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  requested_role text not null check (requested_role in ('coach','manager','accountant','admin')),
  location_id uuid references public.locations(id),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  requested_at timestamptz not null default now(),
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  review_note text,
  unique nulls not distinct (user_id, requested_role, location_id, status)
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references public.users(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  location_id uuid references public.locations(id),
  request_id text,
  source text not null default 'system',
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_entity_idx on public.audit_logs(entity_type, entity_id, created_at desc);
create index if not exists audit_logs_actor_idx on public.audit_logs(actor_user_id, created_at desc);

create table if not exists public.student_goals (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  title text not null,
  description text,
  target_value numeric,
  unit text,
  target_date date,
  status text not null default 'active' check (status in ('active','achieved','paused','cancelled')),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.body_measurements (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  measured_at timestamptz not null,
  weight_kg numeric check (weight_kg is null or weight_kg > 0),
  body_fat_pct numeric check (body_fat_pct is null or body_fat_pct between 0 and 100),
  muscle_mass_kg numeric check (muscle_mass_kg is null or muscle_mass_kg > 0),
  waist_cm numeric, hip_cm numeric, chest_cm numeric,
  source text not null default 'manual',
  external_ref text,
  extra_metrics jsonb not null default '{}'::jsonb,
  note text,
  recorded_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  unique nulls not distinct (student_id, measured_at, source, external_ref)
);
create index if not exists body_measurements_student_time_idx on public.body_measurements(student_id, measured_at desc);

create table if not exists public.student_assessments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  assessment_type text not null,
  assessed_at timestamptz not null,
  results jsonb not null default '{}'::jsonb,
  injuries text,
  limitations text,
  note text,
  assessed_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.exercise_library (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text generated always as (lower(trim(name))) stored,
  category text,
  equipment text,
  instructions text,
  is_active boolean not null default true,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  unique (normalized_name)
);

create table if not exists public.training_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  goal text,
  weeks integer check (weeks is null or weeks > 0),
  location_id uuid references public.locations(id),
  created_by uuid references public.users(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.training_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.training_templates(id) on delete cascade,
  week_no integer not null default 1 check (week_no > 0),
  day_no integer not null default 1 check (day_no > 0),
  position integer not null default 1,
  exercise_id uuid references public.exercise_library(id),
  exercise_name text not null,
  target_sets integer, target_reps text, target_rpe numeric, rest_seconds integer,
  note text,
  unique (template_id, week_no, day_no, position)
);

create table if not exists public.student_training_plans (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  template_id uuid references public.training_templates(id),
  name text not null,
  starts_on date not null,
  ends_on date,
  status text not null default 'active' check (status in ('draft','active','completed','cancelled')),
  assigned_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.planned_workouts (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.student_training_plans(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  planned_for date not null,
  title text,
  items jsonb not null default '[]'::jsonb,
  session_id uuid references public.sessions(id),
  status text not null default 'planned' check (status in ('planned','completed','skipped','cancelled')),
  created_at timestamptz not null default now(),
  unique (plan_id, planned_for)
);

commit;
