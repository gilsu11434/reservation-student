-- usage_reports 테이블에 제출 일시 열이 없는 기존 프로젝트용 긴급 수정입니다.
-- 이 파일을 먼저 단독 실행한 뒤 supabase-reservation-approval-workflow.sql을 실행하세요.

alter table public.usage_reports
add column if not exists created_at timestamptz not null default now();

select
  column_name,
  data_type,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'usage_reports'
  and column_name = 'created_at';
