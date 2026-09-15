// 幾何工具：線性方程、單應矩陣、凸包、多邊形簡化、直線擬合、A4 長寬比估計。
// 點一律用 {x, y}。

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// 高斯消去（部分主元），A 為 n×n 陣列，回傳解或 null
export function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

// 由 4 組對應點求單應矩陣 H（src → dst），回傳長度 9 的陣列
export function homography(src, dst) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    b.push(v);
  }
  const h = solveLinear(A, b);
  return h ? [...h, 1] : null;
}

export function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
}

export function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) return null;
  const inv = [
    A, -(b * i - c * h), b * f - c * e,
    B, a * i - c * g, -(a * f - c * d),
    C, -(a * h - b * g), a * e - b * d,
  ];
  return inv.map((v) => v / det);
}

const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

// Andrew monotone chain 凸包
export function convexHull(points) {
  const pts = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
  if (pts.length < 3) return pts;
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export function polygonArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
}

// Visvalingam：反覆移除「與相鄰點構成三角形面積最小」的頂點，直到剩 k 個
export function reducePolygon(pts, k) {
  const p = [...pts];
  while (p.length > k) {
    let minA = Infinity, idx = 0;
    for (let i = 0; i < p.length; i++) {
      const a = Math.abs(cross(p[(i - 1 + p.length) % p.length], p[i], p[(i + 1) % p.length]));
      if (a < minA) { minA = a; idx = i; }
    }
    p.splice(idx, 1);
  }
  return p;
}

// 凸包 → 四邊形：用「四條最外側的支撐邊」相交，而不是把凸包縮成四個頂點。
// 紙角被腿或影子遮住時，凸包會少一角，但看得到的邊仍是直線，延長相交就能還原那個角。
// 回傳 { quad, coverage }：coverage 是四條線各自由多長的凸包邊支撐（相對最長邊），0 表示用端點退而求其次
export function hullToQuad(hull) {
  const n = hull.length;
  if (n < 4) return null;
  const edges = [];
  for (let i = 0; i < n; i++) {
    const p = hull[i], q = hull[(i + 1) % n];
    const len = dist(p, q);
    if (len < 1e-6) continue;
    edges.push({ p, q, len, dx: (q.x - p.x) / len, dy: (q.y - p.y) / len });
  }
  if (edges.length < 4) return null;
  const angleDiff = (a, b) => {
    const c = Math.abs(a.dx * b.dx + a.dy * b.dy); // |cos|，方向相反也算同向
    return Math.acos(Math.min(1, c));
  };
  const longest = edges.reduce((m, e) => (e.len > m.len ? e : m));
  const famA = edges.filter((e) => angleDiff(e, longest) < (25 * Math.PI) / 180);
  let famB = edges.filter((e) => { const d = angleDiff(e, longest); return d > (65 * Math.PI) / 180; });
  const longestB = famB.length ? famB.reduce((m, e) => (e.len > m.len ? e : m)) : null;
  if (longestB) famB = edges.filter((e) => angleDiff(e, longestB) < (25 * Math.PI) / 180);
  const dirB = longestB || { dx: -longest.dy, dy: longest.dx, len: 0 };

  // 對某個方向族：沿法線找最外側的兩條邊；太短的邊不可信，改用最外側頂點做一條平行線
  const extremes = (fam, dir, refLen) => {
    const nx = -dir.dy, ny = dir.dx;
    const off = (pt) => pt.x * nx + pt.y * ny;
    const minLen = 0.12 * refLen;
    let lo = null, hi = null;
    for (const e of fam) {
      if (e.len < minLen) continue;
      const o = (off(e.p) + off(e.q)) / 2;
      if (!lo || o < lo.o) lo = { o, e };
      if (!hi || o > hi.o) hi = { o, e };
    }
    const lineOf = (e) => ({ nx: -e.dy, ny: e.dx, c: -e.dy * e.p.x + e.dx * e.p.y });
    const fallback = (pick) => {
      let best = null;
      for (const pt of hull) { const o = off(pt); if (!best || pick(o, best.o)) best = { o, pt }; }
      return { nx, ny, c: off(best.pt) };
    };
    return {
      lo: lo ? lineOf(lo.e) : fallback((o, b) => o < b),
      hi: hi ? lineOf(hi.e) : fallback((o, b) => o > b),
      cov: [lo ? lo.e.len / refLen : 0, hi ? hi.e.len / refLen : 0],
    };
  };
  const A = extremes(famA, longest, longest.len);
  const refB = longestB ? longestB.len : longest.len / Math.SQRT2;
  const B = extremes(famB, dirB, refB);
  const corners = [
    intersectLines(A.lo, B.lo), intersectLines(B.lo, A.hi),
    intersectLines(A.hi, B.hi), intersectLines(B.hi, A.lo),
  ];
  if (corners.some((c) => !c)) return null;
  return { quad: assignPaperCorners(corners), coverage: [...A.cov, ...B.cov] };
}

// 依重心角度排序；螢幕座標 y 向下，角度遞增即畫面上的順時針
export function orderClockwise(pts) {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
}

export const rotateCorners = (c, k) => c.map((_, i) => c[(i + k) % 4]);

// 四個角排成 [TL, TR, BR, BL]，第一條邊（TL→TR）是短邊，且盡量是畫面上方那條
export function assignPaperCorners(pts) {
  const c = orderClockwise(pts);
  const s0 = dist(c[0], c[1]) + dist(c[2], c[3]);
  const s1 = dist(c[1], c[2]) + dist(c[3], c[0]);
  const start = s0 <= s1 ? 0 : 1;
  const r1 = rotateCorners(c, start);
  const r2 = rotateCorners(c, start + 2);
  const midY = (q) => (q[0].y + q[1].y) / 2;
  return midY(r1) <= midY(r2) ? r1 : r2;
}

// 總最小平方直線擬合，回傳法線式 nx*x + ny*y = c（n 為單位向量）
export function fitLine(points) {
  const n = points.length;
  if (n < 2) return null;
  let mx = 0, my = 0;
  for (const p of points) { mx += p.x; my += p.y; }
  mx /= n; my /= n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of points) {
    const dx = p.x - mx, dy = p.y - my;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const t = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const dx = Math.cos(t), dy = Math.sin(t);
  const nx = -dy, ny = dx;
  return { nx, ny, c: nx * mx + ny * my, dx, dy };
}

// 迭代剔除離群點的直線擬合
export function robustFitLine(points, tol = 1.5, minInlierRatio = 0.35) {
  let pts = points;
  let line = fitLine(pts);
  for (let it = 0; it < 3 && line; it++) {
    const res = points.map((p) => Math.abs(line.nx * p.x + line.ny * p.y - line.c));
    const sorted = [...res].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)] || 0;
    const th = Math.max(tol, 2.5 * med);
    pts = points.filter((_, i) => res[i] <= th);
    if (pts.length < Math.max(3, points.length * minInlierRatio)) return null;
    line = fitLine(pts);
  }
  return line ? { line, inliers: pts.length } : null;
}

export function intersectLines(l1, l2) {
  const det = l1.nx * l2.ny - l1.ny * l2.nx;
  if (Math.abs(det) < 1e-9) return null;
  return {
    x: (l1.c * l2.ny - l1.ny * l2.c) / det,
    y: (l1.nx * l2.c - l1.c * l2.nx) / det,
  };
}

// 由影像中的四角（[TL,TR,BR,BL]，TL→TR 為短邊）估計紙張真實長寬比（長/短）。
// 方法：Zhang & He (2007) 單張影像矩形長寬比估計，主點假設在影像中心。
export function estimateAspect(corners, imgW, imgH, focalRatio = 0.75) {
  const cx = imgW / 2, cy = imgH / 2;
  const hv = (p) => [p.x - cx, p.y - cy, 1];
  const m1 = hv(corners[0]), m2 = hv(corners[1]), m3 = hv(corners[3]), m4 = hv(corners[2]);
  const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dt = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const c14 = cr(m1, m4);
  const k2 = dt(c14, m3) / dt(cr(m2, m4), m3);
  const k3 = dt(c14, m2) / dt(cr(m3, m4), m2);
  const n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 * m2[2] - m1[2]];
  const n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 * m3[2] - m1[2]];
  const maxSide = Math.max(imgW, imgH);
  const f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]);
  let focal = focalRatio * maxSide;
  let usedDefault = true;
  if (Number.isFinite(f2) && f2 > 0) {
    const f = Math.sqrt(f2);
    if (f > 0.3 * maxSide && f < 3 * maxSide) { focal = f; usedDefault = false; }
  }
  const len = (n) => Math.sqrt((n[0] * n[0] + n[1] * n[1]) / (focal * focal) + n[2] * n[2]);
  const wLen = len(n2), hLen = len(n3);
  return { ratio: hLen / wLen, focal, usedDefault };
}
