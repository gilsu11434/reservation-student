-- 메인 페이지에서 개인정보 없이 금일 예약 시간만 공개 조회합니다.

begin;

create or replace function public.get_public_today_booked_slots()
returns table (
  start_at timestamptz,
  effective_end_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with seoul_day as (
    select
      (
        (now() at time zone 'Asia/Seoul')::date::timestamp
        at time zone 'Asia/Seoul'
      ) as day_start,
      (
        (
          (now() at time zone 'Asia/Seoul')::date + 1
        )::timestamp at time zone 'Asia/Seoul'
      ) as day_end
  )
  select
    reservation.start_at,
    coalesce(
      reservation.effective_end_at,
      reservation.end_at
    ) as effective_end_at
  from public.reservations as reservation
  cross join seoul_day
  where reservation.status::text <> 'cancelled'
    and reservation.start_at < seoul_day.day_end
    and coalesce(
      reservation.effective_end_at,
      reservation.end_at
    ) > seoul_day.day_start
  order by reservation.start_at;
$$;

revoke all on function public.get_public_today_booked_slots()
from public;

grant execute on function public.get_public_today_booked_slots()
to anon, authenticated;

commit;

select
  routine_name,
  data_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'get_public_today_booked_slots';
