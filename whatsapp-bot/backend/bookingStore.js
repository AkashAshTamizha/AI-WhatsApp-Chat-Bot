/**
 * Minimal booking store: a counter plus a list of bookings.
 *   createBookingStore()                 -> in memory only (tests)
 *   createBookingStore({ file: 'x.json'}) -> also saved to that JSON file, so bookings survive restarts
 *
 * It holds no business data; it only remembers who booked what and when.
 * For more than one server instance, replace it with a real database - the
 * methods below are the whole interface the data source uses.
 */
const fs = require('node:fs');
const path = require('node:path');

const FIRST_NUMBER = 10001;

function createBookingStore({ file } = {}) {
  let state = { counter: FIRST_NUMBER - 1, items: [] };

  if (file && fs.existsSync(file)) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (saved && Array.isArray(saved.items)) {
        state = { counter: Number(saved.counter) || FIRST_NUMBER - 1, items: saved.items };
      }
    } catch (err) {
      // Never silently start empty over a damaged file: that would hand out duplicate booking IDs.
      throw new Error(`Cannot read the bookings file ${file}: ${err.message}`);
    }
  }

  function persist() {
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, file); // atomic: a crash never leaves half a file
  }

  const normalise = (id) => String(id || '').trim().toUpperCase();

  return {
    list: () => state.items.map((b) => ({ ...b })),
    get: (id) => {
      const b = state.items.find((x) => x.id === normalise(id));
      return b ? { ...b } : null;
    },
    /** Adds a booking and assigns its ID (e.g. PREFIX-10001). Synchronous, so two callers can't get the same ID. */
    create(prefix, record) {
      state.counter += 1;
      const booking = { ...record, id: `${prefix}-${state.counter}` };
      state.items.push(booking);
      persist();
      return { ...booking };
    },
    update(id, patch) {
      const i = state.items.findIndex((x) => x.id === normalise(id));
      if (i < 0) return null;
      state.items[i] = { ...state.items[i], ...patch };
      persist();
      return { ...state.items[i] };
    },
  };
}

module.exports = { createBookingStore };
