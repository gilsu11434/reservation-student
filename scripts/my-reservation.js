import {
  supabase,
  getCurrentUser,
  logout
} from "./config.js";

let currentUser = null;
let reservations = [];

document
  .getElementById("logout-button")
  .addEventListener("click", logout);

async function initialize() {
  currentUser = await getCurrentUser();

  if (!currentUser) {
    return;
  }

  await loadReservations();
}

async function loadReservations() {
  const container =
    document.getElementById("reservation-list");

  const { data, error } = await supabase
    .from("reservations")
    .select(`
      *,
      teams(team_name),
      reservation_members(*),
      usage_reports(*),
      extension_requests(*)
    `)
    .order("start_at", {
      ascending: false
    });

  if (error) {
    container.innerHTML = `
      <section class="card">
        <h2>예약 정보를 불러오지 못했습니다</h2>
        <p class="form-message error">${escapeHtml(error.message)}</p>
        <button type="button" class="reload-reservations-button">다시 불러오기</button>
      </section>
    `;

    container
      .querySelector(".reload-reservations-button")
      ?.addEventListener("click", loadReservations);
    return;
  }

  reservations = (data ?? []).filter((reservation) => {
    const members = reservation.reservation_members ?? [];
    const hasCompleteParticipantInfo =
      members.length === Number(reservation.headcount);

    return (
      reservation.status !== "cancelled" &&
      hasCompleteParticipantInfo
    );
  });
  renderReservations();
}

function formatDate(value) {
  return new Date(value).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul"
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatProfessorName(value) {
  const name = String(value ?? "")
    .trim()
    .replace(/\s*교수님\s*$/, "")
    .trim();

  return name ? `${name} 교수님` : "-";
}

function getStatusLabel(status) {
  const labels = {
    documents_pending: "수료증 확인 대기",
    ready: "이용 가능",
    completed: "이용 완료",
    cancelled: "취소"
  };

  return labels[status] ?? status;
}

function getApprovalStatusInfo(status) {
  const statuses = {
    pending: {
      label: "예약 승인 대기",
      className: "status-documents_pending"
    },
    approved: {
      label: "예약 승인 완료",
      className: "status-ready"
    },
    rejected: {
      label: "예약 승인 거절",
      className: "status-cancelled"
    }
  };

  return statuses[status] ?? statuses.approved;
}

function getReportStatusInfo(status, hasFile = true) {
  const statuses = {
    pending: {
      label: "승인 대기",
      description: hasFile
        ? "관리자 확인 대기 중입니다."
        : "파일은 미제출 상태이며 관리자 승인도 대기 중입니다.",
      className: "status-documents_pending"
    },
    approved: {
      label: "승인 완료",
      description: "관리자가 이용확인서 제출 요건을 승인했습니다.",
      className: "status-ready"
    },
    rejected: {
      label: "반려",
      description: "내용을 확인한 후 다시 제출해 주세요.",
      className: "status-cancelled"
    }
  };

  return statuses[status] ?? statuses.pending;
}

function getCertificateStatusInfo(member) {
  const status = member.certificate_review_status ??
    (member.certificate_verified ? "approved" : "pending");
  const statuses = {
    pending: {
      label: "제출 완료",
      className: "status-documents_pending"
    },
    approved: {
      label: "승인 완료",
      className: "status-ready"
    },
    rejected: {
      label: "반려",
      className: "status-cancelled"
    }
  };

  if (!member.safety_certificate_path && status === "pending") {
    return {
      status: "pending",
      label: "미제출",
      className: "status-cancelled"
    };
  }

  return {
    status,
    ...(statuses[status] ?? statuses.pending)
  };
}

function normalizeRelatedRows(value) {
  if (Array.isArray(value)) {
    return value;
  }

  return value ? [value] : [];
}

function getLatestReport(reports) {
  return normalizeRelatedRows(reports).sort(
    (first, second) =>
      new Date(second.created_at ?? 0) -
      new Date(first.created_at ?? 0)
  )[0] ?? null;
}

function sanitizeStoragePart(value, fallback = "file") {
  const sanitized = String(value ?? "")
    .trim()
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]+/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 60);

  return sanitized || fallback;
}

function formatFileDate(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function renderReportForm(reservation, report = null) {
  return `
    <form
      class="report-form"
      data-id="${escapeHtml(reservation.id)}"
      ${report ? `data-report-id="${escapeHtml(report.id)}"` : ""}
      ${report?.file_path ? `data-previous-path="${escapeHtml(report.file_path)}"` : ""}
    >
      <input name="report" type="file" accept=".pdf,.jpg,.jpeg,.png" aria-label="이용확인서 파일" required>
      <textarea name="notes" placeholder="특이사항" aria-label="특이사항">${escapeHtml(report?.notes ?? "")}</textarea>
      <button type="submit">${report ? "이용확인서 다시 제출" : "이용확인서 제출"}</button>
    </form>
  `;
}

function renderCertificateForm(reservation, member) {
  return `
    <form
      class="certificate-form"
      data-id="${escapeHtml(reservation.id)}"
      data-member-id="${escapeHtml(member.id)}"
      data-student-id="${escapeHtml(member.student_id)}"
    >
      <input
        name="certificate"
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        aria-label="${escapeHtml(member.member_name)} 수료증 파일"
        required
      >
      <button type="submit">
        ${member.safety_certificate_path ? "수료증 다시 제출" : "수료증 제출"}
      </button>
    </form>
  `;
}

function renderReservations() {
  const container =
    document.getElementById("reservation-list");

  if (reservations.length === 0) {
    container.innerHTML =
      `<section class="card">
        <h2>현재 예약이 없습니다</h2>
        <p class="muted">새 예약을 만들면 이곳에서 현재 예약을 확인할 수 있습니다.</p>
        <a class="button" href="./reservation.html">새 예약 만들기</a>
      </section>`;
    return;
  }

  container.innerHTML = reservations
    .map((reservation) => {
      const members =
        reservation.reservation_members ?? [];

      const submittedCertificateCount = members.filter(
        (member) => Boolean(member.safety_certificate_path)
      ).length;

      const reports = normalizeRelatedRows(
        reservation.usage_reports
      );

      const latestReport = getLatestReport(reports);
      const reportReviewStatus =
        reservation.usage_report_review_status ??
        latestReport?.review_status ??
        "pending";
      const reportStatus = getReportStatusInfo(
        reportReviewStatus,
        Boolean(latestReport)
      );
      const approvalStatus = getApprovalStatusInfo(
        reservation.approval_status ?? "approved"
      );
      const effectiveEnd = new Date(
        reservation.effective_end_at ?? reservation.end_at
      ).getTime();
      const usageEnded =
        Number.isFinite(effectiveEnd) && effectiveEnd <= Date.now();
      const reservationApproved =
        (reservation.approval_status ?? "approved") === "approved";
      const reservationCancelled =
        reservation.status === "cancelled";

      const status = escapeHtml(reservation.status);

      return `
        <section class="card reservation-card">
          <div class="reservation-heading">
            <div>
              <p class="eyebrow">Reservation</p>
              <h2>${escapeHtml(reservation.teams?.team_name ?? "팀")}</h2>
            </div>
            <div class="reservation-status-group">
              <span class="status-badge ${approvalStatus.className}">
                ${escapeHtml(approvalStatus.label)}
              </span>
              <span class="status-badge status-${status}">
                ${escapeHtml(getStatusLabel(reservation.status))}
              </span>
            </div>
          </div>

          <div class="reservation-meta">
            <div class="meta-item">
              <span>이용 시간</span>
              <strong>
                ${formatDate(reservation.start_at)}<br>
                ${formatDate(reservation.end_at)}
              </strong>
            </div>
            <div class="meta-item">
              <span>사용 목적</span>
              <strong>${escapeHtml(reservation.purpose)}</strong>
            </div>
            <div class="meta-item">
              <span>인원 · 수료증</span>
              <strong>${reservation.headcount}명 · ${submittedCertificateCount}/${reservation.headcount}건</strong>
            </div>
            <div class="meta-item">
              <span>종합설계 지도교수님</span>
              <strong>${escapeHtml(formatProfessorName(reservation.graduation_professor))}</strong>
            </div>
          </div>

          ${
            !reservationCancelled && !usageEnded
              ? `
                <div class="reservation-actions">
                  <button
                    type="button"
                    class="cancel-button"
                    data-id="${reservation.id}"
                  >
                    예약 취소
                  </button>
                </div>
              `
              : ""
          }

          <div class="workflow-grid">
            <section class="workflow-panel">
              <h3>참여자 수료증</h3>
              <p>PDF, JPG, PNG · 최대 10MB</p>
              ${
                members.length === 0
                  ? `
                    <form class="member-form" data-id="${reservation.id}">
                      <input name="memberName" placeholder="참여자 이름" aria-label="참여자 이름" required>
                      <input name="studentId" placeholder="학번" aria-label="참여자 학번" required>
                      <input name="memberEmail" type="email" placeholder="가입 이메일" aria-label="참여자 이메일" required>
                      <input name="certificate" type="file" accept=".pdf,.jpg,.jpeg,.png" aria-label="수료증 파일" required>
                      <button type="submit">수료증 제출</button>
                    </form>
                  `
                  : `
                    <div class="participant-upload-list">
                      ${members.map((member) => {
                        const certificateStatus =
                          getCertificateStatusInfo(member);

                        return `
                          <div class="participant-upload-row">
                            <div class="participant-upload-name">
                              <strong>${escapeHtml(member.member_name)}</strong>
                              <span>
                                ${escapeHtml(member.student_id)} ·
                                ${escapeHtml(member.member_email ?? "이메일 미등록")}
                              </span>
                            </div>
                            ${member.safety_certificate_path || certificateStatus.status !== "pending"
                              ? `
                                <span class="status-badge ${certificateStatus.className}">
                                  ${escapeHtml(certificateStatus.label)}
                                </span>
                              `
                              : ""}
                            ${certificateStatus.status === "rejected" && member.certificate_review_note
                              ? `<span class="workflow-review-note">관리자 의견: ${escapeHtml(member.certificate_review_note)}</span>`
                              : ""}
                            ${certificateStatus.status !== "approved" &&
                              (!member.safety_certificate_path || certificateStatus.status === "rejected")
                              ? renderCertificateForm(reservation, member)
                              : ""}
                          </div>
                        `;
                      }).join("")}
                    </div>
                  `
              }
            </section>

            <section class="workflow-panel">
              <h3>연장 신청</h3>
              <p>필요한 연장 시간과 사유를 입력하세요.</p>
              ${
                reservationApproved && !usageEnded && !reservationCancelled
                  ? `
                    <form class="extension-form" data-id="${reservation.id}">
                      <input name="minutes" type="number" min="1" max="120" placeholder="연장시간(분)" aria-label="연장시간" required>
                      <input name="reason" placeholder="연장 사유" aria-label="연장 사유" required>
                      <button type="submit">연장 신청</button>
                    </form>
                  `
                  : `<div class="workflow-state-note">승인된 이용 시작 전 예약만 연장을 신청할 수 있습니다.</div>`
              }
            </section>

            <section class="workflow-panel">
              <h3>이용확인서</h3>
              <p>이용을 마친 후 확인서를 제출하세요.</p>
              <div class="document-status-pair">
                <div class="document-status-item">
                  <span>파일 업로드</span>
                  <strong>${latestReport ? "제출 완료" : "미제출"}</strong>
                </div>
                <div class="document-status-item">
                  <span>관리자 승인</span>
                  <strong>
                    <span class="status-badge ${reportStatus.className}">
                      ${escapeHtml(reportStatus.label)}
                    </span>
                  </strong>
                </div>
              </div>
              ${
                latestReport
                  ? `
                    <div class="participant-upload-row">
                      <div class="participant-upload-name">
                        <strong>이용확인서</strong>
                        <span class="status-badge ${reportStatus.className}">
                          ${escapeHtml(reportStatus.label)}
                        </span>
                      </div>
                      <span class="workflow-status-description">
                        ${escapeHtml(reportStatus.description)}
                      </span>
                      ${latestReport.review_note
                        ? `<span class="workflow-review-note">관리자 의견: ${escapeHtml(latestReport.review_note)}</span>`
                        : ""}
                      ${reportReviewStatus === "rejected" && usageEnded && reservationApproved
                        ? renderReportForm(reservation, latestReport)
                        : ""}
                    </div>
                  `
                  : reportReviewStatus === "approved" || reportReviewStatus === "rejected"
                    ? `
                      <div class="participant-upload-row">
                        <div class="participant-upload-name">
                          <strong>이용확인서</strong>
                          <span class="status-badge ${reportStatus.className}">
                            ${escapeHtml(reportStatus.label)}
                          </span>
                        </div>
                        <span class="workflow-status-description">
                          ${escapeHtml(reportStatus.description)}
                        </span>
                        ${reservation.usage_report_review_note
                          ? `<span class="workflow-review-note">관리자 의견: ${escapeHtml(reservation.usage_report_review_note)}</span>`
                          : ""}
                        ${reportReviewStatus === "rejected" && usageEnded && reservationApproved
                          ? renderReportForm(reservation)
                          : ""}
                      </div>
                    `
                  : !reservationApproved
                    ? `<div class="workflow-state-note">예약 승인 후 이용을 완료하면 제출할 수 있습니다.</div>`
                    : !usageEnded
                      ? `<div class="workflow-state-note">이용 종료 후 제출할 수 있습니다.</div>`
                      : renderReportForm(reservation)
              }
            </section>
          </div>
        </section>
      `;
    })
    .join("");

  attachEventListeners();
}

function validateFile(file) {
  const allowedTypes = [
    "application/pdf",
    "image/jpeg",
    "image/png"
  ];

  if (!allowedTypes.includes(file.type)) {
    throw new Error(
      "PDF, JPG, PNG 파일만 제출할 수 있습니다."
    );
  }

  if (file.size > 10 * 1024 * 1024) {
    throw new Error(
      "파일 크기는 최대 10MB입니다."
    );
  }
}

function getExtension(fileName) {
  return fileName.split(".").pop().toLowerCase();
}

function attachEventListeners() {
  document
    .querySelectorAll(".cancel-button")
    .forEach((button) => {
      button.addEventListener("click", async () => {
        if (!confirm("예약을 취소하시겠습니까?")) {
          return;
        }

        const { error } = await supabase.rpc(
          "cancel_my_reservation",
          {
            p_reservation_id: button.dataset.id
          }
        );

        if (error) {
          alert(error.message);
          return;
        }

        alert("예약을 취소했습니다.");
        await loadReservations();
      });
    });

  document
    .querySelectorAll(".member-form")
    .forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();

        const reservationId = form.dataset.id;
        const memberName =
          form.memberName.value.trim();
        const studentId =
          form.studentId.value.trim();
        const memberEmail =
          form.memberEmail.value.trim().toLowerCase();
        const file = form.certificate.files[0];

        const { data: emailChecks, error: emailCheckError } =
          await supabase.rpc("check_registered_participant_emails", {
            p_emails: [memberEmail]
          });

        if (emailCheckError) {
          alert(emailCheckError.message);
          return;
        }

        if (!emailChecks?.[0]?.is_registered) {
          alert("가입되지 않은 이메일입니다.");
          return;
        }

        try {
          validateFile(file);
        } catch (error) {
          alert(error.message);
          return;
        }

        const extension =
          getExtension(file.name);

        const storedFileName =
          `certificate_${sanitizeStoragePart(studentId)}_` +
          `${Date.now()}.${extension}`;

        const path =
          `${currentUser.id}/` +
          `${reservationId}/` +
          storedFileName;

        const {
          error: uploadError
        } = await supabase.storage
          .from("safety-certificates")
          .upload(path, file, {
            upsert: false
          });

        if (uploadError) {
          alert(uploadError.message);
          return;
        }

        const {
          error: memberError
        } = await supabase
          .from("reservation_members")
          .insert({
            reservation_id: reservationId,
            member_name: memberName,
            student_id: studentId,
            member_email: memberEmail,
            safety_certificate_path: path,
            safety_submitted_at:
              new Date().toISOString()
          });

        if (memberError) {
          await supabase.storage
            .from("safety-certificates")
            .remove([path]);

          alert(memberError.message);
          return;
        }

        alert("수료증을 제출했습니다.");
        await loadReservations();
      });
    });

  document
    .querySelectorAll(".certificate-form")
    .forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();

        const reservationId = form.dataset.id;
        const memberId = form.dataset.memberId;
        const studentId = form.dataset.studentId;
        const file = form.certificate.files[0];

        try {
          validateFile(file);
        } catch (error) {
          alert(error.message);
          return;
        }

        const extension = getExtension(file.name);
        const storedFileName =
          `certificate_${sanitizeStoragePart(studentId)}_` +
          `${Date.now()}.${extension}`;
        const path =
          `${currentUser.id}/` +
          `${reservationId}/` +
          storedFileName;

        const { error: uploadError } = await supabase.storage
          .from("safety-certificates")
          .upload(path, file, { upsert: false });

        if (uploadError) {
          alert(uploadError.message);
          return;
        }

        const { error: memberError } = await supabase.rpc(
          "save_my_certificate_path",
          {
            p_member_id: memberId,
            p_reservation_id: reservationId,
            p_file_path: path
          }
        );

        if (memberError) {
          await supabase.storage
            .from("safety-certificates")
            .remove([path]);

          alert(memberError.message);
          return;
        }

        alert("수료증을 제출했습니다.");
        await loadReservations();
      });
    });

  document
    .querySelectorAll(".extension-form")
    .forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();

        const { error } = await supabase
          .from("extension_requests")
          .insert({
            reservation_id: form.dataset.id,
            requested_minutes:
              Number(form.minutes.value),
            reason: form.reason.value.trim()
          });

        if (error) {
          alert(error.message);
          return;
        }

        alert("연장 신청을 제출했습니다.");
        await loadReservations();
      });
    });

  document
    .querySelectorAll(".report-form")
    .forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();

        const reservationId = form.dataset.id;
        const reportId = form.dataset.reportId;
        const previousPath = form.dataset.previousPath;
        const file = form.report.files[0];
        const reservation = reservations.find(
          (item) => String(item.id) === String(reservationId)
        );

        if (!reservation) {
          alert("예약 정보를 찾을 수 없습니다.");
          return;
        }

        try {
          validateFile(file);
        } catch (error) {
          alert(error.message);
          return;
        }

        const extension =
          getExtension(file.name);

        const storedFileName =
          `usage_report_${formatFileDate(reservation.start_at)}_` +
          `${Date.now()}.${extension}`;

        const path =
          `${currentUser.id}/` +
          `${reservationId}/` +
          storedFileName;

        const {
          error: uploadError
        } = await supabase.storage
          .from("usage-reports")
          .upload(path, file, {
            upsert: false
          });

        if (uploadError) {
          alert(uploadError.message);
          return;
        }

        const reportValues = {
          reservation_id: reservationId,
          file_path: path,
          notes: form.notes.value.trim()
        };

        const reportQuery = reportId
          ? supabase
              .from("usage_reports")
              .update(reportValues)
              .eq("id", reportId)
              .eq("reservation_id", reservationId)
          : supabase
              .from("usage_reports")
              .insert(reportValues);

        const { error: reportError } = await reportQuery;

        if (reportError) {
          await supabase.storage
            .from("usage-reports")
            .remove([path]);

          alert(reportError.message);
          return;
        }

        if (previousPath && previousPath !== path) {
          await supabase.storage
            .from("usage-reports")
            .remove([previousPath]);
        }

        alert("이용확인서를 제출했습니다.");
        await loadReservations();
      });
    });
}

initialize().catch((error) => {
  const container =
    document.getElementById("reservation-list");

  console.error(error);
  container.innerHTML = `
    <section class="card">
      <h2>예약 화면 실행 오류</h2>
      <p class="form-message error">${escapeHtml(error.message)}</p>
      <button type="button" onclick="window.location.reload()">페이지 새로고침</button>
    </section>
  `;
});
