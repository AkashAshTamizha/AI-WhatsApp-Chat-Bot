require('dotenv').config();

const missing = [];
function required(name) {
  const v = process.env[name];
  if (!v) missing.push(name);
  return v;
}

const config = {
  port: Number(process.env.PORT) || 3000,

  meta: {
    graphVersion: process.env.META_GRAPH_VERSION || 'v21.0',
    token: required('WHATSAPP_TOKEN'),
    phoneNumberId: required('WHATSAPP_PHONE_NUMBER_ID'),
    wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    verifyToken: required('WHATSAPP_VERIFY_TOKEN'),
    appSecret: required('META_APP_SECRET'),
  },

  backend: {
    // Defaults to the bundled backend (`npm run backend`, port 4000).
    baseUrl: process.env.BACKEND_BASE_URL || 'http://localhost:4000',
    apiKey: process.env.BACKEND_API_KEY,
    // Paths of the salon backend APIs. The bot contains no salon data - the
    // name, services, prices and time slots all come from these endpoints.
    // Override via env if your real backend uses different routes.
    paths: {
      salon: process.env.BACKEND_SALON_PATH || '/salon',
      services: process.env.BACKEND_SERVICES_PATH || '/services',
      slots: process.env.BACKEND_SLOTS_PATH || '/slots',
      slotById: process.env.BACKEND_SLOT_BY_ID_PATH || '/slots/:id',
      availability: process.env.BACKEND_AVAILABILITY_PATH || '/availability',
      appointments: process.env.BACKEND_APPOINTMENTS_PATH || '/appointments',
    },
  },

  ai: {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || null,
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
  },

  /** Names of required WhatsApp settings that are not set (empty when ready to run). */
  missing,
};

// Warn once at load time. The server refuses to start without them (see server.js),
// but tests and the standalone backend can still import this file.
if (missing.length && !process.env.NODE_TEST_CONTEXT) {
  console.warn(`[config] Missing environment variables: ${missing.join(', ')}`);
}

module.exports = config;
