// 在校正後的紙張影像上分割出腳（含小腿投影），並判斷腳跟在哪條短邊
import { CONFIG } from './config.js';
import { boxBlur, open, close, fillHoles, labelComponents } from './cv.js';
import { solveLinear } from './geometry.js';

// 以二次曲面擬合紙張亮度，吸收整張紙的明暗漸層
function fitSurface(Y, w, h, isPaper) {
  const AtA = Array.from({ length: 6 }, () => new Array(6).fill(0));
  const Atb = new Array(6).fill(0);
  let count = 0;
  for (let y = 0; y < h; y += 4) {
    const v = y / h - 0.5;
    for (let x = 0; x < w; x += 4) {
      const i = y * w + x;
      if (!isPaper(i, x, y)) continue;
      const u = x / w - 0.5;
      const f = [1, u, v, u * u, u * v, v * v];
      for (let a = 0; a < 6; a++) {
        Atb[a] += f[a] * Y[i];
        for (let b = 0; b < 6; b++) AtA[a][b] += f[a] * f[b];
      }
      count++;
    }
  }
  return count >= 60 ? solveLinear(AtA, Atb) : null;
}

const surfaceAt = (c, x, y, w, h) => {
  const u = x / w - 0.5, v = y / h - 0.5;
  return c[0] + c[1] * u + c[2] * v + c[3] * u * u + c[4] * u * v + c[5] * v * v;
};

const median = (arr) => {
  const a = Float32Array.from(arr).sort();
  return a.length ? a[a.length >> 1] : 0;
};

// rect：校正圖（腳跟方向未知）。回傳 { mask, w, h, ppm, heelSide, stat, touchesSides, debug }
export function segmentFoot(rect, ppm, wantDebug = false) {
  const w = rect.width, h = rect.height, n = w * h, d = rect.data;
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) { R[i] = d[4 * i]; G[i] = d[4 * i + 1]; B[i] = d[4 * i + 2]; }
  const Rb = boxBlur(R, w, h, 1), Gb = boxBlur(G, w, h, 1), Bb = boxBlur(B, w, h, 1);
  const Y = new Float32Array(n), CR = new Float32Array(n), CG = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = Rb[i] + Gb[i] + Bb[i] + 1;
    Y[i] = 0.299 * Rb[i] + 0.587 * Gb[i] + 0.114 * Bb[i];
    CR[i] = Rb[i] / s;
    CG[i] = Gb[i] / s;
  }

  // 紙張參考色：兩條長邊附近的條帶取中位數
  const [m0, m1] = CONFIG.SEG_REF_STRIP_MM.map((v) => Math.round(v * ppm));
  const refCR = [], refCG = [], refY = [];
  for (let y = Math.round(0.1 * h); y < 0.9 * h; y += 2) {
    for (const x0 of [m0, w - m1]) {
      for (let x = x0; x < x0 + (m1 - m0); x += 2) {
        const i = y * w + x;
        refCR.push(CR[i]); refCG.push(CG[i]); refY.push(Y[i]);
      }
    }
  }
  const cr0 = median(refCR), cg0 = median(refCG), y0 = Math.max(1, median(refY));
  const chroma = (i) => Math.hypot(CR[i] - cr0, CG[i] - cg0);

  let coef = fitSurface(Y, w, h, (i) => chroma(i) < CONFIG.SEG_CHROMA_T && Y[i] > 0.6 * y0) || [y0, 0, 0, 0, 0, 0];
  for (let it = 0; it < 2; it++) {
    const c = coef;
    const next = fitSurface(Y, w, h, (i, x, y) =>
      chroma(i) < CONFIG.SEG_CHROMA_T && Y[i] > (1 - CONFIG.SEG_DARK_T / 2) * surfaceAt(c, x, y, w, h));
    if (next) coef = next;
  }

  // 光線是否不均：紙面擬合亮度的最亮 / 最暗
  let surfMin = Infinity, surfMax = -Infinity;
  for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) {
    const v = surfaceAt(coef, x, y, w, h);
    if (v < surfMin) surfMin = v;
    if (v > surfMax) surfMax = v;
  }
  const unevenLight = surfMax / Math.max(1, surfMin) > CONFIG.SEG_UNEVEN_LIGHT;

  // 比紙暗很多（深色襪子），或顏色偏離紙張（皮膚）→ 視為腳。
  // 影子只是變暗的紙，顏色偏離很小；但深影常帶地板反射的暖色，所以越暗的地方要求越大的色差才算皮膚
  let mask = new Uint8Array(n);
  const score = wantDebug ? new Uint8Array(n) : null;
  const margin = Math.round(CONFIG.SEG_EDGE_MARGIN_MM * ppm);
  const darkRel = CONFIG.SEG_CHROMA_DARK_REL;
  const chromaT = (rel) => {
    if (rel >= 0.6) return CONFIG.SEG_CHROMA_T;
    if (rel <= darkRel) return CONFIG.SEG_CHROMA_T_DARK;
    const k = (0.6 - rel) / (0.6 - darkRel);
    return CONFIG.SEG_CHROMA_T + (CONFIG.SEG_CHROMA_T_DARK - CONFIG.SEG_CHROMA_T) * k;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const ref = Math.max(1, surfaceAt(coef, x, y, w, h));
      const rel = Y[i] / ref;
      const dark = 1 - rel;
      const sc = Math.max(dark / CONFIG.SEG_DARK_T, chroma(i) / chromaT(rel));
      const inside = x >= margin && x < w - margin && y >= margin && y < h - margin;
      mask[i] = inside && sc > 1 ? 1 : 0;
      if (score) score[i] = Math.min(255, sc * 127);
    }
  }
  const rawMask = wantDebug ? mask : null;
  mask = open(mask, w, h, Math.max(1, Math.round(CONFIG.SEG_OPEN_MM * ppm)));
  mask = close(mask, w, h, Math.max(1, Math.round(CONFIG.SEG_CLOSE_MM * ppm)));
  mask = fillHoles(mask, w, h);

  const { labels, stats } = labelComponents(mask, w, h);
  const minArea = CONFIG.SEG_MIN_AREA_MM2 * ppm * ppm;
  const big = stats.filter((s) => s.area >= minArea).sort((a, b) => b.area - a.area);
  const debug = wantDebug ? { score, rawMask, paperRef: { cr0, cg0, y0 }, coef } : null;
  if (!big.length) return { mask: null, w, h, ppm, heelSide: null, stat: null, unevenLight, debug };
  const best = big[0];

  // 腳跟判斷：上下兩條短邊內側帶狀區的接觸像素數
  const band = Math.round(CONFIG.SEG_HEEL_BAND_MM * ppm);
  let top = 0, bottom = 0;
  for (let y = margin; y < band; y++) {
    for (let x = 0; x < w; x++) {
      if (labels[y * w + x] === best.label) top++;
      if (labels[(h - 1 - y) * w + x] === best.label) bottom++;
    }
  }
  const minContact = 15 * ppm * (band - margin);
  let heelSide = null;
  if (Math.max(top, bottom) >= minContact) heelSide = bottom >= top ? 'bottom' : 'top';

  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = labels[i] === best.label ? 1 : 0;
  const touchesSides = best.minX <= margin || best.maxX >= w - 1 - margin;
  return { mask: out, w, h, ppm, heelSide, stat: best, contacts: { top, bottom }, touchesSides, unevenLight, debug };
}

// 把分割結果轉 180 度（腳跟在上方時使用），轉完腳跟在下方
export function rotateSeg180(seg) {
  const mask = seg.mask ? Uint8Array.from(seg.mask).reverse() : null;
  const heelSide = seg.heelSide === 'top' ? 'bottom' : seg.heelSide === 'bottom' ? 'top' : null;
  return { ...seg, mask, heelSide };
}
