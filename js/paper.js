// A4 紙偵測與透視校正
import { CONFIG } from './config.js';
import {
  downscale, paperScore, localStd, boxBlur, otsu, open, labelComponents, rowExtremes, sampleMap, warpPerspective,
} from './cv.js';
import {
  convexHull, hullToQuad, polygonArea, assignPaperCorners, estimateAspect,
  robustFitLine, intersectLines, homography, dist,
} from './geometry.js';

export const paperCornersMm = () => [
  { x: 0, y: 0 },
  { x: CONFIG.PAPER_W_MM, y: 0 },
  { x: CONFIG.PAPER_W_MM, y: CONFIG.PAPER_H_MM },
  { x: 0, y: CONFIG.PAPER_H_MM },
];

// 找不到紙時給使用者拖動的預設四角
export function defaultCorners(W, H) {
  return assignPaperCorners([
    { x: 0.2 * W, y: 0.15 * H },
    { x: 0.8 * W, y: 0.15 * H },
    { x: 0.8 * W, y: 0.85 * H },
    { x: 0.2 * W, y: 0.85 * H },
  ]);
}

export function aspectCheck(corners, W, H, tol) {
  const { ratio } = estimateAspect(corners, W, H, CONFIG.DEFAULT_FOCAL_RATIO);
  const err = Math.abs(ratio / Math.SQRT2 - 1);
  return { ratio, err, ok: err <= tol };
}

function evaluateCandidate(labels, w, h, st, sx, sy, W, H, threshold) {
  const pts = rowExtremes(labels, w, st);
  const hull = convexHull(pts);
  if (hull.length < 4) return null;
  const hullArea = polygonArea(hull);
  const hq = hullToQuad(hull);
  if (!hq) return null;
  // 四邊形由支撐線構成，一定包住凸包；quadFit = 凸包佔四邊形的比例，
  // 完整的紙接近 1，一個角被腿遮住約 0.85~0.95，形狀根本不是矩形時會很低
  const quadArea = polygonArea(hq.quad);
  const quadFit = quadArea > 0 ? hullArea / quadArea : 0;
  const fill = st.area / hullArea;
  const corners = assignPaperCorners(hq.quad.map((p) => ({ x: p.x * sx, y: p.y * sy })));
  const minSide = Math.min(...[0, 1, 2, 3].map((i) => dist(corners[i], corners[(i + 1) % 4])));
  if (minSide < 0.08 * Math.max(W, H)) return null;
  // 幾乎等於整個畫面的四邊形，通常是亮色地板和紙連成一片，不採用
  if (polygonArea(corners) > 0.85 * W * H) return null;
  const { ratio, err: aspectErr } = aspectCheck(corners, W, H, 1);
  // 碰到畫面邊緣：紙角被切掉，或和亮色背景連在一起，自動結果不可信
  const touches = st.minX <= 0 || st.minY <= 0 || st.maxX >= w - 1 || st.maxY >= h - 1;
  const score =
    Math.pow(Math.min(1, Math.max(0, (quadFit - 0.55) / 0.35)), 2) *
    Math.max(0, 1 - aspectErr / 0.35) *
    Math.min(1, fill / 0.55) *
    Math.min(1, Math.sqrt(st.area / (0.2 * w * h))) *
    (touches ? 0.3 : 1);
  return { corners, score, quadFit, fill, ratio, aspectErr, touches, threshold, area: st.area, coverage: hq.coverage };
}

// 回傳 { ok, corners:[TL,TR,BR,BL], aspect, candidates, debug }
export function detectPaper(img, wantDebug = false) {
  const { image: small, sx, sy } = downscale(img, CONFIG.DETECT_MAX_SIDE);
  const w = small.width, h = small.height, total = w * h;
  const wmap = paperMap(small);
  const t0 = otsu(wmap);
  // 畫面邊框有多少比例是亮的：紙拍在深色地板上時邊框應該是暗的，大部分都亮代表地板太白
  let borderBright = 0, borderCount = 0;
  const countBorder = (i) => { borderCount++; if (wmap[i] > t0) borderBright++; };
  for (let x = 0; x < w; x++) { countBorder(x); countBorder((h - 1) * w + x); }
  for (let y = 1; y < h - 1; y++) { countBorder(y * w); countBorder(y * w + w - 1); }
  const borderBrightRatio = borderBright / borderCount;
  const candidates = [];
  const tried = new Set();
  let debugMask = null;
  let bigTouching = false; // 有夠大的亮區塊碰到畫面邊緣：紙很可能被切出畫面
  for (const off of CONFIG.PAPER_THRESH_OFFSETS) {
    const t = Math.min(250, t0 + off);
    if (tried.has(t)) continue;
    tried.add(t);
    let mask = new Uint8Array(total);
    for (let i = 0; i < total; i++) mask[i] = wmap[i] > t ? 1 : 0;
    mask = open(mask, w, h, CONFIG.PAPER_OPEN_RADIUS_PX);
    if (wantDebug && !debugMask) debugMask = { mask, w, h, sx, sy };
    const { labels, stats } = labelComponents(mask, w, h);
    for (const st of stats) {
      if (st.area < CONFIG.PAPER_MIN_AREA_RATIO * total) continue;
      if (st.minX <= 0 || st.minY <= 0 || st.maxX >= w - 1 || st.maxY >= h - 1) bigTouching = true;
      const cand = evaluateCandidate(labels, w, h, st, sx, sy, img.width, img.height, t);
      if (cand) candidates.push(cand);
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const debug = wantDebug ? { otsu: t0, borderBrightRatio, mask: debugMask, candidates: candidates.slice(0, 5) } : null;

  if (!best || best.score < CONFIG.PAPER_MIN_SCORE) {
    // 沒有像樣的候選就不給提示位置（corners = null），讓使用者逐點四個角
    const hasHint = best && best.score >= CONFIG.PAPER_MIN_HINT_SCORE;
    // 失敗原因：white_floor 地板太白 / cut_off 紙角沒入鏡（要有像樣的候選才敢這樣說）/ not_found 其他
    let reason = 'not_found';
    if (borderBrightRatio > CONFIG.PAPER_WHITE_FLOOR_BORDER) reason = 'white_floor';
    else if ((hasHint && best.touches) || bigTouching) reason = 'cut_off';
    return { ok: false, corners: hasHint ? best.corners : null, reason, borderBrightRatio, candidates, debug };
  }
  const refined = refineCorners(img, best.corners);
  const asp = aspectCheck(refined.corners, img.width, img.height, CONFIG.PAPER_ASPECT_TOL_AUTO);
  return {
    ok: asp.ok,
    reason: asp.ok ? null : 'aspect',
    corners: refined.corners,
    aspect: asp.ratio,
    refinedSides: refined.refinedSides,
    support: refined.support,
    score: best.score,
    candidates,
    debug,
  };
}

// 紙張分數圖：有顏色、有紋理的地方都壓成 0，只剩平滑無色的區域（紙）
function paperMap(image) {
  const w = image.width, h = image.height;
  const score = paperScore(image, CONFIG.PAPER_CHROMA_PENALTY);
  const std = localStd(image, 2);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = std[i] > CONFIG.PAPER_TEXTURE_STD_MAX ? 0 : score[i];
  return boxBlur(out, w, h, 1);
}

// 在原圖解析度沿每條邊的法線找明暗交界，擬合直線後求交點。
// 回傳 { corners, refinedSides, support }：support 是四條邊各自「找到明暗交界的取樣比例」，
// 四個角真的在紙角上時每條邊都接近 1，圓點亂放時會很低
export function refineCorners(img, corners) {
  const W = img.width, H = img.height;
  const wmap = boxBlur(paperScore(img, CONFIG.PAPER_CHROMA_PENALTY), W, H, 1);
  const support = [];
  const diag = Math.hypot(W, H);
  const search = Math.max(6, Math.round(CONFIG.EDGE_REFINE_SEARCH_RATIO * diag));
  const pad = 3;
  const lines = [];
  let refinedSides = 0;
  for (let i = 0; i < 4; i++) {
    const p = corners[i], q = corners[(i + 1) % 4];
    const len = dist(p, q);
    const dx = (q.x - p.x) / len, dy = (q.y - p.y) / len;
    const ox = dy, oy = -dx; // 順時針排列時的朝外法線
    const pts = [];
    const N = CONFIG.EDGE_REFINE_SAMPLES;
    const prof = new Float32Array(2 * (search + pad) + 1);
    for (let s = 0; s < N; s++) {
      const t = 0.08 + 0.84 * (s / (N - 1));
      const bx = p.x + (q.x - p.x) * t, by = p.y + (q.y - p.y) * t;
      for (let j = -search - pad; j <= search + pad; j++) {
        prof[j + search + pad] = sampleMap(wmap, W, H, bx + ox * j, by + oy * j);
      }
      const S = (j) => {
        const k = j + search + pad;
        return prof[k - 2] + prof[k - 1] - prof[k + 1] - prof[k + 2];
      };
      let bestJ = 0, bestV = -Infinity;
      for (let j = -search; j <= search; j++) {
        const v = S(j);
        if (v > bestV) { bestV = v; bestJ = j; }
      }
      if (bestV < CONFIG.EDGE_REFINE_MIN_CONTRAST * 2) continue;
      const a = S(bestJ - 1), c = S(bestJ + 1);
      const den = a - 2 * bestV + c;
      const delta = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
      pts.push({ x: bx + ox * (bestJ + delta), y: by + oy * (bestJ + delta) });
    }
    support.push(pts.length / N);
    const fit = pts.length >= 8 ? robustFitLine(pts, 1.5, 0.35) : null;
    if (fit) {
      lines.push(fit.line);
      refinedSides++;
    } else {
      const nx = -dy, ny = dx;
      lines.push({ nx, ny, c: nx * p.x + ny * p.y });
    }
  }
  const maxShift = CONFIG.EDGE_REFINE_MAX_SHIFT_RATIO * diag;
  const out = corners.map((orig, i) => {
    const c = intersectLines(lines[(i + 3) % 4], lines[i]);
    return c && dist(c, orig) <= maxShift ? c : orig;
  });
  return { corners: out, refinedSides, support };
}

// 四個角是否真的圍住一張紙：先吸附到邊緣，再看四條邊有多少比例找得到明暗交界
export function checkQuad(img, corners) {
  const refined = refineCorners(img, corners);
  const sorted = [...refined.support].sort((a, b) => a - b);
  const meanSupport = refined.support.reduce((s, v) => s + v, 0) / 4;
  // 腿會蓋掉腳跟那條邊的一部分，所以看平均和「第二差的邊」而不是最差的邊
  const ok = meanSupport >= CONFIG.QUAD_CHECK_MEAN_SUPPORT && sorted[1] >= CONFIG.QUAD_CHECK_SIDE_SUPPORT;
  return { ok, corners: refined.corners, refinedSides: refined.refinedSides, support: refined.support, meanSupport };
}

export function rectify(img, corners, pxPerMm) {
  const H = homography(paperCornersMm(), corners);
  const w = Math.round(CONFIG.PAPER_W_MM * pxPerMm);
  const h = Math.round(CONFIG.PAPER_H_MM * pxPerMm);
  return { image: warpPerspective(img, H, w, h, pxPerMm), H };
}
