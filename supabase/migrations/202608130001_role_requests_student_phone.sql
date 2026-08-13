begin;

alter table public.students
  add column if not exists normalized_phone text
  generated always as (nullif(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), '')) stored;

create unique index if not exists students_normalized_phone_uidx
  on public.students(normalized_phone)
  where normalized_phone is not null;

create index if not exists role_requests_pending_idx
  on public.role_requests(status, requested_at desc);

commit;
