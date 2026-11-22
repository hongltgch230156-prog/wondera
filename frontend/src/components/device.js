// Điện thoại = màn hình cảm ứng + cạnh ngắn của màn hình < 600 CSS px.
// Tablet (>= 600) và laptop luôn trả về false => không bị ảnh hưởng.
export const IS_PHONE =
  window.matchMedia("(pointer: coarse)").matches &&
  Math.min(screen.width, screen.height) < 600;