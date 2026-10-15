const wa = require('../services/whatsappService');
const backend = require('../services/backendService');
const ai = require('../services/aiService');
const { getSession, setSession } = require('../state/sessionService');

/**
 * Conversation flow (customers reply with option numbers; keywords also work):
 *
 *   NEW -> MENU
 *   MENU --1--> SERVICES_VIEW -> SERVICE_DETAIL --1--> (date step of booking)
 *        --2--> BOOK_SERVICE -> BOOK_DATE -> BOOK_SLOT -> BOOK_CONFIRM -> booking created, ID sent
 *        --3--> RESCH_ID -> RESCH_SLOT (same day) or RESCH_DATE -> RESCH_SLOT -> rescheduled
 *        --4--> contact details
 *
 * "menu" (or "hi", "0") returns to the main menu from anywhere.
 *
 * Nothing about the business (name, services, prices, durations, hours, phone,
 * slots, currency, locale) is written in this file - only the wording of the
 * conversation is. Every field is optional and simply skipped when the backend
 * doesn't provide it.
 */

const FALLBACK_TEXT = "Sorry, I didn't understand that. Please choose one of the options below.";
const NUMBER_FALLBACK = "Sorry, I didn't understand that. Please reply with one of the numbers shown.";
const BACKEND_DOWN_TEXT = 'Sorry, something went wrong on our side while fetching that. Please try again in a moment.';
const PAGE_SIZE = 10; // slots shown per message; reply "more" for the next page
const SLOT_FETCH_LIMIT = 100;
const MAX_DATES = 10;

// Messages from the same customer are handled one at a time, in order. Without this, two
// quick messages run concurrently and both read the same stale session.
const queues = new Map();
function handleIncomingMessage(msg, contact) {
  const phone = msg.from;
  const run = (queues.get(phone) || Promise.resolve()).then(() => processMessage(msg, contact));
  const tail = run.catch(() => {});
  queues.set(phone, tail);
  tail.then(() => {
    if (queues.get(phone) === tail) queues.delete(phone);
  });
  return run;
}

async function processMessage(msg, contact) {
  const phone = msg.from;
  const text = extractText(msg).trim();
  const session = getSession(phone);

  const profileName = contact?.profile?.name;
  if (profileName && session.data.waName !== profileName) {
    session.data.waName = profileName;
    setSession(phone, session);
  }

  try {
    if (session.step === 'NEW' || RE_MENU.test(text)) return await showMenu(phone, session);
    const handler = STEPS[session.step] || onMenu;
    return await handler(phone, session, text);
  } catch (err) {
    console.error('[chatController] error:', err.message);
    await wa.sendText(phone, BACKEND_DOWN_TEXT).catch(() => {});
  }
}

// ---------- parsing ----------

const RE_MENU = /^(menu|main menu|start|restart|home|hi+|hello+|hey+|namaste|0|welcome\b.*)\s*[.!]*$/i;
const RE_RESCHEDULE = /\b(re-?schedul\w*|change|move|postpone|modify)\b/i;
const RE_BOOK = /\b(book\w*|appointment|slots?|availab\w*|reserve)\b/i;
const RE_SERVICES = /\b(services?|prices?|price list|cost|rates?)\b/i;
const RE_CONTACT = /\b(contact|phone|call|address|location|where|hours|timings?|open|directions?)\b/i;
const RE_MORE = /^(more|next|later)\s*[.!?]*$/i;
const RE_BACK = /^(back|date|dates|change date|other date)\s*[.!?]*$/i;

const stripKeycaps = (s) => String(s || '').replace(/[\uFE0F\u20E3]/g, ''); // "1️⃣" -> "1"

/** "2", "2.", "2️⃣" -> 2; anything else -> null. */
function pickNumber(text) {
  const m = /^\s*(\d{1,3})\s*[.)]?\s*$/.exec(stripKeycaps(text));
  return m ? Number(m[1]) : null;
}

/** Strip WhatsApp formatting characters so backend-supplied names can't break our bold/italic markup. */
const clean = (s) => String(s ?? '').replace(/[*_~`]/g, '');

function extractText(msg) {
  if (msg.type === 'text') return msg.text?.body || '';
  if (msg.type === 'interactive') {
    return msg.interactive?.list_reply?.title || msg.interactive?.button_reply?.title || '';
  }
  return '';
}

// ---------- formatting ----------

/** 1 -> "1️⃣", 12 -> "1️⃣2️⃣" */
const num = (n) => [...String(n)].map((d) => `${d}\uFE0F\u20E3`).join('');

const salonName = (salon) => clean(salon?.name) || 'our salon';

// Currency and locale come from the backend; nothing is assumed here.
function formatPrice(price, currency, locale) {
  if (price == null) return null;
  if (!currency) return String(price);
  try {
    return new Intl.NumberFormat(locale || undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(price);
  } catch {
    return `${currency} ${price}`;
  }
}

/** 45 -> "45 mins", 90 -> "90 mins", 120 -> "2 hrs", 180 -> "3 hrs" */
function formatDuration(minutes) {
  const m = Number(minutes);
  if (!(m > 0)) return null;
  if (m >= 120 && m % 60 === 0) return `${m / 60} hrs`;
  return `${m} mins`;
}

/** Address may be a plain string or a structured object. */
function formatAddress(a) {
  if (!a) return null;
  if (typeof a === 'string') return a;
  return [a.line1, a.line2, a.area, a.city, a.state, a.pincode, a.country].filter(Boolean).join(', ') || null;
}

/** "Name — 45 mins — price", skipping whatever the backend doesn't know. */
const serviceLine = (s, currency, locale) =>
  [clean(s.name), formatDuration(s.durationMinutes), formatPrice(s.price, s.currency || currency, locale)]
    .filter(Boolean)
    .join(' — ');

/** The service / date / time / duration / price block used in selections and confirmations. */
function detailLines({ service, slot, currency, locale, withPrice = true, withDuration = true }) {
  const lines = [];
  if (service?.name) lines.push(`💇 Service: ${clean(service.name)}`);
  if (slot?.dateLabel) lines.push(`📅 Date: ${slot.dateLabel}`);
  if (slot?.startLabel || slot?.startTime) lines.push(`⏰ Time: ${slot.startLabel || slot.startTime}`);
  const dur = formatDuration(service?.durationMinutes);
  if (withDuration && dur) lines.push(`⏱ Duration: ${dur}`);
  const price = formatPrice(service?.price, service?.currency || currency, locale);
  if (withPrice && price) lines.push(`💰 Price: ${price}`);
  return lines;
}

const dateLine = (d) => `${d.relative ? `${d.relative} — ` : d.weekday ? `${d.weekday}, ` : ''}${d.dateLabel || d.date}`;

// ---------- main menu ----------

async function showMenu(phone, session) {
  const salon = await backend.getSalon();
  await wa.sendText(
    phone,
    `Welcome to ${salonName(salon)}! 👋\nHow can we help you today?\n\n` +
      `${num(1)} View Services\n${num(2)} Book an Appointment\n${num(3)} Reschedule an Appointment\n${num(4)} Contact Salon\n\n` +
      'Please reply with the option number.'
  );
  // Only advance once the menu was actually sent; keep just the name WhatsApp gave us.
  session.step = 'MENU';
  session.data = { waName: session.data.waName };
  setSession(phone, session);
}

async function onMenu(phone, session, text) {
  let intent = null;
  const n = pickNumber(text);
  if (n) intent = { 1: 'SERVICES', 2: 'BOOK', 3: 'RESCHEDULE', 4: 'CONTACT' }[n] || null;
  else if (RE_RESCHEDULE.test(text)) intent = 'RESCHEDULE';
  else if (RE_BOOK.test(text)) intent = 'BOOK';
  else if (RE_SERVICES.test(text)) intent = 'SERVICES';
  else if (RE_CONTACT.test(text)) intent = 'CONTACT';
  else if (text) {
    // Optional AI layer for free text the keywords missed (a no-op without ANTHROPIC_API_KEY).
    const guess = await ai.classifyIntent(text);
    if (guess !== 'OTHER') intent = guess;
  }

  switch (intent) {
    case 'SERVICES':
      return sendServiceList(phone, session);
    case 'BOOK':
      return sendBookServiceList(phone, session);
    case 'RESCHEDULE':
      return askBookingId(phone, session);
    case 'CONTACT':
      return sendContact(phone);
    default:
      await wa.sendText(phone, FALLBACK_TEXT);
      return showMenu(phone, session);
  }
}

// ---------- 1. View services ----------

async function loadServices() {
  const { currency, locale, items } = await backend.getServices();
  return { currency, locale, items };
}

async function sendServiceList(phone, session) {
  const [{ currency, locale, items }, salon] = await Promise.all([loadServices(), backend.getSalon()]);
  if (!items.length) return wa.sendText(phone, 'Our services list is not available right now.');

  await wa.sendText(
    phone,
    `✨ *${salonName(salon)} — Services*\n\nPlease choose a service:\n\n` +
      items.map((s, i) => `${num(i + 1)} ${serviceLine(s, currency, locale)}`).join('\n') +
      '\n\nReply with the service number to know more or book an appointment.\nReply *menu* for the main menu.'
  );
  session.step = 'SERVICES_VIEW';
  session.data = { waName: session.data.waName, serviceIds: items.map((s) => s.id) };
  setSession(phone, session);
}

/** Resolves a reply ("3", "hair spa") to one of the services last listed. */
async function chooseService(session, text) {
  const { currency, locale, items } = await loadServices();
  const listed = (session.data.serviceIds || []).map((id) => items.find((s) => s.id === id)).filter(Boolean);
  const pool = listed.length ? listed : items;

  const n = pickNumber(text);
  let service = n ? pool[n - 1] : null;
  if (!n && text.length >= 3) {
    const t = text.toLowerCase();
    service = pool.find((s) => clean(s.name).toLowerCase() === t);
    if (!service) {
      const partial = pool.filter((s) => clean(s.name).toLowerCase().includes(t));
      if (partial.length === 1) service = partial[0];
    }
  }
  return { service: service || null, currency, locale };
}

async function sendServiceDetail(phone, session, service, currency, locale) {
  session.step = 'SERVICE_DETAIL';
  session.data.serviceId = service.id;
  setSession(phone, session);

  const dur = formatDuration(service.durationMinutes);
  const price = formatPrice(service.price, service.currency || currency, locale);
  const facts = [dur ? `⏱ Duration: ${dur}` : null, price ? `💰 Price: ${price}` : null].filter(Boolean);
  await wa.sendText(
    phone,
    `✨ *${clean(service.name)}*\n\n` +
      (service.description ? `${clean(service.description)}\n\n` : '') +
      (facts.length ? `${facts.join('\n')}\n\n` : '') +
      `Reply:\n${num(1)} Book this service\n${num(2)} Back to services\n${num(3)} Main menu`
  );
}

async function onServicesView(phone, session, text) {
  const { service, currency, locale } = await chooseService(session, text);
  if (!service) {
    await wa.sendText(phone, NUMBER_FALLBACK);
    return sendServiceList(phone, session);
  }
  return sendServiceDetail(phone, session, service, currency, locale);
}

async function onServiceDetail(phone, session, text) {
  const n = pickNumber(text);
  if (n === 1 || /^(book|yes)\b/i.test(text)) return askDate(phone, session);
  if (n === 2 || /^back\b/i.test(text)) return sendServiceList(phone, session);
  if (n === 3) return showMenu(phone, session);
  await wa.sendText(phone, NUMBER_FALLBACK);
  const { service, currency, locale } = await currentService(session);
  return service ? sendServiceDetail(phone, session, service, currency, locale) : sendServiceList(phone, session);
}

// ---------- 4. Contact ----------

async function sendContact(phone) {
  const salon = await backend.getSalon();
  const address = formatAddress(salon.address);
  const hours = salon.hoursLabel || (typeof salon.hours === 'string' ? salon.hours : null);
  const lines = [
    salon.phone ? `📞 Phone: ${salon.phone}` : null,
    address ? `📍 Location: ${address}` : null,
    salon.mapUrl ? `🗺 Map: ${salon.mapUrl}` : null,
    hours ? `🕒 Hours: ${hours}` : null,
    salon.rating != null ? `⭐ Rating: ${salon.rating}${salon.reviews != null ? ` (${salon.reviews} reviews)` : ''}` : null,
  ].filter(Boolean);

  await wa.sendText(
    phone,
    `📞 *Contact ${salonName(salon)}*\n\n${lines.length ? `${lines.join('\n')}\n\n` : ''}Reply *menu* for the main menu.`
  );
}

// ---------- 2. Book an appointment ----------

async function sendBookServiceList(phone, session) {
  const { currency, locale, items } = await loadServices();
  if (!items.length) return wa.sendText(phone, 'Our services list is not available right now.');

  await wa.sendText(
    phone,
    "Great! Let's book your appointment. 💇‍♀️\n\nPlease select a service:\n\n" +
      items.map((s, i) => `${num(i + 1)} ${serviceLine(s, currency, locale)}`).join('\n') +
      '\n\nReply with the service number.'
  );
  session.step = 'BOOK_SERVICE';
  session.data = { waName: session.data.waName, flow: 'book', serviceIds: items.map((s) => s.id) };
  setSession(phone, session);
}

async function onBookService(phone, session, text) {
  const { service } = await chooseService(session, text);
  if (!service) {
    await wa.sendText(phone, NUMBER_FALLBACK);
    return sendBookServiceList(phone, session);
  }
  session.data.serviceId = service.id;
  setSession(phone, session);
  return askDate(phone, session);
}

/** The service picked earlier (booking) or the one belonging to the booking being rescheduled. */
async function currentService(session) {
  const { currency, locale, items } = await loadServices();
  const service = items.find((s) => s.id === session.data.serviceId) || session.data.serviceSnapshot || null;
  return { service, currency, locale };
}

/** Lists the days that still have room for this service. `intro` is text to put in front of the list. */
async function askDate(phone, session, intro = '') {
  const { service, currency, locale } = await currentService(session);
  const days = (await backend.getAvailability({ days: 30, serviceId: session.data.serviceId, excludeId: session.data.excludeId }))
    .filter((d) => d.availableSlots > 0)
    .slice(0, MAX_DATES);

  if (!days.length) {
    session.step = 'MENU';
    setSession(phone, session);
    return wa.sendText(
      phone,
      `${intro}Sorry, there are no open time slots for this service right now. Please check back soon.\n\nReply *menu* for the main menu.`
    );
  }

  const resched = session.data.flow === 'resched';
  const summary = resched ? '' : detailLines({ service, currency, locale }).join('\n');
  await wa.sendText(
    phone,
    intro +
      (resched ? '' : "You've selected:\n") +
      (summary ? `${summary}\n\n` : '') +
      `Please select ${resched ? 'a new' : 'an available'} date:\n\n` +
      days.map((d, i) => `${num(i + 1)} ${dateLine(d)}`).join('\n') +
      '\n\nReply with the date number.'
  );
  session.step = resched ? 'RESCH_DATE' : 'BOOK_DATE';
  session.data.dates = days.map((d) => d.date);
  setSession(phone, session);
}

async function onDate(phone, session, text) {
  const n = pickNumber(text);
  const date = n ? (session.data.dates || [])[n - 1] : null;
  if (!date) {
    await wa.sendText(phone, NUMBER_FALLBACK);
    return askDate(phone, session);
  }
  return askSlot(phone, session, date, 0);
}

/** One page of the open slots for the chosen date (numbered across pages). `intro` goes in front of the list. */
async function askSlot(phone, session, date, page, intro = '') {
  const { service, currency, locale } = await currentService(session);
  const slots = await backend.getAvailableSlots({
    date,
    serviceId: session.data.serviceId,
    excludeId: session.data.excludeId,
    limit: SLOT_FETCH_LIMIT,
  });
  if (!slots.length) {
    const note = intro ? "There are no other times left that day, so let's pick a new date.\n\n" : 'Sorry, that day has no open time slots left.\n\n';
    return askDate(phone, session, `${intro}${note}`);
  }

  const pages = Math.ceil(slots.length / PAGE_SIZE);
  const current = Math.min(Math.max(page, 0), pages - 1); // "more" past the end stays on the last page
  const shown = slots.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const resched = session.data.flow === 'resched';

  const summary = resched
    ? slots[0].dateLabel
      ? [`📅 Date: ${slots[0].dateLabel}`]
      : []
    : detailLines({ service, slot: { dateLabel: slots[0].dateLabel }, currency, locale });
  await wa.sendText(
    phone,
    intro +
      (resched ? '' : "You've selected:\n") +
      (summary.length ? `${summary.join('\n')}\n\n` : '') +
      `Please select ${resched ? 'a new' : 'an available'} time slot:\n\n` +
      shown.map((s, i) => `${num(current * PAGE_SIZE + i + 1)} ${s.startLabel || s.startTime}`).join('\n') +
      `\n\nReply with the slot number.${current < pages - 1 ? '\nReply *more* to see later times.' : ''}` +
      '\nReply *date* to choose a different day.'
  );
  session.step = resched ? 'RESCH_SLOT' : 'BOOK_SLOT';
  session.data.date = date;
  session.data.slotPage = current;
  session.data.slotIds = slots.map((s) => s.id);
  setSession(phone, session);
}

/** Handles replies on a slot list, for both booking and rescheduling. */
async function onSlot(phone, session, text) {
  if (RE_MORE.test(text)) return askSlot(phone, session, session.data.date, (session.data.slotPage || 0) + 1);
  if (RE_BACK.test(text)) return askDate(phone, session);

  const n = pickNumber(text);
  const slotId = n ? (session.data.slotIds || [])[n - 1] : null;
  if (!slotId) {
    await wa.sendText(phone, NUMBER_FALLBACK);
    return askSlot(phone, session, session.data.date, session.data.slotPage || 0);
  }

  // Re-check live: the slot may have been taken since the list was sent.
  const slot = await backend.getSlotById(slotId, { serviceId: session.data.serviceId, excludeId: session.data.excludeId });
  if (!slot || !slot.available) {
    return askSlot(phone, session, session.data.date, 0, 'That time slot is no longer available. Here are the latest options.\n\n');
  }

  session.data.slotId = slot.id;
  if (session.data.flow === 'resched') return finishReschedule(phone, session);

  session.step = 'BOOK_CONFIRM';
  setSession(phone, session);
  return sendConfirm(phone, session, slot);
}

async function sendConfirm(phone, session, slot) {
  const { service, currency, locale } = await currentService(session);
  await wa.sendText(
    phone,
    `Please confirm your appointment:\n\n${detailLines({ service, slot, currency, locale }).join('\n')}\n\n` +
      `Reply:\n${num(1)} Confirm\n${num(2)} Change Time\n${num(3)} Cancel`
  );
}

async function onBookConfirm(phone, session, text) {
  const n = pickNumber(text);
  if (n === 2 || /^change/i.test(text)) return askSlot(phone, session, session.data.date, 0);
  if (n === 3 || /^cancel/i.test(text)) {
    session.step = 'MENU';
    session.data = { waName: session.data.waName };
    setSession(phone, session);
    return wa.sendText(phone, 'No problem — your appointment was not booked. 👍\n\nReply *menu* whenever you need us.');
  }
  if (n !== 1 && !/^(confirm|yes|ok)\b/i.test(text)) {
    await wa.sendText(phone, NUMBER_FALLBACK);
    const slot = await backend.getSlotById(session.data.slotId, { serviceId: session.data.serviceId });
    return slot ? sendConfirm(phone, session, slot) : askSlot(phone, session, session.data.date, 0);
  }

  const result = await backend.createAppointment({
    serviceId: session.data.serviceId,
    slotId: session.data.slotId,
    customerName: session.data.waName || undefined,
    customerPhone: phone,
  });
  if (!result.ok) {
    return askSlot(phone, session, session.data.date, 0, 'Sorry, that time was just taken by someone else. Here are the latest options.\n\n');
  }

  const b = result.appointment;
  const salon = await backend.getSalon();
  session.step = 'MENU';
  session.data = { waName: session.data.waName };
  setSession(phone, session);

  const details = detailLines({ service: b.service, slot: b, currency: b.currency, locale: b.locale, withDuration: false });
  await wa.sendText(
    phone,
    `✅ *Appointment Confirmed!*\n\nThank you for booking with ${salonName(salon)}. 💇‍♀️\n\n` +
      `📋 Booking ID: ${b.id}\n${details.join('\n')}\n\n` +
      `Please keep your Booking ID for future changes.\nSee you at ${salonName(salon)}! ❤️`
  );
}

// ---------- 3. Reschedule ----------

async function askBookingId(phone, session) {
  session.step = 'RESCH_ID';
  session.data = { waName: session.data.waName, flow: 'resched' };
  setSession(phone, session);
  await wa.sendText(phone, 'Sure! We can help you reschedule your appointment. 🔄\n\nPlease enter your Booking ID.\nExample: MS-10245');
}

/** "ms 10245", "MS-10245" -> "MS-10245" (null if it doesn't look like a booking ID). */
function parseBookingId(text) {
  const m = /\b([A-Za-z]{1,6})\s*-?\s*(\d{3,8})\b/.exec(text);
  return m ? `${m[1].toUpperCase()}-${m[2]}` : null;
}

async function onBookingId(phone, session, text) {
  const id = parseBookingId(text);
  // Only a booking made from THIS WhatsApp number is ever shown, so IDs can't be used to peek at others' bookings.
  const b = id ? await backend.getAppointment(id, { phone }) : null;
  if (!b || b.status !== 'confirmed') {
    return wa.sendText(
      phone,
      "Sorry, we couldn't find an appointment with that Booking ID for this WhatsApp number. 🤔\n\n" +
        'Please check the ID and enter it again (example: MS-10245), or reply *menu* for the main menu.'
    );
  }
  if (b.past) {
    session.step = 'MENU';
    session.data = { waName: session.data.waName };
    setSession(phone, session);
    return wa.sendText(phone, `That appointment (${b.id}) has already taken place, so it can't be rescheduled.\n\nReply *menu* to book a new one.`);
  }

  session.data.bookingId = b.id;
  session.data.excludeId = b.id; // its own time doesn't count as "taken" while moving it
  session.data.serviceId = b.service.id;
  session.data.serviceSnapshot = b.service;
  setSession(phone, session);

  const found =
    `We found your appointment:\n\n📋 Booking ID: ${b.id}\n💇 Service: ${clean(b.service.name)}\n` +
    `📅 Current Date: ${b.dateLabel}\n⏰ Current Time: ${b.startLabel}\n\n`;
  // Offer new times on the same day first (most changes are small); if none, pick another date.
  return askSlot(phone, session, b.date, 0, found);
}

async function finishReschedule(phone, session) {
  const result = await backend.rescheduleAppointment(session.data.bookingId, {
    slotId: session.data.slotId,
    phone,
  });
  if (!result.ok) {
    return askSlot(phone, session, session.data.date, 0, 'Sorry, that time was just taken by someone else. Here are the latest options.\n\n');
  }
  const b = result.appointment;
  session.step = 'MENU';
  session.data = { waName: session.data.waName };
  setSession(phone, session);

  await wa.sendText(
    phone,
    `🔄 *Appointment Rescheduled Successfully!*\n\n📋 Booking ID: ${b.id}\n💇 Service: ${clean(b.service.name)}\n` +
      `📅 New Date: ${b.dateLabel}\n⏰ New Time: ${b.startLabel}\n\nWe look forward to seeing you! ❤️`
  );
}

// ---------- step table ----------

const STEPS = {
  MENU: onMenu,
  SERVICES_VIEW: onServicesView,
  SERVICE_DETAIL: onServiceDetail,
  BOOK_SERVICE: onBookService,
  BOOK_DATE: onDate,
  BOOK_SLOT: onSlot,
  BOOK_CONFIRM: onBookConfirm,
  RESCH_ID: onBookingId,
  RESCH_DATE: onDate,
  RESCH_SLOT: onSlot,
};

module.exports = { handleIncomingMessage, FALLBACK_TEXT, NUMBER_FALLBACK };
