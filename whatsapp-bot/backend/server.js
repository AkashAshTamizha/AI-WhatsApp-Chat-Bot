require('dotenv').config();
const express = require('express');
const { selectSource } = require('./sources');

const PORT = process.env.MOCK_BACKEND_PORT || 4000;

const clampInt = (v, def, min, max) => {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? def : Math.min(max, Math.max(min, n));
};

/**
 * Same API as before; the data now comes from `source`:
 *   website (default) - the booking website's own config file (see sources/website.js)
 *   mock              - the bundled dummy dataset (DATA_SOURCE=mock)
 */
function createApp(source) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

  /** Resolves ?serviceId= to a service, or sends a 404 and returns false. */
  async function resolveService(req, res) {
    if (!req.query.serviceId) return undefined;
    const svc = await source.findService(req.query.serviceId);
    if (!svc) {
      res.status(404).json({ error: `Unknown serviceId "${req.query.serviceId}"` });
      return false;
    }
    return svc;
  }

  function resolveDate(req, res) {
    if (!req.query.date) return undefined;
    if (!source.isValidDate(req.query.date)) {
      res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      return false;
    }
    return req.query.date;
  }

  const fromParam = (req) =>
    req.query.from && source.isValidDate(req.query.from) ? req.query.from : undefined;

  app.get('/health', route(async (req, res) => {
    await source.getSalon(); // fails (500) if the data source is unreadable
    res.json({ ok: true, source: source.name });
  }));

  // Business details
  app.get('/salon', route(async (req, res) => res.json(await source.getSalon())));

  // Services (& prices, when the data source has them)
  app.get('/services', route(async (req, res) => res.json(await source.getServices({ category: req.query.category }))));

  app.get('/services/:id', route(async (req, res) => {
    const svc = await source.findService(req.params.id);
    if (!svc) return res.status(404).json({ error: 'Service not found' });
    const { currency, locale } = await source.getServices();
    res.json({ currency, locale, ...svc });
  }));

  // Time slots (flat list). Defaults: next 7 days, available only.
  //   ?date=YYYY-MM-DD  ?from=YYYY-MM-DD&days=7  ?serviceId=...  ?available=false  ?limit=10
  app.get('/slots', route(async (req, res) => {
    const service = await resolveService(req, res);
    if (service === false) return;
    const date = resolveDate(req, res);
    if (date === false) return;

    const salon = await source.getSalon();
    const items = await source.listSlots({
      date,
      from: fromParam(req),
      days: clampInt(req.query.days, 7, 1, 30),
      service,
      excludeId: req.query.exclude,
      onlyAvailable: req.query.available !== 'false',
      limit: req.query.limit ? clampInt(req.query.limit, 10, 1, 200) : undefined,
    });
    res.json({ timezone: salon.timezone, slotMinutes: salon.slotMinutes, items });
  }));

  app.get('/slots/:id', route(async (req, res) => {
    const service = await resolveService(req, res);
    if (service === false) return;
    const slot = await source.getSlot(req.params.id, { service, excludeId: req.query.exclude });
    if (!slot) return res.status(404).json({ error: 'Slot not found' });
    res.json(slot);
  }));

  // Availability grouped by day (counts + free slots).
  app.get('/availability', route(async (req, res) => {
    const service = await resolveService(req, res);
    if (service === false) return;
    const date = resolveDate(req, res);
    if (date === false) return;

    const salon = await source.getSalon();
    const items = await source.listAvailability({
      date,
      from: fromParam(req),
      days: clampInt(req.query.days, 7, 1, 30),
      service,
      excludeId: req.query.exclude,
    });
    res.json({ timezone: salon.timezone, items });
  }));

  // ----- Bookings (website source). `phone` / customerPhone limits a lookup to that customer's own bookings. -----
  const bookingsSupported = (res) => {
    if (source.createAppointment) return true;
    res.status(501).json({ error: `The "${source.name}" data source does not take bookings` });
    return false;
  };

  app.get('/appointments', route(async (req, res) => {
    res.json({ items: await source.listAppointments({ customerPhone: req.query.phone }) });
  }));

  app.get('/appointments/:id', route(async (req, res) => {
    if (!bookingsSupported(res)) return;
    const b = await source.getAppointment(req.params.id, { customerPhone: req.query.phone });
    if (!b) return res.status(404).json({ error: 'Appointment not found' });
    res.json(b);
  }));

  // Body: { serviceId, slotId, customerName?, customerPhone }  -> 201, or 404 / 409 (slot taken)
  app.post('/appointments', route(async (req, res) => {
    if (!bookingsSupported(res)) return;
    const { serviceId, slotId, customerName, customerPhone } = req.body || {};
    if (!serviceId || !slotId) return res.status(400).json({ error: 'serviceId and slotId are required' });
    res.status(201).json(await source.createAppointment({ serviceId, slotId, customerName, customerPhone }));
  }));

  // Body: { slotId, customerPhone? }  -> the updated booking, or 404 / 409
  app.patch('/appointments/:id', route(async (req, res) => {
    if (!bookingsSupported(res)) return;
    const { slotId, customerPhone } = req.body || {};
    if (!slotId) return res.status(400).json({ error: 'slotId is required' });
    res.json(await source.rescheduleAppointment(req.params.id, { slotId, customerPhone }));
  }));

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    const status = err.status || 500;
    if (status >= 500) console.error('[backend] error:', err.message);
    res.status(status).json({ error: err.message });
  });

  return app;
}

if (require.main === module) {
  (async () => {
    const source = selectSource();
    try {
      await source.getSalon(); // fail loudly at boot if the website config is missing/invalid
    } catch (err) {
      console.error(`[backend] ${err.message}`);
      process.exit(1);
    }
    createApp(source).listen(PORT, () =>
      console.log(`Backend listening on http://localhost:${PORT} (data source: ${source.name}${source.configPath ? `, ${source.configPath}` : ''})`)
    );
  })();
}

module.exports = { createApp };
