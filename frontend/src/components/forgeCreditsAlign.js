// Căn thẻ credits của 3D Forge: cạnh trên ngang tâm tiêu đề "3D FORGE",
// nhưng không bao giờ thấp tới mức đè lên card RESULT. Chỉ laptop / tablet.
import { IS_PHONE } from "./device.js";

export function initForgeCreditsAlign() {
  if (IS_PHONE) return;                                   // điện thoại đã có CSS riêng
  const chip = document.querySelector(".forge-magic-credits");
  const modal = chip && chip.closest(".modal");
  const panel = chip && chip.closest(".forge-output-panel");
  const title = modal && modal.querySelector(".forge-title");
  if (!chip || !modal || !panel || !title) return;

  const place = () => {
    const tr = title.getBoundingClientRect();
    if (!tr.height) return;                               // modal đang ẩn
    const pr = panel.getBoundingClientRect();
    const ch = chip.offsetHeight || 46;
    // vị trí mong muốn (toạ độ màn hình): ngang tâm tiêu đề, nhưng tối đa là sát trên card, chừa 8px
    const desired = Math.min(tr.top + tr.height / 2, pr.top - ch - 8);
    const current = chip.getBoundingClientRect().top;
    const currentTop = parseFloat(getComputedStyle(chip).top) || 0;
    chip.style.top = `${Math.round(currentTop + (desired - current))}px`;
  };

  const ro = new ResizeObserver(place);
  [title, panel, modal, chip].forEach((el) => ro.observe(el));   // modal mở, đổi cỡ, thẻ hiện ra đều tự căn lại
  window.addEventListener("resize", place);
  requestAnimationFrame(place);
}