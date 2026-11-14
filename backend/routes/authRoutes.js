// backend/routes/authRoutes.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const crypto = require('crypto');
const { sendResetCode } = require('../utils/mailer');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

// Chống dò mật khẩu: tối đa 30 lần thử / 15 phút / mỗi IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const signToken = (user) =>
  jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

const publicUser = (u) => ({ id: u._id, email: u.email, name: u.name, avatar: u.avatar });

// Hash giả để thời gian phản hồi khi "email không tồn tại" gần bằng khi "sai mật khẩu"
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

/* ----------------------------- Cấu hình quên mật khẩu ----------------------------- */
const RESET_TTL_MS = 10 * 60 * 1000;   // mã sống 10 phút
const RESET_COOLDOWN_MS = 60 * 1000;   // gửi lại tối thiểu cách nhau 60 giây
const RESET_MAX_ATTEMPTS = 5;          // nhập sai tối đa 5 lần

// Giới hạn riêng cho việc xin mã: 5 lần / 15 phút / IP (chống spam mail)
const forgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'You have made too many requests, please wait a few minutes and try again.' },
});

const hashCode = (code) =>
  crypto.createHmac('sha256', process.env.JWT_SECRET).update(code).digest('hex');

/* ----------------------------- Đăng ký ----------------------------- */
router.post('/register', limiter, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Email không hợp lệ.' });
    if (password.length < MIN_PASSWORD)
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters long.` });
    if (password.length > 72)
      return res.status(400).json({ error: 'Password is too long (maximum 72 characters).' });

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({
        error: existing.googleId && !existing.password
          ? 'This email is already registered with Google. Please click "Continue with Google".'
          : 'This email is already registered. Please log in instead.',
      });
    }

    const user = await User.create({
      email,
      password: await bcrypt.hash(password, 12),
      name: email.split('@')[0],
    });

    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'This email is already registered.' });
    console.error('[auth/register]', err);
    res.status(500).json({ error: 'Server error, please try again later.' });
  }
});

/* ----------------------------- Đăng nhập ----------------------------- */
router.post('/login', limiter, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!EMAIL_RE.test(email) || !password)
      return res.status(400).json({ error: 'Please enter your email and password.' });

    const user = await User.findOne({ email }).select('+password');
    const ok = await bcrypt.compare(password, user?.password || DUMMY_HASH);

    if (!user || !user.password || !ok) {
      if (user && !user.password && user.googleId)
        return res.status(401).json({ error: 'This account is registered with Google. Please click "Continue with Google".' });
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }

    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Server error, please try again later.' });
  }
});

/* ----------------------------- Google ----------------------------- */
// Frontend gửi access_token (lấy từ popup Google). Backend kiểm tra token đó
// đúng là cấp cho app của mình, rồi lấy email/tên/ảnh từ Google.
router.post('/google', limiter, async (req, res) => {
  try {
    const accessToken = String(req.body.accessToken || '');
    if (!accessToken) return res.status(400).json({ error: 'Missing Google token.' });
    if (!process.env.GOOGLE_CLIENT_ID)
      return res.status(500).json({ error: 'Server chưa cấu hình GOOGLE_CLIENT_ID.' });

    // 1) Token phải được cấp cho đúng Client ID của mình
    const infoRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
    );
    if (!infoRes.ok) return res.status(401).json({ error: 'Invalid Google token.' });
    const tokenInfo = await infoRes.json();
    if (tokenInfo.aud !== process.env.GOOGLE_CLIENT_ID)
      return res.status(401).json({ error: 'Token Google does not belong to this application.' });

    // 2) Lấy thông tin tài khoản
    const profRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profRes.ok) return res.status(401).json({ error: 'Failed to fetch Google profile information.' });
    const profile = await profRes.json();
    if (!profile.email || !profile.email_verified)
      return res.status(401).json({ error: 'Google email is not verified.' });

    const email = profile.email.toLowerCase();
    let user = await User.findOne({ $or: [{ googleId: profile.sub }, { email }] });

    if (!user) {
      user = await User.create({ email, googleId: profile.sub, name: profile.name || email.split('@')[0], avatar: profile.picture || '' });
    } else {
      // Liên kết Google vào tài khoản email đã có
      let dirty = false;
      if (!user.googleId) { user.googleId = profile.sub; dirty = true; }
      if (!user.avatar && profile.picture) { user.avatar = profile.picture; dirty = true; }
      if (!user.name && profile.name) { user.name = profile.name; dirty = true; }
      if (dirty) await user.save();
    }

    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    console.error('[auth/google]', err);
    res.status(500).json({ error: 'Google login failed, please try again.' });
  }
});

/* ----------------------------- Ai đang đăng nhập? ----------------------------- */
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

/* ----------------------------- Đổi tên hiển thị ----------------------------- */
router.patch('/me', requireAuth, async (req, res) => {
  try {
    const name = String(req.body?.name ?? '').trim().slice(0, 40);
    if (!name) return res.status(400).json({ error: 'Name cannot be empty.' });
    const user = await User.findByIdAndUpdate(req.user._id, { name }, { new: true });
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error('[auth/patch-me]', err);
    res.status(500).json({ error: 'Server error, please try again later.' });
  }
});

/* ----------------------------- Quên mật khẩu: xin mã ----------------------------- */
router.post('/forgot-password', forgotLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Email is invalid.' });

    const user = await User.findOne({ email }).select('+resetSentAt');
    if (!user) {
      return res.status(404).json({
        code: 'EMAIL_NOT_FOUND',
        error: 'This email is not registered. Please sign up or use a different email.',
      });
    }

    const inCooldown =
      user.resetSentAt && Date.now() - user.resetSentAt.getTime() < RESET_COOLDOWN_MS;

    if (!inCooldown) {
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      user.resetCodeHash = hashCode(code);
      user.resetCodeExpires = new Date(Date.now() + RESET_TTL_MS);
      user.resetAttempts = 0;
      user.resetSentAt = new Date();
      await user.save();
      sendResetCode(email, code).catch((err) => console.error('[auth/forgot-mail]', err.message));
    }
    res.json({ message: 'Verification code has been sent to your email. It will expire in 10 minutes.' });
  } catch (err) {
    console.error('[auth/forgot-password]', err);
    res.status(500).json({ error: 'Server error, please try again later.' });
  }
});

/* ----------------------------- Quên mật khẩu: đặt mật khẩu mới ----------------------------- */
router.post('/reset-password', limiter, async (req, res) => {
  const BAD = { error: 'Verification code is incorrect or has expired.' };
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();
    const password = String(req.body.password || '');

    if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) return res.status(400).json(BAD);
    if (password.length < MIN_PASSWORD)
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters long.` });
    if (password.length > 72)
      return res.status(400).json({ error: 'Password is too long (maximum 72 characters).' });

    const user = await User.findOne({ email }).select('+resetCodeHash +resetCodeExpires +resetAttempts');
    if (!user || !user.resetCodeHash || !user.resetCodeExpires || user.resetCodeExpires < new Date())
      return res.status(400).json(BAD);
    if (user.resetAttempts >= RESET_MAX_ATTEMPTS)
      return res.status(429).json({ error: 'You have entered the wrong code too many times, please request a new code.' });

    const ok = crypto.timingSafeEqual(Buffer.from(hashCode(code)), Buffer.from(user.resetCodeHash));
    if (!ok) {
      user.resetAttempts += 1;
      await user.save();
      return res.status(400).json(BAD);
    }

    user.password = await bcrypt.hash(password, 12);
    user.passwordChangedAt = new Date();
    // Dùng xong là xóa mã (mã chỉ dùng được 1 lần)
    user.resetCodeHash = undefined;
    user.resetCodeExpires = undefined;
    user.resetAttempts = 0;
    user.resetSentAt = undefined;
    await user.save();

    res.json({ message: 'Password reset successfully. Please log in with your new password.' });
  } catch (err) {
    console.error('[auth/reset-password]', err);
    res.status(500).json({ error: 'Server error, please try again later.' });
  }
});

module.exports = router;