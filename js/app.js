// 流程控制：引導卡片 → 拍照 → （有問題就引導重拍）→ 確認紙角 → 確認腳 → 結果
import { CONFIG } from './config.js';
import { loadImageFile, imageToCanvas, maskToCanvas, grayToCanvas } from './image.js';
import { detectPaper, rectify, aspectCheck, defaultCorners } from './paper.js';
import { assignPaperCorners, dist } from './geometry.js';
import { measureFromCorners } from './pipeline.js';
import { computeMeasurements, measurementConfidence, sanityCheck } from './measure.js';
import { loadChart, recommend, cm } from './sizing.js';
import { PointEditor } from './ui-adjust.js';
import { ISSUES, footIssue } from './guidance.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.get('debug') === '1';
const SKU = params.get('sku');
const BACK_URL = safeUrl(params.get('back'));
const STEP_ORDER = ['guide', 'photo', 'confirm', 'result'];
const COLORS = { heel: '#2F80ED', toe: '#F2994A', width: '#27AE60', paper: '#FF5353' };
const CARD_COUNT = 4;

const state = {
  chart: null,
  card: 0,
  photo: null,
  photoCanvas: null,
  detection: null,
  corners: null,
  autoCorners: false,
  seg: null,
  flags: null,
  rectCanvas: null,
  editor: null,
  feet: [], // 已量過的腳（最多兩隻）
};

const $ = (id) => document.getElementById(id);

function safeUrl(v) {
  if (!v) return null;
  try {
    const u = new URL(v, location.href);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => { s.hidden = s.id !== id; });
  const idx = STEP_ORDER.indexOf($(id).dataset.step);
  $('steps').hidden = idx < 0;
  document.querySelectorAll('#steps li').forEach((li) => {
    const i = STEP_ORDER.indexOf(li.dataset.step);
    li.classList.toggle('active', i === idx);
    li.classList.toggle('done', idx >= 0 && i < idx);
  });
  window.scrollTo(0, 0);
}

function showCard(i) {
  state.card = Math.max(0, Math.min(CARD_COUNT - 1, i));
  document.querySelectorAll('#screen-intro .card').forEach((c) => { c.hidden = Number(c.dataset.card) !== state.card; });
  showScreen('screen-intro');
}

function showProcessing(text) {
  $('processing-text').textContent = text;
  showScreen('screen-processing');
}

function showError(title, message) {
  $('error-title').textContent = title;
  $('error-message').textContent = message;
  showScreen('screen-error');
}

// 拍完照發現問題：一句原因、一句怎麼修、錯與對的示意圖
function showFeedback(issueKey, onContinue) {
  const issue = ISSUES[issueKey] || ISSUES.not_found;
  $('feedback-illus').innerHTML = issue.svg;
  $('feedback-title').textContent = issue.title;
  $('feedback-fix').textContent = issue.fix;
  const btn = $('btn-feedback-continue');
  btn.textContent = issue.kind === 'paper' ? '不用重拍，我自己標出紙角' : '不用重拍，我自己調整位置';
  btn.onclick = onContinue;
  showScreen('screen-feedback');
}

function destroyEditor() {
  if (state.editor) state.editor.destroy();
  state.editor = null;
}

// ---------- 拍照 / 讀檔 ----------

async function handleFile(file) {
  if (!file) return;
  destroyEditor();
  showProcessing('正在讀取照片…');
  await nextFrame();
  try {
    const { image, canvas } = await loadImageFile(file);
    state.photo = image;
    state.photoCanvas = canvas;
  } catch (e) {
    console.error(e);
    showError('照片讀不出來', '這張照片的格式可能不支援。請重拍一張，或改用直接輸入腳長腳寬。');
    return;
  }
  showProcessing('正在找紙的四個角…');
  await nextFrame();
  let det;
  try {
    det = detectPaper(state.photo, DEBUG);
  } catch (e) {
    console.error(e);
    det = { ok: false, reason: 'not_found', corners: defaultCorners(state.photo.width, state.photo.height) };
  }
  state.detection = det;
  if (det.ok) showCorners(det.corners);
  else showFeedback(det.reason, () => showCorners(det.corners));
}

// ---------- 確認紙角 ----------

function showCorners(corners) {
  showScreen('screen-corners');
  const det = state.detection;
  const hint = $('corners-hint');
  hint.classList.toggle('strong', !det.ok);
  hint.textContent = det.ok
    ? '沒對準的話，用手指把圓點拖到紙角。'
    : '請把四個圓點拖到紙的四個角，也可以直接點紙角。';
  $('corners-warn').hidden = true;
  destroyEditor();
  state.editor = new PointEditor($('corners-stage'), {
    source: state.photoCanvas,
    points: corners.map((c, i) => ({ id: `c${i}`, x: c.x, y: c.y, color: COLORS.paper })),
    units: 1,
    tapToMove: true,
    drawOverlay: drawCornerOverlay,
    onChange: () => { $('corners-warn').hidden = true; },
  });
  if (DEBUG) renderCornerDebug();
}

function drawCornerOverlay(ctx, toScreen, pts) {
  const q = assignPaperCorners(pts).map(toScreen);
  ctx.beginPath();
  q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,83,83,.14)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLORS.paper;
  ctx.stroke();
}

async function confirmCorners() {
  const corners = assignPaperCorners(state.editor.getPoints().map((p) => ({ x: p.x, y: p.y })));
  const warn = $('corners-warn');
  const asp = aspectCheck(corners, state.photo.width, state.photo.height, CONFIG.PAPER_ASPECT_TOL_MANUAL);
  if (!asp.ok && warn.hidden) {
    warn.textContent = `四個圓點圍出來的形狀不像 A4 紙（長寬比 ${asp.ratio.toFixed(2)}，A4 是 1.41）。確認圓點都在紙角上，沒問題再按一次。`;
    warn.hidden = false;
    return;
  }
  const det = state.detection;
  const moved = !det.ok || corners.some((c) => Math.min(...det.corners.map((d) => dist(c, d))) > 3);
  state.autoCorners = det.ok && !moved;

  destroyEditor();
  showProcessing('正在量腳…');
  await nextFrame();
  let r;
  try {
    r = measureFromCorners(state.photo, corners, DEBUG);
    state.corners = r.corners;
    state.seg = r.seg;
    state.flags = r.flags;
    state.rectCanvas = imageToCanvas(rectify(state.photo, r.corners, CONFIG.RECT_PX_PER_MM).image);
  } catch (e) {
    console.error(e);
    showError('量測失敗', '處理照片時發生錯誤。請重拍一張，或改用直接輸入腳長腳寬。');
    return;
  }
  const issue = footIssue(r.flags);
  const go = () => {
    showFoot(r.markers);
    if (DEBUG) renderFootDebug(r.segRect, r.flip);
  };
  if (issue) showFeedback(issue, go);
  else go();
}

// ---------- 確認腳 ----------

function markersFromPoints(pts) {
  const m = {};
  for (const p of pts) m[p.id] = { x: p.x, y: p.y };
  return m;
}

function showFoot(markers) {
  showScreen('screen-foot');
  $('foot-warn').hidden = true;
  destroyEditor();
  state.editor = new PointEditor($('foot-stage'), {
    source: state.rectCanvas,
    points: [
      { id: 'heel', label: '腳跟', color: COLORS.heel, ...markers.heel },
      { id: 'toe', label: '腳尖', color: COLORS.toe, ...markers.toe },
      { id: 'left', label: '寬', color: COLORS.width, ...markers.left },
      { id: 'right', label: '寬', color: COLORS.width, ...markers.right },
    ],
    units: CONFIG.RECT_PX_PER_MM,
    drawOverlay: drawFootOverlay,
    onChange: (pts) => {
      $('foot-warn').hidden = true;
      updateFootLive(pts);
    },
  });
  const m = updateFootLive(state.editor.getPoints());
  const conf = measurementConfidence({ autoCorners: state.autoCorners, flags: state.flags, ...m });
  const low = conf < CONFIG.CONFIDENCE_CONFIRM || !state.flags.heelAligned;
  const hint = $('foot-hint');
  hint.classList.toggle('strong', low);
  if (state.flags.noFoot) hint.textContent = '沒找到腳的位置，請把圓點拖到腳跟、腳尖和腳掌最寬處。';
  else if (!state.flags.heelAligned) hint.textContent = '腳跟沒有貼齊紙邊，請確認藍色圓點在腳跟最後面。';
  else if (low) hint.textContent = '這張不太確定，請仔細看圓點有沒有對準，沒對準就拖過去。';
  else hint.textContent = '沒對準的話，用手指拖過去。';
}

function updateFootLive(pts) {
  const m = computeMeasurements(markersFromPoints(pts));
  $('foot-live').textContent = `腳長 ${cm(m.lengthMm)}・腳寬 ${cm(m.widthMm)}`;
  return m;
}

function drawFootOverlay(ctx, toScreen, pts) {
  const mk = markersFromPoints(pts);
  const { heel, toe, left, right } = mk;
  const { ux, uy, nx, ny } = computeMeasurements(mk).axis;
  const line = (a, b, color, width = 2, dash = []) => {
    const p = toScreen(a), q = toScreen(b);
    ctx.beginPath();
    ctx.setLineDash(dash);
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.setLineDash([]);
  };
  line({ x: 0, y: heel.y }, { x: CONFIG.PAPER_W_MM, y: heel.y }, COLORS.heel, 2, [6, 4]);
  line(heel, toe, COLORS.toe, 1.5, [4, 4]);
  line({ x: toe.x - nx * 30, y: toe.y - ny * 30 }, { x: toe.x + nx * 30, y: toe.y + ny * 30 }, COLORS.toe, 2.5);
  for (const p of [left, right]) {
    line({ x: p.x - ux * 35, y: p.y - uy * 35 }, { x: p.x + ux * 35, y: p.y + uy * 35 }, COLORS.width, 2.5);
  }
  const t = (right.x - left.x) * nx + (right.y - left.y) * ny;
  line(left, { x: left.x + nx * t, y: left.y + ny * t }, COLORS.width, 1.5, [4, 3]);
}

function confirmFoot() {
  const m = computeMeasurements(markersFromPoints(state.editor.getPoints()));
  const warn = $('foot-warn');
  const s = sanityCheck(m);
  if (!s.ok && warn.hidden) {
    warn.textContent = s.field === 'length'
      ? `量到的腳長 ${cm(m.lengthMm)} 不太合理，可能紙角沒對準，或不是 A4 紙。確認圓點位置，沒問題再按一次。`
      : `量到的腳寬 ${cm(m.widthMm)} 不太合理，確認兩個綠色圓點在腳掌最寬處，沒問題再按一次。`;
    warn.hidden = false;
    return;
  }
  destroyEditor();
  state.feet = [...state.feet, { lengthMm: m.lengthMm, widthMm: m.widthMm }].slice(-2);
  const lengthMm = Math.max(...state.feet.map((f) => f.lengthMm));
  const widthMm = Math.max(...state.feet.map((f) => f.widthMm));
  showResult(lengthMm, widthMm, state.feet);
}

// ---------- 結果 ----------

function showResult(lengthMm, widthMm, feet = []) {
  showScreen('screen-result');
  $('result-length').textContent = cm(lengthMm);
  $('result-width').textContent = Number.isFinite(widthMm) ? cm(widthMm) : '未提供';
  const list = $('result-details');
  list.innerHTML = '';
  const addDetail = (text) => {
    const li = document.createElement('li');
    li.textContent = text;
    list.appendChild(li);
  };
  if (feet.length === 2) {
    addDetail(`已量兩隻腳（腳長 ${cm(feet[0].lengthMm)}、${cm(feet[1].lengthMm)}），用比較大的那隻判斷。`);
  }
  $('btn-restart').textContent = feet.length === 1 ? '量另一隻腳' : '重新量';

  const tbody = $('result-table');
  tbody.innerHTML = '';
  const chart = state.chart;
  $('result-product').hidden = !chart;
  if (!chart) {
    $('result-headline').textContent = '量好了';
    addDetail(SKU ? '找不到這個商品的尺碼表，請回商品頁對照尺碼表選購。' : '沒有指定商品，請回商品頁對照尺碼表選購。');
    $('result-table-wrap').hidden = true;
    return;
  }
  $('result-product').textContent = chart.name || '';
  const rec = recommend(chart, lengthMm, widthMm);
  $('result-headline').textContent = rec.headline;
  rec.details.forEach(addDetail);
  if (chart.verified === false) addDetail('（測試中）這個商品的尺碼區間還沒確認，實際請以商品頁說明為準。');
  if (!Number.isFinite(widthMm) && chart.width_rule && chart.width_rule.enabled) {
    addDetail('沒有提供腳寬，只用腳長判斷。腳掌偏寬的話建議選大一號。');
  }
  const hasDims = chart.sizes.some((s) => Number.isFinite(s.shoe_length) || Number.isFinite(s.shoe_width));
  $('result-table-wrap').classList.toggle('no-shoe-dims', !hasDims);
  for (const s of [...chart.sizes].sort((a, b) => a.foot_min - b.foot_min)) {
    const tr = document.createElement('tr');
    if (s === rec.primary) tr.className = 'is-primary';
    else if (s === rec.alternative) tr.className = 'is-alt';
    const cells = [
      s.label,
      `${(s.foot_min / 10).toFixed(1)}~${(s.foot_max / 10).toFixed(1)}`,
      Number.isFinite(s.shoe_length) ? (s.shoe_length / 10).toFixed(1) : '-',
      Number.isFinite(s.shoe_width) ? (s.shoe_width / 10).toFixed(1) : '-',
    ];
    for (const c of cells) {
      const td = document.createElement('td');
      td.textContent = c;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  $('result-table-wrap').hidden = false;
}

// ---------- 手動輸入 ----------

function submitManual(e) {
  e.preventDefault();
  const L = parseFloat($('manual-length').value);
  const Wraw = $('manual-width').value.trim();
  const W = Wraw ? parseFloat(Wraw) : NaN;
  const warn = $('manual-warn');
  if (!Number.isFinite(L) || L < 15 || L > 32) {
    warn.textContent = '請輸入 15 到 32 之間的腳長（單位 cm）。';
    warn.hidden = false;
    return;
  }
  if (Wraw && (!Number.isFinite(W) || W < 6 || W > 14)) {
    warn.textContent = '腳寬請輸入 6 到 14 之間的數字（單位 cm），不確定可以不填。';
    warn.hidden = false;
    return;
  }
  warn.hidden = true;
  state.feet = [];
  showResult(L * 10, Number.isFinite(W) ? W * 10 : NaN);
}

// ---------- 除錯畫面（?debug=1） ----------

function appendCanvas(host, canvas, caption) {
  const p = document.createElement('p');
  p.textContent = caption;
  host.append(p, canvas);
}

function renderCornerDebug() {
  const host = $('corners-debug');
  host.innerHTML = '';
  const det = state.detection;
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify({
    ok: det.ok, reason: det.reason, aspect: det.aspect, refinedSides: det.refinedSides, score: det.score,
    otsu: det.debug && det.debug.otsu, borderBright: det.debug && det.debug.borderBrightRatio,
    candidates: (det.candidates || []).slice(0, 5).map((c) => ({
      score: +c.score.toFixed(3), ratio: +c.ratio.toFixed(3), quadFit: +c.quadFit.toFixed(3),
      fill: +c.fill.toFixed(3), touches: c.touches, threshold: c.threshold,
    })),
    photo: [state.photo.width, state.photo.height],
  }, null, 1);
  host.appendChild(pre);
  if (det.debug && det.debug.mask) {
    const { mask, w, h } = det.debug.mask;
    appendCanvas(host, maskToCanvas(mask, w, h, [255, 255, 255, 255]), '白度門檻遮罩（Otsu）');
  }
}

function renderFootDebug(segRect, flip) {
  const host = $('foot-debug');
  host.innerHTML = '';
  const seg = state.seg;
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify({
    heelSide: seg.heelSide, flipped: flip, contacts: seg.contacts, touchesSides: seg.touchesSides,
    flags: state.flags, paperRef: seg.debug && seg.debug.paperRef,
  }, null, 1);
  host.appendChild(pre);
  appendCanvas(host, imageToCanvas(segRect), '分割用校正圖（翻轉前）');
  if (seg.debug && seg.debug.score) appendCanvas(host, grayToCanvas(seg.debug.score, seg.w, seg.h), '腳部分數（越亮越像腳，127 為門檻）');
  if (seg.debug && seg.debug.rawMask) appendCanvas(host, maskToCanvas(seg.debug.rawMask, seg.w, seg.h), '門檻後原始遮罩（翻轉前）');
  if (seg.mask) appendCanvas(host, maskToCanvas(seg.mask, seg.w, seg.h), '最終腳部遮罩（腳跟在下）');
}

// ---------- 初始化 ----------

function init() {
  document.querySelectorAll('[data-file-input]').forEach((input) => {
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      input.value = '';
      handleFile(file);
    });
  });
  document.querySelectorAll('[data-next]').forEach((b) => b.addEventListener('click', () => showCard(state.card + 1)));
  document.querySelectorAll('[data-prev]').forEach((b) => b.addEventListener('click', () => showCard(state.card - 1)));
  document.querySelectorAll('[data-go-manual]').forEach((b) => b.addEventListener('click', () => showScreen('screen-manual')));
  $('btn-manual-back').addEventListener('click', () => showCard(state.card));
  $('manual-form').addEventListener('submit', submitManual);
  $('btn-corners-next').addEventListener('click', confirmCorners);
  $('btn-foot-next').addEventListener('click', confirmFoot);
  $('btn-foot-back').addEventListener('click', () => {
    if (state.photo && state.corners) showCorners(state.corners);
  });
  $('btn-restart').addEventListener('click', () => {
    destroyEditor();
    if (state.feet.length !== 1) state.feet = [];
    showCard(3); // 已經準備好了，直接回到拍照那張
  });
  if (BACK_URL) {
    const a = $('btn-back-product');
    a.href = BACK_URL;
    a.hidden = false;
  }
  if (DEBUG) document.querySelectorAll('[data-debug]').forEach((d) => { d.hidden = false; d.open = true; });

  loadChart(SKU).then((chart) => {
    state.chart = chart;
    if (chart) {
      const el = $('product-name');
      el.textContent = `正在幫「${chart.name}」選尺碼`;
      el.hidden = false;
    }
  });
  showCard(0);
}

init();
