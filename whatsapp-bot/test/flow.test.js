/**
 * End-to-end test against the WEBSITE data source (the default): real chat controller ->
 * real HTTP -> real backend -> the website's actual config file, with an in-memory booking
 * store and a fixed clock. Expectations are read from the config file where possible.
 * Only outbound WhatsApp sends are stubbed.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

process.env.BACKEND_BASE_URL = 'http://127.0.0.1:4555';
process.env.BUSINESS_TIMEZONE = 'Asia/Kolkata';
delete process.env.BUSINESS_CURRENCY;
delete process.env.BUSINESS_LOCALE;

const { createApp } = require('../backend/server');
const { createWebsiteSource, createBookingStore } = require('../backend/sources');
const { text, say, FALLBACK_TEXT, NUMBER_FALLBACK } = require('./helpers');

// 00:30 on 15 January 2026 in Asia/Kolkata: before any opening hour, so no slot is "past".
const EARLY = () => new Date('2026-01-14T19:00:00Z');
const store = createBookingStore();
const source = createWebsiteSource({ now: EARLY, store });

let server, site;
const BASE = 'http://127.0.0.1:4555';
const get = async (p) => (await fetch(`${BASE}${p}`)).json();
const send = (method, p, body) =>
  fetch(`${BASE}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test.before(async () => {
  site = await import(`${pathToFileURL(source.configPath).href}?t=${Date.now()}`);
  await new Promise((r) => { server = createApp(source).listen(4555, r); });
});
test.after(() => server.close());

const keycaps = (n) => [...String(n)].map((d) => `${d}\uFE0F\u20E3`).join('');
/** The reply number shown next to `label` in a numbered list, e.g. numberFor(body, '11:30 AM') -> '4'. */
function numberFor(body, label) {
  const line = body.split('\n').find((l) => l.endsWith(label) || l.includes(`${label} —`));
  assert.ok(line, `"${label}" not listed in:\n${body}`);
  return line.split(' ')[0].replace(/[\uFE0F\u20E3]/g, '');
}
const firstBody = (out) => out[0].body;

const SERVICES = () => site.SALON.services;
const svc = (name) => SERVICES().find((s) => s.name === name);

// ---------------------------------------------------------------- backend

test('backend serves what the website config contains, plus a daily slot template for bookingDays', async () => {
  const salon = await get('/salon');
  assert.equal(salon.name, site.SALON.name);
  assert.equal(salon.phone, site.SALON.phone);
  assert.equal(salon.address, site.SALON.address);

  const services = (await get('/services')).items;
  assert.deepEqual(services.map((s) => s.name), SERVICES().map((s) => s.name));
  assert.equal(services[0].price, SERVICES()[0].price);
  assert.equal((await get('/services')).currency, site.SALON.currency);

  const days = (await get('/availability?days=30')).items;
  assert.equal(days.length, site.SALON.bookingDays);
  assert.equal(days[0].relative, 'Today');
  assert.equal(days[1].relative, 'Tomorrow');
  assert.equal(days[0].dateLabel, '15 January 2026');

  const open = site.SLOTS.filter((s) => s.available).length;
  const today = (await get('/slots?date=2026-01-15&limit=200')).items;
  assert.equal(today.length, open);
  assert.equal(today[0].startLabel, '10:00 AM');
  assert.equal((await get('/slots?date=2026-01-15&limit=200&available=false')).items.length, site.SLOTS.length);

  assert.equal((await get('/slots?date=2026-02-31')).error, 'date must be YYYY-MM-DD');
  assert.equal((await get('/slots?date=2026-03-30')).items.length, 0, 'dates beyond bookingDays are not offered');
  assert.equal((await fetch(`${BASE}/slots/2000-01-01_1000`)).status, 404);
  assert.equal((await fetch(`${BASE}/slots?serviceId=nope`)).status, 404);
});

test('slots that already passed (in the business time zone) are not offered, only for today', async () => {
  const at = (iso) => createWebsiteSource({ now: () => new Date(iso) });
  const n = site.SLOTS.filter((s) => s.available).length;
  assert.equal((await at('2026-01-15T19:00:00Z').listSlots({ date: '2026-01-16' })).length, n);
  const noon = await at('2026-01-15T06:30:00Z').listSlots({ date: '2026-01-15' }); // 12:00 local
  assert.ok(noon.length < n && noon.length > 0);
  assert.equal((await at('2026-01-15T17:30:00Z').listSlots({ date: '2026-01-15' })).length, 0); // 23:00 local
  assert.equal((await at('2026-01-15T17:30:00Z').listSlots({ date: '2026-01-16' })).length, n, 'tomorrow is unaffected');
});

test('a service only gets slots where it fits before closing time', async () => {
  const long = svc('Hair Coloring'); // 120 mins, closing 8:00 PM -> last start 6:00 PM
  const slots = await source.listSlots({ date: '2026-01-15', service: long });
  assert.ok(slots.length > 0);
  assert.equal(slots[slots.length - 1].startLabel, '6:00 PM');
  assert.equal(slots[0].endLabel, '12:00 PM');
  const reasons = (await source.listSlots({ date: '2026-01-15', service: long, onlyAvailable: false })).filter((s) => s.reason === 'after-closing');
  assert.ok(reasons.length >= 1);
});

test('booking API: create, overlap blocking, ownership, reschedule, conflicts', async () => {
  const haircut = svc('Haircut'); // 45 mins
  const day = '2026-01-16';

  // validation
  assert.equal((await send('POST', '/appointments', { slotId: `${day}_1000` })).status, 400);
  assert.equal((await send('POST', '/appointments', { serviceId: 'nope', slotId: `${day}_1000`, customerPhone: '1' })).status, 404);
  assert.equal((await send('POST', '/appointments', { serviceId: haircut.id, slotId: 'bad', customerPhone: '1' })).status, 404);
  assert.equal((await send('POST', '/appointments', { serviceId: haircut.id, slotId: `${day}_1100`, customerPhone: '1' })).status, 409, 'slot marked unavailable by the website');

  const r = await send('POST', '/appointments', { serviceId: haircut.id, slotId: `${day}_1000`, customerName: 'A', customerPhone: '+91 90000 00001' });
  assert.equal(r.status, 201);
  const a = await r.json();
  assert.match(a.id, /^MS-\d{5}$/);
  assert.equal(a.startLabel, '10:00 AM');
  assert.equal(a.endLabel, '10:45 AM');
  assert.equal(a.price, undefined);
  assert.equal(a.service.price, haircut.price);
  assert.equal(a.customerPhone, '919000000001');

  // the same start time and every overlapping start are now blocked, later ones are not
  const free = (await get(`/slots?date=${day}&serviceId=${haircut.id}&limit=200`)).items.map((s) => s.startLabel);
  assert.ok(!free.includes('10:00 AM') && !free.includes('10:30 AM'));
  assert.ok(free.includes('11:30 AM'));
  // a shorter booking starting before 10:00 but running into it is blocked too (45 min at 9:30 would, but no such slot) -> 30 min wash at 10:00 blocked
  const wash = svc('Hair Wash');
  assert.equal((await send('POST', '/appointments', { serviceId: wash.id, slotId: `${day}_1000`, customerPhone: '2' })).status, 409);
  assert.equal((await send('POST', '/appointments', { serviceId: haircut.id, slotId: `${day}_1030`, customerPhone: '2' })).status, 409);

  // lookups are limited to the customer's own number
  assert.equal((await fetch(`${BASE}/appointments/${a.id}?phone=919000000001`)).status, 200);
  assert.equal((await fetch(`${BASE}/appointments/${a.id.toLowerCase()}?phone=9000000001`)).status, 404, 'wrong phone looks like "not found"');
  assert.equal((await fetch(`${BASE}/appointments/MS-99999`)).status, 404);

  // reschedule: its own time doesn't block itself; others' bookings do
  const b = await (await send('POST', '/appointments', { serviceId: haircut.id, slotId: `${day}_1130`, customerPhone: '3' })).json();
  assert.equal((await send('PATCH', `/appointments/${b.id}`, { slotId: `${day}_1000`, customerPhone: '3' })).status, 409);
  assert.equal((await send('PATCH', `/appointments/${b.id}`, { slotId: `${day}_1400`, customerPhone: '9' })).status, 404, 'not the owner');
  const moved = await send('PATCH', `/appointments/${b.id}`, { slotId: `${day}_1400`, customerPhone: '3' });
  assert.equal(moved.status, 200);
  assert.equal((await moved.json()).startLabel, '2:00 PM');
  assert.equal((await send('PATCH', `/appointments/${b.id}`, { slotId: `${day}_1400`, customerPhone: '3' })).status, 200, 'moving onto its own slot is fine');
  assert.ok((await get(`/slots?date=${day}&serviceId=${haircut.id}&limit=200`)).items.some((s) => s.startLabel === '11:30 AM'), 'old time is free again');
  assert.equal((await send('PATCH', `/appointments/${b.id}`, {})).status, 400);

  assert.equal((await (await fetch(`${BASE}/appointments?phone=3`)).json()).items.length, 1);
});

// ---------------------------------------------------------------- chat

test('menu: the website button message and "hi" both open the main menu', async () => {
  for (const [phone, first] of [['911000000001', `Welcome to ${site.SALON.name} 👋`], ['911000000002', 'hi']]) {
    const out = await say(text(phone, first));
    assert.equal(out.length, 1);
    const b = firstBody(out);
    assert.ok(b.startsWith(`Welcome to ${site.SALON.name}! 👋\nHow can we help you today?`));
    for (const line of ['1️⃣ View Services', '2️⃣ Book an Appointment', '3️⃣ Reschedule an Appointment', '4️⃣ Contact Salon']) {
      assert.ok(b.includes(line), line);
    }
    assert.match(b, /Please reply with the option number\./);
  }
  // already in the menu: the button message shows the menu again, with no "didn't understand"
  const out = await say(text('911000000001', `Welcome to ${site.SALON.name} 👋`));
  assert.equal(out.length, 1);
  assert.ok(!out[0].body.includes("didn't understand"));
});

test('1. View Services: list with duration and price, then service detail', async () => {
  const phone = '911000000003';
  await say(text(phone, 'hi'));
  let out = await say(text(phone, '1'));
  const b = firstBody(out);
  assert.ok(b.startsWith(`✨ *${site.SALON.name} — Services*`));
  assert.ok(b.includes('1️⃣ Haircut — 45 mins — ₹500'));
  assert.ok(b.includes('2️⃣ Hair Wash — 30 mins — ₹300'));
  assert.ok(b.includes('4️⃣ Hair Coloring — 2 hrs — ₹2,000'));
  assert.ok(b.includes('8️⃣ Hair Spa — 90 mins — ₹1,500'));
  assert.match(b, /Reply with the service number to know more or book an appointment\./);

  out = await say(text(phone, '8'));
  assert.ok(firstBody(out).includes('*Hair Spa*') && firstBody(out).includes('90 mins') && firstBody(out).includes('₹1,500'));
  assert.match(firstBody(out), /1️⃣ Book this service/);

  out = await say(text(phone, '2')); // back to services
  assert.ok(firstBody(out).includes('Services'));
  out = await say(text(phone, 'facial')); // by name
  assert.ok(firstBody(out).includes('*Facial*'));
  out = await say(text(phone, '1')); // book it -> date list for that service
  assert.ok(firstBody(out).includes('💇 Service: Facial'));
  assert.match(firstBody(out), /Please select an available date/);
});

test('2. Book: service -> date -> time -> confirm -> booking ID', async () => {
  const phone = '911000000004';
  await say(text(phone, 'hi'));
  let out = await say(text(phone, '2'));
  assert.match(firstBody(out), /Let's book your appointment\. 💇‍♀️/);
  assert.ok(firstBody(out).includes('1️⃣ Haircut — 45 mins — ₹500'));

  out = await say(text(phone, '1'));
  let b = firstBody(out);
  assert.match(b, /You've selected:/);
  assert.ok(b.includes('💇 Service: Haircut') && b.includes('⏱ Duration: 45 mins') && b.includes('💰 Price: ₹500'));
  assert.ok(b.includes('1️⃣ Today — 15 January 2026'));
  assert.ok(b.includes('2️⃣ Tomorrow — 16 January 2026'));
  assert.ok(b.includes('3️⃣ Sat, 17 January 2026'));

  out = await say(text(phone, '1'));
  b = firstBody(out);
  assert.ok(b.includes('📅 Date: 15 January 2026'));
  assert.match(b, /Please select an available time slot:/);
  assert.ok(b.includes('1️⃣ 10:00 AM') && b.includes('2️⃣ 10:30 AM'));
  assert.ok(!b.includes('11:00 AM'), 'website-blocked time is not offered');
  assert.match(b, /Reply with the slot number\./);

  const n = numberFor(b, '11:30 AM');
  out = await say(text(phone, n));
  b = firstBody(out);
  assert.match(b, /Please confirm your appointment:/);
  for (const l of ['💇 Service: Haircut', '📅 Date: 15 January 2026', '⏰ Time: 11:30 AM', '⏱ Duration: 45 mins', '💰 Price: ₹500', '1️⃣ Confirm', '2️⃣ Change Time', '3️⃣ Cancel']) {
    assert.ok(b.includes(l), l);
  }

  out = await say(text(phone, '1'));
  b = firstBody(out);
  assert.ok(b.startsWith('✅ *Appointment Confirmed!*'));
  assert.match(b, /Booking ID: MS-\d{5}/);
  for (const l of [`Thank you for booking with ${site.SALON.name}. 💇‍♀️`, '💇 Service: Haircut', '📅 Date: 15 January 2026', '⏰ Time: 11:30 AM', '💰 Price: ₹500', 'Please keep your Booking ID for future changes.']) {
    assert.ok(b.includes(l), l);
  }
  assert.ok(store.list().some((x) => x.customerPhone === phone && x.startMinutes === 11 * 60 + 30));
});

test('2. Book: change time, cancel, "more", wrong replies, "date"', async () => {
  const phone = '911000000005';
  const before = store.list().length;
  await say(text(phone, 'hi'));
  await say(text(phone, 'book an appointment'));
  await say(text(phone, '3')); // Hair Styling
  let out = await say(text(phone, '1'));
  assert.ok(firstBody(out).includes('Hair Styling'));
  assert.ok(!/ more /.test(firstBody(out)));

  out = await say(text(phone, 'banana'));
  assert.equal(out[0].body, NUMBER_FALLBACK);
  assert.match(out[1].body, /time slot/);
  out = await say(text(phone, '99'));
  assert.equal(out[0].body, NUMBER_FALLBACK);

  out = await say(text(phone, 'date'));
  assert.match(firstBody(out), /Please select an available date/);
  await say(text(phone, '2'));
  out = await say(text(phone, '1'));
  assert.match(firstBody(out), /Please confirm/);

  out = await say(text(phone, 'whatever'));
  assert.equal(out[0].body, NUMBER_FALLBACK);
  assert.match(out[1].body, /Please confirm/);

  out = await say(text(phone, '2')); // change time
  assert.match(firstBody(out), /Please select an available time slot/);
  await say(text(phone, '1'));
  out = await say(text(phone, '3')); // cancel
  assert.match(firstBody(out), /not booked/);
  assert.equal(store.list().length, before, 'cancelled booking is not stored');
  out = await say(text(phone, '1')); // back in the menu: option 1
  assert.ok(firstBody(out).includes('Services'));
});

test('two customers choosing the same time: the second is told it was taken and sees fresh options', async () => {
  const [a, b] = ['911000000006', '911000000007'];
  const reach = async (phone) => {
    await say(text(phone, 'hi'));
    await say(text(phone, '2'));
    await say(text(phone, '5')); // Facial, 60 mins
    const slots = await say(text(phone, '3')); // 17 January
    assert.match(slots[0].body, /Please select an available time slot/);
    return say(text(phone, '1')); // first slot on that day -> confirmation question
  };
  await reach(a);
  await reach(b);
  const outA = await say(text(a, '1'));
  assert.match(firstBody(outA), /Appointment Confirmed/);
  const outB = await say(text(b, '1'));
  assert.match(firstBody(outB), /just taken by someone else/);
  assert.match(firstBody(outB), /Please select an available time slot/);
  assert.ok(!firstBody(outB).includes('1️⃣ 10:00 AM'), 'the taken time is no longer offered');
});

test('3. Reschedule: booking ID -> same-day times -> rescheduled', async () => {
  const phone = '911000000008';
  // make a booking first
  await say(text(phone, 'hi'));
  await say(text(phone, '2'));
  await say(text(phone, '1')); // Haircut
  const slots = await say(text(phone, '2')); // tomorrow, 16 Jan
  // the first free time (the API test above already took 10:00 AM)
  const firstLabel = slots[0].body.split('\n').find((l) => l.startsWith('1️⃣ ')).replace(/^1️⃣ /, '');
  await say(text(phone, '1'));
  let out = await say(text(phone, '1'));
  const id = /Booking ID: (MS-\d{5})/.exec(firstBody(out))[1];

  out = await say(text(phone, '3'));
  assert.match(firstBody(out), /reschedule your appointment\. 🔄/);
  assert.match(firstBody(out), /Please enter your Booking ID\./);
  assert.match(firstBody(out), /Example: MS-10245/);

  out = await say(text(phone, 'MS-00000'));
  assert.match(firstBody(out), /couldn't find an appointment/);
  assert.equal(out.length, 1, 'stays on the ID question so the customer can retry');

  out = await say(text(phone, `my id is ${id.toLowerCase().replace('-', ' ')}`)); // forgiving format
  let b = firstBody(out);
  assert.match(b, /We found your appointment:/);
  for (const l of [`📋 Booking ID: ${id}`, '💇 Service: Haircut', '📅 Current Date: 16 January 2026', `⏰ Current Time: ${firstLabel}`, 'Please select a new time slot:']) {
    assert.ok(b.includes(l), l);
  }

  const target = b.split('\n').filter((l) => /^\d/.test(l.replace(/[\uFE0F\u20E3]/g, '')) && /(AM|PM)$/.test(l)).pop().replace(/^\S+ /, '');
  out = await say(text(phone, numberFor(b, target)));
  b = firstBody(out);
  assert.ok(b.startsWith('🔄 *Appointment Rescheduled Successfully!*'));
  for (const l of [`📋 Booking ID: ${id}`, '💇 Service: Haircut', '📅 New Date: 16 January 2026', `⏰ New Time: ${target}`, 'We look forward to seeing you! ❤️']) {
    assert.ok(b.includes(l), l);
  }
  assert.equal((await get(`/appointments/${id}`)).startLabel, target);
});

test('3. Reschedule: another number cannot see or move the booking; "date" switches day', async () => {
  const owner = '911000000009';
  await say(text(owner, 'hi'));
  await say(text(owner, '2'));
  await say(text(owner, '2')); // Hair Wash
  await say(text(owner, '3')); // 17 Jan
  await say(text(owner, '1'));
  let out = await say(text(owner, '1'));
  const id = /Booking ID: (MS-\d{5})/.exec(firstBody(out))[1];

  const thief = '911000000010';
  await say(text(thief, 'hi'));
  await say(text(thief, '3'));
  out = await say(text(thief, id));
  assert.match(firstBody(out), /couldn't find an appointment/);
  assert.ok(!firstBody(out).includes('Hair Wash'));

  await say(text(owner, '3'));
  await say(text(owner, id));
  out = await say(text(owner, 'date'));
  assert.match(firstBody(out), /Please select a new date:/);
  out = await say(text(owner, '1')); // today
  assert.ok(firstBody(out).includes('📅 Date: 15 January 2026'));
  out = await say(text(owner, '1'));
  assert.match(firstBody(out), /Appointment Rescheduled Successfully/);
  assert.match(firstBody(out), /📅 New Date: 15 January 2026/);
});

test('4. Contact Salon: phone, location, hours', async () => {
  const phone = '911000000011';
  await say(text(phone, 'hi'));
  const out = await say(text(phone, '4'));
  const b = firstBody(out);
  assert.ok(b.includes(`Contact ${site.SALON.name}`));
  assert.ok(b.includes(`📞 Phone: ${site.SALON.phone}`));
  assert.ok(b.includes(`📍 Location: ${site.SALON.address}`));
  assert.ok(b.includes(`🕒 Hours: ${site.SALON.hours}`));
});

test('free text in the menu; unknown text gets the fallback and the menu again; "menu" works anywhere', async () => {
  const phone = '911000000012';
  await say(text(phone, 'hi'));
  let out = await say(text(phone, 'what are your prices?'));
  assert.ok(firstBody(out).includes('Services'));
  await say(text(phone, 'menu'));
  out = await say(text(phone, 'I want to reschedule'));
  assert.match(firstBody(out), /Booking ID/);
  out = await say(text(phone, 'menu'));
  assert.match(firstBody(out), /How can we help you today/);
  out = await say(text(phone, 'where are you located'));
  assert.match(firstBody(out), /Phone/);
  out = await say(text(phone, 'what is the weather'));
  assert.equal(out[0].body, FALLBACK_TEXT);
  assert.match(out[1].body, /How can we help you today/);
  out = await say(text(phone, '7')); // not an option
  assert.equal(out[0].body, FALLBACK_TEXT);
});

test('number formats: keycap emoji and "2." are understood', async () => {
  const phone = '911000000013';
  await say(text(phone, 'hi'));
  const out = await say(text(phone, '1️⃣'));
  assert.ok(firstBody(out).includes('Services'));
  const out2 = await say(text(phone, '1.'));
  assert.ok(firstBody(out2).includes('*Haircut*'));
});

test('bot/backend code contains no hard-coded business data, currency or locale', () => {
  const root = path.join(__dirname, '..');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === 'data' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
  // Everything except the legacy mock dataset itself is "code that must stay data-free".
  const files = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'backend'))].filter(
    (f) => !/backend[\\/](data|availability)\.js$/.test(f) && !/sources[\\/]mock\.js$/.test(f)
  );
  const src = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

  const forbidden = [
    site.SALON.name, site.SALON.tagline, site.SALON.address, site.SALON.hours, site.SALON.phone,
    ...SERVICES().map((s) => s.name),
    ...require('../backend/data').services.map((s) => s.name),
    require('../backend/data').salon.name,
    "'INR'", 'en-IN', '₹',
  ];
  for (const f of forbidden) assert.ok(!src.includes(f), `hard-coded: ${f}`);
});
