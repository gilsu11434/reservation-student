import {
  supabase,
  getCurrentUser,
  checkApproved,
  logout
} from "./config.js";

const calendar = document.getElementById(
  "admin-reservation-calendar"
);
const calendarMonthLabel = document.getElementById(
  "calendar-month-label"
);
const adminMessage = document.getElementById(
  "admin-message"
);
const reservationDetailDialog = document.getElementById(
  "reservation-detail-dialog"
);
const reservationDetailContent = document.getElementById(
  "reservation-detail-content"
);

const SEOUL_TIME_ZONE = "Asia/Seoul";
const WEEKDAY_LABELS = [
  "일",
  "월",
  "화",
  "수",
  "목",
  "금",
  "토"
];

const seoulDateFormatter = new Intl.DateTimeFormat(
  "en-CA",
  {
    timeZone: SEOUL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }
);

const seoulTimeFormatter = new Intl.DateTimeFormat(
  "ko-KR",
  {
    timeZone: SEOUL_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }
);

const seoulDateDetailFormatter = new Intl.DateTimeFormat(
  "ko-KR",
  {
    timeZone: SEOUL_TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long"
  }
);

const seoulDateTimeFormatter = new Intl.DateTimeFormat(
  "ko-KR",
  {
    timeZone: SEOUL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }
);

let allReservations = [];
let visibleYear;
let visibleMonth;

document
  .getElementById("logout-button")
  .addEventListener("click", logout);

document
  .getElementById("refresh-button")
  .addEventListener("click", loadReservations);

document
  .getElementById("calendar-prev-button")
  .addEventListener("click", () => {
    moveVisibleMonth(-1);
  });

document
  .getElementById("calendar-next-button")
  .addEventListener("click", () => {
    moveVisibleMonth(1);
  });

document
  .getElementById("calendar-today-button")
  .addEventListener("click", () => {
    setVisibleMonthToToday();
    renderCalendar();
  });

document
  .getElementById("reservation-detail-close")
  .addEventListener("click", closeReservationDetails);

calendar.addEventListener("click", (event) => {
  const reservationButton = event.target.closest(
    "[data-reservation-id]"
  );

  if (!reservationButton) {
    return;
  }

  openReservationDetails(
    reservationButton.dataset.reservationId
  );
});

reservationDetailDialog.addEventListener("click", (event) => {
  if (event.target === reservationDetailDialog) {
    closeReservationDetails();
  }
});

reservationDetailDialog.addEventListener("close", () => {
  document.body.classList.remove("modal-open");
});

reservationDetailContent.addEventListener("click", async (event) => {
  const downloadButton = event.target.closest(
    "[data-download-bucket]"
  );

  if (downloadButton) {
    await downloadPrivateFile(downloadButton);
    return;
  }

  const reservationDecisionButton = event.target.closest(
    "[data-reservation-decision]"
  );

  if (reservationDecisionButton) {
    await reviewReservation(reservationDecisionButton);
    return;
  }

  const certificateDecisionButton = event.target.closest(
    "[data-certificate-decision]"
  );

  if (certificateDecisionButton) {
    await reviewCertificate(certificateDecisionButton);
    return;
  }

  const certificateBulkDecisionButton = event.target.closest(
    "[data-certificate-bulk-decision]"
  );

  if (certificateBulkDecisionButton) {
    await reviewAllCertificates(certificateBulkDecisionButton);
    return;
  }

  const reportDecisionButton = event.target.closest(
    "[data-report-decision]"
  );

  if (reportDecisionButton) {
    await reviewUsageReport(reportDecisionButton);
  }
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showMessage(message, isError = false) {
  adminMessage.textContent = message;
  adminMessage.classList.toggle(
    "error-message",
    isError
  );
  adminMessage.hidden = !message;
}

function formatProfessorName(value) {
  const name = String(value ?? "")
    .trim()
    .replace(/\s*교수님\s*$/, "")
    .trim();

  return name ? `${name} 교수님` : "-";
}

function getDateParts(value = new Date()) {
  const parts = seoulDateFormatter.formatToParts(
    new Date(value)
  );
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day)
  };
}

function makeDateKey(year, month, day) {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0")
  ].join("-");
}

function getReservationDateKey(reservation) {
  const { year, month, day } = getDateParts(
    reservation.start_at
  );

  return makeDateKey(year, month, day);
}

function formatTime(value) {
  if (!value) {
    return "--:--";
  }

  return seoulTimeFormatter.format(new Date(value));
}

function formatDateDetail(value) {
  if (!value) {
    return "-";
  }

  return seoulDateDetailFormatter.format(new Date(value));
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  return seoulDateTimeFormatter.format(new Date(value));
}

function formatDuration(startValue, endValue) {
  const start = new Date(startValue).getTime();
  const end = new Date(endValue).getTime();
  const hours = (end - start) / (60 * 60 * 1000);

  if (!Number.isFinite(hours) || hours <= 0) {
    return "-";
  }

  return `${Number(hours.toFixed(2))}시간`;
}

function getStatusLabel(status) {
  const labels = {
    documents_pending: "수료증 확인 대기",
    ready: "이용 가능",
    completed: "이용 완료",
    cancelled: "취소"
  };

  return labels[status] ?? status ?? "상태 미확인";
}

function getApprovalStatusInfo(status) {
  const statuses = {
    pending: {
      label: "승인 대기",
      className: "status-documents_pending"
    },
    approved: {
      label: "승인 완료",
      className: "status-ready"
    },
    rejected: {
      label: "승인 거절",
      className: "status-cancelled"
    }
  };

  return statuses[status] ?? statuses.approved;
}

function getReportStatusInfo(status) {
  const statuses = {
    pending: {
      label: "승인 대기",
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

  return statuses[status] ?? statuses.pending;
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

function sanitizeFilePart(value, fallback = "미입력") {
  const sanitized = String(value ?? "")
    .trim()
    .replace(/[\\/:*?"<>|#%]+/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 60);

  return sanitized || fallback;
}

function getPathExtension(path) {
  const fileName = String(path ?? "").split("/").pop() ?? "";
  const extension = fileName.includes(".")
    ? fileName.split(".").pop().toLowerCase()
    : "pdf";

  return extension === "jpeg" ? "jpg" : extension;
}

function getCertificateStatus(member) {
  const status = member.certificate_review_status ??
    (member.certificate_verified ? "approved" : "pending");
  const statuses = {
    pending: {
      label: "승인 대기",
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
      status: "missing",
      label: "미제출",
      className: "status-cancelled"
    };
  }

  return {
    status,
    ...(statuses[status] ?? statuses.pending)
  };
}

function getCertificateUploadSummary(members) {
  const participants = normalizeRelatedRows(members);
  const summary = participants.reduce(
    (result, member) => {
      const certificateStatus = getCertificateStatus(member);

      result[certificateStatus.status] += 1;
      if (member.safety_certificate_path) {
        result.submitted += 1;
      }

      return result;
    },
    {
      total: participants.length,
      submitted: 0,
      missing: 0,
      pending: 0,
      approved: 0,
      rejected: 0
    }
  );

  if (summary.total === 0) {
    return {
      ...summary,
      label: "참여자 없음",
      className: "status-cancelled"
    };
  }

  if (summary.rejected > 0) {
    return {
      ...summary,
      label: "반려 있음",
      className: "status-cancelled"
    };
  }

  if (summary.missing > 0) {
    return {
      ...summary,
      label: "미제출 있음",
      className: "status-cancelled"
    };
  }

  if (summary.pending > 0) {
    return {
      ...summary,
      label: "승인 대기",
      className: "status-documents_pending"
    };
  }

  return {
    ...summary,
    label: "승인 완료",
    className: "status-ready"
  };
}

function renderCertificateReviewActions(
  reservationId,
  member,
  certificateStatus
) {
  if (certificateStatus.status === "approved") {
    return `
      <button
        type="button"
        class="danger-button admin-download-button"
        data-reservation-id="${escapeHtml(reservationId)}"
        data-member-id="${escapeHtml(member.id)}"
        data-certificate-decision="pending"
      >승인 취소</button>
    `;
  }

  return `
    ${certificateStatus.status !== "rejected"
      ? `
        <button
          type="button"
          class="danger-button admin-download-button"
          data-reservation-id="${escapeHtml(reservationId)}"
          data-member-id="${escapeHtml(member.id)}"
          data-certificate-decision="rejected"
        >반려</button>
      `
      : ""}
    <button
      type="button"
      class="admin-download-button"
      data-reservation-id="${escapeHtml(reservationId)}"
      data-member-id="${escapeHtml(member.id)}"
      data-certificate-decision="approved"
    >승인</button>
  `;
}

function renderReportReviewActions(
  reservationId,
  reviewStatus,
  includeReject = true
) {
  if (reviewStatus === "approved") {
    return `
      <button
        type="button"
        class="danger-button"
        data-reservation-id="${escapeHtml(reservationId)}"
        data-report-decision="pending"
      >승인 취소</button>
    `;
  }

  return `
    ${includeReject && reviewStatus !== "rejected"
      ? `
        <button
          type="button"
          class="danger-button"
          data-reservation-id="${escapeHtml(reservationId)}"
          data-report-decision="rejected"
        >이용확인서 반려</button>
      `
      : ""}
    <button
      type="button"
      data-reservation-id="${escapeHtml(reservationId)}"
      data-report-decision="approved"
    >이용확인서 승인</button>
  `;
}

function renderDetailItem(label, value, className = "") {
  return `
    <div class="admin-detail-item${className ? ` ${className}` : ""}">
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(value || "-")}</dd>
    </div>
  `;
}

async function downloadPrivateFile(button) {
  const bucket = button.dataset.downloadBucket;
  const path = button.dataset.downloadPath;
  const fileName = button.dataset.downloadName;
  const fileAction = button.dataset.fileAction ?? "download";
  const previewWindow = fileAction === "view"
    ? window.open("about:blank", "_blank")
    : null;

  if (!bucket || !path || !fileName) {
    showMessage("다운로드할 파일 정보가 올바르지 않습니다.", true);
    return;
  }

  button.disabled = true;

  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .download(path);

    if (error) {
      throw error;
    }

    const objectUrl = URL.createObjectURL(data);

    if (fileAction === "view" && previewWindow) {
      previewWindow.location.href = objectUrl;
      window.setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
      }, 60000);
    } else {
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
      }, 1000);
    }
  } catch (error) {
    previewWindow?.close();
    showMessage(`파일 다운로드 오류: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
}

async function reviewCertificate(button) {
  const memberId = button.dataset.memberId;
  const reservationId = button.dataset.reservationId;
  const decision = button.dataset.certificateDecision;
  const actionLabels = {
    approved: "승인",
    rejected: "반려",
    pending: "승인 취소"
  };
  const actionLabel = actionLabels[decision] ?? "처리";

  if (!confirm(`이 수료증을 ${actionLabel}하시겠습니까?`)) {
    return;
  }

  const note = decision === "pending"
    ? ""
    : prompt(
      decision === "approved"
        ? "관리자 메모가 있으면 입력해 주세요. (선택)"
        : "반려 사유를 입력해 주세요.",
      ""
    );

  if (note === null) {
    return;
  }

  if (decision === "rejected" && !note.trim()) {
    alert("반려 사유를 입력해 주세요.");
    return;
  }

  button.disabled = true;

  const { error } = await supabase.rpc(
    "admin_review_certificate",
    {
      p_member_id: memberId,
      p_decision: decision,
      p_note: note.trim() || null
    }
  );

  if (error) {
    showMessage(`수료증 ${actionLabel} 오류: ${error.message}`, true);
    button.disabled = false;
    return;
  }

  await loadReservations();
  openReservationDetails(reservationId);
}

async function reviewAllCertificates(button) {
  const reservationId = button.dataset.reservationId;
  const decision = button.dataset.certificateBulkDecision;
  const actionLabel = decision === "approved"
    ? "전체 승인"
    : "전체 승인 취소";

  if (!confirm(`이 예약의 참여자 수료증을 ${actionLabel}하시겠습니까?`)) {
    return;
  }

  button.disabled = true;

  const { error } = await supabase.rpc(
    "admin_review_all_certificates",
    {
      p_reservation_id: reservationId,
      p_decision: decision,
      p_note: null
    }
  );

  if (error) {
    showMessage(`수료증 ${actionLabel} 오류: ${error.message}`, true);
    button.disabled = false;
    return;
  }

  await loadReservations();
  openReservationDetails(reservationId);
}

async function reviewReservation(button) {
  const reservationId = button.dataset.reservationId;
  const decision = button.dataset.reservationDecision;
  const actionLabel = decision === "approved" ? "승인" : "거절";

  if (!confirm(`이 예약 신청을 ${actionLabel}하시겠습니까?`)) {
    return;
  }

  const note = prompt(
    decision === "approved"
      ? "관리자 메모가 있으면 입력해 주세요. (선택)"
      : "거절 사유를 입력해 주세요. (선택)",
    ""
  );

  if (note === null) {
    return;
  }

  button.disabled = true;

  const { error } = await supabase.rpc(
    "admin_review_reservation",
    {
      p_reservation_id: reservationId,
      p_decision: decision,
      p_note: note.trim() || null
    }
  );

  if (error) {
    showMessage(`예약 ${actionLabel} 오류: ${error.message}`, true);
    button.disabled = false;
    return;
  }

  await loadReservations();
  openReservationDetails(reservationId);
}

async function reviewUsageReport(button) {
  const reservationId = button.dataset.reservationId;
  const decision = button.dataset.reportDecision;
  const actionLabels = {
    approved: "승인",
    rejected: "반려",
    pending: "승인 취소"
  };
  const actionLabel = actionLabels[decision] ?? "처리";

  if (!confirm(`이 이용확인서를 ${actionLabel}하시겠습니까?`)) {
    return;
  }

  const note = decision === "pending"
    ? ""
    : prompt(
      decision === "approved"
        ? "관리자 메모가 있으면 입력해 주세요. (선택)"
        : "반려 사유를 입력해 주세요.",
      ""
    );

  if (note === null) {
    return;
  }

  if (decision === "rejected" && !note.trim()) {
    alert("반려 사유를 입력해 주세요.");
    return;
  }

  button.disabled = true;

  const { error } = await supabase.rpc(
    "admin_review_reservation_report",
    {
      p_reservation_id: reservationId,
      p_decision: decision,
      p_note: note.trim() || null
    }
  );

  if (error) {
    showMessage(`이용확인서 ${actionLabel} 오류: ${error.message}`, true);
    button.disabled = false;
    return;
  }

  await loadReservations();
  openReservationDetails(reservationId);
}

function renderParticipants(reservation) {
  const participants = normalizeRelatedRows(reservation.reservation_members);

  if (participants.length === 0) {
    return `
      <p class="admin-detail-empty">
        저장된 참여자 정보가 없습니다.
      </p>
    `;
  }

  return `
    <div class="admin-participant-table-wrap">
      <table class="admin-participant-table">
        <thead>
          <tr>
            <th scope="col">구분</th>
            <th scope="col">이름</th>
            <th scope="col">학번</th>
            <th scope="col">이메일</th>
            <th scope="col">수료증</th>
          </tr>
        </thead>
        <tbody>
          ${participants.map((member, index) => {
            const certificateStatus = getCertificateStatus(member);
            const isRequester =
              String(member.member_email ?? "").toLowerCase() ===
              String(reservation.requester_email ?? "").toLowerCase();
            const certificateDownloadName =
              `수료증_${sanitizeFilePart(member.member_name)}_` +
              `${sanitizeFilePart(member.student_id)}.` +
              `${getPathExtension(member.safety_certificate_path)}`;

            return `
              <tr>
                <td>${isRequester ? "예약자" : `참여자 ${index + 1}`}</td>
                <td><strong>${escapeHtml(member.member_name || "-")}</strong></td>
                <td>${escapeHtml(member.student_id || "-")}</td>
                <td>${escapeHtml(member.member_email || "-")}</td>
                <td>
                  <div class="admin-document-actions">
                    <span class="status-badge ${certificateStatus.className}">
                      ${certificateStatus.label}
                    </span>
                    ${
                      member.safety_certificate_path
                        ? `
                          <button
                            type="button"
                            class="button-secondary admin-download-button"
                            data-download-bucket="safety-certificates"
                            data-download-path="${escapeHtml(member.safety_certificate_path)}"
                            data-download-name="${escapeHtml(certificateDownloadName)}"
                            data-file-action="view"
                          >파일 보기</button>
                          <button
                            type="button"
                            class="button-secondary admin-download-button"
                            data-download-bucket="safety-certificates"
                            data-download-path="${escapeHtml(member.safety_certificate_path)}"
                            data-download-name="${escapeHtml(certificateDownloadName)}"
                            data-file-action="download"
                          >다운로드</button>
                        `
                        : ""
                    }
                    ${renderCertificateReviewActions(
                      reservation.id,
                      member,
                      certificateStatus
                    )}
                    ${member.certificate_review_note
                      ? `<small class="admin-certificate-note">관리자 의견: ${escapeHtml(member.certificate_review_note)}</small>`
                      : ""}
                  </div>
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function openReservationDetails(reservationId) {
  const reservation = allReservations.find(
    (item) => String(item.id) === String(reservationId)
  );

  if (!reservation) {
    showMessage("예약 상세정보를 찾지 못했습니다.", true);
    return;
  }

  const effectiveEnd =
    reservation.effective_end_at || reservation.end_at;
  const hasExtension =
    new Date(effectiveEnd).getTime() >
    new Date(reservation.end_at).getTime();
  const status = escapeHtml(reservation.status || "unknown");
  const approvalStatus = getApprovalStatusInfo(
    reservation.approval_status ?? "approved"
  );
  const latestReport = getLatestReport(
    reservation.usage_reports
  );
  const reportReviewStatus =
    reservation.usage_report_review_status ??
    latestReport?.review_status ??
    "pending";
  const reportStatus = getReportStatusInfo(reportReviewStatus);
  const certificateSummary = getCertificateUploadSummary(
    reservation.reservation_members
  );
  const reportDownloadName = latestReport
    ? `이용확인서_${sanitizeFilePart(reservation.requester_name)}_` +
      `${getReservationDateKey(reservation)}.` +
      `${getPathExtension(latestReport.file_path)}`
    : "";

  reservationDetailContent.innerHTML = `
    <section class="admin-detail-summary">
      <div>
        <span class="admin-detail-date">
          ${escapeHtml(formatDateDetail(reservation.start_at))}
        </span>
        <strong>
          ${escapeHtml(formatTime(reservation.start_at))}
          <span aria-hidden="true">~</span>
          ${escapeHtml(formatTime(effectiveEnd))}
        </strong>
        <small>
          이용시간 ${escapeHtml(formatDuration(reservation.start_at, effectiveEnd))}
          ${hasExtension ? " · 연장 포함" : ""}
        </small>
      </div>
      <div class="reservation-status-group">
        <span class="status-badge ${approvalStatus.className}">
          ${escapeHtml(approvalStatus.label)}
        </span>
        <span class="status-badge status-${status}">
          ${escapeHtml(getStatusLabel(reservation.status))}
        </span>
      </div>
    </section>

    <section class="admin-detail-section admin-upload-overview">
      <div class="admin-detail-section-heading">
        <h3>파일 업로드 현황</h3>
        <span>수료증과 이용확인서를 한눈에 확인합니다.</span>
      </div>
      <div class="admin-upload-status-grid">
        <article class="admin-upload-status-card">
          <div class="admin-upload-status-heading">
            <span>참여자 수료증</span>
            <span class="status-badge ${certificateSummary.className}">
              ${escapeHtml(certificateSummary.label)}
            </span>
          </div>
          <strong>
            ${certificateSummary.submitted} / ${certificateSummary.total}명 제출
          </strong>
          <small>
            승인 ${certificateSummary.approved}명 ·
            대기 ${certificateSummary.pending}명 ·
            반려 ${certificateSummary.rejected}명 ·
            미제출 ${certificateSummary.missing}명
          </small>
          ${certificateSummary.total > 0
            ? `
              <div class="admin-upload-status-actions">
                <button
                  type="button"
                  class="${certificateSummary.approved === certificateSummary.total ? "danger-button" : ""}"
                  data-reservation-id="${escapeHtml(reservation.id)}"
                  data-certificate-bulk-decision="${certificateSummary.approved === certificateSummary.total ? "pending" : "approved"}"
                >${certificateSummary.approved === certificateSummary.total ? "수료증 전체 승인 취소" : "수료증 전체 승인"}</button>
              </div>
            `
            : ""}
        </article>

        <article class="admin-upload-status-card">
          <div class="admin-upload-status-heading">
            <span>이용확인서</span>
            <span class="status-badge ${reportStatus.className}">
              ${escapeHtml(reportStatus.label)}
            </span>
          </div>
          <strong>${latestReport ? "제출 완료" : "미제출"}</strong>
          <small>
            ${latestReport
              ? `제출 일시 ${escapeHtml(formatDateTime(latestReport.created_at))}`
              : "아직 업로드된 이용확인서가 없습니다."}
          </small>
          <div class="admin-upload-status-actions">
            ${renderReportReviewActions(
              reservation.id,
              reportReviewStatus,
              false
            )}
          </div>
        </article>
      </div>
    </section>

    <section class="admin-detail-section admin-approval-section">
      <div class="admin-detail-section-heading">
        <h3>예약 승인</h3>
        <span class="status-badge ${approvalStatus.className}">
          ${escapeHtml(approvalStatus.label)}
        </span>
      </div>
      ${reservation.approval_note
        ? `<p class="admin-review-note">관리자 메모: ${escapeHtml(reservation.approval_note)}</p>`
        : ""}
      ${
        (reservation.approval_status ?? "approved") === "pending" &&
        reservation.status !== "cancelled"
          ? `
            <div class="admin-actions">
              <button
                type="button"
                class="danger-button"
                data-reservation-id="${escapeHtml(reservation.id)}"
                data-reservation-decision="rejected"
              >예약 거절</button>
              <button
                type="button"
                data-reservation-id="${escapeHtml(reservation.id)}"
                data-reservation-decision="approved"
              >예약 승인</button>
            </div>
          `
          : ""
      }
    </section>

    <section class="admin-detail-section">
      <h3>예약자 정보</h3>
      <dl class="admin-detail-grid">
        ${renderDetailItem("예약자 이름", reservation.requester_name)}
        ${renderDetailItem("이메일", reservation.requester_email)}
        ${renderDetailItem("전화번호", reservation.requester_phone)}
        ${renderDetailItem("학과", reservation.department)}
        ${renderDetailItem("학번", reservation.student_id)}
        ${renderDetailItem(
          "종합설계 지도교수님",
          formatProfessorName(reservation.graduation_professor)
        )}
        ${renderDetailItem(
          "사용 인원",
          reservation.headcount == null
            ? "-"
            : `${reservation.headcount}명`
        )}
      </dl>
    </section>

    <section class="admin-detail-section">
      <h3>이용 정보</h3>
      <dl class="admin-detail-grid">
        ${renderDetailItem("사용할 장비", reservation.equipment || "없음")}
        ${renderDetailItem(
          "예약 신청 일시",
          formatDateTime(reservation.created_at)
        )}
        ${renderDetailItem(
          "사용 목적",
          reservation.purpose,
          "is-full"
        )}
        ${renderDetailItem(
          "예약번호",
          String(reservation.id ?? "-"),
          "is-full"
        )}
      </dl>
    </section>

    <section class="admin-detail-section">
      <div class="admin-detail-section-heading">
        <h3>참여자 정보</h3>
        <span>${certificateSummary.total}명</span>
      </div>
      ${renderParticipants(reservation)}
    </section>

    <section class="admin-detail-section">
      <div class="admin-detail-section-heading">
        <h3>이용확인서</h3>
        <span class="status-badge ${reportStatus.className}">
          ${escapeHtml(reportStatus.label)}
        </span>
      </div>
      <div class="document-status-pair admin-report-status-pair">
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
            <div class="admin-report-panel">
              <dl class="admin-detail-grid">
                ${renderDetailItem(
                  "제출 일시",
                  formatDateTime(latestReport.created_at)
                )}
                ${renderDetailItem(
                  "특이사항",
                  latestReport.notes || "없음"
                )}
                ${latestReport.review_note
                  ? renderDetailItem(
                      "관리자 의견",
                      latestReport.review_note,
                      "is-full"
                    )
                  : ""}
              </dl>
              <div class="admin-document-toolbar">
                <button
                  type="button"
                  class="button-secondary"
                  data-download-bucket="usage-reports"
                  data-download-path="${escapeHtml(latestReport.file_path)}"
                  data-download-name="${escapeHtml(reportDownloadName)}"
                  data-file-action="view"
                >이용확인서 보기</button>
                <button
                  type="button"
                  class="button-secondary"
                  data-download-bucket="usage-reports"
                  data-download-path="${escapeHtml(latestReport.file_path)}"
                  data-download-name="${escapeHtml(reportDownloadName)}"
                  data-file-action="download"
                >이용확인서 다운로드</button>
                ${renderReportReviewActions(
                  reservation.id,
                  reportReviewStatus
                )}
              </div>
            </div>
          `
          : `
            <div class="admin-report-panel">
              <p class="admin-detail-empty">제출된 이용확인서가 없습니다.</p>
              <div class="admin-document-toolbar">
                ${renderReportReviewActions(
                  reservation.id,
                  reportReviewStatus
                )}
              </div>
            </div>
          `
      }
    </section>
  `;

  document.body.classList.add("modal-open");

  if (typeof reservationDetailDialog.showModal === "function") {
    reservationDetailDialog.showModal();
  } else {
    reservationDetailDialog.setAttribute("open", "");
  }
}

function closeReservationDetails() {
  if (typeof reservationDetailDialog.close === "function") {
    reservationDetailDialog.close();
  } else {
    reservationDetailDialog.removeAttribute("open");
    document.body.classList.remove("modal-open");
  }
}

function setVisibleMonthToToday() {
  const today = getDateParts();
  visibleYear = today.year;
  visibleMonth = today.month;
}

function moveVisibleMonth(offset) {
  const date = new Date(
    Date.UTC(visibleYear, visibleMonth - 1 + offset, 1)
  );

  visibleYear = date.getUTCFullYear();
  visibleMonth = date.getUTCMonth() + 1;
  renderCalendar();
}

function groupReservationsByDate() {
  const grouped = new Map();

  allReservations
    .filter((reservation) => reservation.status !== "cancelled")
    .sort(
      (first, second) =>
        new Date(first.start_at) - new Date(second.start_at)
    )
    .forEach((reservation) => {
      const dateKey = getReservationDateKey(reservation);

      if (!grouped.has(dateKey)) {
        grouped.set(dateKey, []);
      }

      grouped.get(dateKey).push(reservation);
    });

  return grouped;
}

function renderReservation(reservation) {
  const requesterName =
    reservation.requester_name || "이름 없음";
  const startTime = formatTime(reservation.start_at);
  const endTime = formatTime(
    reservation.effective_end_at || reservation.end_at
  );
  const approvalStatus = getApprovalStatusInfo(
    reservation.approval_status ?? "approved"
  );

  return `
    <button
      type="button"
      class="calendar-reservation-item"
      data-reservation-id="${escapeHtml(reservation.id)}"
      aria-label="${escapeHtml(requesterName)} ${escapeHtml(startTime)}부터 ${escapeHtml(endTime)}까지 예약 상세정보 보기"
    >
      <strong class="calendar-reservation-name">
        ${escapeHtml(requesterName)}
      </strong>
      <span class="calendar-reservation-time">
        <strong class="calendar-start-time">
          ${escapeHtml(startTime)}
        </strong>
        <span aria-hidden="true">~</span>
        <span>${escapeHtml(endTime)}</span>
      </span>
      <span class="calendar-approval-status ${approvalStatus.className}">
        ${escapeHtml(approvalStatus.label)}
      </span>
      <span class="calendar-reservation-more">상세 보기</span>
    </button>
  `;
}

function renderCalendar() {
  const reservationsByDate = groupReservationsByDate();
  const firstWeekday = new Date(
    Date.UTC(visibleYear, visibleMonth - 1, 1)
  ).getUTCDay();
  const daysInMonth = new Date(
    Date.UTC(visibleYear, visibleMonth, 0)
  ).getUTCDate();
  const today = getDateParts();
  const todayKey = makeDateKey(
    today.year,
    today.month,
    today.day
  );
  const numberOfWeeks = Math.ceil(
    (firstWeekday + daysInMonth) / 7
  );
  const numberOfCells = numberOfWeeks * 7;
  const calendarCells = [];

  calendarMonthLabel.textContent =
    `${visibleYear}년 ${visibleMonth}월`;

  WEEKDAY_LABELS.forEach((label, index) => {
    const weekdayClass =
      index === 0
        ? " is-sunday"
        : index === 6
          ? " is-saturday"
          : "";

    calendarCells.push(`
      <div class="admin-calendar-weekday${weekdayClass}">
        ${label}
      </div>
    `);
  });

  for (let index = 0; index < numberOfCells; index += 1) {
    const day = index - firstWeekday + 1;

    if (day < 1 || day > daysInMonth) {
      calendarCells.push(`
        <div
          class="admin-calendar-day is-outside-month"
          aria-hidden="true"
        ></div>
      `);
      continue;
    }

    const dateKey = makeDateKey(
      visibleYear,
      visibleMonth,
      day
    );
    const dayReservations =
      reservationsByDate.get(dateKey) ?? [];
    const weekday = new Date(
      Date.UTC(visibleYear, visibleMonth - 1, day)
    ).getUTCDay();
    const dayClasses = ["admin-calendar-day"];

    if (dateKey === todayKey) {
      dayClasses.push("is-today");
    }

    if (weekday === 0 || weekday === 6) {
      dayClasses.push("is-weekend");
    }

    calendarCells.push(`
      <section
        class="${dayClasses.join(" ")}"
        aria-label="${visibleYear}년 ${visibleMonth}월 ${day}일, 예약 ${dayReservations.length}건"
      >
        <div class="admin-calendar-date">
          <span>${day}</span>
          ${dateKey === todayKey ? "<small>오늘</small>" : ""}
        </div>
        <div class="calendar-reservation-list">
          ${dayReservations.map(renderReservation).join("")}
        </div>
      </section>
    `);
  }

  calendar.innerHTML = calendarCells.join("");
}

async function loadReservations() {
  showMessage("예약 현황을 불러오는 중입니다.");

  const { data, error } = await supabase
    .from("reservations")
    .select(`
      *,
      reservation_members(*),
      usage_reports(*)
    `)
    .order("start_at", { ascending: true });

  if (error) {
    showMessage(
      `예약 현황을 불러오지 못했습니다: ${error.message}`,
      true
    );
    return;
  }

  allReservations = data ?? [];
  renderCalendar();
  showMessage("");
}

async function initialize() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return;
    }

    const permission = await checkApproved(user.id);

    if (permission.role !== "admin") {
      alert("관리자만 접근할 수 있습니다.");
      window.location.href = "./reservation.html";
      return;
    }

    setVisibleMonthToToday();
    await loadReservations();
  } catch (error) {
    showMessage(
      `관리자 확인 오류: ${error.message}`,
      true
    );
  }
}

initialize();
