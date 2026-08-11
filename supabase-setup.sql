-- reservation-graduate 신규 Supabase 프로젝트 최초 설치 파일
-- Supabase Dashboard > SQL Editor > New query에서 이 파일 전체를 실행하세요.
-- 이 파일은 빈 Supabase 프로젝트를 기준으로 작성되었습니다.
-- 기존 창의융합실의 회원/예약 데이터는 복사하지 않고 구조와 권한만 생성합니다.
--
-- 실행 후 저장소에 포함된 추가 SQL을 아래 순서대로 실행하세요.
--  1) supabase-auto-approve.sql
--  2) supabase-participant-fields.sql
--  3) supabase-member-email.sql
--  4) supabase-participant-daily-limit.sql
--  5) supabase-participant-weekly-limit.sql
--  6) supabase-reservation-window-14-days.sql
--  7) supabase-admin-reservation-details.sql
--  8) supabase-suggestions.sql
--  9) supabase-storage-buckets.sql
-- 10) supabase-usage-reports-policy.sql
-- 11) supabase-certificate-review.sql
-- 12) supabase-reservation-approval-workflow.sql
-- 13) supabase-professor-name-validation.sql
-- 14) supabase-graduate-date-range.sql
--
-- 신규 프로젝트에서는 supabase-fix-usage-reports-created-at.sql과
-- supabase-manual-usage-report-approval.sql을 실행하지 않습니다.

begin;

-- -----------------------------------------------------------------------------
-- 1. 기본 테이블
-- -----------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  phone text not null default '',
  department text not null default '',
  student_id text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists profiles_email_lower_unique
on public.profiles (lower(trim(email)));

create unique index if not exists profiles_student_id_unique
on public.profiles (student_id)
where nullif(trim(student_id), '') is not null;

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user',
  is_approved boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_roles_role_check
    check (role in ('user', 'admin'))
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  team_name text not null,
  leader_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists teams_one_per_leader_unique
on public.teams (leader_id);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  requester_name text not null,
  requester_email text,
  requester_phone text not null,
  department text not null,
  student_id text not null,
  headcount integer not null,
  purpose text not null,
  equipment text not null default '',
  start_at timestamptz not null,
  end_at timestamptz not null,
  approved_extension_minutes integer not null default 0,
  effective_end_at timestamptz not null,
  status text not null default 'documents_pending',
  rules_agreed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reservations_headcount_check
    check (headcount between 1 and 10),
  constraint reservations_time_order_check
    check (end_at > start_at),
  constraint reservations_extension_check
    check (approved_extension_minutes between 0 and 120),
  constraint reservations_status_check
    check (status in ('documents_pending', 'ready', 'completed', 'cancelled'))
);

create index if not exists reservations_start_at_idx
on public.reservations (start_at);

create index if not exists reservations_team_id_idx
on public.reservations (team_id);

create index if not exists reservations_status_idx
on public.reservations (status);

create table if not exists public.reservation_members (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null
    references public.reservations(id) on delete cascade,
  member_name text not null,
  student_id text not null,
  member_email text,
  safety_certificate_path text,
  safety_submitted_at timestamptz,
  certificate_verified boolean not null default false,
  certificate_verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists reservation_members_reservation_id_idx
on public.reservation_members (reservation_id);

create unique index if not exists reservation_members_email_per_reservation_unique
on public.reservation_members (reservation_id, lower(trim(member_email)))
where member_email is not null;

create unique index if not exists reservation_members_student_per_reservation_unique
on public.reservation_members (reservation_id, student_id);

create table if not exists public.extension_requests (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null
    references public.reservations(id) on delete cascade,
  requested_minutes integer not null,
  reason text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint extension_requests_minutes_check
    check (requested_minutes between 1 and 120),
  constraint extension_requests_status_check
    check (status in ('pending', 'approved', 'rejected'))
);

create index if not exists extension_requests_reservation_id_idx
on public.extension_requests (reservation_id);

create table if not exists public.usage_reports (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null
    references public.reservations(id) on delete cascade,
  file_path text not null,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create unique index if not exists usage_reports_one_per_reservation_unique
on public.usage_reports (reservation_id);

-- -----------------------------------------------------------------------------
-- 2. 공통 보조 함수와 트리거
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trigger_profiles_updated_at on public.profiles;
create trigger trigger_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists trigger_user_roles_updated_at on public.user_roles;
create trigger trigger_user_roles_updated_at
before update on public.user_roles
for each row execute function public.set_updated_at();

drop trigger if exists trigger_teams_updated_at on public.teams;
create trigger trigger_teams_updated_at
before update on public.teams
for each row execute function public.set_updated_at();

create or replace function public.set_reservation_effective_end_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.effective_end_at :=
    new.end_at
    + coalesce(new.approved_extension_minutes, 0) * interval '1 minute';
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trigger_set_reservation_effective_end_at
on public.reservations;

create trigger trigger_set_reservation_effective_end_at
before insert or update of end_at, approved_extension_minutes
on public.reservations
for each row
execute function public.set_reservation_effective_end_at();

-- 가입 즉시 profiles와 user_roles를 자동 생성합니다.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    email,
    full_name,
    phone,
    department,
    student_id
  )
  values (
    new.id,
    lower(trim(coalesce(new.email, ''))),
    trim(coalesce(new.raw_user_meta_data->>'full_name', '')),
    trim(coalesce(new.raw_user_meta_data->>'phone', '')),
    trim(coalesce(new.raw_user_meta_data->>'department', '')),
    trim(coalesce(new.raw_user_meta_data->>'student_id', ''))
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = excluded.full_name,
    phone = excluded.phone,
    department = excluded.department,
    student_id = excluded.student_id,
    updated_at = now();

  insert into public.user_roles (user_id, role, is_approved)
  values (new.id, 'user', true)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert or update of email, raw_user_meta_data
on auth.users
for each row
execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = auth.uid()
      and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Row Level Security
-- -----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.teams enable row level security;
alter table public.reservations enable row level security;
alter table public.reservation_members enable row level security;
alter table public.extension_requests enable row level security;
alter table public.usage_reports enable row level security;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
on public.profiles for select to authenticated
using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert to authenticated
with check (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "user_roles_select_own_or_admin" on public.user_roles;
create policy "user_roles_select_own_or_admin"
on public.user_roles for select to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "teams_select_own_or_admin" on public.teams;
create policy "teams_select_own_or_admin"
on public.teams for select to authenticated
using (leader_id = auth.uid() or public.is_admin());

drop policy if exists "teams_insert_own" on public.teams;
create policy "teams_insert_own"
on public.teams for insert to authenticated
with check (leader_id = auth.uid());

drop policy if exists "teams_update_own" on public.teams;
create policy "teams_update_own"
on public.teams for update to authenticated
using (leader_id = auth.uid())
with check (leader_id = auth.uid());

drop policy if exists "reservations_select_owner_or_admin"
on public.reservations;
create policy "reservations_select_owner_or_admin"
on public.reservations for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.teams
    where teams.id = reservations.team_id
      and teams.leader_id = auth.uid()
  )
);

drop policy if exists "reservation_members_select_by_team_leader"
on public.reservation_members;
create policy "reservation_members_select_by_team_leader"
on public.reservation_members for select to authenticated
using (
  exists (
    select 1
    from public.reservations r
    join public.teams t on t.id = r.team_id
    where r.id = reservation_members.reservation_id
      and t.leader_id = auth.uid()
  )
);

drop policy if exists "reservation_members_insert_by_team_leader"
on public.reservation_members;
create policy "reservation_members_insert_by_team_leader"
on public.reservation_members for insert to authenticated
with check (
  exists (
    select 1
    from public.reservations r
    join public.teams t on t.id = r.team_id
    where r.id = reservation_members.reservation_id
      and t.leader_id = auth.uid()
  )
);

drop policy if exists "reservation_members_update_by_team_leader"
on public.reservation_members;
create policy "reservation_members_update_by_team_leader"
on public.reservation_members for update to authenticated
using (
  exists (
    select 1
    from public.reservations r
    join public.teams t on t.id = r.team_id
    where r.id = reservation_members.reservation_id
      and t.leader_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.reservations r
    join public.teams t on t.id = r.team_id
    where r.id = reservation_members.reservation_id
      and t.leader_id = auth.uid()
  )
);

drop policy if exists "extension_requests_select_owner_or_admin"
on public.extension_requests;
create policy "extension_requests_select_owner_or_admin"
on public.extension_requests for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.reservations r
    join public.teams t on t.id = r.team_id
    where r.id = extension_requests.reservation_id
      and t.leader_id = auth.uid()
  )
);

drop policy if exists "extension_requests_insert_owner"
on public.extension_requests;
create policy "extension_requests_insert_owner"
on public.extension_requests for insert to authenticated
with check (
  exists (
    select 1
    from public.reservations r
    join public.teams t on t.id = r.team_id
    where r.id = extension_requests.reservation_id
      and t.leader_id = auth.uid()
  )
);

drop policy if exists "usage_reports_select_by_owner_or_admin"
on public.usage_reports;
create policy "usage_reports_select_by_owner_or_admin"
on public.usage_reports for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.reservations r
    join public.teams t on t.id = r.team_id
    where r.id = usage_reports.reservation_id
      and t.leader_id = auth.uid()
  )
);

drop policy if exists "usage_reports_insert_by_owner"
on public.usage_reports;
create policy "usage_reports_insert_by_owner"
on public.usage_reports for insert to authenticated
with check (
  split_part(file_path, '/', 1) = auth.uid()::text
  and exists (
    select 1
    from public.reservations r
    join public.teams t on t.id = r.team_id
    where r.id = usage_reports.reservation_id
      and t.leader_id = auth.uid()
  )
);

drop policy if exists "usage_reports_update_by_owner"
on public.usage_reports;
create policy "usage_reports_update_by_owner"
on public.usage_reports for update to authenticated
using (
  exists (
    select 1
    from public.reservations r
    join public.teams t on t.id = r.team_id
    where r.id = usage_reports.reservation_id
      and t.leader_id = auth.uid()
  )
)
with check (
  split_part(file_path, '/', 1) = auth.uid()::text
  and exists (
    select 1
    from public.reservations r
    join public.teams t on t.id = r.team_id
    where r.id = usage_reports.reservation_id
      and t.leader_id = auth.uid()
  )
);

drop policy if exists "usage_reports_delete_by_owner_or_admin"
on public.usage_reports;
create policy "usage_reports_delete_by_owner_or_admin"
on public.usage_reports for delete to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.reservations r
    join public.teams t on t.id = r.team_id
    where r.id = usage_reports.reservation_id
      and t.leader_id = auth.uid()
  )
);

-- -----------------------------------------------------------------------------
-- 4. 예약 RPC 함수
-- -----------------------------------------------------------------------------

create or replace function public.get_booked_slots(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  id uuid,
  start_at timestamptz,
  end_at timestamptz,
  effective_end_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    reservation.id,
    reservation.start_at,
    reservation.end_at,
    reservation.effective_end_at
  from public.reservations as reservation
  where reservation.status <> 'cancelled'
    and reservation.start_at < p_to
    and reservation.effective_end_at > p_from
  order by reservation.start_at;
$$;

revoke all on function public.get_booked_slots(timestamptz, timestamptz)
from public;
grant execute on function public.get_booked_slots(timestamptz, timestamptz)
to authenticated;

create or replace function public.create_room_reservation(
  p_team_id uuid,
  p_requester_name text,
  p_requester_phone text,
  p_department text,
  p_student_id text,
  p_headcount integer,
  p_purpose text,
  p_equipment text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_rules_agreed boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation_id uuid;
  v_start_local timestamp;
  v_end_local timestamp;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.teams
    where id = p_team_id
      and leader_id = auth.uid()
  ) then
    raise exception '본인의 예약 정보가 아닙니다.' using errcode = '42501';
  end if;

  if not coalesce(p_rules_agreed, false) then
    raise exception '이용수칙에 동의해야 합니다.' using errcode = '23514';
  end if;

  if nullif(trim(coalesce(p_requester_name, '')), '') is null
    or nullif(trim(coalesce(p_requester_phone, '')), '') is null
    or nullif(trim(coalesce(p_department, '')), '') is null
    or nullif(trim(coalesce(p_student_id, '')), '') is null
    or nullif(trim(coalesce(p_purpose, '')), '') is null then
    raise exception '필수 예약자 정보와 사용 목적을 입력해 주세요.'
      using errcode = '22023';
  end if;

  if p_headcount is null or p_headcount < 1 or p_headcount > 10 then
    raise exception '사용 인원은 1명부터 10명까지 선택할 수 있습니다.'
      using errcode = '22023';
  end if;

  if p_start_at is null or p_end_at is null or p_end_at <= p_start_at then
    raise exception '시작 시각과 종료 시각을 확인해 주세요.'
      using errcode = '22023';
  end if;

  if p_end_at - p_start_at > interval '2 hours' then
    raise exception '하루 최대 이용시간은 2시간입니다.'
      using errcode = '23514';
  end if;

  if p_start_at < now() + interval '24 hours' then
    raise exception '예약은 이용 시작 24시간 전까지만 신청할 수 있습니다.'
      using errcode = '23514';
  end if;

  if (p_start_at at time zone 'Asia/Seoul')::date
    > (now() at time zone 'Asia/Seoul')::date + 14 then
    raise exception '예약은 현재부터 14일 이내의 날짜만 신청할 수 있습니다.'
      using errcode = '23514';
  end if;

  v_start_local := p_start_at at time zone 'Asia/Seoul';
  v_end_local := p_end_at at time zone 'Asia/Seoul';

  if v_start_local::date <> v_end_local::date then
    raise exception '시작 시각과 종료 시각은 같은 날짜여야 합니다.'
      using errcode = '23514';
  end if;

  if extract(isodow from v_start_local) not between 1 and 5 then
    raise exception '토요일과 일요일에는 예약할 수 없습니다.'
      using errcode = '23514';
  end if;

  if date_trunc('hour', v_start_local) <> v_start_local
    or date_trunc('hour', v_end_local) <> v_end_local then
    raise exception '예약 시각은 정각 단위로 선택해 주세요.'
      using errcode = '23514';
  end if;

  if v_start_local::time < time '10:00'
    or v_start_local::time >= time '18:00'
    or v_end_local::time > time '18:00' then
    raise exception '이용 가능 시간은 10:00부터 18:00까지입니다.'
      using errcode = '23514';
  end if;

  -- 같은 시각에 두 요청이 동시에 들어와도 중복예약이 생기지 않도록 잠급니다.
  -- IMMUTABLE 오류가 발생했던 GiST 표현식 인덱스는 사용하지 않습니다.
  perform pg_advisory_xact_lock(824611);

  if exists (
    select 1
    from public.reservations as reservation
    where reservation.status <> 'cancelled'
      and reservation.start_at < p_end_at
      and reservation.effective_end_at > p_start_at
  ) then
    raise exception '선택한 시간에는 이미 예약이 있습니다.'
      using errcode = '23P01';
  end if;

  insert into public.reservations (
    team_id,
    requester_name,
    requester_phone,
    department,
    student_id,
    headcount,
    purpose,
    equipment,
    start_at,
    end_at,
    effective_end_at,
    rules_agreed
  )
  values (
    p_team_id,
    trim(p_requester_name),
    trim(p_requester_phone),
    trim(p_department),
    trim(p_student_id),
    p_headcount,
    trim(p_purpose),
    trim(coalesce(p_equipment, '')),
    p_start_at,
    p_end_at,
    p_end_at,
    true
  )
  returning id into v_reservation_id;

  return v_reservation_id;
end;
$$;

revoke all on function public.create_room_reservation(
  uuid, text, text, text, text, integer, text, text,
  timestamptz, timestamptz, boolean
) from public;

grant execute on function public.create_room_reservation(
  uuid, text, text, text, text, integer, text, text,
  timestamptz, timestamptz, boolean
) to authenticated;

create or replace function public.cancel_my_reservation(
  p_reservation_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_id uuid;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;

  update public.reservations as reservation
  set status = 'cancelled'
  from public.teams as team
  where reservation.id = p_reservation_id
    and team.id = reservation.team_id
    and team.leader_id = auth.uid()
    and reservation.status <> 'cancelled'
  returning reservation.id into v_updated_id;

  if v_updated_id is null then
    raise exception '취소할 예약을 찾을 수 없거나 권한이 없습니다.'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.cancel_my_reservation(uuid) from public;
grant execute on function public.cancel_my_reservation(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. 테이블 권한
-- -----------------------------------------------------------------------------

grant usage on schema public to anon, authenticated;

revoke all on table public.profiles from anon, authenticated;
grant select, insert, update on table public.profiles to authenticated;

revoke all on table public.user_roles from anon, authenticated;
grant select on table public.user_roles to authenticated;

revoke all on table public.teams from anon, authenticated;
grant select, insert, update on table public.teams to authenticated;

revoke all on table public.reservations from anon, authenticated;
grant select on table public.reservations to authenticated;

revoke all on table public.reservation_members from anon, authenticated;
grant select, insert, update on table public.reservation_members
to authenticated;

revoke all on table public.extension_requests from anon, authenticated;
grant select, insert on table public.extension_requests to authenticated;

revoke all on table public.usage_reports from anon, authenticated;
grant select, insert, update, delete on table public.usage_reports
to authenticated;

-- -----------------------------------------------------------------------------
-- 6. 수료증 및 이용확인서 Storage
-- -----------------------------------------------------------------------------

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values
  (
    'safety-certificates',
    'safety-certificates',
    false,
    10485760,
    array['application/pdf', 'image/jpeg', 'image/png']
  ),
  (
    'usage-reports',
    'usage-reports',
    false,
    10485760,
    array['application/pdf', 'image/jpeg', 'image/png']
  )
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "safety_certificates_insert_own"
on storage.objects;
create policy "safety_certificates_insert_own"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'safety-certificates'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "safety_certificates_select_own_or_admin"
on storage.objects;
create policy "safety_certificates_select_own_or_admin"
on storage.objects for select to authenticated
using (
  bucket_id = 'safety-certificates'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
  )
);

drop policy if exists "safety_certificates_update_own"
on storage.objects;
create policy "safety_certificates_update_own"
on storage.objects for update to authenticated
using (
  bucket_id = 'safety-certificates'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'safety-certificates'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "safety_certificates_delete_own_or_admin"
on storage.objects;
create policy "safety_certificates_delete_own_or_admin"
on storage.objects for delete to authenticated
using (
  bucket_id = 'safety-certificates'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
  )
);

drop policy if exists "usage_reports_insert_own"
on storage.objects;
create policy "usage_reports_insert_own"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'usage-reports'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "usage_reports_select_own_or_admin"
on storage.objects;
create policy "usage_reports_select_own_or_admin"
on storage.objects for select to authenticated
using (
  bucket_id = 'usage-reports'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
  )
);

drop policy if exists "usage_reports_update_own"
on storage.objects;
create policy "usage_reports_update_own"
on storage.objects for update to authenticated
using (
  bucket_id = 'usage-reports'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'usage-reports'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "usage_reports_delete_own_or_admin"
on storage.objects;
create policy "usage_reports_delete_own_or_admin"
on storage.objects for delete to authenticated
using (
  bucket_id = 'usage-reports'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
  )
);

commit;

-- 설치 확인용: 모든 행의 installed가 true이면 초기 설치가 정상입니다.
select 'profiles' as object_name, to_regclass('public.profiles') is not null as installed
union all
select 'user_roles', to_regclass('public.user_roles') is not null
union all
select 'teams', to_regclass('public.teams') is not null
union all
select 'reservations', to_regclass('public.reservations') is not null
union all
select 'reservation_members', to_regclass('public.reservation_members') is not null
union all
select 'extension_requests', to_regclass('public.extension_requests') is not null
union all
select 'usage_reports', to_regclass('public.usage_reports') is not null
union all
select 'function:create_room_reservation', to_regprocedure(
  'public.create_room_reservation(uuid,text,text,text,text,integer,text,text,timestamptz,timestamptz,boolean)'
) is not null
union all
select 'function:cancel_my_reservation', to_regprocedure(
  'public.cancel_my_reservation(uuid)'
) is not null
union all
select 'trigger:on_auth_user_created', exists (
  select 1
  from pg_trigger
  where tgname = 'on_auth_user_created'
    and tgrelid = 'auth.users'::regclass
    and not tgisinternal
)
union all
select 'storage:safety-certificates', exists (
  select 1 from storage.buckets where id = 'safety-certificates'
)
union all
select 'storage:usage-reports', exists (
  select 1 from storage.buckets where id = 'usage-reports'
);
