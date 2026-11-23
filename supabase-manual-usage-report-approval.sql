-- 이용확인서 파일 유무와 관계없는 관리자 승인 전용 패치입니다.
-- created_at 열을 사용하지 않으므로 기존 usage_reports 구조에서도 실행할 수 있습니다.
-- Supabase Dashboard > SQL Editor > New query에서 전체 내용을 한 번 실행하세요.

begin;

alter table public.reservations
add column if not exists usage_report_review_status text not null default 'pending';

alter table public.reservations
add column if not exists usage_report_review_note text;

alter table public.reservations
add column if not exists usage_report_reviewed_at timestamptz;

alter table public.reservations
add column if not exists usage_report_reviewed_by uuid references auth.users(id);

alter table public.usage_reports
add column if not exists review_status text not null default 'pending';

alter table public.usage_reports
add column if not exists review_note text;

alter table public.usage_reports
add column if not exists reviewed_at timestamptz;

alter table public.usage_reports
add column if not exists reviewed_by uuid references auth.users(id);

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

-- 기존에 승인된 이용확인서가 있으면 예약 단위 승인 상태로 옮깁니다.
update public.reservations as reservation
set usage_report_review_status = 'approved'
where reservation.usage_report_reviewed_at is null
  and exists (
    select 1
    from public.usage_reports as report
    where report.reservation_id = reservation.id
      and report.review_status = 'approved'
  );

update public.reservations as reservation
set usage_report_review_status = 'rejected'
where reservation.usage_report_reviewed_at is null
  and reservation.usage_report_review_status <> 'approved'
  and exists (
    select 1
    from public.usage_reports as report
    where report.reservation_id = reservation.id
      and report.review_status = 'rejected'
  );

create index if not exists reservations_usage_report_review_idx
on public.reservations (usage_report_review_status);

-- 파일이 새로 제출되거나 교체되면 다시 관리자 승인 대기로 전환합니다.
create or replace function public.sync_usage_report_submission_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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

drop trigger if exists trigger_sync_usage_report_submission_status
on public.usage_reports;

create trigger trigger_sync_usage_report_submission_status
after insert or update of file_path on public.usage_reports
for each row
execute function public.sync_usage_report_submission_status();

-- 관리자는 파일이 없어도 예약 ID만으로 승인·반려·승인 취소할 수 있습니다.
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

  if not exists (
    select 1
    from public.reservations
    where id = p_reservation_id
  ) then
    raise exception '처리할 예약을 찾을 수 없습니다.';
  end if;

  -- 파일이 있으면 해당 예약의 제출 기록도 같은 승인 상태로 맞춥니다.
  update public.usage_reports
  set
    review_status = p_decision,
    review_note = case
      when p_decision = 'pending' then null
      else nullif(trim(coalesce(p_note, '')), '')
    end,
    reviewed_at = now(),
    reviewed_by = auth.uid()
  where reservation_id = p_reservation_id;

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

-- 승인 취소 후에는 다음 예약 제한이 다시 적용되도록 검사 기준을 예약 승인 상태로 통일합니다.
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

commit;

select
  column_name,
  data_type,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'reservations'
  and column_name like 'usage_report_review%'
order by column_name;
