begin;

create unique index if not exists work_logs_one_open_per_user_uidx
  on public.work_logs(user_id) where ended_at is null;

create or replace function public.record_work_clock(p_user_id uuid,p_action text,p_source text default 'mini_app')
returns public.work_logs language plpgsql security definer set search_path=public as $$
declare v_log public.work_logs;
begin
 if p_action='clock_in' then
  if exists(select 1 from public.work_logs where user_id=p_user_id and ended_at is null) then raise exception 'Already clocked in'; end if;
  insert into public.work_logs(user_id,location_id,started_at,status,source)
   select p_user_id,default_location_id,now(),'submitted',p_source from public.users where id=p_user_id returning * into v_log;
 elsif p_action='clock_out' then
  select * into v_log from public.work_logs where user_id=p_user_id and ended_at is null order by started_at desc limit 1 for update;
  if v_log.id is null then raise exception 'No open work log'; end if;
  update public.work_logs set ended_at=now() where id=v_log.id returning * into v_log;
 else raise exception 'Invalid clock action';
 end if;
 perform public.write_audit_log(p_user_id,p_action,'work_log',v_log.id::text,p_source,null,to_jsonb(v_log),null);
 return v_log;
end $$;

revoke execute on function public.record_work_clock(uuid,text,text) from public,anon,authenticated;
commit;
