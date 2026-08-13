begin;

create or replace function public.review_leave_request(
  p_request_id uuid, p_reviewer uuid, p_approve boolean, p_note text default null
) returns public.leave_requests
language plpgsql security definer set search_path=public as $$
declare v_request public.leave_requests; v_allowed boolean;
begin
  select exists(select 1 from public.user_roles where user_id=p_reviewer and role in ('manager','admin')) into v_allowed;
  if not v_allowed then raise exception 'Manager role required'; end if;
  select * into v_request from public.leave_requests where id=p_request_id for update;
  if v_request.id is null then raise exception 'Leave request not found'; end if;
  if v_request.status <> 'pending' then raise exception 'Leave request already reviewed'; end if;
  update public.leave_requests set status=case when p_approve then 'approved' else 'rejected' end,
    reviewed_by=p_reviewer,reviewed_at=now(),review_note=p_note where id=p_request_id returning * into v_request;
  insert into public.approval_logs(entity_type,entity_id,action,actor_user_id,note)
    values('leave_request',p_request_id,case when p_approve then 'approved' else 'rejected' end,p_reviewer,p_note);
  perform public.write_audit_log(p_reviewer,case when p_approve then 'approve' else 'reject' end,'leave_request',p_request_id::text,'mini_app',null,to_jsonb(v_request),null);
  return v_request;
end $$;

revoke execute on function public.review_leave_request(uuid,uuid,boolean,text) from public,anon,authenticated;
commit;
