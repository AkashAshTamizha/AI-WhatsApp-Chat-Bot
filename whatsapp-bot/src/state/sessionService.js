const NodeCache = require('node-cache');

/**
 * Per-WhatsApp-number conversation state: what step they're on and the
 * choices made so far (selected service, date, time slot).
 *
 * This is in-memory, so it resets on restart and won't work across multiple
 * server instances. For production with more than one dyno/pod, replace
 * this with Redis (ioredis) using the same get/set/clear interface.
 */
const cache = new NodeCache({ stdTTL: 60 * 60 * 6 }); // 6h idle timeout

const DEFAULT_STATE = () => ({
  step: 'NEW', // NEW -> MENU -> (SERVICES / BOOK_* / RESCH_*), see chatController.js
  verified: false,
  userId: null,
  data: {},
});

function getSession(phone) {
  let s = cache.get(phone);
  if (!s) {
    s = DEFAULT_STATE();
    cache.set(phone, s);
  }
  return s;
}

function setSession(phone, session) {
  cache.set(phone, session);
  return session;
}

function clearSession(phone) {
  cache.del(phone);
}

module.exports = { getSession, setSession, clearSession };
