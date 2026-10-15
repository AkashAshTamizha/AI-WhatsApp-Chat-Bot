const axios = require('axios');
const config = require('../config');

/**
 * Every salon name, service, price, time slot and availability value the bot
 * shows comes from these calls to the backend (the mock in /backend during
 * testing, your real system later). This file contains no business data -
 * only HTTP calls. If your backend's response shape differs, adjust the
 * mapping here and the rest of the bot needs no changes.
 */
const client = axios.create({
  baseURL: config.backend.baseUrl,
  timeout: 10000,
  headers: config.backend.apiKey ? { Authorization: `Bearer ${config.backend.apiKey}` } : {},
});

const itemsOf = (data) => (Array.isArray(data) ? data : data?.items || []);

async function getSalon() {
  const { data } = await client.get(config.backend.paths.salon);
  return data; // { name, tagline, rating, reviews, address, hoursLabel, currency, ... } - every field optional except name
}

async function getServices() {
  const { data } = await client.get(config.backend.paths.services);
  return { currency: data?.currency, locale: data?.locale, items: itemsOf(data) };
}

/** Upcoming available time slots for a service, soonest first. `excludeId` ignores one booking (when rescheduling it). */
async function getAvailableSlots({ limit = 10, serviceId, date, excludeId } = {}) {
  const { data } = await client.get(config.backend.paths.slots, {
    params: { limit, serviceId, date, exclude: excludeId, available: true },
  });
  return itemsOf(data);
}

/** Returns the slot (with a live `available` flag), or null if it doesn't exist. */
async function getSlotById(id, { serviceId, excludeId } = {}) {
  try {
    const { data } = await client.get(config.backend.paths.slotById.replace(':id', encodeURIComponent(id)), {
      params: { serviceId, exclude: excludeId },
    });
    return data;
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw err;
  }
}

/** Per-day availability summary (open/closed, counts), for a service. */
async function getAvailability({ days = 7, serviceId, excludeId } = {}) {
  const { data } = await client.get(config.backend.paths.availability, {
    params: { days, serviceId, exclude: excludeId },
  });
  return itemsOf(data);
}

// ----- bookings -----

const appointmentPath = (id) => `${config.backend.paths.appointments}/${encodeURIComponent(id)}`;

/** Turns "the backend said no" (not found / slot taken) into a result; anything else is a real error. */
async function attempt(request) {
  try {
    const { data } = await request();
    return { ok: true, appointment: data };
  } catch (err) {
    const status = err.response?.status;
    if (status === 404 || status === 409) return { ok: false, status, error: err.response.data?.error };
    throw err;
  }
}

/** The booking, if it exists AND was made from this phone number; otherwise null. */
async function getAppointment(id, { phone } = {}) {
  const r = await attempt(() => client.get(appointmentPath(id), { params: { phone } }));
  return r.ok ? r.appointment : null;
}

/** -> { ok: true, appointment } | { ok: false, status: 404|409, error } */
function createAppointment({ serviceId, slotId, customerName, customerPhone }) {
  return attempt(() =>
    client.post(config.backend.paths.appointments, { serviceId, slotId, customerName, customerPhone })
  );
}

/** -> { ok: true, appointment } | { ok: false, status: 404|409, error } */
function rescheduleAppointment(id, { slotId, phone }) {
  return attempt(() => client.patch(appointmentPath(id), { slotId, customerPhone: phone }));
}

module.exports = {
  getSalon,
  getServices,
  getAvailableSlots,
  getSlotById,
  getAvailability,
  getAppointment,
  createAppointment,
  rescheduleAppointment,
};
