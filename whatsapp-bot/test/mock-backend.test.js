/**
 * The bundled dummy dataset still works as a selectable data source
 * (DATA_SOURCE=mock) for browsing: menu, services, contact, dates and slots.
 * It has no booking storage, so booking itself needs the default website source.
 */
const test = require('node:test');
const assert = require('node:assert');

process.env.BACKEND_BASE_URL = 'http://127.0.0.1:4556';

const { createApp } = require('../backend/server');
const { mock } = require('../backend/sources');
const { salon, services } = require('../backend/data');
const { text, say, NUMBER_FALLBACK } = require('./helpers');

let server;
test.before(() => new Promise((r) => { server = createApp(mock).listen(4556, r); }));
test.after(() => server.close());
const get = async (p) => (await fetch(`http://127.0.0.1:4556${p}`)).json();

test('mock dataset is complete', async () => {
  assert.equal((await get('/salon')).name, salon.name);
  assert.equal((await get('/services')).items.length, services.length);
  assert.ok(services.every((s) => s.price > 0 && s.durationMinutes > 0));
  const slots = (await get('/slots?limit=10')).items;
  assert.equal(slots.length, 10);
  assert.ok(slots.every((s) => s.available));
  const av = (await get('/availability?days=7')).items;
  assert.equal(av.length, 7);
  assert.ok(av.some((d) => !d.open), 'Sunday should show as closed in a 7-day window');
  assert.ok((await get('/appointments')).items.length > 0);
});

test('long services need consecutive free slots', async () => {
  const any = (await get('/slots?days=7&available=true')).items.length;
  const bridal = (await get('/slots?days=7&available=true&serviceId=svc-010')).items.length;
  assert.ok(bridal < any);
});

test('the mock source has no booking storage, so booking endpoints say so (501)', async () => {
  const r = await fetch('http://127.0.0.1:4556/appointments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serviceId: 'svc-001', slotId: 'x', customerPhone: '1' }),
  });
  assert.equal(r.status, 501);
  assert.equal((await fetch('http://127.0.0.1:4556/appointments/MS-10001')).status, 501);
});

test('chat on the mock data: menu, prices formatted from backend currency/locale, dates and slots', async () => {
  const phone = '911111111112';
  let out = await say(text(phone, 'hi'));
  assert.match(out[0].body, new RegExp(`Welcome to ${salon.name.replace(/[&]/g, '\\$&')}!`));

  out = await say(text(phone, '1'));
  for (const s of services) assert.ok(out[0].body.includes(s.name));
  assert.match(out[0].body, /Women's Haircut — 45 mins — ₹600/);
  assert.match(out[0].body, /Hair Colour \(Global\) — 2 hrs — ₹2,500/);

  out = await say(text(phone, 'menu'));
  out = await say(text(phone, '4'));
  assert.ok(out[0].body.includes(salon.phone));
  assert.ok(out[0].body.includes('Adyar'), 'structured address is flattened');

  await say(text(phone, 'menu'));
  await say(text(phone, '2'));
  out = await say(text(phone, '2')); // Men's Haircut
  assert.match(out[0].body, /Please select an available date/);
  out = await say(text(phone, '1'));
  assert.match(out[0].body, /Please select an available time slot/);

  out = await say(text(phone, 'what is the weather'));
  assert.equal(out[0].body, NUMBER_FALLBACK);
});
