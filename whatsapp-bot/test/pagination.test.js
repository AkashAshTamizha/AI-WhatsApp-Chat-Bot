/** Slot list pagination, label edge cases and message ordering (backend stubbed). */
const test = require('node:test');
const assert = require('node:assert');

process.env.BACKEND_BASE_URL = 'http://127.0.0.1:4558';
const { text, say, NUMBER_FALLBACK } = require('./helpers');
const backend = require('../src/services/backendService');

const mk = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `2026-01-01_${String(900 + i).padStart(4, '0')}`,
    date: '2026-01-01',
    dateLabel: '1 January 2026',
    startLabel: `Slot ${i + 1}`,
    available: true,
  }));

const stub = (extra = {}) => {
  const real = { ...backend };
  backend.getSalon = async () => ({ name: 'S' });
  backend.getServices = async () => ({ items: [{ id: 'cut', name: 'Cut' }] });
  backend.getAvailability = async () => [{ date: '2026-01-01', dateLabel: '1 January 2026', relative: 'Today', availableSlots: 23 }];
  backend.getAvailableSlots = async () => mk(23);
  backend.getSlotById = async (id) => mk(23).find((s) => s.id === id) || null;
  Object.assign(backend, extra);
  return () => Object.assign(backend, real);
};

const reachSlots = async (phone) => {
  await say(text(phone, 'hi'));
  await say(text(phone, '2'));
  await say(text(phone, '1'));
  return say(text(phone, '1'));
};

test('more than 10 slots: first page + "more" shows the rest, numbered continuously', async () => {
  const restore = stub();
  try {
    const phone = '9200000001';
    let out = await reachSlots(phone);
    const shownCount = (b) => b.split('\n').filter((l) => /Slot \d+$/.test(l)).length;
    assert.equal(shownCount(out[0].body), 10);
    assert.ok(out[0].body.includes('1️⃣ Slot 1') && out[0].body.includes('1️⃣0️⃣ Slot 10'));
    assert.match(out[0].body, /Reply \*more\*/);

    out = await say(text(phone, 'more'));
    assert.ok(out[0].body.includes('1️⃣1️⃣ Slot 11') && out[0].body.includes('2️⃣0️⃣ Slot 20'));
    assert.ok(!out[0].body.includes('Slot 10\n'));
    assert.match(out[0].body, /Reply \*more\*/);

    out = await say(text(phone, 'more'));
    assert.equal(shownCount(out[0].body), 3);
    assert.ok(!/Reply \*more\*/.test(out[0].body), 'no "more" hint on the last page');

    out = await say(text(phone, 'more'));
    assert.ok(out[0].body.includes('2️⃣1️⃣ Slot 21'), 'stays on the last page');

    out = await say(text(phone, 'more please'));
    assert.equal(out[0].body, NUMBER_FALLBACK, '"more please" is not a paging command');

    // a number from an earlier page still works
    out = await say(text(phone, '12'));
    assert.match(out[0].body, /Please confirm your appointment/);
  } finally {
    restore();
  }
});

test('missing backend fields never print "undefined"; markup characters in names are stripped', async () => {
  const restore = stub({
    getSalon: async () => ({}), // no name at all
    getServices: async () => ({ items: [{ id: 'x', name: '*Cut* _it_' }] }), // no price, no duration, no currency
    getAvailableSlots: async () => [{ id: 'x1', date: '2026-01-01', startTime: '10:00', available: true }],
    getSlotById: async () => ({ id: 'x1', available: true, startTime: '10:00' }),
    getAvailability: async () => [{ date: '2026-01-01', availableSlots: 1 }],
  });
  try {
    const phone = '9200000002';
    const all = [];
    for (const m of ['hi', '1', 'menu', '2', '1', '1', '1', '1']) {
      all.push(...(await say(text(phone, m))).map((o) => o.body));
    }
    const joined = all.join('\n');
    assert.ok(!/undefined|null|NaN/.test(joined), joined);
    assert.match(joined, /Welcome to our salon!/);
    assert.ok(!/\*Cut\*|_it_/.test(joined), 'name markup stripped');
    assert.match(joined, /Cut it/);
    assert.match(joined, /10:00/);
  } finally {
    restore();
  }
});

test('two messages sent back-to-back are handled in order (menu first, then the choice)', async () => {
  const restore = stub({
    getSalon: async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { name: 'S', phone: '123' };
    },
  });
  const { handleIncomingMessage } = require('../src/controllers/chatController');
  const sent = require('../src/services/whatsappService');
  const orig = sent.sendText;
  try {
    const phone = '9200000003';
    const log = [];
    sent.sendText = async (to, body) => log.push(body);
    await Promise.all([
      handleIncomingMessage({ from: phone, id: '1', type: 'text', text: { body: 'hi' } }, null),
      handleIncomingMessage({ from: phone, id: '2', type: 'text', text: { body: '4' } }, null),
    ]);
    assert.equal(log.length, 2);
    assert.match(log[0], /Welcome to S!/);
    assert.match(log[1], /Phone: 123/);
  } finally {
    sent.sendText = orig;
    restore();
  }
});

test('a backend failure gets a friendly message and the customer can retry the same step', async () => {
  let fail = true;
  const restore = stub({
    getAvailability: async () => {
      if (fail) throw new Error('boom');
      return [{ date: '2026-01-01', dateLabel: '1 January 2026', relative: 'Today', availableSlots: 3 }];
    },
  });
  const origError = console.error;
  console.error = () => {};
  try {
    const phone = '9200000004';
    await say(text(phone, 'hi'));
    await say(text(phone, '2'));
    let out = await say(text(phone, '1'));
    assert.match(out[0].body, /something went wrong/);
    fail = false;
    out = await say(text(phone, '1'));
    assert.match(out[0].body, /Please select an available date/);
  } finally {
    console.error = origError;
    restore();
  }
});
