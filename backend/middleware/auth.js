// backend/middleware/auth.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Yêu cầu header:  Authorization: Bearer <token>
 * Hợp lệ -> gắn req.user rồi cho đi tiếp, sai/hết hạn -> 401.
 */
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: '	You need to log in to continue.' });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.id).select('email name avatar passwordChangedAt');
    if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
    if (user.passwordChangedAt && payload.iat * 1000 < user.passwordChangedAt.getTime())
      return res.status(401).json({ error: 'Password has been changed, please log in again.' });

    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Session has expired, please log in again.' });
  }
}

module.exports = { requireAuth };