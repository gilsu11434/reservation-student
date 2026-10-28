-- 창의융합프로젝트실: 관리자 예약 제한 시간 관리
-- Supabase SQL Editor에서 이 파일 전체를 한 번 실행하세요.

begin;

create table if not exists public.reservation_time_blocks (
  id uuid primary key default gen_random_uuid(),
  start_at timestamptz not null,
  end_at timestamptz not null,
  reason text not null default '관리자 지정',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint reservation_time_blocks_time_order_check
    check (end_at > start_at),
  constraint reservation_time_blocks_reason_length_check
    check (char_length(reason) between 1 and 100)
);

create index if not exists reservation_time_blocks_start_at_idx
on public.reservation_time_blocks (start_at);

create index if not exists reservation_time_blocks_end_at_idx
on public.reservation_time_blocks (end_at);

alter table public.reservation_time_blocks enable row level security;

revoke all on table public.reservation_time_blocks
from public, anon, authenticated;

create or replace function public.admin_list_reservation_time_blocks()
returns table (
  id uuid,
  start_at timestamptz,
  end_at timestamptz,
  reason text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.user_roles as user_role
    where user_role.user_id = auth.uid()
      and user_role.role = 'admin'
      and user_role.is_approved = true
  ) then
    raise exception '승인된 관리자만 예약 제한 시간을 조회할 수 있습니다.'
      using errcode = '42501';
  end if;

  return query
  select
    time_block.id,
    time_block.start_at,
    time_block.end_at,
    time_block.reason,
    time_block.created_at
  from public.reservation_time_blocks as time_block
  order by time_block.start_at;
end;
$$;

create or replace function public.admin_create_reservation_time_block(
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_block_id uuid;
  v_start_local timestamp;
  v_end_local timestamp;
  v_reason text;
begin
  if not exists (
    select 1
    from public.user_roles as user_role
    where user_role.user_id = auth.uid()
      and user_role.role = 'admin'
      and user_role.is_approved = true
  ) then
    raise exception '승인된 관리자만 예약 제한 시간을 등록할 수 있습니다.'
      using errcode = '42501';
  end if;

  if p_start_at is null
    or p_end_at is null
    or p_end_at <= p_start_at then
    raise exception '시작 시각과 종료 시각을 확인해 주세요.'
      using errcode = '22023';
  end if;

  if p_start_at <= now() then
    raise exception '현재 시각 이후의 시간만 예약 제한으로 등록할 수 있습니다.'
      using errcode = '23514';
  end if;

  v_start_local := p_start_at at time zone 'Asia/Seoul';
  v_end_local := p_end_at at time zone 'Asia/Seoul';

  if v_start_local::date <> v_end_local::date then
    raise exception '시작 시각과 종료 시각은 같은 날짜여야 합니다.'
      using errcode = '23514';
  end if;

  if date_trunc('hour', v_start_local) <> v_start_local
    or date_trunc('hour', v_end_local) <> v_end_local then
    raise exception '예약 제한 시각은 정각 단위로 선택해 주세요.'
      using errcode = '23514';
  end if;

  if v_start_local::time < time '10:00'
    or v_start_local::time >= time '18:00'
    or v_end_local::time > time '18:00' then
    raise exception '예약 제한은 운영시간 10:00부터 18:00까지 설정할 수 있습니다.'
      using errcode = '23514';
  end if;

  v_reason := coalesce(
    nullif(trim(coalesce(p_reason, '')), ''),
    '관리자 지정'
  );

  if char_length(v_reason) > 100 then
    raise exception '제한 사유는 100자 이내로 입력해 주세요.'
      using errcode = '22023';
  end if;

  -- 예약 생성 함수와 같은 잠금을 사용해 동시 요청에서도 충돌을 막습니다.
  perform pg_advisory_xact_lock(824611);

  if exists (
    select 1
    from public.reservations as reservation
    where reservation.status::text <> 'cancelled'
      and reservation.start_at < p_end_at
      and coalesce(
        reservation.effective_end_at,
        reservation.end_at
      ) > p_start_at
  ) then
    raise exception '선택한 시간에 이미 예약이 있어 제한 시간을 등록할 수 없습니다.'
      using errcode = '23P01';
  end if;

  if exists (
    select 1
    from public.reservation_time_blocks as time_block
    where time_block.start_at < p_end_at
      and time_block.end_at > p_start_at
  ) then
    raise exception '선택한 시간과 겹치는 예약 제한이 이미 등록되어 있습니다.'
      using errcode = '23P01';
  end if;

  insert into public.reservation_time_blocks (
    start_at,
    end_at,
    reason,
    created_by
  )
  values (
    p_start_at,
    p_end_at,
    v_reason,
    auth.uid()
  )
  returning id into v_block_id;

  return v_block_id;
end;
$$;

create or replace function public.admin_delete_reservation_time_block(
  p_block_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted_id uuid;
begin
  if not exists (
    select 1
    from public.user_roles as user_role
    where user_role.user_id = auth.uid()
      and user_role.role = 'admin'
      and user_role.is_approved = true
  ) then
    raise exception '승인된 관리자만 예약 제한을 해제할 수 있습니다.'
      using errcode = '42501';
  end if;

  delete from public.reservation_time_blocks as time_block
  where time_block.id = p_block_id
  returning time_block.id into v_deleted_id;

  if v_deleted_id is null then
    raise exception '해제할 예약 제한 시간을 찾지 못했습니다.'
      using errcode = 'P0002';
  end if;
end;
$$;

-- 사용자 예약 화면에는 실제 예약과 관리자 제한 시간을 함께 반환합니다.
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
set search_path = public, pg_temp
as $$
  select
    blocked_slot.id,
    blocked_slot.start_at,
    blocked_slot.end_at,
    blocked_slot.effective_end_at
  from (
    select
      reservation.id,
      reservation.start_at,
      reservation.end_at,
      coalesce(
        reservation.effective_end_at,
        reservation.end_at
      ) as effective_end_at
    from public.reservations as reservation
    where reservation.status::text <> 'cancelled'

    union all

    select
      time_block.id,
      time_block.start_at,
      time_block.end_at,
      time_block.end_at as effective_end_at
    from public.reservation_time_blocks as time_block
  ) as blocked_slot
  where blocked_slot.start_at < p_to
    and blocked_slot.effective_end_at > p_from
  order by blocked_slot.start_at;
$$;

-- 메인 페이지 금일 예약 현황에도 관리자 제한 시간을 예약 불가로 표시합니다.
drop function if exists public.get_public_today_booked_slots();

create function public.get_public_today_booked_slots()
returns table (
  start_at timestamptz,
  effective_end_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with seoul_day as (
    select
      (
        (now() at time zone 'Asia/Seoul')::date::timestamp
        at time zone 'Asia/Seoul'
      ) as day_start,
      (
        ((now() at time zone 'Asia/Seoul')::date + 1)::timestamp
        at time zone 'Asia/Seoul'
      ) as day_end
  ),
  occupied_slots as (
    select
      reservation.start_at,
      coalesce(
        reservation.effective_end_at,
        reservation.end_at
      ) as effective_end_at
    from public.reservations as reservation
    where reservation.status::text <> 'cancelled'

    union all

    select
      time_block.start_at,
      time_block.end_at as effective_end_at
    from public.reservation_time_blocks as time_block
  )
  select
    occupied_slot.start_at,
    occupied_slot.effective_end_at
  from occupied_slots as occupied_slot
  cross join seoul_day
  where occupied_slot.start_at < seoul_day.day_end
    and occupied_slot.effective_end_at > seoul_day.day_start
  order by occupied_slot.start_at;
$$;

-- 화면을 우회한 예약 요청도 데이터베이스에서 차단합니다.
create or replace function public.enforce_reservation_time_blocks()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_effective_end_at timestamptz;
begin
  if new.status::text = 'cancelled' then
    return new;
  end if;

  v_effective_end_at := coalesce(new.effective_end_at, new.end_at);

  if exists (
    select 1
    from public.reservation_time_blocks as time_block
    where time_block.start_at < v_effective_end_at
      and time_block.end_at > new.start_at
  ) then
    raise exception '관리자가 예약을 제한한 시간입니다. 다른 시간을 선택해 주세요.'
      using errcode = '23P01';
  end if;

  return new;
end;
$$;

drop trigger if exists zz_reservations_enforce_time_blocks
on public.reservations;

create trigger zz_reservations_enforce_time_blocks
before insert or update of
  start_at,
  end_at,
  effective_end_at,
  approved_extension_minutes,
  status
on public.reservations
for each row
execute function public.enforce_reservation_time_blocks();

revoke all on function public.admin_list_reservation_time_blocks()
from public;
revoke all on function public.admin_create_reservation_time_block(
  timestamptz,
  timestamptz,
  text
) from public;
revoke all on function public.admin_delete_reservation_time_block(uuid)
from public;
revoke all on function public.get_reservation_blocked_slots(
  timestamptz,
  timestamptz
) from public;
revoke all on function public.get_public_today_booked_slots()
from public;
revoke all on function public.enforce_reservation_time_blocks()
from public;

grant execute on function public.admin_list_reservation_time_blocks()
to authenticated;
grant execute on function public.admin_create_reservation_time_block(
  timestamptz,
  timestamptz,
  text
) to authenticated;
grant execute on function public.admin_delete_reservation_time_block(uuid)
to authenticated;
grant execute on function public.get_reservation_blocked_slots(
  timestamptz,
  timestamptz
) to authenticated;
grant execute on function public.get_public_today_booked_slots()
to anon, authenticated;

commit;

notify pgrst, 'reload schema';

select
  to_regclass('public.reservation_time_blocks') as time_blocks_table,
  to_regprocedure('public.admin_create_reservation_time_block(timestamptz,timestamptz,text)')
    as create_time_block_function,
  to_regprocedure('public.admin_delete_reservation_time_block(uuid)')
    as delete_time_block_function;
