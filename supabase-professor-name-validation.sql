-- 종합설계 지도교수님 이름을 완성형 한글 또는 영문 2글자 이상으로 검사합니다.
-- Supabase Dashboard > SQL Editor에서 이 파일 전체를 한 번 실행하세요.

create or replace function public.set_my_reservation_professor(
  p_reservation_id uuid,
  p_graduation_professor text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_professor_name text;
begin
  v_professor_name := regexp_replace(
    trim(coalesce(p_graduation_professor, '')),
    '[[:space:]]*교수님[[:space:]]*$',
    ''
  );

  if nullif(v_professor_name, '') is null then
    raise exception '종합설계 지도교수님 이름을 입력해 주세요.';
  end if;

  if v_professor_name !~ '^[가-힣A-Za-z·ㆍ ]+$'
    or char_length(regexp_replace(v_professor_name, '[ ·ㆍ]', '', 'g')) < 2
    or char_length(v_professor_name) > 30 then
    raise exception '종합설계 지도교수님 이름은 완성형 한글 또는 영문으로 2글자 이상 입력해 주세요. (예: 홍길동)';
  end if;

  update public.reservations as reservation
  set graduation_professor = v_professor_name
  where reservation.id = p_reservation_id
    and exists (
      select 1
      from public.teams as team
      where team.id = reservation.team_id
        and team.leader_id = auth.uid()
    );

  if not found then
    raise exception '본인이 신청한 예약을 찾을 수 없습니다.';
  end if;
end;
$$;

revoke all on function public.set_my_reservation_professor(uuid, text)
from public;

grant execute on function public.set_my_reservation_professor(uuid, text)
to authenticated;
