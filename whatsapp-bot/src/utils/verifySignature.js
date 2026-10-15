const crypto = require('crypto');
const config = require('../config');

/**
 * Meta signs every webhook POST body with your App Secret and sends it in the
 * X-Hub-Signature-256 header. Verifying it stops anyone else from hitting your
 * webhook URL and injecting fake messages. It must be checked against the RAW
 * request body, exactly as received.
 *
 * Fails closed: no secret, no header, wrong length or wrong HMAC => false.
 */
function isValidSignature(signatureHeader, rawBody, secret) {
  if (!secret || !signatureHeader) return false;
  const expected =
    'sha256=' + crypto.createHmac('sha256', secret).update(rawBody || Buffer.alloc(0)).digest('hex');
  const a = Buffer.from(String(signatureHeader));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Express middleware: rejects the request with 401 unless the signature is valid. */
function requireMetaSignature(req, res, next) {
  if (!config.meta.appSecret) {
    console.error('[webhook] META_APP_SECRET is not set - rejecting webhook call');
    return res.status(500).send('Server is not configured');
  }
  if (!isValidSignature(req.get('X-Hub-Signature-256'), req.rawBody, config.meta.appSecret)) {
    return res.status(401).send('Invalid signature');
  }
  next();
}

module.exports = { isValidSignature, requireMetaSignature };
