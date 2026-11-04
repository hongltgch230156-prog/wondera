// frontend/src/components/handMath.js
// Bộ lọc làm mượt vị trí tay cho Snap & Solve.
//
// "One Euro Filter" (Casiez et al., 2012): khi tay đứng yên thì lọc mạnh (hết rung),
// khi tay di chuyển nhanh thì lọc nhẹ (bám sát, ít trễ). Tốt hơn nhiều so với lerp hệ số cố định.
// Thêm "dự đoán" (predict): đẩy vị trí tới trước một chút theo vận tốc để bù độ trễ của camera + model.
//
//   const fx = new OneEuro();            // mỗi trục một bộ lọc
//   const x = fx.filter(giaTri, tinhTheoGiay);   // gọi mỗi lần có kết quả tracking mới
//   fx.reset();                           // gọi khi tay mới xuất hiện lại

export class OneEuro {
  /**
   * @param {number} minCutoff  càng nhỏ càng mượt khi đứng yên (Hz).
   * @param {number} beta       càng lớn càng bám sát khi di chuyển nhanh (tính theo đơn vị pixel/giây).
   * @param {number} dCutoff    lọc vận tốc (Hz), thường để 1.
   * @param {number} maxPredict giới hạn thời gian dự đoán tới trước (giây). 0 = tắt dự đoán.
   *                            Lớn hơn = ít trễ hơn nhưng vọt quá một chút khi tay dừng đột ngột.
   */
  constructor(minCutoff = 3, beta = 0.05, dCutoff = 1, maxPredict = 0.02) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.maxPredict = maxPredict;
    this.reset();
  }

  reset() {
    this.x = null;   // giá trị đã lọc
    this.dx = 0;     // vận tốc đã lọc
    this.t = 0;
  }

  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  /** @param {number} v giá trị đo được   @param {number} t thời gian (giây, tăng dần) */
  filter(v, t) {
    if (this.x === null) {
      this.x = v;
      this.t = t;
      return v;
    }
    const dt = Math.max(1e-3, t - this.t);
    this.t = t;
    const rawVelocity = (v - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (rawVelocity - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (v - this.x);
    // Dự đoán: tracking càng thưa (dt lớn) thì đẩy càng xa, nhưng không quá maxPredict
    const predict = Math.min(this.maxPredict, dt * 0.5);
    return this.x + this.dx * predict;
  }
}

/** Tâm lòng bàn tay = trung điểm cổ tay (0) và khớp ngón giữa (9).
 *  Ít nhảy hơn khi nắm/xòe tay so với chỉ dùng khớp 9 (cách WonderSnap lấy vị trí bàn tay). */
export function palmCenter(landmarks) {
  const wrist = landmarks[0];
  const knuckle = landmarks[9];
  return { x: (wrist.x + knuckle.x) / 2, y: (wrist.y + knuckle.y) / 2 };
}