/**
 * Webhook security + delivery behaviour, driven through the real Express app:
 * signature verification, GET handshake, bad JSON, duplicate deliveries,
 * several entries/messages in one payload.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

process.env.WHATSAPP_TOKEN = 't';
process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
process.env.WHATSAPP_VERIFY_TOKEN = 'verify-me';
process.env.META_APP_SECRET = 'shh';
process.env.BACKEND_BASE_URL = 'http://127.0.0.1:4557';

const { sent } = (() => {
  const wa = require('../src/services/whatsappService');
  const sent = [];
  wa.sendText = async (to, body) => sent.push({ to, body });
  wa.sendList = async (to, p) => sent.push({ to, ...p });
  wa.markRead = async () => {};
  return { sent };
})();

const backend = require('../src/services/backendService');
backend.getSalon = async () => ({ name: 'Test Salon' });
backend.getServices = async () => ({ items: [{ id: 'cut', name: 'Cut' }] });
backend.getAvailableSlots = async () => [];

const { app } = require('../src/server');
const { isValidSignature } = require('../src/utils/verifySignature');

let server, base;
test.before(async () => {
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const sign = (body) => 'sha256=' + crypto.createHmac('sha256', 'shh').update(body).digest('hex');
const post = (body, headers = {}) =>
  fetch(`${base}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
const payload = (...msgs) =>
  JSON.stringify({
    entry: [{ changes: [{ value: { contacts: [{ wa_id: msgs[0].from, profile: { name: 'W' } }], messages: msgs } }] }],
  });
const msg = (id, from, body) => ({ id, from, type: 'text', text: { body } });
const settle = () => new Promise((r) => setTimeout(r, 150));

test('GET handshake: right token echoes challenge, wrong token is 403', async () => {
  let r = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc123`);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'abc123');
  r = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=abc123`);
  assert.equal(r.status, 403);
});

test('POST without / with a wrong signature is rejected and nothing is processed', async () => {
  sent.length = 0;
  const body = payload(msg('wamid.bad', '9100000001', 'hi'));
  assert.equal((await post(body)).status, 401);
  assert.equal((await post(body, { 'X-Hub-Signature-256': 'sha256=deadbeef' })).status, 401);
  assert.equal((await post('', {})).status, 401); // empty body can no longer skip the check
  await settle();
  assert.equal(sent.length, 0);
});

test('valid signature is accepted and the message is answered', async () => {
  sent.length = 0;
  const body = payload(msg('wamid.ok1', '9100000002', 'hi'));
  assert.equal((await post(body, { 'X-Hub-Signature-256': sign(body) })).status, 200);
  await settle();
  assert.equal(sent.length, 1);
  assert.match(sent[0].body, /Welcome to Test Salon!/);
});

test('a re-delivered webhook (same message id) is processed only once', async () => {
  sent.length = 0;
  const body = payload(msg('wamid.dup', '9100000003', 'hi'));
  const h = { 'X-Hub-Signature-256': sign(body) };
  await post(body, h);
  await post(body, h);
  await settle();
  assert.equal(sent.length, 1);
});

test('several messages in one payload are all handled, in order, per user', async () => {
  sent.length = 0;
  const body = payload(msg('wamid.a', '9100000004', 'hi'), msg('wamid.b', '9100000004', '1'));
  await post(body, { 'X-Hub-Signature-256': sign(body) });
  await settle();
  assert.match(sent[0].body, /Welcome/);
  assert.match(sent[1].body, /Services/, 'the second message (option 1) was read after the menu was shown');
});

test('malformed JSON is a 400, not a crash', async () => {
  const r = await post('{not json', { 'X-Hub-Signature-256': sign('{not json') });
  assert.equal(r.status, 400);
});

test('isValidSignature fails closed', () => {
  const buf = Buffer.from('x');
  const good = sign('x');
  assert.equal(isValidSignature(good, buf, 'shh'), true);
  assert.equal(isValidSignature(good, buf, ''), false);
  assert.equal(isValidSignature(undefined, buf, 'shh'), false);
  assert.equal(isValidSignature('sha256=short', buf, 'shh'), false);
});
