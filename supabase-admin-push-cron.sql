-- 관리자 예약 알림 Edge Function을 1분마다 실행합니다.
-- 아래 YOUR_CRON_SECRET을 generate-vapid-keys.mjs가 출력한 CRON_SECRET으로 바꾼 뒤
-- Supabase SQL Editor에서 전체 실행하세요. 이 파일의 실제 비밀값은 GitHub에 올리지 마세요.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'admin-push-every-minute';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
end;
$$;

select cron.schedule(
  'admin-push-every-minute',
  '* * * * *',
  $job$
    select net.http_post(
      url := 'https://lnbqbtoqcajqwhupkvid.supabase.co/functions/v1/admin-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', 'YOUR_CRON_SECRET'
      ),
      body := '{"action":"scheduled"}'::jsonb,
      timeout_milliseconds := 10000
    );
  $job$
);

select jobid, jobname, schedule, active
from cron.job
where jobname = 'admin-push-every-minute';
