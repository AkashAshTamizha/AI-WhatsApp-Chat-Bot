/**
 * Website data source (default).
 *
 * The booking website has no API: its business name, tagline, rating, address,
 * hours, services and time slots all live in a static frontend file
 * (salon-booking/src/config.js). This adapter reads THAT file at request time
 * and exposes it through the same API shapes the bot already consumes, so the
 * bot always describes whatever the website currently shows. Nothing from the
 * website is copied into this repo; edit the website config and the bot follows.
 *
 * Mapping (website export -> API):
 *   SALON.*                 -> GET /salon
 *   SALON.services          -> GET /services   (strings, or objects that may also
 *                                               carry id/price/durationMinutes/...)
 *   SLOTS [{time,available}]-> GET /slots, /slots/:id, /availability
 *                              (the same daily template repeats for the next
 *                               SALON.bookingDays days, default 7)
 *
 * Bookings are the one thing the website does not have, so this source keeps
 * them in a booking store (see ../bookingStore.js): POST /appointments,
 * GET /appointments/:id and PATCH /appointments/:id. A booked slot blocks every
 * slot that would overlap it, and a service only gets slots where it fits
 * (service length, closing time).
 *
 * Fields the website does not have (prices, durations) are left out, never invented.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { createBookingStore } = require('../bookingStore');

// Default assumes the two projects sit side by side: ../salon-booking next to the bot folder.
const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '../../../salon-booking/src/config.js');

// ---------- reading the website's config file ----------

/** Fallback for when the file can't be import()ed (e.g. copied out of its ESM package). */
function evalAsScript(code) {
  const names = [...code.matchAll(/^export\s+(?:const|let|var)\s+(\w+)/gm)].map((m) => m[1]);
  const body = code.replace(/^export\s+(?=const|let|var)/gm, '');
  return vm.runInNewContext(`${body}\n;({ ${names.join(', ')} })`);
}

async function readModule(file) {
  const stat = fs.statSync(file); // throws if missing
  try {
    // mtime in the URL busts Node's module cache, so edits to the website config are picked up live.
    const ns = await import(`${pathToFileURL(file).href}?v=${stat.mtimeMs}`);
    // Depending on the Node version / package "type", named exports may sit under `.default`.
    if (ns.SALON) return ns;
    if (ns.default && ns.default.SALON) return ns.default;
  } catch {
    /* fall through to the script evaluator */
  }
  return evalAsScript(fs.readFileSync(file, 'utf8'));
}

// ---------- time helpers ----------

const pad = (n) => String(n).padStart(2, '0');
const toHHMM = (m) => `${pad(Math.floor(m / 60))}${pad(m % 60)}`;
const utc = (dateStr) => new Date(`${dateStr}T00:00:00Z`);
const isValidDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = utc(s);
  // Round-trip check: JS silently rolls 2026-02-31 over to March 3rd, which must not count as valid.
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

function addDays(dateStr, n) {
  const d = utc(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function nowIn(timeZone, date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value])
  );
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** "10:00 AM" / "1:30 pm" / "14:00" -> minutes since midnight, or null. */
function parseTime(label) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])?\s*$/.exec(String(label));
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0);
  }
  return h > 23 || min > 59 ? null : h * 60 + min;
}

const slug = (s) =>
  String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');

// ---------- the source ----------

const SLOT_ID = /^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})$/;

const httpError = (status, message) => Object.assign(new Error(message), { status });
const digits = (s) => String(s || '').replace(/\D/g, '');

/** Initials of the business name, used as the booking ID prefix (two words -> two letters). */
function prefixFor(site) {
  if (site.bookingPrefix) return String(site.bookingPrefix).toUpperCase();
  const initials = String(site.name)
    .split(/\s+/)
    .map((w) => (w.match(/\p{L}/u) || [''])[0])
    .join('')
    .toUpperCase();
  return initials.slice(0, 4) || 'BK';
}

/** 14:30 -> "2:30 PM" */
function label12(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * @param {object}   [opts]
 * @param {string}   [opts.configPath] path to the website's config.js
 * @param {() => Date} [opts.now]      clock (injectable for tests)
 * @param {object}   [opts.store]      booking store (default: in memory)
 */
function createWebsiteSource({ configPath, now = () => new Date(), store = createBookingStore() } = {}) {
  let warnedTz = false;
  const file = path.resolve(configPath || process.env.WEBSITE_CONFIG_PATH || DEFAULT_CONFIG_PATH);

  async function load() {
    let mod;
    try {
      mod = await readModule(file);
    } catch (err) {
      throw new Error(
        `Cannot read the website config at ${file} (${err.message}). ` +
          'Set WEBSITE_CONFIG_PATH to the website\'s src/config.js, or DATA_SOURCE=mock to use the dummy data.'
      );
    }
    const site = mod.SALON;
    if (!site || !site.name) throw new Error(`${file} must export SALON with at least a "name".`);

    const configured = process.env.BUSINESS_TIMEZONE || site.timezone;
    const timezone = configured || Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!configured && !warnedTz) {
      warnedTz = true;
      console.warn(
        `[website source] BUSINESS_TIMEZONE is not set; using this server's time zone (${timezone}). ` +
          'The website config has no time zone, so set BUSINESS_TIMEZONE (e.g. Asia/Kolkata) or "already passed" slots will be judged on the wrong clock.'
      );
    }
    try {
      new Intl.DateTimeFormat('en', { timeZone: timezone });
    } catch {
      throw new Error(`Invalid time zone "${timezone}" (set BUSINESS_TIMEZONE to an IANA name).`);
    }

    const salon = {
      id: slug(site.name),
      name: site.name,
      tagline: site.tagline,
      rating: site.rating,
      reviews: site.reviews,
      address: site.address,
      phone: site.phone,
      mapUrl: site.mapUrl,
      hoursLabel: typeof site.hours === 'string' ? site.hours : undefined,
      hours: typeof site.hours === 'object' ? site.hours : undefined,
      image: site.image,
      whatsappNumber: mod.WHATSAPP_NUMBER,
      timezone,
      locale: process.env.BUSINESS_LOCALE || site.locale || 'en-GB',
      currency: process.env.BUSINESS_CURRENCY || site.currency,
      bookingLeadMinutes: Number(process.env.BOOKING_LEAD_MINUTES) || 0,
      bookingDays: Math.min(30, Math.max(1, Number(site.bookingDays) || 7)),
      closingMinutes: site.closingTime ? parseTime(site.closingTime) : null,
    };

    const services = (site.services || []).map((s, i) =>
      typeof s === 'string'
        ? { id: slug(s) || `service-${i + 1}`, name: s }
        : { id: s.id || slug(s.name) || `service-${i + 1}`, ...s }
    );

    const rawSlots = (mod.SLOTS || [])
      .map((s) => ({ minutes: parseTime(s.time), available: s.available !== false }))
      .filter((s) => s.minutes !== null)
      .sort((a, b) => a.minutes - b.minutes);

    return { salon, services, rawSlots, prefix: prefixFor(site) };
  }

  const fmtDate = (locale, date, opts) => new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(utc(date));

  /** Dates a customer may book: today and the following bookingDays - 1 days. */
  function bookableDates(data) {
    const today = nowIn(data.salon.timezone, now()).date;
    return Array.from({ length: data.salon.bookingDays }, (_, i) => addDays(today, i));
  }

  function dayInfo(data, date) {
    const today = nowIn(data.salon.timezone, now()).date;
    const gap = Math.round((utc(date) - utc(today)) / 86400000);
    return {
      date,
      dateLabel: fmtDate(data.salon.locale, date, { day: 'numeric', month: 'long', year: 'numeric' }),
      weekday: fmtDate(data.salon.locale, date, { weekday: 'short' }),
      relative: gap === 0 ? 'Today' : gap === 1 ? 'Tomorrow' : null,
    };
  }

  /**
   * Every slot of one day, with a live availability verdict for a given service.
   * A slot is unavailable when: the website marks it so, it has already passed,
   * the service would overlap an existing booking, or it would end after closing time.
   * `excludeId` ignores one booking (the one being rescheduled).
   */
  function slotsOn(data, date, { service, excludeId } = {}) {
    const t = nowIn(data.salon.timezone, now());
    const dur = Number(service?.durationMinutes) > 0 ? Number(service.durationMinutes) : 0;
    const busy = store
      .list()
      .filter((b) => b.date === date && b.status === 'confirmed' && b.id !== excludeId)
      .map((b) => ({ start: b.startMinutes, end: b.startMinutes + (b.durationMinutes || 1) }));
    const info = dayInfo(data, date);

    return data.rawSlots.map((s) => {
      const end = s.minutes + dur;
      let reason = null;
      if (!s.available) reason = 'unavailable';
      else if (date === t.date && s.minutes < t.minutes + data.salon.bookingLeadMinutes) reason = 'past';
      else if (data.salon.closingMinutes != null && (dur ? end : s.minutes + 1) > data.salon.closingMinutes) reason = 'after-closing';
      else if (busy.some((b) => s.minutes < b.end && Math.max(end, s.minutes + 1) > b.start)) reason = 'booked';

      return {
        id: `${date}_${toHHMM(s.minutes)}`,
        ...info,
        minutes: s.minutes,
        startTime: `${pad(Math.floor(s.minutes / 60))}:${pad(s.minutes % 60)}`,
        startLabel: label12(s.minutes),
        ...(dur ? { endLabel: label12(end) } : {}),
        available: reason === null,
        reason,
      };
    });
  }

  const publicSlot = ({ minutes, ...s }) => s; // `minutes` is for internal use

  const dateWindow = ({ date, from, days = 7 }, data) => {
    const allowed = bookableDates(data);
    const wanted = date ? [date] : Array.from({ length: days }, (_, i) => addDays(from || allowed[0], i));
    return wanted.filter((d) => allowed.includes(d));
  };

  function findSlot(data, id, opts) {
    const m = SLOT_ID.exec(String(id));
    if (!m || !isValidDate(m[1])) return null;
    if (!bookableDates(data).includes(m[1])) return null;
    return slotsOn(data, m[1], opts).find((s) => s.id === id) || null;
  }

  /** A stored booking as the API shows it. */
  function toPublic(data, b) {
    const t = nowIn(data.salon.timezone, now());
    const end = b.startMinutes + (b.durationMinutes || 0);
    return {
      id: b.id,
      status: b.status,
      service: { id: b.serviceId, name: b.serviceName, price: b.price, durationMinutes: b.durationMinutes },
      currency: data.salon.currency,
      locale: data.salon.locale,
      slotId: `${b.date}_${toHHMM(b.startMinutes)}`,
      ...dayInfo(data, b.date),
      startTime: `${pad(Math.floor(b.startMinutes / 60))}:${pad(b.startMinutes % 60)}`,
      startLabel: label12(b.startMinutes),
      ...(b.durationMinutes ? { endLabel: label12(end) } : {}),
      customerName: b.customerName,
      customerPhone: b.customerPhone,
      past: b.date < t.date || (b.date === t.date && end <= t.minutes),
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    };
  }

  /** The booking, only if `customerPhone` (when given) is the number that made it. */
  function ownedBooking(id, customerPhone) {
    const b = store.get(id);
    if (!b) return null;
    if (customerPhone && digits(customerPhone) !== digits(b.customerPhone)) return null;
    return b;
  }

  return {
    name: 'website',
    configPath: file,
    isValidDate,

    async getSalon() {
      return (await load()).salon;
    },

    async getServices({ category } = {}) {
      const { salon, services } = await load();
      const items = category
        ? services.filter((s) => String(s.category || '').toLowerCase() === String(category).toLowerCase())
        : services;
      return { currency: salon.currency, locale: salon.locale, items };
    },

    async findService(id) {
      return (await load()).services.find((s) => s.id === id) || null;
    },

    async listSlots({ date, from, days = 7, service, excludeId, onlyAvailable = true, limit } = {}) {
      const data = await load();
      let slots = dateWindow({ date, from, days }, data).flatMap((d) => slotsOn(data, d, { service, excludeId }));
      if (onlyAvailable) slots = slots.filter((s) => s.available);
      return (limit ? slots.slice(0, limit) : slots).map(publicSlot);
    },

    async getSlot(id, { service, excludeId } = {}) {
      const slot = findSlot(await load(), id, { service, excludeId });
      return slot ? publicSlot(slot) : null;
    },

    async listAvailability({ date, from, days = 7, service, excludeId } = {}) {
      const data = await load();
      return dateWindow({ date, from, days }, data).map((d) => {
        const slots = slotsOn(data, d, { service, excludeId });
        const free = slots.filter((s) => s.available);
        return {
          ...dayInfo(data, d),
          open: slots.length > 0,
          totalSlots: slots.length,
          availableSlots: free.length,
          slots: free.map(publicSlot),
        };
      });
    },

    // ----- bookings -----

    async listAppointments({ customerPhone } = {}) {
      const data = await load();
      return store
        .list()
        .filter((b) => !customerPhone || digits(customerPhone) === digits(b.customerPhone))
        .map((b) => toPublic(data, b));
    },

    async getAppointment(id, { customerPhone } = {}) {
      const data = await load();
      const b = ownedBooking(id, customerPhone);
      return b ? toPublic(data, b) : null;
    },

    async createAppointment({ serviceId, slotId, customerName, customerPhone }) {
      const data = await load();
      const service = data.services.find((s) => s.id === serviceId);
      if (!service) throw httpError(404, `Unknown serviceId "${serviceId}"`);
      if (!digits(customerPhone)) throw httpError(400, 'customerPhone is required');

      const slot = findSlot(data, slotId, { service });
      if (!slot) throw httpError(404, 'Slot not found');
      if (!slot.available) throw httpError(409, `That time is no longer available (${slot.reason}).`);

      // Check and insert happen in the same synchronous step, so two customers can't take one slot.
      const stamp = now().toISOString();
      const b = store.create(data.prefix, {
        status: 'confirmed',
        serviceId: service.id,
        serviceName: service.name,
        price: service.price,
        durationMinutes: Number(service.durationMinutes) || 0,
        date: slot.date,
        startMinutes: slot.minutes,
        customerName: customerName || null,
        customerPhone: digits(customerPhone),
        createdAt: stamp,
        updatedAt: stamp,
      });
      return toPublic(data, b);
    },

    async rescheduleAppointment(id, { slotId, customerPhone }) {
      const data = await load();
      const existing = ownedBooking(id, customerPhone);
      if (!existing || existing.status !== 'confirmed') throw httpError(404, 'Appointment not found');

      const service = data.services.find((s) => s.id === existing.serviceId) || {
        durationMinutes: existing.durationMinutes,
      };
      const slot = findSlot(data, slotId, { service, excludeId: existing.id });
      if (!slot) throw httpError(404, 'Slot not found');
      if (!slot.available) throw httpError(409, `That time is no longer available (${slot.reason}).`);

      const b = store.update(existing.id, {
        date: slot.date,
        startMinutes: slot.minutes,
        updatedAt: now().toISOString(),
      });
      return toPublic(data, b);
    },
  };
}

module.exports = { createWebsiteSource, parseTime };
