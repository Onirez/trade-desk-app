// Hand-drawn canvas charts (no library). devicePixelRatio aware.
const Charts = (() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function setup(cv) {
    const r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d);
    const c = cv.getContext('2d'); c.setTransform(d, 0, 0, d, 0, 0);
    return {c, w: r.width, h: r.height};
  }
  // Line chart: points [[ts,v]], start value, marks [{ts,kind,text}]
  function line(cv, pts, start, marks, anim) {
    const {c, w, h} = setup(cv);
    const top = 34, bot = h - 6;
    c.clearRect(0, 0, w, h);
    const ys = pts.map(p => p[1]).concat([start]);
    let lo = Math.min(...ys), hi = Math.max(...ys);
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
    const t0 = pts.length ? pts[0][0] : 0, t1 = pts.length ? pts[pts.length - 1][0] : 1;
    const X = t => pts.length < 2 ? w / 2 : (t - t0) / ((t1 - t0) || 1) * (w - 4) + 2;
    const Y = v => bot - (v - lo) / (hi - lo) * (bot - top);
    c.setLineDash([4, 5]); c.strokeStyle = 'rgba(235,235,245,0.3)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(0, Y(start)); c.lineTo(w, Y(start)); c.stroke(); c.setLineDash([]);
    if (pts.length < 2) return;
    const g = c.createLinearGradient(0, top, 0, bot);
    g.addColorStop(0, 'rgba(0,211,90,0.28)'); g.addColorStop(1, 'rgba(0,211,90,0)');
    c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1])));
    c.lineTo(X(t1), bot); c.lineTo(X(t0), bot); c.closePath(); c.fillStyle = g; c.fill();
    c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1])));
    c.strokeStyle = '#00d35a'; c.lineWidth = 2; c.lineJoin = 'round'; c.stroke();
    // marks above the line, never overlapping: a later mark moves up a row
    c.font = '600 11px -apple-system,system-ui,sans-serif';
    const placed = [];
    const col = {bought: '#0a84ff', win: '#00d35a', stop: '#ff453a'};
    (marks || []).filter(m => m.ts >= t0 && m.ts <= t1 + 60).forEach(m => {
      const x = X(Math.min(m.ts, t1)), tw = c.measureText(m.text).width + 12;
      let x0 = Math.max(0, Math.min(w - tw, x - tw / 2)), row = 0;
      while (placed.some(p => p.row === row && !(x0 + tw < p.x0 || x0 > p.x0 + p.tw))) row++;
      placed.push({x0, tw, row});
      const v = interp(pts, m.ts), y = Math.max(12, Y(v) - 14 - row * 22);
      c.globalAlpha = anim && !reduce ? 0 : 1;
      c.fillStyle = col[m.kind] || '#0a84ff';
      rr(c, x0, y - 9, tw, 18, 9); c.fill();
      c.fillStyle = m.kind === 'win' ? '#000' : '#fff'; c.fillText(m.text, x0 + 6, y + 4);
      c.globalAlpha = 1;
    });
  }
  function interp(pts, t) {
    for (let i = 1; i < pts.length; i++) if (pts[i][0] >= t) return pts[i - 1][1];
    return pts[pts.length - 1][1];
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  // Candles + volume + orange dashed exit line
  function candles(cv, cs, exitLine, entry) {
    const {c, w, h} = setup(cv);
    c.clearRect(0, 0, w, h);
    if (!cs.length) return;
    const ph = h * 0.78, vh = h - ph - 4;
    const vals = cs.flatMap(k => [k.h, k.l]).concat(exitLine ? [exitLine] : []).concat(entry ? [entry] : []);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo <= 0) { hi *= 1.01; lo *= 0.99; }
    const Y = v => 6 + (hi - v) / (hi - lo) * (ph - 12);
    const n = Math.max(cs.length, 20), cw = w / n, bw = Math.max(2, cw * 0.62);
    const vmax = Math.max(...cs.map(k => k.v || 0), 1e-9);
    cs.forEach((k, i) => {
      const x = (n - cs.length + i) * cw + cw / 2, up = k.c >= k.o, col = up ? '#00d35a' : '#ff453a';
      c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, Y(k.h)); c.lineTo(x, Y(k.l)); c.stroke();
      const y1 = Y(Math.max(k.o, k.c)), y2 = Y(Math.min(k.o, k.c));
      c.fillRect(x - bw / 2, y1, bw, Math.max(1, y2 - y1));
      const vb = (k.v || 0) / vmax * vh;
      c.globalAlpha = 0.45; c.fillRect(x - bw / 2, h - vb, bw, vb); c.globalAlpha = 1;
    });
    if (exitLine) {
      c.setLineDash([5, 4]); c.strokeStyle = '#ff9f0a'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(0, Y(exitLine)); c.lineTo(w, Y(exitLine)); c.stroke(); c.setLineDash([]);
      c.fillStyle = '#ff9f0a'; c.font = '600 11px -apple-system,system-ui,sans-serif';
      c.fillText('Risk trailing stop', 4, Y(exitLine) - 4);
    }
  }
  // Score ring 0-100, green from 70
  function ring(cv, score) {
    const {c, w, h} = setup(cv), r = Math.min(w, h) / 2 - 8, cx = w / 2, cy = h / 2;
    c.clearRect(0, 0, w, h); c.lineWidth = 10; c.lineCap = 'round';
    c.strokeStyle = '#2c2c2e'; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
    if (score != null) {
      c.strokeStyle = score >= 70 ? '#00d35a' : '#ffd60a';
      c.beginPath(); c.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * score / 100); c.stroke();
    }
    c.fillStyle = '#fff'; c.font = '700 34px -apple-system,system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(score == null ? '–' : String(score), cx, cy);
  }
  return {line, candles, ring};
})();
