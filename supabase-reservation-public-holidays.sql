-- 창의융합프로젝트실 예약: 주말 및 대한민국 공휴일 예약 차단
-- Supabase SQL Editor에서 이 파일 전체를 한 번 실행하세요.

begin;

create table if not exists public.reservation_holidays (
  holiday_date date primary key,
  holiday_name text not null check (length(trim(holiday_name)) > 0),
  created_at timestamptz not null default now()
);

alter table public.reservation_holidays enable row level security;

revoke all on table public.reservation_holidays from anon, authenticated;

-- 우주항공청이 발표한 2026·2027년 월력요항 기준입니다.
-- 고정일 공휴일도 함께 저장해 관리자 확인과 명칭 표시에 사용합니다.
insert into public.reservation_holidays (holiday_date, holiday_name)
values
  ('2026-01-01', '신정'),
  ('2026-02-16', '설날 연휴'),
  ('2026-02-17', '설날'),
  ('2026-02-18', '설날 연휴'),
  ('2026-03-01', '삼일절'),
  ('2026-03-02', '삼일절 대체공휴일'),
  ('2026-05-01', '노동절'),
  ('2026-05-05', '어린이날'),
  ('2026-05-24', '부처님오신날'),
  ('2026-05-25', '부처님오신날 대체공휴일'),
  ('2026-06-03', '전국동시지방선거일'),
  ('2026-06-06', '현충일'),
  ('2026-07-17', '제헌절'),
  ('2026-08-15', '광복절'),
  ('2026-08-17', '광복절 대체공휴일'),
  ('2026-09-24', '추석 연휴'),
  ('2026-09-25', '추석'),
  ('2026-09-26', '추석 연휴'),
  ('2026-10-03', '개천절'),
  ('2026-10-05', '개천절 대체공휴일'),
  ('2026-10-09', '한글날'),
  ('2026-12-25', '기독탄신일'),
  ('2027-01-01', '신정'),
  ('2027-02-06', '설날 연휴'),
  ('2027-02-07', '설날'),
  ('2027-02-08', '설날 연휴'),
  ('2027-02-09', '설날 연휴 대체공휴일'),
  ('2027-03-01', '삼일절'),
  ('2027-05-01', '노동절'),
  ('2027-05-03', '노동절 대체공휴일'),
  ('2027-05-05', '어린이날'),
  ('2027-05-13', '부처님오신날'),
  ('2027-06-06', '현충일'),
  ('2027-07-17', '제헌절'),
  ('2027-07-19', '제헌절 대체공휴일'),
  ('2027-08-15', '광복절'),
  ('2027-08-16', '광복절 대체공휴일'),
  ('2027-09-14', '추석 연휴'),
  ('2027-09-15', '추석'),
  ('2027-09-16', '추석 연휴'),
  ('2027-10-03', '개천절'),
  ('2027-10-04', '개천절 대체공휴일'),
  ('2027-10-09', '한글날'),
  ('2027-10-11', '한글날 대체공휴일'),
  ('2027-12-25', '기독탄신일'),
  ('2027-12-27', '기독탄신일 대체공휴일')
on conflict (holiday_date) do update
set holiday_name = excluded.holiday_name;

-- 매년 날짜가 같은 공휴일은 별도 입력 없이도 계속 적용됩니다.
create or replace function public.reservation_fixed_holiday_name(
  p_date date
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case to_char(p_date, 'MM-DD')
    when '01-01' then '신정'
    when '03-01' then '삼일절'
    when '05-01' then '노동절'
    when '05-05' then '어린이날'
    when '06-06' then '현충일'
    when '07-17' then '제헌절'
    when '08-15' then '광복절'
    when '10-03' then '개천절'
    when '10-09' then '한글날'
    when '12-25' then '기독탄신일'
    else null
  end;
$$;

create or replace function public.get_reservation_holidays(
  p_from date,
  p_to date
)
returns table (
  holiday_date date,
  holiday_name text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with requested_dates as (
    select day_value::date as holiday_date
    from generate_series(
      p_from::timestamp,
      p_to::timestamp,
      interval '1 day'
    ) as requested_series(day_value)
    where p_from is not null
      and p_to is not null
      and p_from <= p_to
      and p_to - p_from <= 366
  )
  select
    requested_dates.holiday_date,
    coalesce(
      reservation_holidays.holiday_name,
      public.reservation_fixed_holiday_name(requested_dates.holiday_date)
    ) as holiday_name
  from requested_dates
  left join public.reservation_holidays
    on reservation_holidays.holiday_date = requested_dates.holiday_date
  where reservation_holidays.holiday_date is not null
     or public.reservation_fixed_holiday_name(requested_dates.holiday_date)
       is not null
  order by requested_dates.holiday_date;
$$;

revoke all on function public.reservation_fixed_holiday_name(date)
  from public;
revoke all on function public.get_reservation_holidays(date, date)
  from public;
grant execute on function public.get_reservation_holidays(date, date)
  to authenticated;

create or replace function public.enforce_reservation_business_day()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reservation_date date;
  v_holiday_name text;
begin
  v_reservation_date := (new.start_at at time zone 'Asia/Seoul')::date;

  if extract(isodow from v_reservation_date) in (6, 7) then
    raise exception '토요일과 일요일에는 예약할 수 없습니다.'
      using errcode = '23514';
  end if;

  select holiday_name
    into v_holiday_name
  from public.get_reservation_holidays(
    v_reservation_date,
    v_reservation_date
  )
  limit 1;

  if v_holiday_name is not null then
    raise exception '% 공휴일에는 예약할 수 없습니다.', v_holiday_name
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_reservation_business_day()
  from public;

drop trigger if exists reservations_enforce_business_day
  on public.reservations;

create trigger reservations_enforce_business_day
before insert or update of start_at
on public.reservations
for each row
execute function public.enforce_reservation_business_day();

commit;

-- 향후 발표되는 임시공휴일·선거일·대체공휴일은 아래 형식으로 추가합니다.
-- insert into public.reservation_holidays (holiday_date, holiday_name)
-- values ('2028-01-01', '공휴일 이름')
-- on conflict (holiday_date) do update
-- set holiday_name = excluded.holiday_name;
