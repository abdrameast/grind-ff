/* =============================================================================
   Calque 2D par-dessus la scène : anneau spectral, lignes de vitesse,
   gouttes centrifuges, coulures, oscilloscope.
   ========================================================================== */
const FX2D = {
  c: null, g: null, dpr: 1, w: 1, h: 1,
  bars: new Float32Array(96), peaks: new Float32Array(96),
  drips: [], drops: [], bursts: [], sprays: [],
  lite: false,
  zoneColors: null,

  init() {
    this.c = $('#fx');
    this.g = this.c.getContext('2d');
    const P = CONFIG.palette;
    this.zoneColors = [P.magenta, P.orange, P.yellow, P.lime, P.cyan];
  },
  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.w = view.W; this.h = view.H;
    this.c.width = Math.round(this.w * this.dpr);
    this.c.height = Math.round(this.h * this.dpr);
  },

  burst() {
    if (reduced() || this.lite) return;
    this.bursts.push({ t: 0, seed: Math.random() * 1000, n: 30 + Math.floor(Math.random() * 16) });
  },
  spray(x, y, color) {
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2, s = 80 + Math.random() * 380;
      this.sprays.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: 1.2 + Math.random() * 3, life: 0.18 + Math.random() * 0.22, color });
    }
  },
  fling(disc, n) {
    if (reduced() || this.lite) return;
    const P = CONFIG.palette;
    const cols = [P.magenta, P.lime, P.cyan, P.yellow, P.orange];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const tx = -Math.sin(a), ty = Math.cos(a);
      const sp = 260 + Math.random() * 300, out = 60 + Math.random() * 90;
      this.drops.push({
        x: disc.x + Math.cos(a) * disc.r * 0.97, y: disc.y + Math.sin(a) * disc.r * 0.97,
        vx: -tx * sp + Math.cos(a) * out, vy: -ty * sp + Math.sin(a) * out,
        r: 2.5 + Math.random() * 3.5, life: 0.45 + Math.random() * 0.45, color: cols[Math.floor(Math.random() * cols.length)],
      });
    }
    if (this.drops.length > 600) this.drops.splice(0, this.drops.length - 600);
  },

  draw(dt, F, disc, accentHex) {
    const g = this.g, dpr = this.dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    const ink = CONFIG.palette.ink;

    // lignes de vitesse (manga)
    for (let k = this.bursts.length - 1; k >= 0; k--) {
      const b = this.bursts[k];
      b.t += dt;
      const life = 0.36;
      if (b.t > life) { this.bursts.splice(k, 1); continue; }
      const al = 1 - b.t / life;
      const rnd = mulberry32(Math.floor(b.seed));
      const far = Math.hypot(this.w, this.h);
      g.fillStyle = ink;
      g.globalAlpha = 0.78 * al;
      g.beginPath();
      for (let j = 0; j < b.n; j++) {
        const a = rnd() * Math.PI * 2;
        const r1 = disc.r * (1.42 + rnd() * 0.45) + b.t * 160;
        const half = (4 + rnd() * 14) / far;
        g.moveTo(disc.x + Math.cos(a) * r1, disc.y + Math.sin(a) * r1);
        g.lineTo(disc.x + Math.cos(a - half) * far, disc.y + Math.sin(a - half) * far);
        g.lineTo(disc.x + Math.cos(a + half) * far, disc.y + Math.sin(a + half) * far);
        g.closePath();
      }
      g.fill();
      g.globalAlpha = 1;
    }

    // anneau spectral
    const N = 96, half = N / 2;
    const r0 = disc.r * 1.1;
    const maxLen = disc.r * 0.3;
    const bw = clamp(((2 * Math.PI * r0) / N) * 0.46, 3, 12);
    const bars = this.bars, peaks = this.peaks;
    for (let i = 0; i < N; i++) {
      const k = i < half ? i : N - 1 - i;
      const band = Math.round(2 + (k / (half - 1)) * 52);
      const v = F.spectrum[band] || 0;
      bars[i] = v > bars[i] ? lerp(bars[i], v, 0.55) : damp(bars[i], v, 9, dt);
      if (!this.lite && !reduced() && bars[i] > 0.6 && bars[i] > peaks[i] + 0.12 && this.drips.length < 70) {
        const a = -Math.PI / 2 + ((i + 0.5) / N) * Math.PI * 2;
        const len = disc.r * 0.025 + bars[i] * maxLen;
        this.drips.push({
          x: disc.x + Math.cos(a) * (r0 + len), y: disc.y + Math.sin(a) * (r0 + len),
          vy: 0, len: 2, max: 10 + Math.random() * 22, life: 1.1, color: this.zoneColors[Math.min(4, Math.floor((k / half) * 5))],
        });
      }
      peaks[i] = Math.max(peaks[i] - dt * 0.7, bars[i]);
    }
    const seg = (i) => {
      const a = -Math.PI / 2 + ((i + 0.5) / N) * Math.PI * 2;
      const len = disc.r * 0.025 + bars[i] * maxLen;
      const ca = Math.cos(a), sa = Math.sin(a);
      return [disc.x + ca * r0, disc.y + sa * r0, disc.x + ca * (r0 + len), disc.y + sa * (r0 + len)];
    };
    g.lineCap = 'round';
    g.strokeStyle = ink;
    g.lineWidth = bw + 6;
    g.beginPath();
    for (let i = 0; i < N; i++) { const s = seg(i); g.moveTo(s[0], s[1]); g.lineTo(s[2], s[3]); }
    g.stroke();
    for (let z = 0; z < 5; z++) {
      g.strokeStyle = this.zoneColors[z];
      g.lineWidth = bw;
      g.beginPath();
      for (let i = 0; i < N; i++) {
        const k = i < half ? i : N - 1 - i;
        if (Math.min(4, Math.floor((k / half) * 5)) !== z) continue;
        const s = seg(i); g.moveTo(s[0], s[1]); g.lineTo(s[2], s[3]);
      }
      g.stroke();
    }

    // coulures qui tombent des pics
    for (let k = this.drips.length - 1; k >= 0; k--) {
      const d = this.drips[k];
      d.life -= dt;
      if (d.life <= 0) { this.drips.splice(k, 1); continue; }
      d.vy = Math.min(120, d.vy + 260 * dt);
      d.y += d.vy * dt;
      d.len = Math.min(d.max, d.len + 40 * dt);
      g.globalAlpha = Math.min(1, d.life * 2.2);
      g.lineWidth = 7; g.strokeStyle = ink;
      g.beginPath(); g.moveTo(d.x, d.y - d.len); g.lineTo(d.x, d.y); g.stroke();
      g.lineWidth = 3.5; g.strokeStyle = d.color;
      g.beginPath(); g.moveTo(d.x, d.y - d.len); g.lineTo(d.x, d.y); g.stroke();
    }
    g.globalAlpha = 1;

    // gouttes éjectées par la rotation : elles s'écrasent ensuite sur le mur
    for (let k = this.drops.length - 1; k >= 0; k--) {
      const d = this.drops[k];
      d.life -= dt;
      d.vy += 1500 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt;
      const off = d.x < -40 || d.x > this.w + 40 || d.y > this.h + 40;
      if (d.life <= 0 || off) {
        if (!off && Math.hypot(d.x - disc.x, d.y - disc.y) > disc.r * 1.05) spawnSplat(d.x, d.y, 9 + d.r * 2.6, new THREE.Color(d.color));
        this.drops.splice(k, 1);
        continue;
      }
      const tx = d.x - d.vx * 0.022, ty = d.y - d.vy * 0.022;
      g.strokeStyle = ink; g.lineWidth = d.r * 2 + 4;
      g.beginPath(); g.moveTo(tx, ty); g.lineTo(d.x, d.y); g.stroke();
      g.strokeStyle = d.color; g.lineWidth = d.r * 2;
      g.beginPath(); g.moveTo(tx, ty); g.lineTo(d.x, d.y); g.stroke();
    }

    // pschitt du clic
    for (let k = this.sprays.length - 1; k >= 0; k--) {
      const p = this.sprays[k];
      p.life -= dt;
      if (p.life <= 0) { this.sprays.splice(k, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy *= 0.9;
      g.fillStyle = p.color;
      g.globalAlpha = Math.min(1, p.life * 5);
      g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;

    // oscilloscope au feutre au-dessus du bandeau
    if (view.waveY > 0) {
      const y0 = view.waveY, amp = 10 + 22 * F.level;
      const x0 = this.w * 0.08, x1 = this.w * 0.92;
      g.lineJoin = 'round';
      const path = () => {
        g.beginPath();
        for (let i = 0; i < 128; i++) {
          const x = lerp(x0, x1, i / 127);
          const env = Math.sin((i / 127) * Math.PI);
          const y = y0 + F.waveform[i * 2] * amp * 3.2 * env;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
      };
      g.strokeStyle = ink; g.lineWidth = 6; path(); g.stroke();
      g.strokeStyle = accentHex; g.lineWidth = 2.6; path(); g.stroke();
    }
  },
};
