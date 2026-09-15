// 自動測試：幾何、尺碼邏輯、模擬照片完整流程
import { homography, applyH, estimateAspect, assignPaperCorners, dist } from '../js/geometry.js';
import { detectPaper } from '../js/paper.js';
import { measureFromCorners } from '../js/pipeline.js';
import { recommend, validateChart } from '../js/sizing.js';
import { makeScene } from './synthetic.js';

const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

function cornerError(found, truth) {
  return Math.max(...found.map((c) => Math.min(...truth.map((t) => dist(c, t)))));
}

export const SCENES = [
  { name: '正上方拍、腳跟在下', opts: {} },
  { name: '傾斜 12°/8°、旋轉 10°', opts: { tiltX: 12, tiltY: 8, roll: 10, footLen: 265, footWidth: 104 } },
  { name: '朋友幫拍（腳跟在畫面上方）', opts: { heelAtTop: true, tiltX: -8, footLen: 238, footWidth: 94, seed: 3 } },
  { name: '腳斜放 8°', opts: { footAngle: 8, footLen: 255, footWidth: 100, tiltY: 6, seed: 4 } },
  { name: '橫拍（紙轉 90°）', opts: { W: 1600, H: 1200, roll: 90, footLen: 245, footWidth: 96, seed: 5 } },
  { name: '暖色燈光 + 強烈明暗漸層', opts: { paper: [250, 226, 186], floor: [95, 70, 45], skin: [232, 164, 118], leg: [205, 140, 100], light: 0.35, tiltX: 6, seed: 6 } },
  { name: '深色襪子', opts: { skin: [58, 56, 66], leg: [52, 50, 60], footLen: 272, footWidth: 106, seed: 7 } },
  { name: '紙偏離畫面中心', opts: { offX: 28, offY: -35, fill: 0.6, tiltX: -10, footLen: 228, footWidth: 90, seed: 8 } },
  { name: '腳跟沒對齊紙邊（離 15 mm）', opts: { heelGap: 15, drawLeg: false, footLen: 240, footWidth: 95, seed: 9 }, heelNotAligned: true },
  { name: '強烈傾斜 22°', opts: { tiltX: 22, tiltY: -6, fill: 0.55, footLen: 258, footWidth: 101, seed: 11 } },
  { name: '淺色木地板', opts: { floor: [196, 164, 122], tiltY: 7, footLen: 247, footWidth: 97, seed: 12 } },
  { name: '白色地板（抓不到可以，抓錯不行）', opts: { floor: [236, 236, 232], seed: 10 }, expectNoPaper: true, expectReason: 'white_floor' },
  { name: '紙角被切出畫面（抓不到可以，抓錯不行）', opts: { fill: 0.98, roll: 4, seed: 13 }, expectNoPaper: true, expectReason: 'cut_off' },
];

export async function runAll(report) {
  const results = [];
  const add = (group, name, pass, detail) => {
    const r = { group, name, pass, detail };
    results.push(r);
    if (report) report(r);
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  // ---- 幾何 ----
  {
    const src = [{ x: 0, y: 0 }, { x: 210, y: 0 }, { x: 210, y: 297 }, { x: 0, y: 297 }];
    const dst = [{ x: 312, y: 205 }, { x: 1010, y: 260 }, { x: 1105, y: 1390 }, { x: 180, y: 1300 }];
    const H = homography(src, dst);
    const err = Math.max(...src.map((p, i) => dist(applyH(H, p.x, p.y), dst[i])));
    add('幾何', '單應矩陣四點對應', err < 1e-6, `最大誤差 ${err.toExponential(2)} px`);
  }
  {
    const scene = makeScene({ tiltX: 18, tiltY: -12, roll: 25, W: 600, H: 800, noise: 0, shadow: false });
    const c = assignPaperCorners(scene.truthCorners);
    const { ratio, usedDefault } = estimateAspect(c, 600, 800);
    add('幾何', '傾斜照片估計 A4 長寬比', Math.abs(ratio / Math.SQRT2 - 1) < 0.02, `估計 ${round(ratio, 3)}（A4 = 1.414）${usedDefault ? '，使用預設焦距' : '，焦距由四角推算'}`);
  }

  // ---- 尺碼邏輯（範例尺碼表 + 試穿紀錄）----
  const chart = await fetch('fixtures/sample-chart.json').then((r) => r.json());
  add('尺碼', '尺碼表格式', validateChart(chart), `${chart.sizes.length} 個尺碼`);
  const sizeCases = [
    ['試穿1 腳長22.2 寬9.2（試穿5號）', 222, 92, '建議 5號'],
    ['試穿2 腳長23.6 寬9.5（試穿6號）', 236, 95, '建議 5號 或 6號'],
    ['試穿3 腳長23.0 寬9.8（試穿選7號，規則給6號，已知差異）', 230, 98, '建議 6號'],
    ['試穿4 腳長25.8 寬9.5（試穿8號）', 258, 95, '建議 8號'],
    ['試穿5 腳長25.0 寬10.5（試穿7號/8號寬鬆）', 250, 105, '建議 8號'],
    ['試穿6 腳長26.0 寬10.0（試穿8號）', 260, 100, '建議 8號'],
    ['試穿7 腳長27.0 寬10.5（試穿9號）', 270, 105, '建議 9號'],
    ['區間中點 24.0', 240, 90, '建議 6號'],
    ['接近上限 24.4', 244, 90, '建議 6號 或 7號'],
    ['最大號邊界內 28.7', 287, 100, '建議 10號'],
    ['超出最大號 29.2', 292, 100, '這款沒有適合你的尺碼'],
    ['小於最小號 21.5', 215, 85, '這款沒有適合你的尺碼'],
    ['沒有腳寬 25.0', 250, NaN, '建議 7號'],
  ];
  for (const [name, L, W, expect] of sizeCases) {
    const rec = recommend(chart, L, W);
    add('尺碼', name, rec.headline === expect, `${rec.headline}｜預期 ${expect}`);
  }

  // ---- 商品清單（沒指定商品時結果頁會列出全部）----
  {
    const idx = await fetch('../data/sizes/index.json').then((r) => r.json());
    const skus = Array.isArray(idx.products) ? idx.products : [];
    const charts = await Promise.all(skus.map((s) => fetch(`../data/sizes/${s}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
    const allValid = charts.length > 0 && charts.every((c) => c && validateChart(c) && c.product_url);
    add('尺碼', '商品清單 index.json', allValid, `${skus.join(', ')}，每個都有尺碼表與商品連結=${allValid}`);
  }

  // ---- DK A0235 夾腳拖（區間暫定，未確認）----
  for (const [sku, cases] of [
    ['11802053', [[240, 95, '建議 24號'], [244, 95, '建議 24號 或 25號'], [280, 100, '建議 28號'], [292, 100, '這款沒有適合你的尺碼'], [219, 90, '這款沒有適合你的尺碼']]],
    ['11802051', [[250, 95, '建議 25號'], [236, 90, '建議 23號 或 24號'], [272, 105, '建議 27號 或 28號']]],
  ]) {
    const dk = await fetch(`../data/sizes/${sku}.json`).then((r) => r.json());
    add('尺碼', `DK ${sku} 尺碼表格式`, validateChart(dk) && dk.verified === false, `${dk.name}，${dk.sizes.map((s) => s.label).join('/')}，verified=${dk.verified}`);
    for (const [L, W, expect] of cases) {
      const rec = recommend(dk, L, W);
      add('尺碼', `DK ${sku} 腳長 ${L / 10}`, rec.headline === expect, `${rec.headline}｜預期 ${expect}`);
    }
  }

  // ---- 模擬照片完整流程 ----
  for (const sc of SCENES) {
    await tick();
    const t0 = performance.now();
    const scene = makeScene(sc.opts);
    const tRender = performance.now();
    let det;
    try {
      det = detectPaper(scene.image);
    } catch (e) {
      add('流程', sc.name, false, `偵測紙張時丟出錯誤：${e.message}`);
      continue;
    }
    const tDetect = performance.now();
    if (sc.expectNoPaper) {
      // 抓不到紙沒關係，但不能「抓錯還說抓到」，後續流程也不能出錯。corners 為 null 表示連提示都不給（使用者要自己點角）
      let crashed = false;
      const px = dist(scene.truthCorners[0], scene.truthCorners[1]) / 210;
      let err = NaN;
      if (det.corners) {
        try { measureFromCorners(scene.image, det.corners); } catch { crashed = true; }
        err = cornerError(det.corners, scene.truthCorners) / px;
      }
      const reasonOk = det.ok || !sc.expectReason || det.reason === sc.expectReason;
      const pass = !crashed && reasonOk && (!det.ok || err <= 1.5);
      add('流程', sc.name, pass, `ok=${det.ok}，原因=${det.reason}（預期 ${sc.expectReason || '不限'}），${det.corners ? `提示紙角誤差 ${round(err)} mm` : '沒有提示位置，改由使用者點角'}，後續流程${crashed ? '出錯' : '沒有出錯'}`);
      continue;
    }
    const cErr = det.ok ? cornerError(det.corners, scene.truthCorners) : Infinity;
    const pxPerMm = dist(scene.truthCorners[0], scene.truthCorners[1]) / 210;
    const r = measureFromCorners(scene.image, det.ok ? det.corners : assignPaperCorners(scene.truthCorners));
    const tMeasure = performance.now();
    const dL = r.measurement.lengthMm - scene.truth.length;
    const dW = r.measurement.widthMm - scene.truth.width;
    const cornerOk = det.ok && cErr / pxPerMm <= 1.5;
    const measureOk = Math.abs(dL) <= 2.5 && Math.abs(dW) <= 2.5;
    const alignOk = sc.heelNotAligned ? r.flags.heelAligned === false : r.flags.heelAligned === true;
    add('流程', sc.name, cornerOk && measureOk && alignOk,
      `紙角${det.ok ? `誤差 ${round(cErr / pxPerMm)} mm` : '未偵測到'}｜腳長 ${round(r.measurement.lengthMm)}（真值 ${scene.truth.length}，差 ${round(dL)}）｜腳寬 ${round(r.measurement.widthMm)}（真值 ${scene.truth.width}，差 ${round(dW)}）｜腳跟對齊=${r.flags.heelAligned}｜翻轉=${r.flip}｜偵測 ${Math.round(tDetect - tRender)} ms、量測 ${Math.round(tMeasure - tDetect)} ms`);
  }
  return results;
}
