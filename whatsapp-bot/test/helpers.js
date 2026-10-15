// Shared test plumbing: capture outbound WhatsApp sends, drive the real controller.
const wa = require('../src/services/whatsappService');

const sent = [];
wa.sendText = async (to, body) => sent.push({ type: 'text', to, body });
wa.sendList = async (to, payload) => sent.push({ type: 'list', to, ...payload });
wa.sendButtons = async (to, body, buttons) => sent.push({ type: 'buttons', to, body, buttons });

const { handleIncomingMessage, FALLBACK_TEXT, NUMBER_FALLBACK } = require('../src/controllers/chatController');

const text = (from, body) => ({ from, id: 'm', type: 'text', text: { body } });
const listPick = (from, id, title) => ({
  from, id: 'm', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title } },
});
const say = async (m) => {
  sent.length = 0;
  await handleIncomingMessage(m, { profile: { name: 'WA' } });
  return [...sent];
};

module.exports = { text, listPick, say, FALLBACK_TEXT, NUMBER_FALLBACK };
