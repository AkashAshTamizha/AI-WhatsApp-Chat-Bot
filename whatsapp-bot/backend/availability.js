const { salon, services, appointments } = require('./data');

const SLOT = salon.slotMinutes;
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// ---------- date helpers (all in the salon's timezone) ----------

function nowInSalonTz() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: salon.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

const utc = (dateStr) => new Date(`${dateStr}T00:00:00Z`);

function addDays(dateStr, n) {
  const d = utc(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const isValidDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = utc(s);
  // Round-trip check: JS silently rolls 2026-02-31 over to March 3rd, which must not count as valid.
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

function dateLabel(dateStr) {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(utc(dateStr));
}

const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function timeLabel(m) {
  const h24 = Math.floor(m / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m % 60).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}

// ---------- availability engine ----------

const slotsNeeded = (service) => (service ? Math.ceil(service.durationMinutes / SLOT) : 1);

/** Set of "YYYY-MM-DD_HHMM" keys that are already taken by seeded appointments. */
function bookedKeys(today) {
  const keys = new Set();
  for (const a of appointments) {
    if (a.status === 'cancelled') continue;
    const svc = services.find((s) => s.id === a.serviceId);
    const date = addDays(today, a.dayOffset);
    const start = toMinutes(a.start);
    for (let k = 0; k < slotsNeeded(svc); k++) {
      keys.add(`${date}_${toHHMM(start + k * SLOT).replace(':', '')}`);
    }
  }
  return keys;
}

function dayStartTimes(date) {
  const hours = salon.hours[DAY_KEYS[utc(date).getUTCDay()]];
  if (!hours) return [];
  const out = [];
  for (let m = toMinutes(hours.open); m + SLOT <= toMinutes(hours.close); m += SLOT) out.push(m);
  return out;
}

/**
 * All slots for one date, each flagged available/unavailable (with a reason).
 * If a service is given, a slot is only available when enough consecutive
 * free slots follow it to fit the service's duration.
 */
function slotsForDate(date, { service } = {}) {
  const now = nowInSalonTz();
  const booked = bookedKeys(now.date);
  const starts = dayStartTimes(date);
  const needed = slotsNeeded(service);
  const keyOf = (m) => `${date}_${toHHMM(m).replace(':', '')}`;

  return starts.map((m, i) => {
    let reason = null;
    if (date < now.date || (date === now.date && m < now.minutes + (salon.bookingLeadMinutes || 0))) {
      reason = 'past';
    } else {
      for (let k = 0; k < needed; k++) {
        const next = starts[i + k];
        if (next === undefined) { reason = 'too_late_for_service'; break; }
        if (booked.has(keyOf(next))) { reason = 'booked'; break; }
      }
    }
    return {
      id: keyOf(m),
      date,
      dateLabel: dateLabel(date),
      startTime: toHHMM(m),
      endTime: toHHMM(m + SLOT),
      startLabel: timeLabel(m),
      endLabel: timeLabel(m + SLOT),
      available: reason === null,
      reason,
    };
  });
}

function dateRange(from, days) {
  return Array.from({ length: days }, (_, i) => addDays(from, i));
}

/** Flat, chronologically ordered slot list across one date or a range. */
function listSlots({ date, from, days = 7, service, onlyAvailable = true, limit } = {}) {
  const dates = date ? [date] : dateRange(from || nowInSalonTz().date, days);
  let slots = dates.flatMap((d) => slotsForDate(d, { service }));
  if (onlyAvailable) slots = slots.filter((s) => s.available);
  return limit ? slots.slice(0, limit) : slots;
}

/** Per-day summary: open/closed, counts and the free slots. */
function listAvailability({ date, from, days = 7, service } = {}) {
  const dates = date ? [date] : dateRange(from || nowInSalonTz().date, days);
  return dates.map((d) => {
    const all = slotsForDate(d, { service });
    const free = all.filter((s) => s.available);
    return {
      date: d,
      dateLabel: dateLabel(d),
      open: all.length > 0,
      totalSlots: all.length,
      availableSlots: free.length,
      slots: free,
    };
  });
}

function getSlot(id, { service } = {}) {
  const m = /^(\d{4}-\d{2}-\d{2})_(\d{4})$/.exec(id);
  if (!m || !isValidDate(m[1])) return null;
  return slotsForDate(m[1], { service }).find((s) => s.id === id) || null;
}

/** Seeded appointments with real dates and service names resolved. */
function listAppointments() {
  const today = nowInSalonTz().date;
  return appointments.map((a) => {
    const svc = services.find((s) => s.id === a.serviceId);
    const start = toMinutes(a.start);
    return {
      id: a.id,
      date: addDays(today, a.dayOffset),
      startTime: a.start,
      endTime: toHHMM(start + slotsNeeded(svc) * SLOT),
      serviceId: a.serviceId,
      serviceName: svc?.name,
      customerName: a.customerName,
      customerPhone: a.customerPhone,
      status: a.status,
    };
  });
}

module.exports = { nowInSalonTz, isValidDate, listSlots, listAvailability, getSlot, listAppointments };
