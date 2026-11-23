# 창의융합프로젝트실 예약

창의융합프로젝트실 이용 안내, 이메일 로그인, 호실 예약, 내 예약 관리 및 관리자 기능을 제공하는 웹앱입니다.

## 적용된 화면

- `index.html`: 이용 안내
- `login.html`: 이메일 로그인 및 회원가입
- `reservation.html`: 예약 신청과 예약 시간 확인
- `my-reservation.html`: 내 예약, 수료증, 연장 신청, 이용확인서
- `admin.html`: 사용자와 전체 예약 관리
- `suggestions.html`: 제목·가린 작성자 공개, 작성자 삭제 및 비공개 사진 첨부
- `styles/style.css`: 전체 공통 디자인
- `scripts`: Supabase 연결과 페이지 기능
- `supabase-reservation-approval-workflow.sql`: 예약·이용확인서 관리자 승인 흐름
- `supabase-certificate-review.sql`: 수료증 경로 저장과 관리자 승인·반려

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
    제목과 가운데가 `*`로 가려진 작성자는 공개됩니다. 본문과 첨부 사진은 관리자와 작성자 본인만 조회할 수 있고, 작성자는 자신의 게시글을 삭제할 수 있습니다.
11. 수료증과 이용확인서 업로드를 위해 `supabase-storage-buckets.sql` 전체를 한 번 실행합니다.
    실행 후 Storage에 `safety-certificates`, `usage-reports` Bucket이 생성되었는지 확인합니다.
12. 이용확인서 제출 기록을 저장할 수 있도록 `supabase-usage-reports-policy.sql` 전체를 한 번 실행합니다.
    마지막 조회 결과에 `usage_reports_insert_by_owner` 정책이 보이면 정상입니다.
13. 수료증 저장, 파일 없는 승인 및 승인 취소 기능을 위해 `supabase-certificate-review.sql` 전체를 한 번 실행합니다.
14. 예약 승인제, 이용확인서의 파일 없는 승인·승인 취소 및 다음 예약 기능을 위해 `supabase-reservation-approval-workflow.sql` 전체를 한 번 실행합니다.
    기존 예약은 그대로 유지되며, 이 SQL을 실행한 뒤 만들어지는 예약부터 새 승인 흐름이 적용됩니다.
15. `scripts/config.js`의 Supabase URL과 Publishable Key가 현재 프로젝트 값인지 확인합니다.
16. VS Code에서 `index.html`을 열고 Live Server를 실행합니다.

신규 회원은 가입한 이메일로 로그인합니다. 기존 학번 기반 계정도 `profiles.email`에 저장된 이메일로 로그인할 수 있습니다.

## 이용확인서 양식

메인 페이지의 `이용확인서 양식 다운로드` 버튼을 누르면 `forms/usage-report-form.html`을 내려받을 수 있습니다.
파일을 브라우저로 열어 내용을 입력한 다음 `인쇄 · PDF로 저장` 버튼을 눌러 PDF로 저장하고, `내 예약` 페이지에서 제출하세요.

## 승인 진행 방식

1. 사용자가 예약을 신청하면 예약 시간은 즉시 다른 사용자에게 예약 불가로 표시되고, 예약 상태는 `승인 대기`가 됩니다.
2. 관리자가 달력의 예약 건을 눌러 예약을 승인하거나 거절합니다. 거절한 예약 시간은 다시 예약할 수 있습니다.
3. 관리자는 예약 상세화면에서 파일 제출 여부와 관계없이 참여자별 수료증을 승인·반려·승인 취소할 수 있습니다.
4. 사용자는 승인된 예약의 이용 종료 후 이용확인서를 제출합니다.
5. 관리자는 이용확인서 파일이 없어도 승인할 수 있으며, 승인하면 사용자는 다음 예약을 신청할 수 있습니다. 승인 취소 시 다음 예약 제한이 다시 적용됩니다.
6. 수료증과 이용확인서는 관리자 상세화면에서 바로 보거나 내려받을 수 있습니다.

## GitHub Pages 반영

수정 파일을 저장한 뒤 GitHub Desktop 또는 터미널에서 커밋하고 `main` 브랜치에 Push합니다. GitHub Pages가 갱신된 후 브라우저에서 강력 새로고침하세요.
