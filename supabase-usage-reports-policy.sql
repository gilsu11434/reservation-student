-- 이용확인서 파일 업로드 후 public.usage_reports 테이블에
-- 제출 기록을 저장할 수 있도록 RLS 정책을 설정합니다.
-- Supabase Dashboard > SQL Editor > New query에서 전체 내용을 한 번 실행하세요.

begin;

alter table public.usage_reports enable row level security;

-- 예약을 만든 사용자는 본인 예약의 이용확인서 기록을 조회할 수 있습니다.
-- 관리자는 모든 이용확인서 기록을 조회할 수 있습니다.
drop policy if exists "usage_reports_select_by_owner_or_admin"
on public.usage_reports;

create policy "usage_reports_select_by_owner_or_admin"
on public.usage_reports
for select
to authenticated
using (
  exists (
    select 1
    from public.reservations as reservation
    join public.teams as team
      on team.id = reservation.team_id
    where reservation.id = usage_reports.reservation_id
      and team.leader_id = auth.uid()
  )
  or exists (
    select 1
    from public.user_roles as user_role
    where user_role.user_id = auth.uid()
      and user_role.role::text = 'admin'
  )
);

-- 예약을 만든 사용자만 본인 예약에 이용확인서 기록을 추가할 수 있습니다.
-- file_path의 첫 번째 폴더도 로그인 사용자의 UUID와 같아야 합니다.
drop policy if exists "usage_reports_insert_by_owner"
on public.usage_reports;

create policy "usage_reports_insert_by_owner"
on public.usage_reports
for insert
to authenticated
with check (
  split_part(file_path, '/', 1) = auth.uid()::text
  and exists (
    select 1
    from public.reservations as reservation
    join public.teams as team
      on team.id = reservation.team_id
    where reservation.id = usage_reports.reservation_id
      and team.leader_id = auth.uid()
  )
);

-- 추후 이용확인서 수정 기능을 추가해도 본인 예약의 기록만 변경할 수 있습니다.
drop policy if exists "usage_reports_update_by_owner"
on public.usage_reports;

create policy "usage_reports_update_by_owner"
on public.usage_reports
for update
to authenticated
using (
  exists (
    select 1
    from public.reservations as reservation
    join public.teams as team
      on team.id = reservation.team_id
    where reservation.id = usage_reports.reservation_id
      and team.leader_id = auth.uid()
  )
)
with check (
  split_part(file_path, '/', 1) = auth.uid()::text
  and exists (
    select 1
    from public.reservations as reservation
    join public.teams as team
      on team.id = reservation.team_id
    where reservation.id = usage_reports.reservation_id
      and team.leader_id = auth.uid()
  )
);

-- 예약을 만든 사용자 또는 관리자는 이용확인서 기록을 삭제할 수 있습니다.
drop policy if exists "usage_reports_delete_by_owner_or_admin"
on public.usage_reports;

create policy "usage_reports_delete_by_owner_or_admin"
on public.usage_reports
for delete
to authenticated
using (
  exists (
    select 1
    from public.reservations as reservation
    join public.teams as team
      on team.id = reservation.team_id
    where reservation.id = usage_reports.reservation_id
      and team.leader_id = auth.uid()
  )
  or exists (
    select 1
    from public.user_roles as user_role
    where user_role.user_id = auth.uid()
      and user_role.role::text = 'admin'
  )
);

grant select, insert, update, delete
on table public.usage_reports
to authenticated;

commit;

-- 실행 확인용 쿼리입니다. 아래 SELECT 결과에 INSERT 정책이 보이면 정상입니다.
select policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename = 'usage_reports'
order by policyname;
