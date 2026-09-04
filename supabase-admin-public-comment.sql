-- 예약별 공개 관리자 코멘트
-- 관리자만 작성·수정할 수 있고, 예약자는 기존 예약 조회 권한을 통해 확인합니다.

begin;

alter table public.reservations
add column if not exists admin_comment text;

alter table public.reservations
add column if not exists admin_comment_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reservations_admin_comment_length_check'
      and conrelid = 'public.reservations'::regclass
  ) then
    alter table public.reservations
    add constraint reservations_admin_comment_length_check
    check (char_length(admin_comment) <= 1000);
  end if;
end;
$$;

-- 기존 예약 수정 권한이 있더라도 일반 사용자가 공개 코멘트를 위조하지 못하게 막습니다.
create or replace function public.protect_reservation_admin_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_changed boolean;
begin
  v_is_changed := case
    when tg_op = 'INSERT' then
      new.admin_comment is not null or
      new.admin_comment_updated_at is not null
    else
      new.admin_comment is distinct from old.admin_comment or
      new.admin_comment_updated_at is distinct from old.admin_comment_updated_at
  end;

  if v_is_changed and not exists (
    select 1
    from public.user_roles as user_role
    where user_role.user_id = auth.uid()
      and user_role.role::text = 'admin'
  ) then
    raise exception '관리자 코멘트는 관리자만 변경할 수 있습니다.';
  end if;

  return new;
end;
$$;

drop trigger if exists trigger_protect_admin_comment_on_insert
on public.reservations;

create trigger trigger_protect_admin_comment_on_insert
before insert on public.reservations
for each row
execute function public.protect_reservation_admin_comment();

drop trigger if exists trigger_protect_admin_comment_on_update
on public.reservations;

create trigger trigger_protect_admin_comment_on_update
before update of admin_comment, admin_comment_updated_at
on public.reservations
for each row
execute function public.protect_reservation_admin_comment();

revoke all on function public.protect_reservation_admin_comment()
from public;

create or replace function public.admin_set_reservation_comment(
  p_reservation_id uuid,
  p_comment text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  if not exists (
    select 1
    from public.user_roles as user_role
    where user_role.user_id = auth.uid()
      and user_role.role::text = 'admin'
  ) then
    raise exception '관리자만 코멘트를 저장할 수 있습니다.';
  end if;

  if length(v_comment) > 1000 then
    raise exception '관리자 코멘트는 1,000자 이하로 입력해 주세요.';
  end if;

  update public.reservations
  set
    admin_comment = v_comment,
    admin_comment_updated_at = case
      when v_comment is null then null
      else now()
    end
  where id = p_reservation_id;

  if not found then
    raise exception '예약 정보를 찾을 수 없습니다.';
  end if;
end;
$$;

revoke all on function public.admin_set_reservation_comment(uuid, text)
from public;

grant execute on function public.admin_set_reservation_comment(uuid, text)
to authenticated;

commit;

select
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'reservations'
  and column_name in (
    'admin_comment',
    'admin_comment_updated_at'
  )
order by column_name;
