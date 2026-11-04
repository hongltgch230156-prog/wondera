const FREE_CREDITS = 2; // tặng 1 lần cho mỗi tài khoản

const PACKAGES = [
  { id: 'pack5',  label: 'Starter', credits: 5,  vnd: 49000,  usd: 1.99,  polarProductEnv: 'POLAR_PRODUCT_PACK5' },
  { id: 'pack20', label: 'Creator', credits: 20, vnd: 149000, usd: 5.99,  polarProductEnv: 'POLAR_PRODUCT_PACK20', popular: true },
  { id: 'pack50', label: 'Studio',  credits: 50, vnd: 299000, usd: 11.99, polarProductEnv: 'POLAR_PRODUCT_PACK50' },
];

const getPackage = (id) => PACKAGES.find((p) => p.id === id) || null;

// Chi phí mỗi hành động (đơn vị: credits)
const COSTS = { magicWandObject: 1 };

// Bật/tắt từng cổng bằng biến môi trường (thiếu khóa thì cổng đó tự ẩn khỏi giao diện)
const providerStatus = () => ({
  vnpay: !!(process.env.VNPAY_TMN_CODE && process.env.VNPAY_HASH_SECRET),
  polar: !!(process.env.POLAR_ACCESS_TOKEN && process.env.POLAR_WEBHOOK_SECRET),
});

const publicPackages = () =>
  PACKAGES.map(({ polarProductEnv, ...p }) => p);

module.exports = { FREE_CREDITS, PACKAGES, COSTS, getPackage, providerStatus, publicPackages };