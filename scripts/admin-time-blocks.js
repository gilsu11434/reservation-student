import {
  supabase,
  getCurrentUser,
  checkApproved,
  logout
} from "./config.js";

const form = document.getElementById("time-block-form");
const dateInput = document.getElementById("time-block-date");
const startInput = document.getElementById("time-block-start");
const endInput = document.getElementById("time-block-end");
const reasonInput = document.getElementById("time-block-reason");
const message = document.getElementById("time-block-message");
const list = document.getElementById("time-block-list");
const refreshButton = document.getElementById("time-block-refresh");

const SEOUL_TIME_ZONE = "Asia/Seoul";
const seoulDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SEOUL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});
const seoulDetailFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: SEOUL_TIME_ZONE,
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short"
});
const seoulTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: SEOUL_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

document.getElementById("logout-button").addEventListener("click", logout);
refreshButton.addEventListener("click", loadTimeBlocks);
startInput.addEventListener("change", syncEndTimeOptions);
form.addEventListener("submit", createTimeBlock);
list.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-time-block-delete]");

  if (button) {
    await deleteTimeBlock(button);
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

function getSeoulDateKey(value = new Date()) {
  const parts = seoulDateFormatter.formatToParts(value);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function formatHour(hour) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function toSeoulInstant(dateValue, hour) {
  return new Date(
    `${dateValue}T${formatHour(hour)}:00+09:00`
  ).toISOString();
}

function showMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
  message.classList.toggle("success", Boolean(text) && !isError);
}

function syncEndTimeOptions() {
  const startHour = Number(startInput.value);
  const options = Array.from(endInput.options);

  options.forEach((option) => {
    option.disabled = Number(option.value) <= startHour;
  });

  if (Number(endInput.value) <= startHour) {
    const firstAvailable = options.find((option) => !option.disabled);
    endInput.value = firstAvailable?.value ?? "18";
  }
}

function renderTimeBlocks(timeBlocks) {
  const upcoming = (timeBlocks ?? [])
    .filter((timeBlock) => new Date(timeBlock.end_at).getTime() > Date.now())
    .sort(
      (first, second) =>
        new Date(first.start_at) - new Date(second.start_at)
    );

  if (upcoming.length === 0) {
    list.innerHTML = `
      <p class="admin-time-block-empty">
        등록된 예약 제한 시간이 없습니다.
      </p>
    `;
    return;
  }

  list.innerHTML = upcoming.map((timeBlock) => `
    <article class="admin-time-block-item">
      <div>
        <strong>${escapeHtml(seoulDetailFormatter.format(new Date(timeBlock.start_at)))}</strong>
        <span>
          ${escapeHtml(seoulTimeFormatter.format(new Date(timeBlock.start_at)))}
          ~
          ${escapeHtml(seoulTimeFormatter.format(new Date(timeBlock.end_at)))}
        </span>
        <small>${escapeHtml(timeBlock.reason || "관리자 지정")}</small>
      </div>
      <button
        class="admin-time-block-delete"
        type="button"
        data-time-block-delete="${escapeHtml(timeBlock.id)}"
        data-time-block-label="${escapeHtml(seoulDetailFormatter.format(new Date(timeBlock.start_at)))} ${escapeHtml(seoulTimeFormatter.format(new Date(timeBlock.start_at)))}~${escapeHtml(seoulTimeFormatter.format(new Date(timeBlock.end_at)))}"
      >제한 해제</button>
    </article>
  `).join("");
}

async function loadTimeBlocks() {
  list.innerHTML = `
    <p class="admin-time-block-empty">
      제한 시간을 불러오는 중입니다.
    </p>
  `;

  const { data, error } = await supabase.rpc(
    "admin_list_reservation_time_blocks"
  );

  if (error) {
    list.innerHTML = `
      <p class="admin-time-block-empty">
        제한 시간을 불러오지 못했습니다.
      </p>
    `;
    showMessage(`예약 제한 조회 오류: ${error.message}`, true);
    return;
  }

  renderTimeBlocks(data ?? []);
}

async function createTimeBlock(event) {
  event.preventDefault();
  showMessage("");

  const dateValue = dateInput.value;
  const startHour = Number(startInput.value);
  const endHour = Number(endInput.value);

  if (!dateValue) {
    showMessage("제한 날짜를 선택해 주세요.", true);
    dateInput.focus();
    return;
  }

  if (endHour <= startHour) {
    showMessage("종료 시각은 시작 시각보다 늦어야 합니다.", true);
    endInput.focus();
    return;
  }

  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = "등록 중...";

  const { error } = await supabase.rpc(
    "admin_create_reservation_time_block",
    {
      p_start_at: toSeoulInstant(dateValue, startHour),
      p_end_at: toSeoulInstant(dateValue, endHour),
      p_reason: reasonInput.value.trim()
    }
  );

  submitButton.disabled = false;
  submitButton.textContent = "예약 제한 등록";

  if (error) {
    showMessage(error.message, true);
    return;
  }

  showMessage("예약 제한 시간이 등록되었습니다.");
  reasonInput.value = "";
  await loadTimeBlocks();
}

async function deleteTimeBlock(button) {
  const label = button.dataset.timeBlockLabel || "선택한 시간";

  if (!confirm(`${label} 예약 제한을 해제하시겠습니까?`)) {
    return;
  }

  button.disabled = true;
  button.textContent = "해제 중...";

  const { error } = await supabase.rpc(
    "admin_delete_reservation_time_block",
    {
      p_block_id: button.dataset.timeBlockDelete
    }
  );

  if (error) {
    button.disabled = false;
    button.textContent = "제한 해제";
    showMessage(`예약 제한 해제 오류: ${error.message}`, true);
    return;
  }

  showMessage("예약 제한이 해제되었습니다.");
  await loadTimeBlocks();
}

async function initialize() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return;
    }

    const permission = await checkApproved(user.id);

    if (
      permission.role !== "admin" ||
      permission.is_approved !== true
    ) {
      alert("승인된 관리자만 접근할 수 있습니다.");
      window.location.href = "./reservation.html";
      return;
    }

    const today = getSeoulDateKey();
    dateInput.min = today;
    dateInput.value = today;
    syncEndTimeOptions();
    await loadTimeBlocks();
  } catch (error) {
    showMessage(`관리자 확인 오류: ${error.message}`, true);
  }
}

initialize();
