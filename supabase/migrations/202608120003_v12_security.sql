begin;

-- V6-compatible duplicate protection.
create unique index if not exists user_roles_user_role_uidx on public.user_roles(user_id, role);
create unique index if not exists coach_students_active_uidx on public.coach_students(coach_id, student_id) where ended_at is null;
create unique index if not exists sessions_coach_time_scheduled_uidx on public.sessions(coach_id, scheduled_at) where status = 'scheduled';

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$ declare t text; begin
  foreach t in array array['locations','student_goals','training_templates','student_training_plans','group_classes'] loop
    execute format('drop trigger if exists touch_updated_at on public.%I', t);
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

create or replace function public.write_audit_log(
  p_actor uuid, p_action text, p_entity_type text, p_entity_id text,
  p_source text default 'api', p_before jsonb default null, p_after jsonb default null,
  p_metadata jsonb default '{}'::jsonb
) returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  insert into audit_logs(actor_user_id, action, entity_type, entity_id, source, before_data, after_data, metadata)
  values(p_actor, p_action, p_entity_type, p_entity_id, p_source, p_before, p_after, coalesce(p_metadata,'{}'::jsonb))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.review_role_request(
  p_request_id uuid, p_reviewer uuid, p_approve boolean, p_note text default null
) returns public.role_requests language plpgsql security definer set search_path = public as $$
declare v_req role_requests; v_is_manager boolean;
begin
  select exists(select 1 from user_roles where user_id=p_reviewer and role in ('manager','admin')) into v_is_manager;
  if not v_is_manager then raise exception 'manager_or_admin_required'; end if;
  select * into v_req from role_requests where id=p_request_id for update;
  if v_req.id is null then raise exception 'request_not_found'; end if;
  if v_req.status <> 'pending' then raise exception 'request_already_reviewed'; end if;
  update role_requests set status=case when p_approve then 'approved' else 'rejected' end,
    reviewed_by=p_reviewer, reviewed_at=now(), review_note=p_note where id=p_request_id returning * into v_req;
  if p_approve then insert into user_roles(user_id,role) values(v_req.user_id,v_req.requested_role) on conflict do nothing; end if;
  perform write_audit_log(p_reviewer, case when p_approve then 'approve' else 'reject' end,
    'role_request', p_request_id::text, 'rpc', null, to_jsonb(v_req));
  return v_req;
end $$;

-- Tables are accessed only by trusted Vercel APIs using the Supabase secret.
-- Enabling RLS prevents accidental browser/anon access without inventing an auth mapping.
do $$ declare t text; begin
  foreach t in array array[
    'locations','user_location_access','role_requests','audit_logs','student_goals','body_measurements',
    'student_assessments','exercise_library','training_templates','training_template_items',
    'student_training_plans','planned_workouts','sales_records','group_classes','group_class_attendance',
    'work_logs','shifts','leave_requests','payroll_periods','payroll_records','accounting_exports',
    'approval_logs','integration_adapters','integration_runs'
  ] loop execute format('alter table public.%I enable row level security', t); end loop;
end $$;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on function public.review_role_request(uuid,uuid,boolean,text) from public, anon, authenticated;
revoke execute on function public.write_audit_log(uuid,text,text,text,text,jsonb,jsonb,jsonb) from public, anon, authenticated;

commit;
