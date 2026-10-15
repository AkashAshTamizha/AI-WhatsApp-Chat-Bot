/**
 * Legacy data source: the bundled dummy dataset (data.js + availability.js),
 * unchanged. Select it with DATA_SOURCE=mock. Kept so the original test
 * dataset still works; the default source is the website (see website.js).
 */
const { salon, services } = require('../data');
const av = require('../availability');

// Mock-only presentation hint; real/website sources supply their own.
const LOCALE = 'en-IN';

module.exports = {
  name: 'mock',
  async getSalon() {
    return { ...salon, locale: LOCALE };
  },
  async getServices({ category } = {}) {
    const items = category
      ? services.filter((s) => s.category.toLowerCase() === String(category).toLowerCase())
      : services;
    return { currency: salon.currency, locale: LOCALE, items };
  },
  async findService(id) {
    return services.find((s) => s.id === id) || null;
  },
  async listSlots(opts) {
    return av.listSlots(opts);
  },
  async getSlot(id, opts) {
    return av.getSlot(id, opts);
  },
  async listAvailability(opts) {
    return av.listAvailability(opts);
  },
  async listAppointments() {
    return av.listAppointments();
  },
  isValidDate: av.isValidDate,
};
