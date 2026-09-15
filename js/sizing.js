// 尺碼表載入與尺碼建議
import { CONFIG } from './config.js';

export const cm = (mm) => `${(mm / 10).toFixed(1)} cm`;
const range = (s) => `${(s.foot_min / 10).toFixed(1)}~${(s.foot_max / 10).toFixed(1)} cm`;

export function validateChart(c) {
  return !!c && Array.isArray(c.sizes) && c.sizes.length > 0 && c.sizes.every((s) =>
    typeof s.label === 'string' && Number.isFinite(s.foot_min) && Number.isFinite(s.foot_max) && s.foot_max > s.foot_min);
}

export async function loadChart(sku) {
  if (!sku || !/^[A-Za-z0-9_-]{1,40}$/.test(sku)) return null;
  try {
    const res = await fetch(`data/sizes/${encodeURIComponent(sku)}.json`, { cache: 'no-cache' });
    if (!res.ok) return null;
    const chart = await res.json();
    return validateChart(chart) ? chart : null;
  } catch {
    return null;
  }
}

// 沒有指定商品時用：載入 data/sizes/index.json 列出的全部商品尺碼表
export async function loadCatalog() {
  try {
    const res = await fetch('data/sizes/index.json', { cache: 'no-cache' });
    if (!res.ok) return [];
    const { products = [] } = await res.json();
    const charts = await Promise.all(products.map((sku) => loadChart(sku)));
    return charts.filter(Boolean);
  } catch {
    return [];
  }
}

// 回傳 { status, primary, alternative, bumped, headline, details, lengthSize }
// status：ok / too_small / too_large
export function recommend(chart, lengthMm, widthMm, boundaryMm = CONFIG.BOUNDARY_MM) {
  const sizes = [...chart.sizes].sort((a, b) => a.foot_min - b.foot_min);
  const L = Math.round(lengthMm);
  const W = Number.isFinite(widthMm) ? Math.round(widthMm) : null;
  const first = sizes[0], last = sizes[sizes.length - 1];
  const details = [];
  let idx;

  if (L < first.foot_min) {
    if (L < first.foot_min - boundaryMm) {
      return {
        status: 'too_small', primary: first, alternative: null, bumped: false, lengthSize: first,
        headline: '這款沒有適合你的尺碼',
        details: [`你的腳長 ${cm(L)}，比這款最小的${first.label}（適合腳長 ${range(first)}）還小。最接近的是${first.label}，建議試穿確認。`],
      };
    }
    idx = 0;
    details.push(`你的腳長 ${cm(L)} 略小於${first.label}的建議範圍，${first.label}是這款最小的尺碼，建議試穿確認。`);
  } else if (L >= last.foot_max) {
    // 超過最大號的範圍就不建議硬穿：鞋子偏小比偏大難穿（實測腳長 27.7 穿 28 號已經剛好貼合）
    return {
      status: 'too_large', primary: last, alternative: null, bumped: false, lengthSize: last,
      headline: '這款沒有適合你的尺碼',
      details: [`你的腳長 ${cm(L)}，超過這款最大的${last.label}（適合腳長 ${range(last)}）。${last.label}可能會太小，建議試穿確認。`],
    };
  } else {
    idx = sizes.findIndex((s) => L >= s.foot_min && L < s.foot_max);
    if (idx < 0) idx = sizes.findIndex((s) => s.foot_min > L); // 落在區間空隙時選大一號
  }

  const base = sizes[idx];
  let primary = base, alternative = null, bumped = false;

  const rule = chart.width_rule || {};
  if (rule.enabled && W !== null && Number.isFinite(base.shoe_width)) {
    const limit = base.shoe_width + (rule.margin_mm || 0);
    if (W >= limit) {
      if (idx + 1 < sizes.length) {
        primary = sizes[idx + 1];
        alternative = base;
        bumped = true;
        details.push(`你的腳寬 ${cm(W)}，${base.label}的鞋寬是 ${cm(base.shoe_width)}。腳掌偏寬，建議選大一號的${primary.label}；只看腳長是${base.label}。`);
      } else {
        details.push(`你的腳寬 ${cm(W)} 偏寬，這款最大就是${base.label}，建議試穿確認。`);
      }
    }
  }

  // 只會往大一號建議，不建議小一號：量測有幾公釐誤差，建議小一號很容易穿不下
  if (!bumped && L < base.foot_max && L >= base.foot_max - boundaryMm) {
    const up = sizes[idx + 1];
    if (up) {
      alternative = up;
      details.push(`你的腳長接近${base.label}的上限，${base.label}或${up.label}都可以。腳掌偏寬或喜歡寬鬆一點，選${up.label}。`);
    } else {
      details.push(`你的腳長接近${base.label}的上限，這款沒有更大的尺碼，建議試穿確認。`);
    }
  }

  let headline;
  if (alternative && !bumped) {
    const pair = [primary, alternative].sort((a, b) => a.foot_min - b.foot_min);
    headline = `建議 ${pair[0].label} 或 ${pair[1].label}`;
  } else {
    headline = `建議 ${primary.label}`;
  }
  return { status: 'ok', primary, alternative, bumped, headline, details, lengthSize: base };
}
