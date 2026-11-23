-- 창의융합프로젝트실: 주말·공휴일 직후 첫 운영일 예약 차단
-- Supabase SQL Editor에서 이 파일 전체를 한 번 실행하세요.

begin;

do $$
begin
  if to_regprocedure(
    'public.get_reservation_holidays(date,date)'
  ) is null then
    raise exception
      '공휴일 설정이 없습니다. supabase-reservation-public-holidays.sql을 먼저 실행해 주세요.';
  end if;
end;
$$;

create or replace function public.enforce_reservation_business_day()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reservation_date date;
  v_holiday_name text;
  v_today date;
  v_today_holiday_name text;
  v_today_is_closed boolean;
  v_next_business_date date;
  v_next_holiday_name text;
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

  v_today := (now() at time zone 'Asia/Seoul')::date;

  select holiday_name
    into v_today_holiday_name
  from public.get_reservation_holidays(v_today, v_today)
  limit 1;

  v_today_is_closed :=
    extract(isodow from v_today) in (6, 7)
    or v_today_holiday_name is not null;

  if v_today_is_closed then
    v_next_business_date := v_today + 1;

    loop
      select holiday_name
        into v_next_holiday_name
      from public.get_reservation_holidays(
        v_next_business_date,
        v_next_business_date
      )
      limit 1;

      exit when
        extract(isodow from v_next_business_date) between 1 and 5
        and v_next_holiday_name is null;

      v_next_business_date := v_next_business_date + 1;
    end loop;

    if v_reservation_date = v_next_business_date then
      raise exception
        '현재가 주말 또는 공휴일이므로 연휴 직후 첫 운영일인 %에는 예약할 수 없습니다.',
        to_char(v_next_business_date, 'YYYY-MM-DD')
        using errcode = '23514';
    end if;
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

notify pgrst, 'reload schema';

select
  to_regprocedure('public.enforce_reservation_business_day()')
    as business_day_guard,
  to_regprocedure('public.get_reservation_holidays(date,date)')
    as holiday_lookup;
