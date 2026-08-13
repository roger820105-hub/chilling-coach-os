begin;

alter table public.shifts add column if not exists external_source text;
alter table public.shifts add column if not exists external_ref text;
create unique index if not exists shifts_external_ref_uidx on public.shifts(external_source,external_ref);

create table if not exists public.staff_external_mappings(
 id uuid primary key default gen_random_uuid(), provider text not null, external_key text not null,
 user_id uuid not null references public.users(id), created_by uuid references public.users(id), created_at timestamptz not null default now(),
 unique(provider,external_key)
);

insert into public.integration_adapters(adapter_key,version,provider,direction,entity_type,field_mapping,config_schema,is_active)
values('hills-shifts','v1','google_sheets','import','shifts',
 '{"employee":"班表A欄姓名","date":"班表第2列日期","shift_code":"班表儲存格","shift_times":"班表AH:AJ"}'::jsonb,
 '{"spreadsheet_id":"1uVuYJvA7fucbMAznqVZnggHqZ3HGaV1WzMoO_2ytWH0","sheet_name":"班表","timezone":"Asia/Taipei"}'::jsonb,false)
on conflict(adapter_key,version) do nothing;

commit;
