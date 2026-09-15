// 影像基本運算。影像格式為 {width, height, data}（與 ImageData 相容）。
// 連續座標慣例：像素 (i, j) 的中心在 (i + 0.5, j + 0.5)。

export function createImage(w, h) {
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
}

// 面積平均縮圖，回傳縮圖與 x/y 放大倍率（縮圖座標 × 倍率 = 原圖座標）
export function downscale(img, maxSide) {
  const { width: W, height: H, data } = img;
  const s = Math.max(W, H) / maxSide;
  if (s <= 1) return { image: img, sx: 1, sy: 1 };
  const w = Math.max(1, Math.round(W / s));
  const h = Math.max(1, Math.round(H / s));
  const out = createImage(w, h);
  const sx = W / w, sy = H / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(H, Math.floor((y + 1) * sy)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.min(W, Math.floor((x + 1) * sx)));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * W + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) {
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
        }
      }
      const o = (y * w + x) * 4;
      out.data[o] = r / n; out.data[o + 1] = g / n; out.data[o + 2] = b / n; out.data[o + 3] = 255;
    }
  }
  return { image: out, sx, sy };
}

// 白度 = min(R, G, B)：只有「亮且不帶顏色」的像素才會高
export function whiteness(img) {
  const { data } = img;
  const out = new Uint8Array(img.width * img.height);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    out[j] = r < g ? (r < b ? r : b) : (g < b ? g : b);
  }
  return out;
}

// 可分離方框模糊（邊緣延伸），回傳 Float32Array
export function boxBlur(src, w, h, r) {
  const out = new Float32Array(w * h);
  if (r <= 0) { out.set(src); return out; }
  const tmp = new Float32Array(w * h);
  const k = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0;
    for (let x = -r; x <= r; x++) s += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = s / k;
      s += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / k;
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

// Otsu 自動門檻（值域 0~255），mask 可選
export function otsu(values, mask) {
  const hist = new Float64Array(256);
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    if (mask && !mask[i]) continue;
    hist[Math.max(0, Math.min(255, Math.round(values[i])))]++;
    n++;
  }
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = -1, th = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; th = t; }
  }
  return th;
}

// 二值形態學（視窗超出影像的部分忽略）
function morphPass(src, w, h, r, dilate, horizontal) {
  const out = new Uint8Array(w * h);
  const outer = horizontal ? h : w;
  const inner = horizontal ? w : h;
  const step = horizontal ? 1 : w;
  for (let a = 0; a < outer; a++) {
    const base = horizontal ? a * w : a;
    let s = 0;
    for (let b = 0; b <= Math.min(r, inner - 1); b++) s += src[base + b * step];
    for (let b = 0; b < inner; b++) {
      const lo = b - r < 0 ? 0 : b - r;
      const hi = b + r > inner - 1 ? inner - 1 : b + r;
      const n = hi - lo + 1;
      out[base + b * step] = dilate ? (s > 0 ? 1 : 0) : (s === n ? 1 : 0);
      if (b + r + 1 < inner) s += src[base + (b + r + 1) * step];
      if (b - r >= 0) s -= src[base + (b - r) * step];
    }
  }
  return out;
}

export const dilate = (m, w, h, r) => (r > 0 ? morphPass(morphPass(m, w, h, r, true, true), w, h, r, true, false) : m);
export const erode = (m, w, h, r) => (r > 0 ? morphPass(morphPass(m, w, h, r, false, true), w, h, r, false, false) : m);
export const open = (m, w, h, r) => dilate(erode(m, w, h, r), w, h, r);
export const close = (m, w, h, r) => erode(dilate(m, w, h, r), w, h, r);

// 4 連通元件標記
export function labelComponents(mask, w, h) {
  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const stats = [];
  let next = 0;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || labels[i]) continue;
    next++;
    let sp = 0;
    stack[sp++] = i;
    labels[i] = next;
    let area = 0, minX = w, maxX = 0, minY = h, maxY = 0;
    while (sp) {
      const p = stack[--sp];
      area++;
      const x = p % w, y = (p / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && mask[p - 1] && !labels[p - 1]) { labels[p - 1] = next; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !labels[p + 1]) { labels[p + 1] = next; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] && !labels[p - w]) { labels[p - w] = next; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] && !labels[p + w]) { labels[p + w] = next; stack[sp++] = p + w; }
    }
    stats.push({ label: next, area, minX, maxX, minY, maxY });
  }
  return { labels, stats };
}

// 補洞：沒有碰到影像邊界的背景區塊填成前景
export function fillHoles(mask, w, h) {
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1;
  const { labels, stats } = labelComponents(inv, w, h);
  const hole = new Uint8Array(stats.length + 1);
  for (const s of stats) {
    if (s.minX > 0 && s.minY > 0 && s.maxX < w - 1 && s.maxY < h - 1) hole[s.label] = 1;
  }
  const out = new Uint8Array(mask);
  for (let i = 0; i < out.length; i++) if (labels[i] && hole[labels[i]]) out[i] = 1;
  return out;
}

// 取某元件每一列最左、最右的邊界點（算凸包用）
export function rowExtremes(labels, w, stat) {
  const pts = [];
  for (let y = stat.minY; y <= stat.maxY; y++) {
    const row = y * w;
    let l = -1, r = -1;
    for (let x = stat.minX; x <= stat.maxX; x++) if (labels[row + x] === stat.label) { l = x; break; }
    if (l < 0) continue;
    for (let x = stat.maxX; x >= l; x--) if (labels[row + x] === stat.label) { r = x; break; }
    pts.push({ x: l, y: y + 0.5 }, { x: r + 1, y: y + 0.5 });
  }
  return pts;
}

// 單通道圖雙線性取樣（連續座標）
export function sampleMap(map, w, h, x, y) {
  x = Math.min(w - 1, Math.max(0, x - 0.5));
  y = Math.min(h - 1, Math.max(0, y - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const a = map[y0 * w + x0] * (1 - fx) + map[y0 * w + x1] * fx;
  const b = map[y1 * w + x0] * (1 - fx) + map[y1 * w + x1] * fx;
  return a * (1 - fy) + b * fy;
}

// 透視校正：H 為「紙張 mm → 原圖連續座標」，輸出 outW×outH，每 mm pxPerMm 像素
export function warpPerspective(src, H, outW, outH, pxPerMm) {
  const out = createImage(outW, outH);
  const { width: W, height: Hh, data } = src;
  const o = out.data;
  for (let v = 0; v < outH; v++) {
    const my = (v + 0.5) / pxPerMm;
    for (let u = 0; u < outW; u++) {
      const mx = (u + 0.5) / pxPerMm;
      const ww = H[6] * mx + H[7] * my + H[8];
      let x = (H[0] * mx + H[1] * my + H[2]) / ww - 0.5;
      let y = (H[3] * mx + H[4] * my + H[5]) / ww - 0.5;
      x = x < 0 ? 0 : x > W - 1 ? W - 1 : x;
      y = y < 0 ? 0 : y > Hh - 1 ? Hh - 1 : y;
      const x0 = x | 0, y0 = y | 0;
      const x1 = x0 + 1 < W ? x0 + 1 : x0, y1 = y0 + 1 < Hh ? y0 + 1 : y0;
      const fx = x - x0, fy = y - y0;
      const i00 = (y0 * W + x0) * 4, i10 = (y0 * W + x1) * 4;
      const i01 = (y1 * W + x0) * 4, i11 = (y1 * W + x1) * 4;
      const k = (v * outW + u) * 4;
      for (let c = 0; c < 3; c++) {
        const a = data[i00 + c] + (data[i10 + c] - data[i00 + c]) * fx;
        const b = data[i01 + c] + (data[i11 + c] - data[i01 + c]) * fx;
        o[k + c] = a + (b - a) * fy;
      }
      o[k + 3] = 255;
    }
  }
  return out;
}
