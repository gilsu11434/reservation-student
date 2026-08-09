import {
  supabase,
  getCurrentUser,
  logout
} from "./config.js";

let currentUser = null;
let currentTeamId = null;
let currentProfile = null;

const reservationForm = document.getElementById("reservation-form");
const requesterNameInput = document.getElementById("requester-name");
const requesterEmailInput = document.getElementById("requester-email");
const requesterPhoneInput = document.getElementById("requester-phone");
const departmentInput = document.getElementById("department");
const studentIdInput = document.getElementById("student-id");
const headcountInput = document.getElementById("headcount");
const headcountButtons = document.querySelectorAll("[data-headcount]");
const participantsSection = document.getElementById("participants-section");
const participantFields = document.getElementById("participant-fields");
const participantSummary = document.getElementById("participant-summary");
const reservationDateInput = document.getElementById("reservation-date");
const reservationCalendar = document.getElementById("reservation-calendar");
const calendarToggle = document.getElementById("calendar-toggle");
const calendarValue = document.getElementById("calendar-value");
const calendarPopover = document.getElementById("calendar-popover");
const calendarMonth = document.getElementById("calendar-month");
const calendarDays = document.getElementById("calendar-days");
const calendarPrev = document.getElementById("calendar-prev");
const calendarNext = document.getElementById("calendar-next");
const startTimeInput = document.getElementById("start-time");
const endTimeInput = document.getElementById("end-time");
const startTimeButtons = document.querySelectorAll("[data-start-hour]");
const endTimeButtons = document.querySelectorAll("[data-end-hour]");
const selectedTimeSummary = document.getElementById(
  "selected-time-summary"
);
const timeSlotMessage = document.getElementById("time-slot-message");
const graduationProfessorInput = document.getElementById(
  "graduation-professor"
);
const equipmentInput = document.getElementById("equipment");
const purposeInput = document.getElementById("purpose");
const rulesAgreedInput = document.getElementById("rules-agreed");
const reservationMessage = document.getElementById(
  "reservation-message"
);

let bookedSlots = [];
let bookedSlotsLoaded = false;
let bookedSlotsLoadFailed = false;
let selectedStartHour = null;
let selectedEndHour = null;
let calendarMinimumDate = null;
let calendarMaximumDate = null;
let calendarViewDate = null;
let professorNameComposing = false;
let activeReservationErrorInput = null;

document
  .getElementById("logout-button")
  .addEventListener("click", logout);

headcountButtons.forEach((button) => {
  button.setAttribute("aria-pressed", "false");

  button.addEventListener("click", () => {
    selectHeadcount(Number(button.dataset.headcount));
  });
});

document
  .getElementById("requester-name")
  .addEventListener("input", updatePrimaryParticipant);

document
  .getElementById("student-id")
  .addEventListener("input", updatePrimaryParticipant);

document
  .getElementById("requester-email")
  .addEventListener("input", updatePrimaryParticipant);

graduationProfessorInput.addEventListener("compositionstart", () => {
  professorNameComposing = true;
});

graduationProfessorInput.addEventListener("compositionend", () => {
  professorNameComposing = false;
  graduationProfessorInput.value = sanitizeProfessorName(
    graduationProfessorInput.value
  );
});

graduationProfessorInput.addEventListener("input", () => {
  if (!professorNameComposing) {
    graduationProfessorInput.value = sanitizeProfessorName(
      graduationProfessorInput.value
    );
  }
});

graduationProfessorInput.addEventListener("blur", () => {
  graduationProfessorInput.value = normalizeProfessorName(
    graduationProfessorInput.value
  );
});

function clearEditedFieldError(event) {
  const input = event.target;

  input.removeAttribute?.("aria-invalid");

  if (activeReservationErrorInput === input) {
    activeReservationErrorInput = null;
    reservationMessage.textContent = "";
    reservationMessage.classList.remove("error");
  }
}

reservationForm.addEventListener("input", clearEditedFieldError);
reservationForm.addEventListener("change", clearEditedFieldError);

function sanitizeProfessorName(value) {
  return String(value ?? "")
    .replace(/\s*교수님?\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .slice(0, 30);
}

function normalizeProfessorName(value) {
  return sanitizeProfessorName(value).trim();
}

function isValidProfessorName(value) {
  const letters = value.match(/[가-힣a-zA-Z]/g) ?? [];

  return (
    letters.length >= 2 &&
    Array.from(value).length <= 30 &&
    /^[가-힣a-zA-Z·ㆍ ]+$/.test(value)
  );
}

function isValidDescriptiveText(value) {
  const completeLetters = value.match(/[가-힣a-zA-Z]/g) ?? [];

  return completeLetters.length >= 2;
}

function showReservationFieldError(input, text) {
  if (
    activeReservationErrorInput &&
    activeReservationErrorInput !== input
  ) {
    activeReservationErrorInput.removeAttribute("aria-invalid");
  }

  activeReservationErrorInput = input;
  reservationMessage.textContent = text;
  reservationMessage.classList.remove("success");
  reservationMessage.classList.add("error");
  input.setAttribute("aria-invalid", "true");
  input.focus();
}

function createReservationValidationError(text, input) {
  const error = new Error(text);
  error.input = input;
  return error;
}

calendarToggle.addEventListener("click", () => {
  const opening = calendarPopover.hidden;
  calendarPopover.hidden = !opening;
  calendarToggle.setAttribute("aria-expanded", String(opening));

  if (opening) {
    renderReservationCalendar();
  }
});

calendarPrev.addEventListener("click", () => {
  moveCalendarMonth(-1);
});

calendarNext.addEventListener("click", () => {
  moveCalendarMonth(1);
});

document.addEventListener("click", (event) => {
  if (!reservationCalendar.contains(event.target)) {
    closeReservationCalendar();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeReservationCalendar();
    calendarToggle.focus();
  }
});

startTimeButtons.forEach((button) => {
  button.setAttribute("aria-pressed", "false");

  button.addEventListener("click", () => {
    selectStartTime(Number(button.dataset.startHour));
  });
});

endTimeButtons.forEach((button) => {
  button.setAttribute("aria-pressed", "false");

  button.addEventListener("click", () => {
    selectEndTime(Number(button.dataset.endHour));
  });
});

async function initialize() {
  currentUser = await getCurrentUser();

  if (!currentUser) {
    return;
  }

  const profile = await loadProfile();

  if (!profile) {
    return;
  }

  setDateLimits();
  updateTimeSlotAvailability();
  await ensureReservationTeam(profile);
  await loadBookedSlots();
}

async function loadProfile() {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", currentUser.id)
    .single();

  if (error) {
    alert(error.message);
    return null;
  }

  currentProfile = data;
  fillProfile(data);

  return data;
}

function fillProfile(profile) {
  document.getElementById("requester-name").value =
    profile.full_name ?? "";

  document.getElementById("requester-email").value =
    normalizeEmail(profile.email ?? currentUser?.email ?? "");

  document.getElementById("requester-phone").value =
    profile.phone ?? "";

  document.getElementById("department").value =
    profile.department ?? "";

  document.getElementById("student-id").value =
    profile.student_id ?? "";

  updatePrimaryParticipant();
}

function getSavedParticipantValues() {
  const saved = new Map();

  participantFields
    .querySelectorAll(".participant-card[data-participant-index]")
    .forEach((card) => {
      const index = Number(card.dataset.participantIndex);
      const nameInput = card.querySelector(".participant-name");
      const studentIdInput = card.querySelector(".participant-student-id");
      const emailInput = card.querySelector(".participant-email");

      if (nameInput && studentIdInput && emailInput) {
        saved.set(index, {
          name: nameInput.value,
          studentId: studentIdInput.value,
          email: emailInput.value
        });
      }
    });

  return saved;
}

function selectHeadcount(count) {
  const savedValues = getSavedParticipantValues();

  headcountInput.value = String(count);
  participantSummary.textContent = `${count}명 선택`;
  participantsSection.hidden = false;

  headcountButtons.forEach((button) => {
    const selected = Number(button.dataset.headcount) === count;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });

  renderParticipantFields(count, savedValues);
}

function renderParticipantFields(count, savedValues = new Map()) {
  participantFields.innerHTML = "";

  const primaryCard = document.createElement("div");
  primaryCard.className = "participant-card participant-primary";
  primaryCard.dataset.participantIndex = "0";
  primaryCard.innerHTML = `
    <span class="participant-number">1</span>
    <div class="participant-primary-info">
      <div>
        <span>예약자 이름</span>
        <strong data-primary-name></strong>
      </div>
      <div>
        <span>학번</span>
        <strong data-primary-student-id></strong>
      </div>
      <div>
        <span>이메일</span>
        <strong data-primary-email></strong>
      </div>
    </div>
  `;
  participantFields.appendChild(primaryCard);

  for (let index = 1; index < count; index += 1) {
    const saved = savedValues.get(index) ?? {};
    const card = document.createElement("div");
    card.className = "participant-card";
    card.dataset.participantIndex = String(index);
    card.innerHTML = `
      <span class="participant-number">${index + 1}</span>
      <div class="participant-inputs">
        <label>
          참여자 이름
          <input
            class="participant-name"
            autocomplete="off"
            placeholder="이름을 입력하세요"
            required
          >
        </label>
        <label>
          학번
          <input
            class="participant-student-id"
            inputmode="numeric"
            autocomplete="off"
            placeholder="학번을 입력하세요"
            required
          >
        </label>
        <label>
          이메일
          <input
            class="participant-email"
            type="email"
            autocomplete="email"
            placeholder="가입한 이메일을 입력하세요"
            required
          >
        </label>
      </div>
    `;

    card.querySelector(".participant-name").value = saved.name ?? "";
    card.querySelector(".participant-student-id").value =
      saved.studentId ?? "";
    card.querySelector(".participant-email").value = saved.email ?? "";
    participantFields.appendChild(card);
  }

  updatePrimaryParticipant();
}

function updatePrimaryParticipant() {
  const nameElement = participantFields.querySelector("[data-primary-name]");
  const studentIdElement = participantFields.querySelector(
    "[data-primary-student-id]"
  );
  const emailElement = participantFields.querySelector(
    "[data-primary-email]"
  );

  if (nameElement) {
    nameElement.textContent =
      document.getElementById("requester-name").value.trim() || "-";
  }

  if (studentIdElement) {
    studentIdElement.textContent =
      document.getElementById("student-id").value.trim() || "-";
  }

  if (emailElement) {
    emailElement.textContent =
      normalizeEmail(document.getElementById("requester-email").value) || "-";
  }
}

function collectParticipants() {
  const headcount = Number(headcountInput.value);

  if (!headcount) {
    throw createReservationValidationError(
      "사용 인원을 선택해 주세요.",
      headcountButtons[0]
    );
  }

  const requesterEmail = normalizeEmail(
    document.getElementById("requester-email").value
  );

  if (!isValidEmail(requesterEmail)) {
    throw createReservationValidationError(
      "예약자 이메일을 확인할 수 없습니다. 회원정보의 이메일을 확인해 주세요.",
      requesterEmailInput
    );
  }

  const participants = [
    {
      member_name: document.getElementById("requester-name").value.trim(),
      student_id: document.getElementById("student-id").value.trim(),
      member_email: requesterEmail
    }
  ];

  participantFields
    .querySelectorAll(".participant-card[data-participant-index]")
    .forEach((card) => {
      const index = Number(card.dataset.participantIndex);

      if (index === 0) {
        return;
      }

      const memberNameInput = card.querySelector(".participant-name");
      const participantStudentIdInput = card.querySelector(
        ".participant-student-id"
      );
      const memberEmailInput = card.querySelector(".participant-email");
      const memberName = memberNameInput.value.trim();
      const studentId = participantStudentIdInput.value.trim();
      const memberEmail = normalizeEmail(
        memberEmailInput.value
      );

      if (!memberName || !studentId || !memberEmail) {
        const missingInput = !memberName
          ? memberNameInput
          : !studentId
            ? participantStudentIdInput
            : memberEmailInput;

        throw createReservationValidationError(
          `${index + 1}번 참여자의 이름, 학번, 이메일을 입력해 주세요.`,
          missingInput
        );
      }

      if (!isValidEmail(memberEmail)) {
        throw createReservationValidationError(
          `${index + 1}번 참여자의 이메일 형식이 올바르지 않습니다.`,
          memberEmailInput
        );
      }

      participants.push({
        member_name: memberName,
        student_id: studentId,
        member_email: memberEmail
      });
    });

  const studentIds = participants.map((participant) => participant.student_id);

  if (new Set(studentIds).size !== studentIds.length) {
    throw createReservationValidationError(
      "같은 학번을 두 번 입력할 수 없습니다.",
      participantFields.querySelector(".participant-student-id") ??
        studentIdInput
    );
  }

  const memberEmails = participants.map(
    (participant) => participant.member_email
  );

  if (new Set(memberEmails).size !== memberEmails.length) {
    throw createReservationValidationError(
      "같은 이메일을 두 번 입력할 수 없습니다.",
      participantFields.querySelector(".participant-email") ??
        requesterEmailInput
    );
  }

  return participants;
}

function resetHeadcountPicker() {
  headcountInput.value = "";
  participantsSection.hidden = true;
  participantFields.innerHTML = "";
  participantSummary.textContent = "";

  headcountButtons.forEach((button) => {
    button.classList.remove("selected");
    button.setAttribute("aria-pressed", "false");
  });
}

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function formatHour(hour) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function formatUsageHours(value) {
  const hours = Number(value);

  if (!Number.isFinite(hours)) {
    return "0";
  }

  return Number.isInteger(hours)
    ? String(hours)
    : hours.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function formatUsageErrorMessage(value) {
  return String(value || "참여자 정보를 저장하지 못했습니다.")
    .replace(/^참여자\s+/, "")
    .replace(
      /(\d+(?:\.\d+)?)시간/g,
      (match, hours) => `${formatUsageHours(hours)}시간`
    );
}

function formatSeoulDate(value) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).format(new Date(value));
}

function formatSeoulTime(value) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date(value));
}

function getDateWeekday(dateValue) {
  const [year, month, day] = dateValue.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function getTimeSlotStatus(dateValue, hour) {
  if (!dateValue) {
    return { available: false, label: "날짜 선택 필요" };
  }

  if (!bookedSlotsLoaded) {
    return {
      available: false,
      label: bookedSlotsLoadFailed ? "예약 확인 실패" : "예약 확인 중"
    };
  }

  const weekday = getDateWeekday(dateValue);

  if (weekday === 0 || weekday === 6) {
    return { available: false, label: "주말 이용 불가" };
  }

  const slotStart = new Date(
    `${dateValue}T${formatHour(hour)}:00+09:00`
  );
  const slotEnd = new Date(
    `${dateValue}T${formatHour(hour + 1)}:00+09:00`
  );
  const minimumStartTime = Date.now() + 24 * 60 * 60 * 1000;

  if (slotStart.getTime() < minimumStartTime) {
    return { available: false, label: "예약 마감" };
  }

  const isBooked = bookedSlots.some((slot) => {
    const bookedStart = new Date(slot.start_at).getTime();
    const bookedEnd = new Date(
      slot.effective_end_at ?? slot.end_at
    ).getTime();

    return (
      bookedStart < slotEnd.getTime() &&
      bookedEnd > slotStart.getTime()
    );
  });

  if (isBooked) {
    return { available: false, label: "예약됨" };
  }

  return { available: true, label: "예약 가능" };
}

function getTimeRangeStatus(dateValue, startHour, endHour) {
  for (let hour = startHour; hour < endHour; hour += 1) {
    const status = getTimeSlotStatus(dateValue, hour);

    if (!status.available) {
      return status;
    }
  }

  return { available: true, label: "종료 가능" };
}

function resetSelectedTimeSlots() {
  selectedStartHour = null;
  selectedEndHour = null;
  syncSelectedTimeSlots();
}

function selectStartTime(hour) {
  const clickedButton = document.querySelector(
    `[data-start-hour="${hour}"]`
  );

  if (!clickedButton || clickedButton.disabled) {
    return;
  }

  if (selectedStartHour === hour) {
    selectedStartHour = null;
    selectedEndHour = null;
  } else {
    selectedStartHour = hour;
    selectedEndHour = null;
  }

  updateTimeSlotAvailability();
}

function selectEndTime(hour) {
  const clickedButton = document.querySelector(
    `[data-end-hour="${hour}"]`
  );

  if (!clickedButton || clickedButton.disabled) {
    return;
  }

  selectedEndHour = selectedEndHour === hour ? null : hour;
  updateTimeSlotAvailability();
}

function syncSelectedTimeSlots() {
  startTimeButtons.forEach((button) => {
    const selected = Number(button.dataset.startHour) === selectedStartHour;

    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });

  endTimeButtons.forEach((button) => {
    const selected = Number(button.dataset.endHour) === selectedEndHour;

    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });

  timeSlotMessage.classList.remove("success", "error");
  selectedTimeSummary.parentElement.classList.remove("complete");

  if (selectedStartHour === null) {
    startTimeInput.value = "";
    endTimeInput.value = "";
    selectedTimeSummary.textContent = "선택 전";

    if (!reservationDateInput.value) {
      timeSlotMessage.textContent = "예약 날짜를 먼저 선택해 주세요.";
    } else if (bookedSlotsLoadFailed) {
      timeSlotMessage.textContent =
        "예약 현황을 불러오지 못했습니다. 페이지를 새로고침해 주세요.";
      timeSlotMessage.classList.add("error");
    } else if (!bookedSlotsLoaded) {
      timeSlotMessage.textContent = "예약 현황을 확인하고 있습니다.";
    } else {
      timeSlotMessage.textContent = "시작 시각을 선택해 주세요.";
    }

    return;
  }

  startTimeInput.value = formatHour(selectedStartHour);

  if (selectedEndHour === null) {
    endTimeInput.value = "";
    selectedTimeSummary.textContent =
      `${formatHour(selectedStartHour)} ~ 종료 시각 선택 필요`;
    timeSlotMessage.textContent = "오른쪽에서 종료 시각을 선택해 주세요.";
    return;
  }

  endTimeInput.value = formatHour(selectedEndHour);
  selectedTimeSummary.textContent =
    `${formatHour(selectedStartHour)} ~ ${formatHour(selectedEndHour)} ` +
    `(${selectedEndHour - selectedStartHour}시간)`;
  selectedTimeSummary.parentElement.classList.add("complete");
  timeSlotMessage.textContent = "시작 시각과 종료 시각이 선택되었습니다.";
}

function updateTimeSlotAvailability() {
  const dateValue = reservationDateInput.value;

  if (selectedStartHour !== null) {
    const startStatus = getTimeSlotStatus(dateValue, selectedStartHour);

    if (!startStatus.available) {
      selectedStartHour = null;
      selectedEndHour = null;
    } else if (selectedEndHour !== null) {
      const rangeStatus = getTimeRangeStatus(
        dateValue,
        selectedStartHour,
        selectedEndHour
      );

      if (!rangeStatus.available) {
        selectedEndHour = null;
      }
    }
  }

  startTimeButtons.forEach((button) => {
    const hour = Number(button.dataset.startHour);
    const statusText = button.querySelector("small");
    const status = getTimeSlotStatus(dateValue, hour);

    button.disabled = !status.available;
    button.title = status.label;
    button.setAttribute(
      "aria-label",
      `${formatHour(hour)} ${status.label}`
    );
    button.setAttribute("aria-disabled", String(!status.available));

    if (statusText) {
      statusText.textContent = status.label;
    }
  });

  endTimeButtons.forEach((button) => {
    const hour = Number(button.dataset.endHour);
    const statusText = button.querySelector("small");
    let status;

    if (selectedStartHour === null) {
      status = { available: false, label: "시작 선택 필요" };
    } else if (
      hour <= selectedStartHour ||
      hour > Math.min(selectedStartHour + 2, 18)
    ) {
      status = { available: false, label: "선택 불가" };
    } else {
      status = getTimeRangeStatus(
        dateValue,
        selectedStartHour,
        hour
      );
    }

    button.disabled = !status.available;
    button.title = status.label;
    button.setAttribute(
      "aria-label",
      `${formatHour(hour)} ${status.label}`
    );
    button.setAttribute("aria-disabled", String(!status.available));

    if (statusText) {
      statusText.textContent = status.label;
    }
  });

  syncSelectedTimeSlots();

  if (
    dateValue &&
    bookedSlotsLoaded &&
    selectedStartHour === null &&
    Array.from(startTimeButtons).every((button) => button.disabled)
  ) {
    timeSlotMessage.textContent =
      "선택한 날짜에는 예약 가능한 시간이 없습니다.";
    timeSlotMessage.classList.add("error");
  }
}

async function ensureReservationTeam(profile) {
  const { data: existingTeams, error: loadError } = await supabase
    .from("teams")
    .select("id")
    .eq("leader_id", currentUser.id)
    .order("created_at", { ascending: true })
    .limit(1);

  if (loadError) {
    alert(`예약 정보 준비 오류: ${loadError.message}`);
    return false;
  }

  if (existingTeams.length > 0) {
    currentTeamId = existingTeams[0].id;
    return true;
  }

  const defaultTeamName =
    `${profile.student_id || currentUser.id.slice(0, 8)} 예약`;

  const { data: createdTeam, error: createError } = await supabase
    .from("teams")
    .insert({
      team_name: defaultTeamName,
      leader_id: currentUser.id
    })
    .select("id")
    .single();

  if (createError) {
    alert(`예약 정보 준비 오류: ${createError.message}`);
    return false;
  }

  currentTeamId = createdTeam.id;
  return true;
}

function toLocalDateValue(date) {
  const localDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60 * 1000
  );
  return localDate.toISOString().slice(0, 10);
}

function parseLocalDateValue(dateValue) {
  const [year, month, day] = dateValue.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function getMonthIndex(date) {
  return date.getFullYear() * 12 + date.getMonth();
}

function closeReservationCalendar() {
  calendarPopover.hidden = true;
  calendarToggle.setAttribute("aria-expanded", "false");
}

function moveCalendarMonth(direction) {
  if (!calendarViewDate) {
    return;
  }

  const nextMonth = new Date(
    calendarViewDate.getFullYear(),
    calendarViewDate.getMonth() + direction,
    1,
    12
  );
  const minimumMonth = getMonthIndex(calendarMinimumDate);
  const maximumMonth = getMonthIndex(calendarMaximumDate);
  const nextMonthIndex = getMonthIndex(nextMonth);

  if (
    nextMonthIndex < minimumMonth ||
    nextMonthIndex > maximumMonth
  ) {
    return;
  }

  calendarViewDate = nextMonth;
  renderReservationCalendar();
}

function selectReservationDate(dateValue) {
  const selectedDate = parseLocalDateValue(dateValue);
  const weekday = selectedDate.getDay();
  const outsideRange =
    selectedDate < calendarMinimumDate ||
    selectedDate > calendarMaximumDate;

  if (outsideRange || weekday === 0 || weekday === 6) {
    return;
  }

  reservationDateInput.value = dateValue;
  calendarValue.textContent = dateValue;
  calendarToggle.classList.add("has-value");
  closeReservationCalendar();
  resetSelectedTimeSlots();
  updateTimeSlotAvailability();
}

function renderReservationCalendar() {
  if (
    !calendarViewDate ||
    !calendarMinimumDate ||
    !calendarMaximumDate
  ) {
    return;
  }

  const year = calendarViewDate.getFullYear();
  const month = calendarViewDate.getMonth();
  const firstWeekday = new Date(year, month, 1, 12).getDay();
  const daysInMonth = new Date(year, month + 1, 0, 12).getDate();
  const minimumMonth = getMonthIndex(calendarMinimumDate);
  const maximumMonth = getMonthIndex(calendarMaximumDate);
  const currentMonth = getMonthIndex(calendarViewDate);

  calendarMonth.textContent = `${year}년 ${month + 1}월`;
  calendarPrev.disabled = currentMonth <= minimumMonth;
  calendarNext.disabled = currentMonth >= maximumMonth;
  calendarDays.innerHTML = "";

  for (let index = 0; index < firstWeekday; index += 1) {
    const emptyCell = document.createElement("span");
    emptyCell.className = "calendar-day-empty";
    emptyCell.setAttribute("aria-hidden", "true");
    calendarDays.appendChild(emptyCell);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day, 12);
    const dateValue = toLocalDateValue(date);
    const weekday = date.getDay();
    const weekend = weekday === 0 || weekday === 6;
    const outsideRange =
      date < calendarMinimumDate || date > calendarMaximumDate;
    const disabled = weekend || outsideRange;
    const button = document.createElement("button");

    button.type = "button";
    button.className = "calendar-day";
    button.textContent = String(day);
    button.dataset.calendarDate = dateValue;
    button.disabled = disabled;
    button.setAttribute("role", "gridcell");
    button.setAttribute("aria-disabled", String(disabled));
    button.setAttribute(
      "aria-label",
      disabled
        ? `${dateValue} 선택 불가`
        : `${dateValue} 예약 날짜 선택`
    );

    if (weekend) {
      button.classList.add("weekend");
    }

    if (outsideRange) {
      button.classList.add("outside-range");
    }

    if (dateValue === reservationDateInput.value) {
      button.classList.add("selected");
      button.setAttribute("aria-selected", "true");
    }

    button.addEventListener("click", () => {
      selectReservationDate(dateValue);
    });

    calendarDays.appendChild(button);
  }

  const occupiedCells = firstWeekday + daysInMonth;
  const trailingCells = (7 - (occupiedCells % 7)) % 7;

  for (let index = 0; index < trailingCells; index += 1) {
    const emptyCell = document.createElement("span");
    emptyCell.className = "calendar-day-empty";
    emptyCell.setAttribute("aria-hidden", "true");
    calendarDays.appendChild(emptyCell);
  }
}

function setDateLimits() {
  calendarMinimumDate = new Date();
  calendarMinimumDate.setHours(12, 0, 0, 0);
  calendarMinimumDate.setDate(calendarMinimumDate.getDate() + 1);

  calendarMaximumDate = new Date();
  calendarMaximumDate.setHours(12, 0, 0, 0);
  calendarMaximumDate.setDate(calendarMaximumDate.getDate() + 14);

  reservationDateInput.min = toLocalDateValue(calendarMinimumDate);
  reservationDateInput.max = toLocalDateValue(calendarMaximumDate);
  calendarViewDate = reservationDateInput.value
    ? parseLocalDateValue(reservationDateInput.value)
    : new Date(
      calendarMinimumDate.getFullYear(),
      calendarMinimumDate.getMonth(),
      1,
      12
    );

  calendarValue.textContent = reservationDateInput.value || "연도-월-일";
  calendarToggle.classList.toggle(
    "has-value",
    Boolean(reservationDateInput.value)
  );
  closeReservationCalendar();
  renderReservationCalendar();
}

async function loadBookedSlots() {
  const from = new Date();

  const to = new Date();
  to.setDate(to.getDate() + 15);

  const { data, error } = await supabase.rpc(
    "get_reservation_blocked_slots",
    {
      p_from: from.toISOString(),
      p_to: to.toISOString()
    }
  );

  const container =
    document.getElementById("booked-slots");

  if (error) {
    bookedSlots = [];
    bookedSlotsLoaded = false;
    bookedSlotsLoadFailed = true;

    if (container) {
      container.textContent = error.message;
    }

    updateTimeSlotAvailability();
    return;
  }

  bookedSlots = data ?? [];
  bookedSlotsLoaded = true;
  bookedSlotsLoadFailed = false;
  updateTimeSlotAvailability();

  if (!container) {
    return;
  }

  if (bookedSlots.length === 0) {
    container.textContent = "현재 예약된 시간이 없습니다.";
    return;
  }

  container.innerHTML = bookedSlots
    .map((slot) => {
      const date = formatSeoulDate(slot.start_at);
      const startTime = formatSeoulTime(slot.start_at);
      const endTime = formatSeoulTime(
        slot.effective_end_at ?? slot.end_at
      );

      return `
        <div class="booked-slot">
          <strong>${date}</strong>
          <span>
            ${startTime} ~ ${endTime}
          </span>
        </div>
      `;
    })
    .join("");
}

reservationForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const message = reservationMessage;

    if (activeReservationErrorInput) {
      activeReservationErrorInput.removeAttribute("aria-invalid");
      activeReservationErrorInput = null;
    }

    const requesterName = requesterNameInput.value.trim();
    const requesterEmail = normalizeEmail(requesterEmailInput.value);
    const requesterPhone = requesterPhoneInput.value.trim();
    const department = departmentInput.value.trim();
    const studentId = studentIdInput.value.trim();
    const graduationProfessor = normalizeProfessorName(
      graduationProfessorInput.value
    );

    const equipment = equipmentInput.value.trim();
    const purpose = purposeInput.value.trim();

    const date = reservationDateInput.value;
    const startTime = startTimeInput.value;
    const endTime = endTimeInput.value;

    graduationProfessorInput.value = graduationProfessor;

    if (!requesterName) {
      showReservationFieldError(
        requesterNameInput,
        "예약자 이름을 입력해 주세요."
      );
      return;
    }

    if (!isValidEmail(requesterEmail)) {
      showReservationFieldError(
        requesterEmailInput,
        "예약자 이메일을 확인할 수 없습니다. 회원정보의 이메일을 확인해 주세요."
      );
      return;
    }

    if (!requesterPhone) {
      showReservationFieldError(
        requesterPhoneInput,
        "예약자 전화번호를 입력해 주세요."
      );
      return;
    }

    if (!department) {
      showReservationFieldError(
        departmentInput,
        "학과를 입력해 주세요."
      );
      return;
    }

    if (!studentId) {
      showReservationFieldError(
        studentIdInput,
        "학번을 입력해 주세요."
      );
      return;
    }

    if (!graduationProfessor) {
      showReservationFieldError(
        graduationProfessorInput,
        "종합설계 지도교수님 이름을 입력해 주세요."
      );
      return;
    }

    if (!isValidProfessorName(graduationProfessor)) {
      showReservationFieldError(
        graduationProfessorInput,
        "종합설계 지도교수님 이름은 완성형 한글 또는 영문으로 2글자 이상 입력해 주세요. (예: 홍길동)"
      );
      return;
    }

    let participants;

    try {
      participants = collectParticipants();
    } catch (error) {
      showReservationFieldError(
        error.input ?? headcountButtons[0],
        error.message
      );
      return;
    }

    if (!equipment) {
      showReservationFieldError(
        equipmentInput,
        "사용할 장비를 입력해 주세요. 사용 장비가 없다면 ‘없음’이라고 입력해 주세요."
      );
      return;
    }

    if (!isValidDescriptiveText(equipment)) {
      showReservationFieldError(
        equipmentInput,
        "사용할 장비에는 완성형 한글 또는 영문을 2글자 이상 입력해 주세요. (예: 컴퓨터, 인두기)"
      );
      return;
    }

    if (!purpose) {
      showReservationFieldError(
        purposeInput,
        "사용 목적을 입력해 주세요."
      );
      return;
    }

    if (!isValidDescriptiveText(purpose)) {
      showReservationFieldError(
        purposeInput,
        "사용 목적에는 완성형 한글 또는 영문을 2글자 이상 입력해 주세요. (예: 종합설계 작품 제작)"
      );
      return;
    }

    if (!date) {
      showReservationFieldError(
        calendarToggle,
        "예약 날짜를 선택해 주세요."
      );
      return;
    }

    if (!startTime) {
      const firstAvailableStartButton = Array.from(
        startTimeButtons
      ).find((button) => !button.disabled);

      showReservationFieldError(
        firstAvailableStartButton ?? calendarToggle,
        firstAvailableStartButton
          ? "시작 시각을 선택해 주세요."
          : "선택한 날짜에 예약 가능한 시작 시각이 없습니다. 다른 날짜를 선택해 주세요."
      );
      return;
    }

    if (!endTime) {
      const firstAvailableEndButton = Array.from(
        endTimeButtons
      ).find((button) => !button.disabled);

      showReservationFieldError(
        firstAvailableEndButton ?? calendarToggle,
        "종료 시각을 선택해 주세요."
      );
      return;
    }

    if (!rulesAgreedInput.checked) {
      showReservationFieldError(
        rulesAgreedInput,
        "이용수칙과 파손·분실 책임 규정을 확인하고 동의해 주세요."
      );
      return;
    }

    if (!currentTeamId) {
      message.textContent =
        "예약 정보를 준비하지 못했습니다. 페이지를 새로고침해 주세요.";
      message.classList.remove("success");
      message.classList.add("error");
      return;
    }

    const { data: emailChecks, error: emailCheckError } =
      await supabase.rpc("check_registered_participant_emails", {
        p_emails: participants.map(
          (participant) => participant.member_email
        )
      });

    if (emailCheckError) {
      message.textContent =
        `참여자 이메일 확인 오류: ${emailCheckError.message}`;
      message.classList.remove("success");
      message.classList.add("error");
      return;
    }

    const unregisteredEmails = (emailChecks ?? [])
      .filter((result) => !result.is_registered)
      .map((result) => result.member_email);

    if (unregisteredEmails.length > 0) {
      message.textContent =
        `가입되지 않은 이메일입니다: ${unregisteredEmails.join(", ")}`;
      message.classList.remove("success");
      message.classList.add("error");
      return;
    }

    const startAt =
      new Date(
        `${date}T${startTime}:00+09:00`
      ).toISOString();

    const endAt =
      new Date(
        `${date}T${endTime}:00+09:00`
      ).toISOString();

    const { data: dailyUsage, error: dailyUsageError } =
      await supabase.rpc("check_participant_daily_hours", {
        p_emails: participants.map(
          (participant) => participant.member_email
        ),
        p_start_at: startAt,
        p_end_at: endAt
      });

    if (dailyUsageError) {
      message.textContent =
        `일일 이용시간 확인 오류: ${dailyUsageError.message}`;
      message.classList.remove("success");
      message.classList.add("error");
      return;
    }

    const dailyOverLimitParticipants = (dailyUsage ?? []).filter(
      (usage) => !usage.is_allowed
    );

    if (dailyOverLimitParticipants.length > 0) {
      const details = dailyOverLimitParticipants.map((usage) => {
        const participant = participants.find(
          (item) => item.member_email === usage.member_email
        );

        return (
          `${participant?.member_name ?? usage.member_email} ` +
          `(${usage.member_email}: 기존 ` +
          `${formatUsageHours(usage.used_hours)}시간 + 신청 ` +
          `${formatUsageHours(usage.requested_hours)}시간)`
        );
      });

      message.textContent =
        `일일 2시간을 초과하는 참여자가 있어 예약할 수 없습니다: ` +
        details.join(" / ");
      message.classList.remove("success");
      message.classList.add("error");
      return;
    }

    const { data: weeklyUsage, error: weeklyUsageError } =
      await supabase.rpc("check_participant_weekly_hours", {
        p_emails: participants.map(
          (participant) => participant.member_email
        ),
        p_start_at: startAt,
        p_end_at: endAt
      });

    if (weeklyUsageError) {
      message.textContent =
        `주간 이용시간 확인 오류: ${weeklyUsageError.message}`;
      message.classList.remove("success");
      message.classList.add("error");
      return;
    }

    const overLimitParticipants = (weeklyUsage ?? []).filter(
      (usage) => !usage.is_allowed
    );

    if (overLimitParticipants.length > 0) {
      const details = overLimitParticipants.map((usage) => {
        const participant = participants.find(
          (item) => item.member_email === usage.member_email
        );

        return (
          `${participant?.member_name ?? usage.member_email} ` +
          `(${usage.member_email}: 기존 ` +
          `${formatUsageHours(usage.used_hours)}시간 + 신청 ` +
          `${formatUsageHours(usage.requested_hours)}시간)`
        );
      });

      message.textContent =
        `주간 4시간을 초과하는 참여자가 있어 예약할 수 없습니다: ` +
        details.join(" / ");
      message.classList.remove("success");
      message.classList.add("error");
      return;
    }

    const { data, error } = await supabase.rpc(
      "create_room_reservation",
      {
        p_team_id: currentTeamId,

        p_requester_name:
          document.getElementById("requester-name")
            .value.trim(),

        p_requester_phone:
          document.getElementById("requester-phone")
            .value.trim(),

        p_department:
          document.getElementById("department")
            .value.trim(),

        p_student_id:
          document.getElementById("student-id")
            .value.trim(),

        p_headcount: participants.length,

        p_purpose: purpose,

        p_equipment: equipment,

        p_start_at: startAt,
        p_end_at: endAt,

        p_rules_agreed:
          document.getElementById("rules-agreed")
            .checked
      }
    );

    if (error) {
      message.textContent = error.message;
      message.classList.add("error");
      return;
    }

    const reservationResult = Array.isArray(data) ? data[0] : data;
    const reservationId =
      reservationResult?.reservation_id ??
      reservationResult?.id ??
      reservationResult;

    if (!reservationId) {
      message.textContent =
        "예약은 생성됐지만 처리 정보를 확인하지 못했습니다. 관리자에게 문의해 주세요.";
      message.classList.add("error");
      return;
    }

    const { error: professorError } = await supabase.rpc(
      "set_my_reservation_professor",
      {
        p_reservation_id: String(reservationId),
        p_graduation_professor: graduationProfessor
      }
    );

    if (professorError) {
      await supabase.rpc("cancel_my_reservation", {
        p_reservation_id: reservationId
      });

      message.textContent =
        `종합설계 지도교수님 저장 오류: ${professorError.message}`;
      message.classList.add("error");
      return;
    }

    const { error: memberError } = await supabase.rpc(
      "save_verified_reservation_participants",
      {
        p_reservation_id: String(reservationId),
        p_requester_email: participants[0].member_email,
        p_participants: participants
      }
    );

    if (memberError) {
      await supabase.rpc("cancel_my_reservation", {
        p_reservation_id: reservationId
      });

      message.textContent = formatUsageErrorMessage(
        memberError.message
      );
      message.classList.add("error");
      return;
    }

    message.textContent =
      "예약 신청이 접수되었습니다. 관리자 승인 대기 중입니다.";
    message.classList.remove("error");
    message.classList.add("success");

    event.target.reset();
    resetHeadcountPicker();
    resetSelectedTimeSlots();
    updateTimeSlotAvailability();

    if (currentProfile) {
      fillProfile(currentProfile);
    }

    setDateLimits();

    await loadBookedSlots();
  });

initialize();
