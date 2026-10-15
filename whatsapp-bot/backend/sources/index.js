const path = require('node:path');
const mock = require('./mock');
const { createWebsiteSource } = require('./website');
const { createBookingStore } = require('../bookingStore');

/** Bookings are saved here unless BOOKINGS_FILE says otherwise (git-ignored). */
const DEFAULT_BOOKINGS_FILE = path.resolve(__dirname, '../data/bookings.json');

/** DATA_SOURCE=website (default) | mock */
function selectSource(kind = process.env.DATA_SOURCE || 'website') {
  if (kind === 'mock') return mock;
  if (kind === 'website') {
    const file = process.env.BOOKINGS_FILE || DEFAULT_BOOKINGS_FILE;
    return createWebsiteSource({ store: createBookingStore({ file }) });
  }
  throw new Error(`Unknown DATA_SOURCE "${kind}" (use "website" or "mock")`);
}

module.exports = { selectSource, createWebsiteSource, createBookingStore, mock };
