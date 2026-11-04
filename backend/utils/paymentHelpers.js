// backend/utils/paymentHelpers.js

// Trang web (frontend) - nơi khách được đưa về sau khi thanh toán
const frontendUrl = () => (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');

// Địa chỉ backend mà VNPay / Polar gọi được từ internet (ngrok / cloudflared khi chạy localhost)
const backendUrl = () => (process.env.BACKEND_PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');

module.exports = { frontendUrl, backendUrl };