# 창의융합프로젝트실 예약

창의융합프로젝트실 이용 안내, 이메일 로그인, 호실 예약, 내 예약 관리 및 관리자 기능을 제공하는 웹앱입니다.

## 적용된 화면

- `index.html`: 이용 안내
- `login.html`: 이메일 로그인 및 회원가입
- `reservation.html`: 예약 신청과 예약 시간 확인
- `my-reservation.html`: 내 예약, 수료증, 연장 신청, 이용확인서
- `admin.html`: 사용자와 전체 예약 관리
- `suggestions.html`: 제목·가린 작성자 공개 및 관리자 전용 본문 열람
- `styles/style.css`: 전체 공통 디자인
- `scripts`: Supabase 연결과 페이지 기능

## 최초 설정

1. Supabase의 `Authentication > Sign In / Providers > Email`에서 `Confirm email`을 켭니다.
2. `Authentication > URL Configuration`의 `Site URL`을 실제 배포 주소로 설정하고, `Redirect URLs`에 실제 `login.html` 주소를 추가합니다.
3. Supabase의 `SQL Editor`에서 `supabase-auto-approve.sql` 전체를 한 번 실행합니다.
4. 참여자 입력 기능을 사용하려면 `supabase-participant-fields.sql` 전체를 한 번 실행합니다.
5. 이메일 로그인과 참여자 이메일 검증을 위해 `supabase-member-email.sql` 전체를 한 번 실행합니다.
6. 참여자 개인별 일일 2시간 제한을 위해 `supabase-participant-daily-limit.sql` 전체를 한 번 실행합니다.
7. 참여자 개인별 주간 4시간 제한을 위해 `supabase-participant-weekly-limit.sql` 전체를 한 번 실행합니다.
8. 예약 가능 범위를 14일로 적용하려면 `supabase-reservation-window-14-days.sql` 전체를 한 번 실행합니다.
9. 관리자 예약 상세화면에서 참여자 정보를 확인하려면 `supabase-admin-reservation-details.sql` 전체를 한 번 실행합니다.
10. 건의사항 게시판을 사용하려면 `supabase-suggestions.sql` 전체를 한 번 실행합니다.
    제목과 가운데가 `*`로 가려진 작성자는 공개되며 본문은 관리자 계정만 조회할 수 있습니다.
11. `scripts/config.js`의 Supabase URL과 Publishable Key가 현재 프로젝트 값인지 확인합니다.
12. VS Code에서 `index.html`을 열고 Live Server를 실행합니다.

신규 회원은 가입한 이메일로 로그인합니다. 기존 학번 기반 계정도 `profiles.email`에 저장된 이메일로 로그인할 수 있습니다.

## GitHub Pages 반영

수정 파일을 저장한 뒤 GitHub Desktop 또는 터미널에서 커밋하고 `main` 브랜치에 Push합니다. GitHub Pages가 갱신된 후 브라우저에서 강력 새로고침하세요.
