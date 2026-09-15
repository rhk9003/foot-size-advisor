// 瀏覽器端：讀取照片、影像與畫布互轉
import { CONFIG } from './config.js';

// 讀入照片並縮到長邊 maxSide。現代瀏覽器繪製 <img> 時會自動套用 EXIF 方向。
// 就算方向沒轉正也不影響量測，四角校正與方向無關。
export function loadImageFile(file, maxSide = CONFIG.WORK_MAX_SIDE) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error('no_file')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * s));
        const h = Math.max(1, Math.round(img.naturalHeight * s));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h);
        resolve({ image: { width: w, height: h, data: data.data }, canvas });
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode_failed')); };
    img.src = url;
  });
}

export function imageToCanvas(image) {
  const c = document.createElement('canvas');
  c.width = image.width;
  c.height = image.height;
  c.getContext('2d').putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  return c;
}

// 二值遮罩疊色（除錯用）
export function maskToCanvas(mask, w, h, rgba = [255, 90, 0, 150]) {
  const img = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    img.data.set(rgba, i * 4);
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').putImageData(img, 0, 0);
  return c;
}

// 單通道 0~255 灰階圖（除錯用）
export function grayToCanvas(values, w, h) {
  const img = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = values[i];
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').putImageData(img, 0, 0);
  return c;
}
