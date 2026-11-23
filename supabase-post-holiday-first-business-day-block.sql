-- 창의융합프로젝트실: 주말·공휴일 신청 시 연휴 직후 첫 운영일 예약 차단
-- 기존 사이트에 추가 적용할 때 Supabase SQL Editor에서 이 파일만 전체 실행하세요.

begin;

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
  v_today_is_holiday boolean;
  v_post_holiday_date date;
  v_next_date_is_holiday boolean;
begin
  v_reservation_date := (new.start_at at time zone 'Asia/Seoul')::date;
  v_today := (current_timestamp at time zone 'Asia/Seoul')::date;

  select exists (
    select 1
    from public.get_reservation_holidays(v_today, v_today)
  )
  into v_today_is_holiday;

  if extract(isodow from v_today) in (6, 7)
    or v_today_is_holiday then
    v_post_holiday_date := v_today + 1;

    loop
      select exists (
        select 1
        from public.get_reservation_holidays(
          v_post_holiday_date,
          v_post_holiday_date
        )
      )
      into v_next_date_is_holiday;

      exit when extract(isodow from v_post_holiday_date) not in (6, 7)
        and not v_next_date_is_holiday;

      v_post_holiday_date := v_post_holiday_date + 1;
    end loop;

    if v_reservation_date = v_post_holiday_date then
      raise exception '현재가 주말 또는 공휴일이므로 연휴 직후 첫 운영일(%)은 예약할 수 없습니다.',
        to_char(v_post_holiday_date, 'YYYY-MM-DD')
        using errcode = '23514';
    end if;
  end if;

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
