// 流程：尺碼表（輸入資料或拍照測腳長）→ 拍照引導 → 拍照 → 自動量測（有問題就引導重拍）→ 結果
// 不提供人工拖點修正：量測結果在結果頁用縮圖呈現，看起來不對就重拍
import { CONFIG } from './config.js';
import { loadImageFile, imageToCanvas, maskToCanvas, grayToCanvas } from './image.js';
import { detectPaper, rectify } from './paper.js';
import { measureFromCorners } from './pipeline.js';
import { sanityCheck } from './measure.js';
import { loadChart, loadCatalog, recommend, cm } from './sizing.js';
import { ISSUES, footIssue } from './guidance.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.get('debug') === '1';
const SKU = params.get('sku');
const BACK_URL = safeUrl(params.get('back'));
// 嵌在商品頁的 iframe 裡：不顯示標題列和「回商品頁」（本來就在商品頁上），連結開在整個頁面
const EMBED = params.get('embed') === '1';
const CARD_COUNT = 4;
const COLORS = { heel: '#2F80ED', toe: '#F2994A', width: '#27AE60' };

const state = {
  chart: null,       // 網址指定的商品尺碼表
  catalog: [],       // 沒指定商品時的全部商品
  chartLoaded: false,
  card: 0,
  feet: [],          // 拍照量過的腳（最多兩隻）
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

// 讓「處理中」畫面先畫出來再開始運算；畫面暫停繪製時（背景分頁等）用逾時備援，不會卡住
const nextFrame = () => new Promise((resolve) => {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    setTimeout(resolve, 30);
  };
  requestAnimationFrame(finish);
  setTimeout(finish, 150);
});

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => { s.hidden = s.id !== id; });
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

// ---------- 尺碼表 ----------

const introChart = () => state.chart || state.catalog[0] || null;

// 腳寬規則是「腳寬 ≥ 鞋寬就大一號」，所以適合腳寬是鞋寬少 0.1 cm 以下
function widthLimitText(chart, s) {
  if (!chart.width_rule || !chart.width_rule.enabled || !Number.isFinite(s.shoe_width)) return null;
  return `${((s.shoe_width - 1) / 10).toFixed(1)} 以下`;
}

function fillChartTable(tbody, wrap, chart, rec) {
  tbody.innerHTML = '';
  const hasWidth = chart.sizes.some((s) => widthLimitText(chart, s));
  wrap.classList.toggle('no-width', !hasWidth);
  for (const s of [...chart.sizes].sort((a, b) => a.foot_min - b.foot_min)) {
    const tr = document.createElement('tr');
    if (rec && s === rec.primary) tr.className = 'is-primary';
    else if (rec && s === rec.alternative) tr.className = 'is-alt';
    const cells = [s.label, `${(s.foot_min / 10).toFixed(1)}~${(s.foot_max / 10).toFixed(1)}`, widthLimitText(chart, s) || '-'];
    for (const text of cells) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  wrap.hidden = false;
}

function renderIntro() {
  const chart = introChart();
  $('intro-product').hidden = !chart;
  $('intro-chart-note').hidden = !chart;
  $('intro-fallback-title').hidden = !!chart || !state.chartLoaded;
  if (!chart) {
    $('intro-chart').hidden = true;
    return;
  }
  $('intro-product-name').textContent = chart.family_name || chart.name;
  const img = $('intro-product-img');
  if (chart.image) {
    img.src = chart.image;
    img.hidden = false;
  } else {
    img.hidden = true;
  }
  fillChartTable($('intro-chart-body'), $('intro-chart'), chart, null);
}

// ---------- 拍照 → 自動量測 ----------

async function handleFile(file) {
  if (!file) return;
  showProcessing('正在讀取照片…');
  await nextFrame();
  let photo;
  try {
    photo = (await loadImageFile(file)).image;
  } catch (e) {
    console.error(e);
    showError('照片讀不出來', '這張照片的格式可能不支援。請重拍一張，或改用輸入資料。');
    return;
  }
  showProcessing('正在量腳…');
  await nextFrame();

  let det;
  try {
    det = detectPaper(photo, DEBUG);
  } catch (e) {
    console.error(e);
    det = { ok: false, reason: 'not_found', corners: null };
  }
  if (!det.ok) {
    showFeedback(det.reason, null, { photo, det });
    return;
  }

  let r;
  try {
    r = measureFromCorners(photo, det.corners, DEBUG);
  } catch (e) {
    console.error(e);
    showError('量測失敗', '處理照片時發生錯誤。請重拍一張，或改用輸入資料。');
    return;
  }
  const issue = footIssue(r.flags) || (sanityCheck(r.measurement).ok ? null : 'bad_measure');
  const go = () => showPhotoResult(photo, det, r);
  if (issue) showFeedback(issue, ISSUES[issue] && ISSUES[issue].soft ? go : null, { photo, det, r });
  else go();
}

// 照片有問題：一句原因、一句怎麼修、錯與對的示意圖。輕微問題可以選「仍然看結果」
function showFeedback(issueKey, onContinue, ctx) {
  const issue = ISSUES[issueKey] || ISSUES.not_found;
  $('feedback-illus').innerHTML = issue.svg;
  $('feedback-title').textContent = issue.title;
  $('feedback-fix').textContent = issue.fix;
  const btn = $('btn-feedback-continue');
  btn.hidden = !onContinue;
  btn.onclick = onContinue;
  showScreen('screen-feedback');
  if (DEBUG && ctx) renderDebug($('feedback-debug'), ctx);
}

// 結果頁的縮圖：校正後的紙、紅色是量到的腳、橘線腳尖、綠線腳掌最寬處
function drawPreview(photo, r) {
  const ppm = 2.5;
  const canvas = imageToCanvas(rectify(photo, r.corners, ppm).image);
  const ctx = canvas.getContext('2d');
  if (r.seg.mask) ctx.drawImage(maskToCanvas(r.seg.mask, r.seg.w, r.seg.h, [255, 83, 83, 90]), 0, 0, canvas.width, canvas.height);
  const { heel, toe, left, right } = r.markers;
  const { ux, uy, nx, ny } = r.measurement.axis;
  const line = (a, b, color, dash = []) => {
    ctx.beginPath();
    ctx.setLineDash(dash);
    ctx.moveTo(a.x * ppm, a.y * ppm);
    ctx.lineTo(b.x * ppm, b.y * ppm);
    ctx.lineWidth = 6;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.setLineDash([]);
  };
  const hy = Math.min(heel.y, CONFIG.PAPER_H_MM - 1.5);
  line({ x: 0, y: hy }, { x: CONFIG.PAPER_W_MM, y: hy }, COLORS.heel, [14, 8]);
  line({ x: toe.x - nx * 45, y: toe.y - ny * 45 }, { x: toe.x + nx * 45, y: toe.y + ny * 45 }, COLORS.toe);
  for (const p of [left, right]) {
    line({ x: p.x - ux * 45, y: p.y - uy * 45 }, { x: p.x + ux * 45, y: p.y + uy * 45 }, COLORS.width);
  }
  return canvas;
}

function showPhotoResult(photo, det, r) {
  const m = r.measurement;
  state.feet = [...state.feet, { lengthMm: m.lengthMm, widthMm: m.widthMm }].slice(-2);
  const lengthMm = Math.max(...state.feet.map((f) => f.lengthMm));
  const widthMm = Math.max(...state.feet.map((f) => f.widthMm));
  showResult(lengthMm, widthMm, { preview: drawPreview(photo, r), unevenLight: !!r.seg.unevenLight, fromPhoto: true });
  if (DEBUG) renderDebug($('result-debug'), { photo, det, r });
}

// ---------- 結果 ----------

function showResult(lengthMm, widthMm, { preview = null, unevenLight = false, fromPhoto = false } = {}) {
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
  const feet = fromPhoto ? state.feet : [];
  if (feet.length === 2) {
    addDetail(`已量兩隻腳（腳長 ${cm(feet[0].lengthMm)}、${cm(feet[1].lengthMm)}），用比較大的那隻判斷。`);
  }

  const previewHost = $('result-preview-canvas');
  previewHost.innerHTML = '';
  if (preview) previewHost.appendChild(preview);
  $('result-preview').hidden = !preview;

  const restart = $('btn-restart');
  if (fromPhoto && feet.length === 1) {
    restart.textContent = '量另一隻腳';
    restart.onclick = () => showCard(3);
  } else {
    restart.textContent = '重新開始';
    restart.onclick = () => { state.feet = []; showCard(0); };
  }

  const chart = state.chart;
  const back = $('btn-back-product');
  const backUrl = EMBED ? null : BACK_URL || (chart && chart.product_url) || null;
  back.hidden = !backUrl;
  if (backUrl) back.href = backUrl;

  $('result-products').hidden = true;
  $('result-table-wrap').hidden = true;
  $('result-product').hidden = !chart;

  if (!chart) {
    if (state.catalog.length) {
      renderCatalog(state.catalog, lengthMm, widthMm, addDetail);
    } else {
      $('result-headline').textContent = '量好了';
      addDetail(SKU ? '找不到這個商品的尺碼表，請回商品頁對照尺碼表選購。' : '沒有指定商品，請回商品頁對照尺碼表選購。');
    }
  } else {
    $('result-product').textContent = chart.name || '';
    const rec = recommend(chart, lengthMm, widthMm);
    $('result-headline').textContent = rec.headline;
    rec.details.forEach(addDetail);
    if (chart.verified === false) addDetail('（測試中）這個商品的尺碼區間還沒確認，實際請以商品頁說明為準。');
    if (!Number.isFinite(widthMm) && chart.width_rule && chart.width_rule.enabled) {
      addDetail('沒有提供腳寬，只用腳長判斷。腳掌偏寬的話建議選大一號。');
    }
    fillChartTable($('result-table'), $('result-table-wrap'), chart, rec);
  }
  if (unevenLight) addDetail('照片裡有明顯的影子，腳寬可能量大一點。');
}

// 沒有指定商品：每個商品各算一次建議尺碼，列成可點的商品卡片
function renderCatalog(catalog, lengthMm, widthMm, addDetail) {
  const recs = catalog.map((chart) => ({ chart, rec: recommend(chart, lengthMm, widthMm) }));
  const headlines = [...new Set(recs.map((r) => r.rec.headline))];
  if (headlines.length === 1) {
    $('result-headline').textContent = headlines[0];
    recs[0].rec.details.forEach(addDetail);
  } else {
    $('result-headline').textContent = '各商品的建議尺碼';
  }
  if (catalog.some((c) => c.verified === false)) addDetail('（測試中）商品的尺碼區間還沒確認，實際請以商品頁說明為準。');

  const host = $('result-products');
  host.innerHTML = '';
  const title = document.createElement('h2');
  title.textContent = '推薦商品';
  host.appendChild(title);
  for (const { chart, rec } of recs) {
    const card = document.createElement(chart.product_url ? 'a' : 'div');
    card.className = 'product-card';
    if (chart.product_url) {
      card.href = chart.product_url;
      card.target = EMBED ? '_top' : '_blank';
      card.rel = 'noopener';
    }
    if (chart.image) {
      const img = document.createElement('img');
      img.src = chart.image;
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
      card.appendChild(img);
    }
    const info = document.createElement('span');
    info.className = 'product-card-info';
    const name = document.createElement('span');
    name.className = 'product-card-name';
    name.textContent = chart.name;
    const size = document.createElement('strong');
    size.className = 'product-card-size';
    size.textContent = rec.status === 'ok' ? rec.headline : '沒有適合你的尺碼';
    info.append(name, size);
    card.appendChild(info);
    if (chart.product_url) {
      const go = document.createElement('span');
      go.className = 'product-card-go';
      go.textContent = '去看看 ›';
      card.appendChild(go);
    }
    host.appendChild(card);
  }
  host.hidden = false;
}

// ---------- 直接輸入 ----------

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

// ---------- 除錯（?debug=1） ----------

function appendCanvas(host, canvas, caption) {
  const p = document.createElement('p');
  p.textContent = caption;
  host.append(p, canvas);
}

function renderDebug(host, { photo, det, r }) {
  host.innerHTML = '';
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify({
    photo: photo ? [photo.width, photo.height] : null,
    detect: det ? {
      ok: det.ok, reason: det.reason, aspect: det.aspect, score: det.score, support: det.support,
      otsu: det.debug && det.debug.otsu, borderBright: det.debug && det.debug.borderBrightRatio,
      corners: det.corners ? det.corners.map((c) => [Math.round(c.x), Math.round(c.y)]) : null,
    } : null,
    measure: r ? {
      lengthMm: Math.round(r.measurement.lengthMm * 10) / 10, widthMm: Math.round(r.measurement.widthMm * 10) / 10,
      flags: r.flags, heelSide: r.seg.heelSide, flipped: r.flip, unevenLight: r.seg.unevenLight,
    } : null,
  }, null, 1);
  host.appendChild(pre);
  if (det && det.debug && det.debug.mask) {
    const { mask, w, h } = det.debug.mask;
    appendCanvas(host, maskToCanvas(mask, w, h, [255, 255, 255, 255]), '紙張分數門檻遮罩');
  }
  if (r) {
    appendCanvas(host, imageToCanvas(r.segRect), '分割用校正圖（翻轉前）');
    if (r.seg.debug && r.seg.debug.score) appendCanvas(host, grayToCanvas(r.seg.debug.score, r.seg.w, r.seg.h), '腳部分數（127 為門檻）');
    if (r.seg.mask) appendCanvas(host, maskToCanvas(r.seg.mask, r.seg.w, r.seg.h), '最終腳部遮罩（腳跟在下）');
  }
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
  $('btn-manual-back').addEventListener('click', () => showCard(0));
  $('manual-form').addEventListener('submit', submitManual);
  if (EMBED) document.documentElement.classList.add('embed');
  if (DEBUG) document.querySelectorAll('[data-debug]').forEach((d) => { d.hidden = false; d.open = true; });

  loadChart(SKU).then(async (chart) => {
    state.chart = chart;
    if (!chart) state.catalog = await loadCatalog();
    state.chartLoaded = true;
    renderIntro();
  });
  showCard(0);
}

init();
