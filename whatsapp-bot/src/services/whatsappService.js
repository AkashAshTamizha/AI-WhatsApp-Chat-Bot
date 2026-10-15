const axios = require('axios');
const config = require('../config');

const BASE = `https://graph.facebook.com/${config.meta.graphVersion}/${config.meta.phoneNumberId}`;

const client = axios.create({
  baseURL: BASE,
  headers: { 'Content-Type': 'application/json' },
  timeout: 10000,
});

// Read the token per request (never send "Bearer undefined") ...
client.interceptors.request.use((req) => {
  if (!config.meta.token || !config.meta.phoneNumberId) {
    throw new Error('WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID are not set');
  }
  req.headers.Authorization = `Bearer ${config.meta.token}`;
  return req;
});

// ... and surface Meta's own error message instead of a bare "Request failed with status 400".
client.interceptors.response.use(
  (res) => res,
  (err) => {
    const apiError = err.response?.data?.error;
    if (apiError) {
      err.message = `WhatsApp API ${err.response.status}: ${apiError.message}${
        apiError.code ? ` (code ${apiError.code})` : ''
      }`;
    }
    return Promise.reject(err);
  }
);

// WhatsApp limits (Cloud API): text 4096, list header 60, list body 1024, list button 20.
const clip = (s, n) => (typeof s === 'string' && s.length > n ? `${s.slice(0, n - 1)}…` : s);

async function sendText(to, body) {
  return client.post('/messages', {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: clip(body, 4096) },
  });
}

/**
 * Interactive list message - the standard way to present a selectable menu.
 * Max 10 rows in total across all sections; titles are short.
 */
async function sendList(to, { header, body, buttonText, sections }) {
  const interactive = {
    type: 'list',
    body: { text: clip(body, 1024) },
    action: { button: clip(buttonText, 20), sections },
  };
  if (header) interactive.header = { type: 'text', text: clip(header, 60) };
  return client.post('/messages', { messaging_product: 'whatsapp', to, type: 'interactive', interactive });
}

/** Quick reply buttons - up to 3, for yes/no/menu style prompts. */
async function sendButtons(to, body, buttons) {
  return client.post('/messages', {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: clip(body, 1024) },
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: clip(b.title, 20) },
        })),
      },
    },
  });
}

async function markRead(messageId) {
  return client.post('/messages', {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
  });
}

module.exports = { sendText, sendList, sendButtons, markRead };
