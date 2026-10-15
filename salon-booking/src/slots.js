// Helpers for the "today's time slots" list.

/** "10:00 AM" / "01:30 pm" / "14:00" -> minutes since midnight, or null if it can't be read. */
export function parseTime(label) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])?\s*$/.exec(String(label))
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2])
  if (m[3]) {
    if (h < 1 || h > 12) return null
    h = (h % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0)
  }
  return h > 23 || min > 59 ? null : h * 60 + min
}

/** Current time of day (minutes since midnight) in the business's time zone. */
export function minutesNow(timeZone, date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date)
    const get = (t) => Number(parts.find((p) => p.type === t)?.value)
    return get('hour') * 60 + get('minute')
  } catch {
    return date.getHours() * 60 + date.getMinutes() // invalid/missing time zone -> visitor's clock
  }
}

/** Marks slots whose start time has already passed today as unavailable. */
export function withPastMarked(slots, nowMinutes) {
  return slots.map((s) => {
    const start = parseTime(s.time)
    const past = start !== null && start < nowMinutes
    return { ...s, available: s.available && !past, past }
  })
}
