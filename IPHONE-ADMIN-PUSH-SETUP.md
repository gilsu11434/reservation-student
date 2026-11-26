# 관리자 아이폰 예약 알림 설정

이 기능은 승인된 관리자에게만 다음 알림을 전송합니다.

- 매일 오전 9시: 오늘의 전체 예약 시간과 승인 상태
- 예약 시작 약 10분 전: 해당 예약 시간과 승인 상태
- 잠금화면 알림에는 예약자 이름·이메일·전화번호를 표시하지 않습니다.

## 1. 데이터베이스 설정

Supabase `SQL Editor → New query`에서 `supabase-admin-push-notifications.sql`을 전체 실행합니다.

## 2. 푸시 키 생성

프로젝트 최상위 폴더에서 PowerShell을 열고 다음 명령을 실행합니다.

```powershell
node .\scripts\generate-vapid-keys.mjs
```

출력되는 `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET`을 안전한 곳에 복사합니다. `VAPID_PRIVATE_KEY`와 `CRON_SECRET`은 GitHub에 올리면 안 됩니다.

## 3. Supabase CLI 연결

```powershell
npm install supabase --save-dev
npx supabase init
npx supabase login
npx supabase link --project-ref lnbqbtoqcajqwhupkvid
```

`npx` 방식의 Supabase CLI는 Node.js 20 이상이 필요합니다.

## 4. 비밀값 등록과 Edge Function 배포

아래 따옴표 안에 2단계에서 생성된 실제 값을 넣습니다.

```powershell
npx supabase secrets set VAPID_PUBLIC_KEY="실제_PUBLIC_KEY" VAPID_PRIVATE_KEY="실제_PRIVATE_KEY" CRON_SECRET="실제_CRON_SECRET" VAPID_SUBJECT="mailto:gilsu8213@cau.ac.kr"
npx supabase functions deploy admin-push --no-verify-jwt
```

`--no-verify-jwt`를 사용하더라도 함수 내부에서 관리자 로그인과 Cron 비밀값을 다시 검사합니다.

## 5. 자동 알림 작업 등록

`supabase-admin-push-cron.sql`을 열어 `YOUR_CRON_SECRET`을 2단계에서 생성한 실제 `CRON_SECRET`으로 교체합니다.

교체한 SQL은 Supabase SQL Editor에서만 실행하고, 실제 비밀값이 들어간 파일은 GitHub에 올리지 않습니다.

실행 결과에 `admin-push-every-minute` 작업이 표시되면 정상입니다.

## 6. 사이트 배포

프로젝트 파일을 GitHub에 Commit하고 Push합니다. GitHub Pages 배포가 끝나면 아이폰의 기존 홈 화면 아이콘을 삭제하고 다음 순서로 다시 등록하는 것이 안전합니다.

1. Safari에서 배포된 `admin.html`을 엽니다.
2. 공유 버튼 → `홈 화면에 추가`를 누릅니다.
3. 홈 화면의 `창의융합실 관리` 아이콘으로 실행합니다.
4. 관리자 계정으로 로그인합니다.
5. 관리자 페이지의 `아이폰 알림 켜기`를 누릅니다.
6. iOS 알림 요청에서 `허용`을 누릅니다.
7. `시험 알림 보내기`로 정상 수신을 확인합니다.

## 7. 동작 확인

- 관리자 페이지에서 알림을 끄면 해당 아이폰 구독만 삭제됩니다.
- 다른 관리자 아이폰도 각 기기에서 한 번씩 알림을 켜야 합니다.
- 관리자 권한이 취소된 계정에는 더 이상 알림을 보내지 않습니다.
- iOS 푸시는 네트워크와 절전 상태에 따라 수 초 정도 늦을 수 있습니다.
