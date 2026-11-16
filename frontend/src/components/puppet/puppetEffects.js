// frontend/src/components/puppet/puppetEffects.js
// Hiệu ứng nhỏ vẽ trên canvas sân khấu: vòng sáng khi đánh trúng, tia lấp lánh, mảnh giấy vỡ khi kết liễu.
const rnd = (a, b) => a + Math.random() * (b - a);
export class Effects {
  constructor() { this.list = []; }
  clear() { this.list.length = 0; }
  /** vòng sáng + tia khi vợt chạm quả cầu */
  hit(x, y, power = 1, color = "#fff1b0") {
    this.list.push({ k: "ring", x, y, t: 0, dur: 0.35, r0: 14, r1: 70 + 40 * power, color });
    for (let i = 0; i < 9; i++) {
      const a = rnd(0, 6.283), s = rnd(120, 360) * (0.6 + power * 0.5);
      this.list.push({ k: "spark", x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, dur: rnd(0.25, 0.5), r: rnd(2, 4.5), color });
    }
  }
  /** nảy trên mặt bàn */
  bounce(x, y) {
    for (let i = 0; i < 5; i++) this.list.push({ k: "spark", x, y, vx: rnd(-160, 160), vy: rnd(-220, -60), t: 0, dur: rnd(0.2, 0.4), r: rnd(1.5, 3), color: "#f8e1b0" });
  }
  /** tia lửa dọc đường bay của vũ khí */
  trail(x, y, color = "#fff1b0") {
    this.list.push({ k: "spark", x, y, vx: rnd(-40, 40), vy: rnd(-40, 40), t: 0, dur: rnd(0.18, 0.34), r: rnd(2, 4), color, g: 0 });
  }
  /** vũ khí va vào khiên / thân đối thủ: vòng sáng lớn + chùm tia bắn theo hướng ngược lại với hướng bay */
  clash(x, y, dir = -1, color = "#fff6c8") {
    this.list.push({ k: "ring", x, y, t: 0, dur: 0.42, r0: 18, r1: 120, color });
    this.list.push({ k: "ring", x, y, t: 0, dur: 0.28, r0: 8, r1: 64, color: "#ffd27a" });
    for (let i = 0; i < 16; i++) {
      const a = (dir < 0 ? Math.PI : 0) + rnd(-1.0, 1.0), sp = rnd(260, 620);
      this.list.push({ k: "spark", x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, t: 0, dur: rnd(0.25, 0.55), r: rnd(2.5, 5), color: i % 3 ? color : "#ffb347" });
    }
  }
  /** bụi tung lên khi con rối tiếp đất (k = tỉ lệ phối cảnh) */
  dust(x, y, k = 1) {
    for (let i = 0; i < 12; i++) {
      const side = i % 2 ? 1 : -1;
      this.list.push({ k: "spark", x: x + side * rnd(10, 46) * k, y: y - rnd(0, 4), vx: side * rnd(50, 180) * k, vy: rnd(-90, -20), t: 0, dur: rnd(0.35, 0.65), r: rnd(5, 11) * k, color: "rgba(236,214,180,0.9)", g: 60 });
    }
  }
  /** chữ nổi lên (ví dụ "+13") */
  float(x, y, text, color = "#fff") {
    this.list.push({ k: "text", x, y, t: 0, dur: 0.9, text, color });
  }
  /** con rối bị đánh vỡ thành các mảnh giấy */
  shards(cx, cy, w, h, palette) {
    for (let i = 0; i < 46; i++) {
      this.list.push({
        k: "shard", x: cx + rnd(-w / 2, w / 2), y: cy + rnd(-h / 2, h / 2),
        vx: rnd(-80, 520), vy: rnd(-520, 80), rot: rnd(0, 6.283), vr: rnd(-9, 9),
        w: rnd(14, 38), h: rnd(10, 28), t: 0, dur: rnd(1.1, 1.9), color: palette[(Math.random() * palette.length) | 0],
      });
    }
    this.list.push({ k: "ring", x: cx, y: cy, t: 0, dur: 0.6, r0: 20, r1: 260, color: "#fff7d0" });
  }
  /** mưa giấy ăn mừng */
  confetti(W, H, palette) {
    for (let i = 0; i < 70; i++) {
      this.list.push({ k: "shard", x: rnd(0, W), y: rnd(-200, -10), vx: rnd(-60, 60), vy: rnd(120, 340), rot: rnd(0, 6.283), vr: rnd(-4, 4), w: rnd(10, 22), h: rnd(6, 14), t: 0, dur: rnd(2.5, 4), color: palette[(Math.random() * palette.length) | 0], g: 0 });
    }
  }
  update(dt) {
    for (const e of this.list) {
      e.t += dt;
      if (e.k === "spark" || e.k === "shard") {
        e.x += e.vx * dt; e.y += e.vy * dt;
        e.vy += (e.g ?? 900) * dt;
        if (e.k === "shard") e.rot += e.vr * dt;
      }
    }
    this.list = this.list.filter((e) => e.t < e.dur);
  }
  draw(ctx) {
    for (const e of this.list) {
      const p = e.t / e.dur;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - p * p);
      if (e.k === "ring") {
        ctx.strokeStyle = e.color; ctx.lineWidth = 7 * (1 - p) + 1;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r0 + (e.r1 - e.r0) * (1 - (1 - p) ** 2), 0, 6.283); ctx.stroke();
      } else if (e.k === "spark") {
        ctx.fillStyle = e.color; ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (1 - p * 0.6), 0, 6.283); ctx.fill();
      } else if (e.k === "shard") {
        ctx.translate(e.x, e.y); ctx.rotate(e.rot); ctx.fillStyle = e.color; ctx.strokeStyle = "rgba(60,30,20,.55)"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-e.w / 2, -e.h / 2); ctx.lineTo(e.w / 2, -e.h * 0.35); ctx.lineTo(e.w * 0.3, e.h / 2); ctx.lineTo(-e.w / 2, e.h * 0.3); ctx.closePath(); ctx.fill(); ctx.stroke();
      } else if (e.k === "text") {
        ctx.font = "900 34px Nunito, sans-serif"; ctx.textAlign = "center"; ctx.lineWidth = 6; ctx.strokeStyle = "rgba(80,40,10,.65)";
        const y = e.y - 60 * p; ctx.strokeText(e.text, e.x, y); ctx.fillStyle = e.color; ctx.fillText(e.text, e.x, y);
      }
      ctx.restore();
    }
  }
}