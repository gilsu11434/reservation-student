-- 관리자 페이지에서 예약을 완전히 삭제하기 위한 전용 함수입니다.
-- Supabase Dashboard > SQL Editor > New query에서 이 파일 전체를 한 번 실행하세요.

begin;

create or replace function public.admin_delete_reservation(
  p_reservation_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_id uuid;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.user_roles as user_role
    where user_role.user_id = auth.uid()
      and user_role.role::text = 'admin'
  ) then
    raise exception '관리자만 예약을 삭제할 수 있습니다.'
      using errcode = '42501';
  end if;

  if p_reservation_id is null then
    raise exception '삭제할 예약 ID가 필요합니다.'
      using errcode = '22004';
  end if;

  delete from public.reservations
  where id = p_reservation_id
  returning id into v_deleted_id;

  if v_deleted_id is null then
    raise exception '삭제할 예약 정보를 찾을 수 없습니다.'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.admin_delete_reservation(uuid)
from public;

grant execute on function public.admin_delete_reservation(uuid)
to authenticated;

commit;

select
  to_regprocedure('public.admin_delete_reservation(uuid)') is not null
    as admin_delete_reservation_installed;
