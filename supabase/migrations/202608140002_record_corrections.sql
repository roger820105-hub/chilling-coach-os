-- Editable student CRM with traceable package/session corrections.
begin;

alter table public.students add column if not exists updated_at timestamptz not null default now();
alter table public.body_measurements add column if not exists updated_at timestamptz not null default now();
alter table public.body_measurements add column if not exists archived_at timestamptz;
alter table public.student_assessments add column if not exists updated_at timestamptz not null default now();
alter table public.student_assessments add column if not exists archived_at timestamptz;
alter table public.packages add column if not exists updated_at timestamptz not null default now();
alter table public.packages add column if not exists voided_at timestamptz;
alter table public.packages add column if not exists void_reason text;

create or replace function public.adjust_package_sessions(
  p_package_id uuid, p_actor uuid, p_purchased integer, p_remaining integer, p_reason text
) returns public.packages
language plpgsql security definer set search_path=public as $$
declare v_old public.packages; v_new public.packages; v_reason text:=trim(coalesce(p_reason,''));
begin
  if v_reason='' then raise exception 'Adjustment reason required'; end if;
  if p_purchased < 0 or p_remaining < 0 or p_remaining > p_purchased then
    raise exception 'Invalid session totals';
  end if;
  select * into v_old from public.packages where id=p_package_id for update;
  if not found then raise exception 'Package not found'; end if;
  if p_remaining<>v_old.remaining_sessions then
    insert into public.package_adjustments(package_id,delta_sessions,reason,created_by)
    values(p_package_id,p_remaining-v_old.remaining_sessions,v_reason,p_actor);
  end if;
  update public.packages set purchased_sessions=p_purchased,remaining_sessions=p_remaining,updated_at=now()
  where id=p_package_id returning * into v_new;
  perform public.write_audit_log(p_actor,'adjust','package',p_package_id::text,'mini_app',to_jsonb(v_old),to_jsonb(v_new),jsonb_build_object('reason',v_reason));
  return v_new;
end $$;
revoke execute on function public.adjust_package_sessions(uuid,uuid,integer,integer,text) from public,anon,authenticated;

create or replace function public.reopen_session_and_restore(p_session_id uuid,p_actor uuid,p_reason text)
returns public.sessions
language plpgsql security definer set search_path=public as $$
declare v_old public.sessions; v_new public.sessions; v_reason text:=trim(coalesce(p_reason,''));
begin
  if v_reason='' then raise exception 'Restore reason required'; end if;
  select * into v_old from public.sessions where id=p_session_id for update;
  if not found then raise exception 'Session not found'; end if;
  if v_old.status<>'completed' then raise exception 'Only completed sessions can be restored'; end if;
  if v_old.package_id is not null then
    update public.packages set remaining_sessions=remaining_sessions+1,updated_at=now() where id=v_old.package_id;
    insert into public.package_adjustments(package_id,delta_sessions,reason,created_by)
    values(v_old.package_id,1,'復原課程：'||v_reason,p_actor);
  end if;
  update public.sessions set status='scheduled',completed_at=null where id=p_session_id returning * into v_new;
  update public.planned_workouts set status='planned' where session_id=p_session_id;
  perform public.write_audit_log(p_actor,'restore','session',p_session_id::text,'mini_app',to_jsonb(v_old),to_jsonb(v_new),jsonb_build_object('reason',v_reason));
  return v_new;
end $$;
revoke execute on function public.reopen_session_and_restore(uuid,uuid,text) from public,anon,authenticated;

commit;
