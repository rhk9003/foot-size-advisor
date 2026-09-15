// 模擬照片產生器：深色地板上的 A4 紙、紙上的腳形與小腿投影、相機傾斜、光線漸層、影子、雜訊。
// 用真實相機模型（K·R·K⁻¹ 旋轉單應）產生透視變形，所以長寬比估計也能驗證。
import { createImage } from '../js/cv.js';
import { invert3, applyH } from '../js/geometry.js';

function prng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mul3 = (A, B) => {
  const C = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j];
  return C;
};

function rotation(ax, ay, az) {
  const [a, b, c] = [ax, ay, az].map((d) => (d * Math.PI) / 180);
  const Rx = [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
  const Ry = [Math.cos(b), 0, Math.sin(b), 0, 1, 0, -Math.sin(b), 0, Math.cos(b)];
  const Rz = [Math.cos(c), -Math.sin(c), 0, Math.sin(c), Math.cos(c), 0, 0, 0, 1];
  return mul3(Rz, mul3(Ry, Rx));
}

// 腳形半寬（s 為從腳跟往腳尖的距離）
export function footHalfWidth(s, L, W) {
  if (s < 0 || s > L) return -1;
  const r = 0.325 * W;
  if (s < r) return Math.sqrt(r * r - (r - s) * (r - s));
  const knots = [[r, 0.325 * W], [0.4 * L, 0.36 * W], [0.68 * L, 0.5 * W], [0.8 * L, 0.44 * W]];
  if (s <= 0.8 * L) {
    for (let i = 0; i < knots.length - 1; i++) {
      const [s0, h0] = knots[i], [s1, h1] = knots[i + 1];
      if (s >= s0 && s <= s1) return h0 + ((h1 - h0) * (s - s0)) / (s1 - s0);
    }
  }
  const k = (s - 0.8 * L) / (0.2 * L);
  return 0.44 * W * Math.sqrt(Math.max(0, 1 - k * k));
}

export function makeScene(o = {}) {
  const {
    W = 1200, H = 1600, fill = 0.7,
    tiltX = 0, tiltY = 0, roll = 0, offX = 0, offY = 0,
    floor = [72, 60, 52], paper = [244, 242, 236], skin = [224, 176, 146], leg = [190, 140, 112],
    footLen = 250, footWidth = 98, footAngle = 0, footOffsetX = 0, heelGap = 0, heelAtTop = false,
    light = 0.12, noise = 6, shadow = true, seed = 1, drawLeg = true,
  } = o;

  const f = 0.75 * Math.max(W, H);
  const K = [f, 0, W / 2, 0, f, H / 2, 0, 0, 1];
  const Kinv = invert3(K);
  const s = (fill * Math.max(W, H)) / 297;
  const R = mul3(K, mul3(rotation(tiltX, tiltY, roll), Kinv));
  // 移動相機位置讓紙中心落在「畫面中心 + offX/offY」，模擬使用者把紙框在畫面裡
  const target = { x: W / 2 + s * offX, y: H / 2 + s * offY };
  let tx = W / 2 - s * 105, ty = H / 2 - s * 148.5;
  let Hm;
  for (let it = 0; it < 8; it++) {
    Hm = mul3(R, [s, 0, tx, 0, s, ty, 0, 0, 1]); // 紙張 mm → 影像
    const c = applyH(Hm, 105, 148.5);
    tx += (target.x - c.x) * 0.9;
    ty += (target.y - c.y) * 0.9;
  }
  const Hinv = invert3(Hm);

  const th = (footAngle * Math.PI) / 180;
  let B, u, n;
  if (!heelAtTop) {
    B = { x: 105 + footOffsetX, y: 297 - heelGap };
    u = { x: Math.sin(th), y: -Math.cos(th) };
  } else {
    B = { x: 105 - footOffsetX, y: heelGap };
    u = { x: -Math.sin(th), y: Math.cos(th) };
  }
  n = { x: -u.y, y: u.x };

  const rnd = prng(seed);
  const img = createImage(W, H);
  const d = img.data;
  for (let v = 0; v < H; v++) {
    for (let x = 0; x < W; x++) {
      const p = applyH(Hinv, x + 0.5, v + 0.5);
      const rx = p.x - B.x, ry = p.y - B.y;
      const ss = rx * u.x + ry * u.y, tt = rx * n.x + ry * n.y;
      let c;
      const onPaper = p.x >= 0 && p.x <= 210 && p.y >= 0 && p.y <= 297;
      const hw = footHalfWidth(ss, footLen, footWidth);
      if (hw >= 0 && Math.abs(tt) <= hw) c = skin;
      else if (drawLeg && ss >= -90 && ss <= 0.25 * footLen && Math.abs(tt) <= 0.6 * footWidth) c = leg;
      else if (onPaper) {
        c = paper;
        if (shadow) {
          const ex = (p.x - 40) / 22, ey = (p.y - 140) / 55;
          if (ex * ex + ey * ey < 1) c = paper.map((vv) => vv * 0.74);
        }
      } else c = floor;
      const lf = 1 - light * (x / W);
      const k = (v * W + x) * 4;
      for (let ch = 0; ch < 3; ch++) d[k + ch] = c[ch] * lf + (rnd() - 0.5) * 2 * noise;
      d[k + 3] = 255;
    }
  }
  const corners = [{ x: 0, y: 0 }, { x: 210, y: 0 }, { x: 210, y: 297 }, { x: 0, y: 297 }].map((q) => applyH(Hm, q.x, q.y));
  return { image: img, truthCorners: corners, truth: { length: footLen, width: footWidth }, H: Hm };
}
