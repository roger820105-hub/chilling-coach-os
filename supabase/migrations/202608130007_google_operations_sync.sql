begin;

alter table public.work_logs add column if not exists credited_hours numeric(8,2);
alter table public.work_logs drop constraint if exists work_logs_credited_hours_check;
alter table public.work_logs add constraint work_logs_credited_hours_check check (credited_hours is null or credited_hours >= 0);

alter table public.leave_requests add column if not exists requested_hours numeric(8,2);
alter table public.leave_requests add column if not exists external_source text;
alter table public.leave_requests add column if not exists external_ref text;
alter table public.leave_requests drop constraint if exists leave_requests_requested_hours_check;
alter table public.leave_requests add constraint leave_requests_requested_hours_check check (requested_hours is null or requested_hours >= 0);
create unique index if not exists leave_requests_external_uidx on public.leave_requests(external_source,external_ref) where external_source is not null and external_ref is not null;

insert into public.integration_adapters(adapter_key,version,provider,direction,entity_type,field_mapping,config_schema,is_active)
values
 ('hills-overtime','v1','google_sheets','import','work_logs','{}'::jsonb,'{}'::jsonb,true),
 ('hills-leave','v1','google_sheets','import','leave_requests','{}'::jsonb,'{}'::jsonb,true)
on conflict (adapter_key,version) do update set is_active=excluded.is_active;

commit;
