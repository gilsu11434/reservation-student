-- reservation-graduate 전용 날짜 기간 예약 기능
-- 기존 SQL 14개를 모두 실행한 뒤 Supabase SQL Editor에서 이 파일 전체를 한 번 실행하세요.
-- 기존 예약은 시간 예약(hourly)으로 보존하며 삭제하지 않습니다.

begin;

alter table public.reservations
add column if not exists reservation_mode text not null default 'hourly';

update public.reservations
set reservation_mode = 'hourly'
where reservation_mode is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reservations_mode_check'
      and conrelid = 'public.reservations'::regclass
  ) then
    alter table public.reservations
    add constraint reservations_mode_check
    check (reservation_mode in ('hourly', 'date_range'));
  end if;
end;
$$;

alter table public.reservations
add column if not exists graduation_professor text;

-- 졸업생용 예약은 사용 인원과 시간 누적 제한을 사용하지 않습니다.
-- 예약자 한 명은 수료증 제출을 위해 reservation_members에 계속 저장합니다.
drop trigger if exists trigger_enforce_participant_daily_limit
on public.reservation_members;

drop trigger if exists trigger_enforce_participant_weekly_limit
on public.reservation_members;

create or replace function public.create_graduate_date_range_reservation(
  p_team_id uuid,
  p_requester_name text,
  p_requester_email text,
  p_requester_phone text,
  p_department text,
  p_student_id text,
  p_graduation_professor text,
  p_purpose text,
  p_equipment text,
  p_start_date date,
  p_end_date date,
  p_rules_agreed boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation_id uuid;
  v_requester_email text;
  v_professor_name text;
  v_today date;
  v_start_at timestamptz;
  v_end_at timestamptz;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.teams as team
    where team.id = p_team_id
      and team.leader_id = auth.uid()
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
    or nullif(trim(coalesce(p_purpose, '')), '') is null
    or nullif(trim(coalesce(p_equipment, '')), '') is null then
    raise exception '필수 예약자 정보, 사용할 장비와 사용 목적을 입력해 주세요.'
      using errcode = '22023';
  end if;

  v_requester_email := lower(trim(coalesce(p_requester_email, '')));

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = auth.uid()
      and lower(trim(profile.email)) = v_requester_email
  ) then
    raise exception '예약자 이메일이 로그인 회원정보와 일치하지 않습니다.'
      using errcode = '23514';
  end if;

  v_professor_name := regexp_replace(
    trim(coalesce(p_graduation_professor, '')),
    '[[:space:]]*교수님([[:space:]]*연구실)?[[:space:]]*$',
    ''
  );

  if nullif(v_professor_name, '') is null then
    raise exception '지도교수님 이름을 입력해 주세요.' using errcode = '22023';
  end if;

  if v_professor_name !~ '^[가-힣A-Za-z·ㆍ ]+$'
    or char_length(regexp_replace(v_professor_name, '[ ·ㆍ]', '', 'g')) < 2
    or char_length(v_professor_name) > 30 then
    raise exception '지도교수님 이름은 완성형 한글 또는 영문으로 2글자 이상 입력해 주세요. (예: 홍길동)'
      using errcode = '22023';
  end if;

  if p_start_date is null or p_end_date is null then
    raise exception '시작 날짜와 종료 날짜를 모두 선택해 주세요.'
      using errcode = '22023';
  end if;

  if p_end_date < p_start_date then
    raise exception '종료 날짜는 시작 날짜 이후여야 합니다.'
      using errcode = '23514';
  end if;

  if p_end_date - p_start_date > 4 then
    raise exception '한 번에 최대 연속 평일 5일까지 선택할 수 있습니다.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from generate_series(
      p_start_date::timestamp,
      p_end_date::timestamp,
      interval '1 day'
    ) as selected_dates(selected_date)
    where extract(isodow from selected_date) not between 1 and 5
  ) then
    raise exception '토요일과 일요일을 포함한 기간은 예약할 수 없습니다.'
      using errcode = '23514';
  end if;

  v_today := (now() at time zone 'Asia/Seoul')::date;

  if p_start_date < v_today + 1 then
    raise exception '예약 시작일은 내일부터 선택할 수 있습니다.'
      using errcode = '23514';
  end if;

  if p_end_date > v_today + 14 then
    raise exception '예약은 현재부터 14일 이내의 날짜만 신청할 수 있습니다.'
      using errcode = '23514';
  end if;

  v_start_at := (
    p_start_date + time '10:00'
  ) at time zone 'Asia/Seoul';
  v_end_at := (
    p_end_date + time '18:00'
  ) at time zone 'Asia/Seoul';

  -- 두 사용자가 동시에 같은 날짜를 신청해도 한 건만 저장되도록 직렬화합니다.
  perform pg_advisory_xact_lock(
    hashtextextended('graduate-room-date-range', 0)
  );

  if exists (
    select 1
    from public.reservations as reservation
    where reservation.status::text <> 'cancelled'
      and reservation.start_at < v_end_at
      and reservation.effective_end_at > v_start_at
  ) then
    raise exception '선택한 기간에 이미 예약된 날짜가 있습니다.'
      using errcode = '23P01';
  end if;

  insert into public.reservations (
    team_id,
    requester_name,
    requester_email,
    requester_phone,
    department,
    student_id,
    headcount,
    graduation_professor,
    purpose,
    equipment,
    start_at,
    end_at,
    effective_end_at,
    reservation_mode,
    rules_agreed
  )
  values (
    p_team_id,
    trim(p_requester_name),
    v_requester_email,
    trim(p_requester_phone),
    trim(p_department),
    trim(p_student_id),
    1,
    v_professor_name,
    trim(p_purpose),
    trim(p_equipment),
    v_start_at,
    v_end_at,
    v_end_at,
    'date_range',
    true
  )
  returning id into v_reservation_id;

  insert into public.reservation_members (
    reservation_id,
    member_name,
    student_id,
    member_email
  )
  values (
    v_reservation_id,
    trim(p_requester_name),
    trim(p_student_id),
    v_requester_email
  );

  return v_reservation_id;
end;
$$;

revoke all on function public.create_graduate_date_range_reservation(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  date,
  date,
  boolean
) from public;

grant execute on function public.create_graduate_date_range_reservation(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  date,
  date,
  boolean
) to authenticated;

commit;

select
  'function:create_graduate_date_range_reservation' as check_name,
  to_regprocedure(
    'public.create_graduate_date_range_reservation(uuid,text,text,text,text,text,text,text,text,date,date,boolean)'
  ) is not null as installed;
