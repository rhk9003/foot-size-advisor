// 由腳的遮罩自動放置標記點，並由標記點計算腳長、腳寬
// 標記點單位 mm（紙張座標，腳跟在下緣 y=297）
import { CONFIG } from './config.js';

// seg 需已轉成腳跟在下方
export function autoMarkers(seg) {
  const { mask, w, h, ppm } = seg;
  const PW = CONFIG.PAPER_W_MM, PH = CONFIG.PAPER_H_MM;
  const margin = Math.round(CONFIG.SEG_EDGE_MARGIN_MM * ppm);
  const heelAligned = seg.heelSide === 'bottom';

  if (!mask) {
    return { markers: defaultMarkers(), flags: { heelAligned: false, noFoot: true } };
  }

  let cnt = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) cnt++;
  const px = new Float32Array(cnt), py = new Float32Array(cnt);
  for (let y = 0, k = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) { px[k] = (x + 0.5) / ppm; py[k] = (y + 0.5) / ppm; k++; }
    }
  }

  // 腳跟點：對齊時在紙的下緣。x 不取貼邊那幾列（常是小腿的投影，可能偏一邊），
  // 改取腳跟邊往上 12~30 mm 這段（腳跟本體）每列中心的中位數
  let heel;
  if (heelAligned) {
    const centers = [];
    const y0 = h - Math.round(CONFIG.HEEL_CENTER_ZONE_MM[1] * ppm);
    const y1 = h - Math.round(CONFIG.HEEL_CENTER_ZONE_MM[0] * ppm);
    for (let y = Math.max(0, y0); y < y1; y++) {
      let l = -1, r = -1;
      for (let x = 0; x < w; x++) if (mask[y * w + x]) { if (l < 0) l = x; r = x; }
      if (l >= 0) centers.push((l + r + 1) / 2);
    }
    centers.sort((a, b) => a - b);
    heel = { x: centers.length ? centers[centers.length >> 1] / ppm : PW / 2, y: PH };
  } else {
    let maxY = -Infinity;
    for (let k = 0; k < cnt; k++) if (py[k] > maxY) maxY = py[k];
    let sx = 0, n = 0;
    for (let k = 0; k < cnt; k++) if (py[k] > maxY - 5) { sx += px[k]; n++; }
    heel = { x: sx / n, y: maxY + 0.5 / ppm };
  }

  // 腳尖點：沿腳軸方向最遠的點，腳軸 = 腳跟點→腳尖，迭代收斂
  let ux = 0, uy = -1, toe = null;
  for (let it = 0; it < 3; it++) {
    let best = -Infinity, bi = 0;
    for (let k = 0; k < cnt; k++) {
      const s = (px[k] - heel.x) * ux + (py[k] - heel.y) * uy;
      if (s > best) { best = s; bi = k; }
    }
    toe = { x: px[bi], y: py[bi] };
    const L = Math.hypot(toe.x - heel.x, toe.y - heel.y) || 1;
    ux = (toe.x - heel.x) / L;
    uy = (toe.y - heel.y) / L;
  }
  toe = { x: toe.x + (ux * 0.5) / ppm, y: toe.y + (uy * 0.5) / ppm };

  // 腳寬點：腳掌區段內，垂直腳軸方向的最左、最右點
  const L = Math.hypot(toe.x - heel.x, toe.y - heel.y);
  const nx = -uy, ny = ux;
  const [z0, z1] = CONFIG.WIDTH_ZONE;
  let minT = Infinity, maxT = -Infinity, li = -1, ri = -1;
  for (let k = 0; k < cnt; k++) {
    const dx = px[k] - heel.x, dy = py[k] - heel.y;
    const s = dx * ux + dy * uy;
    if (s < z0 * L || s > z1 * L) continue;
    const t = dx * nx + dy * ny;
    if (t < minT) { minT = t; li = k; }
    if (t > maxT) { maxT = t; ri = k; }
  }
  let left, right;
  if (li >= 0) {
    left = { x: px[li] - (nx * 0.5) / ppm, y: py[li] - (ny * 0.5) / ppm };
    right = { x: px[ri] + (nx * 0.5) / ppm, y: py[ri] + (ny * 0.5) / ppm };
  } else {
    const cx = heel.x + ux * 0.67 * L, cy = heel.y + uy * 0.67 * L;
    left = { x: cx - nx * 45, y: cy - ny * 45 };
    right = { x: cx + nx * 45, y: cy + ny * 45 };
  }

  const edge = (margin + 1) / ppm;
  const flags = {
    heelAligned,
    widthAtMargin: left.x <= edge || right.x >= PW - edge,
    toeAtMargin: toe.y <= edge,
  };
  return { markers: { heel, toe, left, right }, flags };
}

export function defaultMarkers() {
  return {
    heel: { x: 105, y: 297 },
    toe: { x: 105, y: 50 },
    left: { x: 60, y: 120 },
    right: { x: 150, y: 120 },
  };
}

// 腳長 = 腳跟點到腳尖點距離；腳寬 = 兩寬度點在「垂直腳軸方向」的距離
export function computeMeasurements(markers) {
  const { heel, toe, left, right } = markers;
  const len = Math.hypot(toe.x - heel.x, toe.y - heel.y) || 1;
  const ux = (toe.x - heel.x) / len, uy = (toe.y - heel.y) / len;
  const nx = -uy, ny = ux;
  const width = Math.abs((right.x - left.x) * nx + (right.y - left.y) * ny);
  return {
    lengthMm: len + CONFIG.LENGTH_OFFSET_MM,
    widthMm: width + CONFIG.WIDTH_OFFSET_MM,
    axis: { ux, uy, nx, ny },
  };
}

export function measurementConfidence({ autoCorners, flags, lengthMm, widthMm }) {
  let c = autoCorners ? 0.3 : 0.2;
  if (flags && flags.heelAligned) c += 0.3;
  if (widthMm >= 70 && widthMm <= 130) c += 0.2;
  if (lengthMm >= 200 && lengthMm <= 300) c += 0.2;
  if (flags && flags.widthAtMargin) c -= 0.2;
  if (flags && flags.toeAtMargin) c -= 0.2;
  if (flags && flags.noFoot) c = 0;
  return Math.max(0, Math.min(1, Math.round(c * 100) / 100));
}

export function sanityCheck({ lengthMm, widthMm }) {
  const [lMin, lMax] = CONFIG.FOOT_LENGTH_RANGE;
  const [wMin, wMax] = CONFIG.FOOT_WIDTH_RANGE;
  if (lengthMm < lMin || lengthMm > lMax) return { ok: false, field: 'length' };
  if (widthMm < wMin || widthMm > wMax) return { ok: false, field: 'width' };
  return { ok: true };
}
