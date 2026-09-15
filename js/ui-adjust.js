// 可拖動標記點的畫布編輯器：底圖 + 圓形手把 + 拖動時的放大鏡
// 座標：points 使用「世界座標」，world × units = 底圖像素

const HIT_RADIUS = 44;     // 觸控命中半徑（CSS px）
const HANDLE_RADIUS = 13;
const MAG_RADIUS = 58;
const MAG_ZOOM = 3;

export class PointEditor {
  constructor(host, { source, points, units = 1, drawOverlay = null, onChange = null, tapToMove = false, placeMode = false, maxHeightRatio = 0.62 }) {
    this.host = host;
    this.source = source;
    this.units = units;
    this.points = points.map((p) => ({ ...p }));
    this.drawOverlay = drawOverlay;
    this.onChange = onChange;
    this.tapToMove = tapToMove;
    // 放置模式：圓點一開始不顯示，使用者每點一下就放一個，放完四個才進入拖動模式
    this.placed = points.map(() => !placeMode);
    this.maxHeightRatio = maxHeightRatio;
    this.active = null;
    this.pointer = null;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'editor-canvas';
    this.canvas.style.touchAction = 'none';
    host.innerHTML = '';
    host.appendChild(this.canvas);

    this._down = (e) => this.onDown(e);
    this._move = (e) => this.onMove(e);
    this._up = (e) => this.onUp(e);
    this._resize = () => { this.layout(); this.draw(); };
    this.canvas.addEventListener('pointerdown', this._down);
    this.canvas.addEventListener('pointermove', this._move);
    this.canvas.addEventListener('pointerup', this._up);
    this.canvas.addEventListener('pointercancel', this._up);
    window.addEventListener('resize', this._resize);
    this.layout();
    this.draw();
  }

  destroy() {
    window.removeEventListener('resize', this._resize);
    this.host.innerHTML = '';
  }

  layout() {
    const sw = this.source.width, sh = this.source.height;
    const maxW = this.host.clientWidth || 340;
    const maxH = Math.max(240, window.innerHeight * this.maxHeightRatio);
    let cssW = maxW;
    let cssH = (cssW * sh) / sw;
    if (cssH > maxH) { cssH = maxH; cssW = (cssH * sw) / sh; }
    this.cssW = cssW;
    this.cssH = cssH;
    this.scale = cssW / sw; // CSS px / 底圖像素
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
  }

  toScreen(p) {
    return { x: p.x * this.units * this.scale, y: p.y * this.units * this.scale };
  }

  toWorld(sx, sy) {
    const maxX = this.source.width / this.units, maxY = this.source.height / this.units;
    return {
      x: Math.min(maxX, Math.max(0, sx / this.scale / this.units)),
      y: Math.min(maxY, Math.max(0, sy / this.scale / this.units)),
    };
  }

  eventPos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  allPlaced() {
    return this.placed.every(Boolean);
  }

  placedCount() {
    return this.placed.filter(Boolean).length;
  }

  onDown(e) {
    const pos = this.eventPos(e);
    if (!this.allPlaced()) {
      const idx = this.placed.indexOf(false);
      const p = this.points[idx];
      Object.assign(p, this.toWorld(pos.x, pos.y));
      this.placed[idx] = true;
      this.offset = { x: 0, y: 0 };
      e.preventDefault();
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* 合成事件沒有真正的指標 */ }
      this.active = p;
      this.pointer = pos;
      this.draw();
      if (this.onChange) this.onChange(this.getPoints(), true);
      return;
    }
    let best = null, bestD = Infinity;
    for (const p of this.points) {
      const s = this.toScreen(p);
      const d = Math.hypot(s.x - pos.x, s.y - pos.y);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (!best) return;
    if (bestD > HIT_RADIUS) {
      if (!this.tapToMove) return;
      Object.assign(best, this.toWorld(pos.x, pos.y));
      this.offset = { x: 0, y: 0 };
    } else {
      const s = this.toScreen(best);
      this.offset = { x: s.x - pos.x, y: s.y - pos.y };
    }
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* 合成事件沒有真正的指標 */ }
    this.active = best;
    this.pointer = pos;
    this.draw();
    if (this.onChange) this.onChange(this.getPoints(), true);
  }

  onMove(e) {
    if (!this.active) return;
    e.preventDefault();
    const pos = this.eventPos(e);
    this.pointer = pos;
    Object.assign(this.active, this.toWorld(pos.x + this.offset.x, pos.y + this.offset.y));
    this.draw();
    if (this.onChange) this.onChange(this.getPoints(), true);
  }

  onUp() {
    if (!this.active) return;
    this.active = null;
    this.pointer = null;
    this.draw();
    if (this.onChange) this.onChange(this.getPoints(), false);
  }

  getPoints() {
    return this.points.map((p) => ({ ...p }));
  }

  setPoints(points) {
    this.points = points.map((p) => ({ ...p }));
    this.draw();
  }

  draw() {
    const ctx = this.canvas.getContext('2d');
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.source, 0, 0, this.cssW, this.cssH);
    if (this.drawOverlay && this.allPlaced()) {
      ctx.save();
      this.drawOverlay(ctx, (p) => this.toScreen(p), this.getPoints());
      ctx.restore();
    }
    this.points.forEach((p, i) => { if (this.placed[i]) this.drawHandle(ctx, p, p === this.active); });
    if (this.active) this.drawMagnifier(ctx, this.active);
  }

  drawHandle(ctx, p, active) {
    const s = this.toScreen(p);
    const color = p.color || '#FF5353';
    ctx.beginPath();
    ctx.arc(s.x, s.y, active ? HANDLE_RADIUS + 3 : HANDLE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = hexToRgba(color, active ? 0.25 : 0.35);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    if (p.label) drawLabel(ctx, p.label, s.x, s.y - HANDLE_RADIUS - 6, color, this.cssW);
  }

  drawMagnifier(ctx, p) {
    const s = this.toScreen(p);
    const left = this.pointer ? this.pointer.x > this.cssW / 2 : true;
    const cx = left ? MAG_RADIUS + 8 : this.cssW - MAG_RADIUS - 8;
    const cy = MAG_RADIUS + 8;
    const srcX = p.x * this.units, srcY = p.y * this.units;
    const srcR = MAG_RADIUS / (this.scale * MAG_ZOOM);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, MAG_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.clip();
    ctx.drawImage(this.source, srcX - srcR, srcY - srcR, srcR * 2, srcR * 2, cx - MAG_RADIUS, cy - MAG_RADIUS, MAG_RADIUS * 2, MAG_RADIUS * 2);
    ctx.strokeStyle = p.color || '#FF5353';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - 14, cy); ctx.lineTo(cx + 14, cy);
    ctx.moveTo(cx, cy - 14); ctx.lineTo(cx, cy + 14);
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, MAG_RADIUS, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,.35)';
    ctx.stroke();
    void s;
  }
}

export function drawLabel(ctx, text, x, y, color, maxW) {
  ctx.font = '600 13px system-ui, -apple-system, "PingFang TC", "Noto Sans TC", sans-serif';
  const w = ctx.measureText(text).width + 12;
  const bx = Math.min(Math.max(2, x - w / 2), maxW - w - 2);
  const by = Math.max(2, y - 20);
  ctx.fillStyle = color;
  roundRect(ctx, bx, by, w, 20, 10);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + 6, by + 10.5);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
