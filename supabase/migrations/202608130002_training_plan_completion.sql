begin;

create table if not exists public.exercise_aliases (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references public.exercise_library(id) on delete cascade,
  alias text not null,
  normalized_alias text generated always as (lower(trim(alias))) stored,
  created_at timestamptz not null default now(),
  unique (normalized_alias)
);
alter table public.exercise_aliases enable row level security;
revoke all on public.exercise_aliases from anon;

create or replace function public.complete_planned_workout_for_session()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.status='completed' and old.status is distinct from 'completed' then
    update planned_workouts set status='completed', session_id=new.id
    where id=(select id from planned_workouts where student_id=new.student_id and status='planned'
      and planned_for between (new.scheduled_at at time zone 'Asia/Taipei')::date-3 and (new.scheduled_at at time zone 'Asia/Taipei')::date+3
      order by abs(planned_for-(new.scheduled_at at time zone 'Asia/Taipei')::date), planned_for limit 1);
  end if;
  return new;
end $$;
drop trigger if exists complete_planned_workout_after_session on public.sessions;
create trigger complete_planned_workout_after_session after update of status on public.sessions
for each row execute function public.complete_planned_workout_for_session();

commit;
