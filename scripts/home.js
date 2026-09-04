import { supabase } from "./config.js";

const slotsContainer = document.getElementById(
  "today-reservation-slots"
);
const dateLabel = document.getElementById(
  "today-reservation-date"
);

const SEOUL_TIME_ZONE = "Asia/Seoul";
const FIRST_HOUR = 10;
const LAST_HOUR = 18;

const seoulDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SEOUL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

const seoulDateLabelFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: SEOUL_TIME_ZONE,
  month: "long",
  day: "numeric",
  weekday: "short"
});

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

function getSlotBoundary(dateKey, hour) {
  return new Date(`${dateKey}T${formatHour(hour)}:00+09:00`).getTime();
}

function isSlotBooked(bookings, slotStart, slotEnd) {
  return bookings.some((booking) => {
    const bookingStart = new Date(booking.start_at).getTime();
    const bookingEnd = new Date(
      booking.effective_end_at ?? booking.end_at
    ).getTime();

    return bookingStart < slotEnd && bookingEnd > slotStart;
  });
}

function renderSlots(bookings) {
  const dateKey = getSeoulDateKey();
  const rows = [];

  for (let hour = FIRST_HOUR; hour < LAST_HOUR; hour += 1) {
    const slotStart = getSlotBoundary(dateKey, hour);
    const slotEnd = getSlotBoundary(dateKey, hour + 1);
    const booked = isSlotBooked(bookings, slotStart, slotEnd);
    const timeLabel = `${formatHour(hour)} – ${formatHour(hour + 1)}`;
    const displayTimeLabel = `${formatHour(hour)}–${formatHour(hour + 1)}`;
    const stateLabel = booked ? "예약됨" : "미예약";

    rows.push(`
      <div
        class="today-reservation-slot${booked ? " is-booked" : ""}"
        aria-label="${timeLabel} ${stateLabel}"
      >
        <span class="today-reservation-time">${displayTimeLabel}</span>
      </div>
    `);
  }

  slotsContainer.innerHTML = rows.join("");
}

async function loadTodayReservations() {
  dateLabel.textContent = seoulDateLabelFormatter.format(new Date());

  const { data, error } = await supabase.rpc(
    "get_public_today_booked_slots"
  );

  if (error) {
    slotsContainer.innerHTML = `
      <p class="today-reservation-error">
        예약 현황을 불러오지 못했습니다.
      </p>
    `;
    return;
  }

  renderSlots(data ?? []);
}

loadTodayReservations();

window.setInterval(() => {
  if (!document.hidden) {
    loadTodayReservations();
  }
}, 60 * 1000);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    loadTodayReservations();
  }
});
