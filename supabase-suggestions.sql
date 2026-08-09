-- 건의사항 게시판에 필요한 테이블과 접근 권한을 생성합니다.
-- Supabase Dashboard > SQL Editor에서 전체 내용을 한 번 실행하세요.

create table if not exists public.suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null,
  title text not null,
  content text not null,
  created_at timestamptz not null default now(),
  constraint suggestions_title_length
    check (char_length(trim(title)) between 1 and 100),
  constraint suggestions_content_length
    check (char_length(trim(content)) between 1 and 2000)
);

create index if not exists suggestions_created_at_idx
on public.suggestions (created_at desc);

alter table public.suggestions enable row level security;

-- 작성자를 브라우저 입력값으로 받지 않고 로그인 회원정보에서 자동 저장합니다.
create or replace function public.prepare_suggestion_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;

  new.user_id := auth.uid();
  new.author_name := coalesce(
    (
      select nullif(trim(profile.full_name), '')
      from public.profiles as profile
      where profile.id = auth.uid()
    ),
    '이용자'
  );
  new.title := trim(new.title);
  new.content := trim(new.content);

  return new;
end;
$$;

drop trigger if exists trigger_prepare_suggestion_author
on public.suggestions;

create trigger trigger_prepare_suggestion_author
before insert on public.suggestions
for each row
execute function public.prepare_suggestion_author();

-- 관리자와 작성자 본인만 원본 게시글(본문 포함)을 읽을 수 있습니다.
drop policy if exists "suggestions_read_all"
on public.suggestions;

drop policy if exists "suggestions_read_admin"
on public.suggestions;

drop policy if exists "suggestions_read_owner_or_admin"
on public.suggestions;

create policy "suggestions_read_owner_or_admin"
on public.suggestions
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
      select 1
      from public.user_roles as user_role
      where user_role.user_id = auth.uid()
        and user_role.role::text = 'admin'
    )
);

-- 일반 이용자에게는 제목, 가려진 작성자 이름, 작성일만 제공합니다.
-- 본문(content)과 사용자 식별값(user_id)은 이 View에 포함하지 않습니다.
create or replace view public.suggestion_public_list
with (security_barrier = true)
as
select
  suggestion.id,
  suggestion.title,
  case
    when char_length(trim(suggestion.author_name)) <= 1 then
      left(trim(suggestion.author_name), 1) || '*'
    when char_length(trim(suggestion.author_name)) = 2 then
      left(trim(suggestion.author_name), 1) || '*'
    else
      left(trim(suggestion.author_name), 1)
      || repeat('*', char_length(trim(suggestion.author_name)) - 2)
      || right(trim(suggestion.author_name), 1)
  end as masked_author_name,
  suggestion.created_at
from public.suggestions as suggestion;

drop policy if exists "suggestions_insert_authenticated"
on public.suggestions;

create policy "suggestions_insert_authenticated"
on public.suggestions
for insert
to authenticated
with check (user_id = auth.uid());

-- 수정할 때 작성자 정보는 바꾸지 못하도록 원래 값으로 고정합니다.
create or replace function public.prepare_suggestion_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.user_id := old.user_id;
  new.author_name := old.author_name;
  new.title := trim(new.title);
  new.content := trim(new.content);
  return new;
end;
$$;

drop trigger if exists trigger_prepare_suggestion_update
on public.suggestions;

create trigger trigger_prepare_suggestion_update
before update on public.suggestions
for each row
execute function public.prepare_suggestion_update();

drop policy if exists "suggestions_update_owner"
on public.suggestions;

create policy "suggestions_update_owner"
on public.suggestions
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "suggestions_delete_owner_or_admin"
on public.suggestions;

drop policy if exists "suggestions_delete_admin"
on public.suggestions;

create policy "suggestions_delete_owner_or_admin"
on public.suggestions
for delete
to authenticated
using (
  user_id = auth.uid()
  or exists (
      select 1
      from public.user_roles as user_role
      where user_role.user_id = auth.uid()
        and user_role.role::text = 'admin'
    )
);

revoke all on table public.suggestions from anon, authenticated;
grant select, insert, update, delete on table public.suggestions to authenticated;

revoke all on table public.suggestion_public_list
from public, anon, authenticated;

grant select on table public.suggestion_public_list
to anon, authenticated;
