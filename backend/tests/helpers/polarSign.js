// Ký body webhook Polar theo chuẩn Standard Webhooks (dùng secret dạng khoá thô như polar.js hỗ trợ)
const crypto = require('crypto');

function polarHeaders(rawBody, { id = 'msg_test', ts = Math.floor(Date.now() / 1000), secret = process.env.POLAR_WEBHOOK_SECRET } = {}) {
  const sig = crypto.createHmac('sha256', Buffer.from(secret, 'utf8')).update(`${id}.${ts}.${rawBody}`).digest('base64');
  return { 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': `v1,${sig}`, 'content-type': 'application/json' };
}

module.exports = { polarHeaders };
