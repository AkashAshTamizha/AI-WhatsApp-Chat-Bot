const express = require('express');
const NodeCache = require('node-cache');
const config = require('../config');
const wa = require('../services/whatsappService');
const { handleIncomingMessage } = require('../controllers/chatController');

const router = express.Router();

// Meta re-delivers a webhook if it didn't get a 200 quickly enough. Remember message
// ids for a while so a retry is never processed (and answered) twice.
const seen = new NodeCache({ stdTTL: 15 * 60, checkperiod: 120 });

/**
 * Meta calls this once, with hub.verify_token equal to WHATSAPP_VERIFY_TOKEN,
 * to confirm you control this URL (App Dashboard > WhatsApp > Configuration).
 */
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && config.meta.verifyToken && token === config.meta.verifyToken) {
    return res.status(200).send(String(challenge ?? ''));
  }
  return res.sendStatus(403);
});

/** Pulls every inbound message (with its contact) out of a webhook payload. */
function extractMessages(body) {
  const out = [];
  for (const entry of body?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value;
      for (const msg of value?.messages || []) {
        const contact = (value.contacts || []).find((c) => c.wa_id === msg.from) || value.contacts?.[0];
        out.push({ msg, contact });
      }
    }
  }
  return out;
}

/**
 * Meta POSTs every inbound message / status update here. The signature has already
 * been verified (server.js). Acknowledge immediately, then process.
 */
router.post('/webhook', (req, res) => {
  res.sendStatus(200);

  (async () => {
    for (const { msg, contact } of extractMessages(req.body)) {
      if (!msg?.id || !msg.from) continue;
      if (seen.has(msg.id)) continue; // duplicate delivery
      seen.set(msg.id, true);

      wa.markRead(msg.id).catch(() => {});
      await handleIncomingMessage(msg, contact);
    }
  })().catch((err) => console.error('[webhook] processing error:', err.message));
});

module.exports = router;
module.exports.extractMessages = extractMessages;
