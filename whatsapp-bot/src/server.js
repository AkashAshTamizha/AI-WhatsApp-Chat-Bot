const express = require('express');
const config = require('./config');
const webhookRouter = require('./routes/webhook');
const { requireMetaSignature } = require('./utils/verifySignature');

const app = express();
app.disable('x-powered-by');

// Keep the raw bytes: the HMAC signature is computed over them, not over parsed JSON.
app.use(
  express.json({
    limit: '1mb',
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Every POST to the webhook must carry a valid signature from Meta (checked even
// when the body is empty or not JSON, so it can't be skipped).
app.post('/webhook', requireMetaSignature);

app.use('/', webhookRouter);

app.get('/health', (req, res) => res.json({ ok: true }));

app.use((req, res) => res.status(404).send('Not found'));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).send('Invalid JSON');
  if (err.type === 'entity.too.large') return res.status(413).send('Payload too large');
  console.error('[server] unexpected error:', err.message);
  res.status(500).send('Server error');
});

function start() {
  if (config.missing.length) {
    console.error(
      `[server] Cannot start: set ${config.missing.join(', ')} in your .env file (see .env.example).`
    );
    process.exit(1);
  }
  process.on('unhandledRejection', (reason) => {
    console.error('[server] unhandled rejection:', reason instanceof Error ? reason.message : reason);
  });
  return app.listen(config.port, () => {
    console.log(`WhatsApp bot server listening on port ${config.port}`);
  });
}

if (require.main === module) start();

module.exports = { app, start };
