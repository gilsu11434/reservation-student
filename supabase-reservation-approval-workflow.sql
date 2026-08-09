-- 예약 승인제, 졸업작품 담당 교수, 이용확인서 승인 및 다음 예약 제한을 설정합니다.
-- Supabase Dashboard > SQL Editor > New query에서 전체 내용을 한 번 실행하세요.

begin;

-- 기존 예약은 바로 승인된 것으로 유지하고, 이 SQL 실행 후 생성되는 예약부터 승인 대기로 시작합니다.
alter table public.reservations
add column if not exists graduation_professor text;

alter table public.reservations
add column if not exists approval_status text;

update public.reservations
set approval_status = 'approved'
where approval_status is null;

alter table public.reservations
alter column approval_status set default 'pending';

alter table public.reservations
alter column approval_status set not null;

alter table public.reservations
add column if not exists approval_note text;

alter table public.reservations
add column if not exists approved_at timestamptz;

alter table public.reservations
add column if not exists approved_by uuid references auth.users(id);

-- 기존 예약은 다음 예약 제한 대상에서 제외하고, 이후 예약부터 보고서 승인을 요구합니다.
alter table public.reservations
add column if not exists report_required boolean not null default false;

alter table public.reservations
alter column report_required set default true;

-- 이용확인서 파일이 없어도 예약 단위로 승인 상태를 저장합니다.
alter table public.reservations
add column if not exists usage_report_review_status text not null default 'pending';

alter table public.reservations
add column if not exists usage_report_review_note text;

alter table public.reservations
add column if not exists usage_report_reviewed_at timestamptz;

alter table public.reservations
add column if not exists usage_report_reviewed_by uuid references auth.users(id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reservations_approval_status_check'
      and conrelid = 'public.reservations'::regclass
  ) then
    alter table public.reservations
    add constraint reservations_approval_status_check
    check (approval_status in ('pending', 'approved', 'rejected'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reservations_usage_report_review_status_check'
      and conrelid = 'public.reservations'::regclass
  ) then
    alter table public.reservations
    add constraint reservations_usage_report_review_status_check
    check (usage_report_review_status in ('pending', 'approved', 'rejected'));
  end if;
end;
$$;

alter table public.usage_reports
add column if not exists review_status text not null default 'pending';

alter table public.usage_reports
add column if not exists reviewed_at timestamptz;

alter table public.usage_reports
add column if not exists reviewed_by uuid references auth.users(id);

alter table public.usage_reports
add column if not exists review_note text;

-- 기존 프로젝트의 usage_reports 테이블에는 created_at이 없을 수 있습니다.
-- 관리자 화면과 최근 이용확인서 조회에서 사용할 제출 일시를 보완합니다.
alter table public.usage_reports
add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'usage_reports_review_status_check'
      and conrelid = 'public.usage_reports'::regclass
  ) then
    alter table public.usage_reports
    add constraint usage_reports_review_status_check
    check (review_status in ('pending', 'approved', 'rejected'));
  end if;
end;
$$;

create index if not exists reservations_approval_status_idx
on public.reservations (approval_status);

create index if not exists usage_reports_reservation_review_idx
on public.usage_reports (reservation_id, review_status);

create index if not exists reservations_usage_report_review_idx
on public.reservations (usage_report_review_status);

-- 기존 이용확인서의 최근 승인 상태를 예약 단위 상태로 한 번 동기화합니다.
update public.reservations as reservation
set
  usage_report_review_status = latest_report.review_status,
  usage_report_review_note = latest_report.review_note,
  usage_report_reviewed_at = latest_report.reviewed_at,
  usage_report_reviewed_by = latest_report.reviewed_by
from (
  select distinct on (report.reservation_id)
    report.reservation_id,
    report.review_status,
    report.review_note,
    report.reviewed_at,
    report.reviewed_by
  from public.usage_reports as report
  order by report.reservation_id, report.created_at desc
) as latest_report
where reservation.id = latest_report.reservation_id
  and reservation.usage_report_reviewed_at is null;

-- 예약 화면에서 입력한 담당 교수 이름만 본인 예약에 저장합니다.
create or replace function public.set_my_reservation_professor(
  p_reservation_id uuid,
  p_graduation_professor text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_professor_name text;
begin
  v_professor_name := regexp_replace(
    trim(coalesce(p_graduation_professor, '')),
    '[[:space:]]*교수님[[:space:]]*$',
    ''
  );

  if nullif(v_professor_name, '') is null then
    raise exception '종합설계 지도교수님 이름을 입력해 주세요.';
  end if;

  if v_professor_name !~ '^[가-힣A-Za-z·ㆍ ]+$'
    or char_length(regexp_replace(v_professor_name, '[ ·ㆍ]', '', 'g')) < 2
    or char_length(v_professor_name) > 30 then
    raise exception '종합설계 지도교수님 이름은 완성형 한글 또는 영문으로 2글자 이상 입력해 주세요. (예: 홍길동)';
  end if;

  update public.reservations as reservation
  set graduation_professor = v_professor_name
  where reservation.id = p_reservation_id
    and exists (
      select 1
      from public.teams as team
      where team.id = reservation.team_id
        and team.leader_id = auth.uid()
    );

  if not found then
    raise exception '본인이 신청한 예약을 찾을 수 없습니다.';
  end if;
end;
$$;

revoke all on function public.set_my_reservation_professor(uuid, text)
from public;

grant execute on function public.set_my_reservation_professor(uuid, text)
to authenticated;

-- 취소되지 않은 예약은 승인 전이라도 예약 시간으로 반환합니다.
create or replace function public.get_reservation_blocked_slots(
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
    reservation.end_at
      + coalesce(reservation.approved_extension_minutes, 0)
      * interval '1 minute' as effective_end_at
  from public.reservations as reservation
  where reservation.status::text <> 'cancelled'
    and reservation.start_at < p_to
    and (
      reservation.end_at
      + coalesce(reservation.approved_extension_minutes, 0)
      * interval '1 minute'
    ) > p_from
  order by reservation.start_at;
$$;

revoke all on function public.get_reservation_blocked_slots(
  timestamptz,
  timestamptz
) from public;

grant execute on function public.get_reservation_blocked_slots(
  timestamptz,
  timestamptz
) to authenticated;

-- 한 예약의 이용확인서가 관리자 승인될 때까지 같은 예약자는 다음 예약을 만들 수 없습니다.
create or replace function public.enforce_reservation_approval_cycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_leader_id uuid;
begin
  select team.leader_id
  into v_leader_id
  from public.teams as team
  where team.id = new.team_id;

  if v_leader_id is null then
    raise exception '예약자 정보를 확인할 수 없습니다.';
  end if;

  -- 같은 사용자가 동시에 두 요청을 보내도 한 건씩 검사합니다.
  perform pg_advisory_xact_lock(
    hashtextextended(v_leader_id::text, 0)
  );

  if exists (
    select 1
    from public.reservations as previous_reservation
    join public.teams as previous_team
      on previous_team.id = previous_reservation.team_id
    where previous_team.leader_id = v_leader_id
      and previous_reservation.status::text <> 'cancelled'
      and previous_reservation.report_required = true
      and previous_reservation.usage_report_review_status <> 'approved'
  ) then
    raise exception '이전 예약의 이용확인서에 대한 관리자 승인을 받은 후 다음 예약을 신청할 수 있습니다.'
      using errcode = '23514';
  end if;

  new.approval_status := 'pending';
  new.approval_note := null;
  new.approved_at := null;
  new.approved_by := null;
  new.report_required := true;

  return new;
end;
$$;

drop trigger if exists trigger_enforce_reservation_approval_cycle
on public.reservations;

create trigger trigger_enforce_reservation_approval_cycle
before insert on public.reservations
for each row
execute function public.enforce_reservation_approval_cycle();

-- 이용 종료 전 제출을 막고, 새 제출 또는 재제출은 관리자 확인 대기로 돌립니다.
create or replace function public.prepare_usage_report_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effective_end_at timestamptz;
  v_leader_id uuid;
  v_approval_status text;
  v_reservation_status text;
begin
  select
    reservation.end_at
      + coalesce(reservation.approved_extension_minutes, 0)
      * interval '1 minute',
    team.leader_id,
    reservation.approval_status,
    reservation.status::text
  into
    v_effective_end_at,
    v_leader_id,
    v_approval_status,
    v_reservation_status
  from public.reservations as reservation
  join public.teams as team
    on team.id = reservation.team_id
  where reservation.id = new.reservation_id;

  if v_leader_id is null then
    raise exception '예약 정보를 찾을 수 없습니다.';
  end if;

  if v_leader_id <> auth.uid() then
    raise exception '본인 예약의 이용확인서만 제출할 수 있습니다.';
  end if;

  if v_approval_status <> 'approved'
    or v_reservation_status = 'cancelled' then
    raise exception '승인된 예약의 이용확인서만 제출할 수 있습니다.';
  end if;

  if now() < v_effective_end_at then
    raise exception '이용이 종료된 후 이용확인서를 제출할 수 있습니다.';
  end if;

  new.review_status := 'pending';
  new.review_note := null;
  new.reviewed_at := null;
  new.reviewed_by := null;

  update public.reservations
  set
    usage_report_review_status = 'pending',
    usage_report_review_note = null,
    usage_report_reviewed_at = null,
    usage_report_reviewed_by = null
  where id = new.reservation_id;

  update public.reservations
  set status = 'ready'
  where id = new.reservation_id
    and status::text = 'completed';

  return new;
end;
$$;

drop trigger if exists trigger_prepare_usage_report_review
on public.usage_reports;

create trigger trigger_prepare_usage_report_review
before insert or update of file_path on public.usage_reports
for each row
execute function public.prepare_usage_report_review();

-- 관리자만 예약 신청을 승인하거나 거절할 수 있습니다.
create or replace function public.admin_review_reservation(
  p_reservation_id uuid,
  p_decision text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.user_roles as user_role
    where user_role.user_id = auth.uid()
      and user_role.role::text = 'admin'
  ) then
    raise exception '관리자만 예약을 승인할 수 있습니다.';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception '승인 또는 거절 상태가 올바르지 않습니다.';
  end if;

  if p_decision = 'approved' then
    update public.reservations
    set
      approval_status = 'approved',
      approval_note = nullif(trim(coalesce(p_note, '')), ''),
      approved_at = now(),
      approved_by = auth.uid()
    where id = p_reservation_id
      and status::text <> 'cancelled';
  else
    update public.reservations
    set
      approval_status = 'rejected',
      approval_note = nullif(trim(coalesce(p_note, '')), ''),
      approved_at = now(),
      approved_by = auth.uid(),
      status = 'cancelled'
    where id = p_reservation_id;
  end if;

  if not found then
    raise exception '처리할 예약을 찾을 수 없습니다.';
  end if;
end;
$$;

revoke all on function public.admin_review_reservation(uuid, text, text)
from public;

grant execute on function public.admin_review_reservation(uuid, text, text)
to authenticated;

-- 관리자는 파일 제출 여부와 관계없이 예약 단위로 이용확인서를 승인·반려·승인 취소할 수 있습니다.
create or replace function public.admin_review_reservation_report(
  p_reservation_id uuid,
  p_decision text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation_exists boolean;
begin
  if not exists (
    select 1
    from public.user_roles as user_role
    where user_role.user_id = auth.uid()
      and user_role.role::text = 'admin'
  ) then
    raise exception '관리자만 이용확인서를 승인할 수 있습니다.';
  end if;

  if p_decision not in ('approved', 'rejected', 'pending') then
    raise exception '승인, 반려 또는 승인 취소 상태가 올바르지 않습니다.';
  end if;

  select exists (
    select 1
    from public.reservations
    where id = p_reservation_id
  ) into v_reservation_exists;

  if not v_reservation_exists then
    raise exception '처리할 예약을 찾을 수 없습니다.';
  end if;

  -- 파일이 있으면 가장 최근 제출 기록도 같은 상태로 맞춥니다.
  update public.usage_reports
  set
    review_status = p_decision,
    review_note = case
      when p_decision = 'pending' then null
      else nullif(trim(coalesce(p_note, '')), '')
    end,
    reviewed_at = now(),
    reviewed_by = auth.uid()
  where id = (
    select report.id
    from public.usage_reports as report
    where report.reservation_id = p_reservation_id
    order by report.created_at desc
    limit 1
  );

  update public.reservations
  set
    usage_report_review_status = p_decision,
    usage_report_review_note = case
      when p_decision = 'pending' then null
      else nullif(trim(coalesce(p_note, '')), '')
    end,
    usage_report_reviewed_at = now(),
    usage_report_reviewed_by = auth.uid()
  where id = p_reservation_id;

  if p_decision = 'approved' then
    update public.reservations
    set status = 'completed'
    where id = p_reservation_id
      and status::text <> 'cancelled';
  else
    update public.reservations
    set status = 'ready'
    where id = p_reservation_id
      and status::text = 'completed';
  end if;
end;
$$;

revoke all on function public.admin_review_reservation_report(uuid, text, text)
from public;

grant execute on function public.admin_review_reservation_report(uuid, text, text)
to authenticated;

-- 이전 관리자 화면과의 호환성을 위해 파일 ID 기반 함수도 유지합니다.
create or replace function public.admin_review_usage_report(
  p_report_id uuid,
  p_decision text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation_id uuid;
begin
  select report.reservation_id
  into v_reservation_id
  from public.usage_reports as report
  where report.id = p_report_id;

  if v_reservation_id is null then
    raise exception '처리할 이용확인서를 찾을 수 없습니다.';
  end if;

  perform public.admin_review_reservation_report(
    v_reservation_id,
    p_decision,
    p_note
  );
end;
$$;

revoke all on function public.admin_review_usage_report(uuid, text, text)
from public;

grant execute on function public.admin_review_usage_report(uuid, text, text)
to authenticated;

commit;

-- 확인용: 아래 결과에 새 컬럼이 표시되면 정상입니다.
select
  column_name,
  data_type,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('reservations', 'usage_reports')
  and column_name in (
    'graduation_professor',
    'approval_status',
    'report_required',
    'review_status',
    'created_at',
    'usage_report_review_status',
    'usage_report_review_note',
    'usage_report_reviewed_at',
    'usage_report_reviewed_by'
  )
order by table_name, column_name;
