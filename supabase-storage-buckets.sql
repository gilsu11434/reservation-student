-- 수료증과 이용확인서 업로드용 Supabase Storage 설정입니다.
-- Supabase Dashboard > SQL Editor > New query에서 전체 내용을 한 번 실행하세요.

begin;

-- my-reservation.js에서 사용하는 이름과 정확히 같아야 합니다.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values
  (
    'safety-certificates',
    'safety-certificates',
    false,
    10485760,
    array['application/pdf', 'image/jpeg', 'image/png']
  ),
  (
    'usage-reports',
    'usage-reports',
    false,
    10485760,
    array['application/pdf', 'image/jpeg', 'image/png']
  )
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 업로드 경로의 첫 번째 폴더는 my-reservation.js가 넣는 로그인 사용자 UUID입니다.
drop policy if exists "safety_certificates_insert_own"
on storage.objects;

create policy "safety_certificates_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'safety-certificates'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "safety_certificates_select_own_or_admin"
on storage.objects;

create policy "safety_certificates_select_own_or_admin"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'safety-certificates'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1
      from public.user_roles
      where user_id = auth.uid()
        and role::text = 'admin'
    )
  )
);

drop policy if exists "safety_certificates_update_own"
on storage.objects;

create policy "safety_certificates_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'safety-certificates'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'safety-certificates'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "safety_certificates_delete_own_or_admin"
on storage.objects;

create policy "safety_certificates_delete_own_or_admin"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'safety-certificates'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1
      from public.user_roles
      where user_id = auth.uid()
        and role::text = 'admin'
    )
  )
);

drop policy if exists "usage_reports_insert_own"
on storage.objects;

create policy "usage_reports_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'usage-reports'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "usage_reports_select_own_or_admin"
on storage.objects;

create policy "usage_reports_select_own_or_admin"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'usage-reports'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1
      from public.user_roles
      where user_id = auth.uid()
        and role::text = 'admin'
    )
  )
);

drop policy if exists "usage_reports_update_own"
on storage.objects;

create policy "usage_reports_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'usage-reports'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'usage-reports'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "usage_reports_delete_own_or_admin"
on storage.objects;

create policy "usage_reports_delete_own_or_admin"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'usage-reports'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1
      from public.user_roles
      where user_id = auth.uid()
        and role::text = 'admin'
    )
  )
);

commit;

-- 실행 후 Storage 메뉴에서 아래 두 Bucket이 보이면 정상입니다.
-- safety-certificates
-- usage-reports
