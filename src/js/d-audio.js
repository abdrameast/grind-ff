/* =============================================================================
   Réactivité au son : une seule interface AudioFeatures pour tous les visuels.
   LIVE (audio de l'onglet), MIC (haut-parleurs) ou AUTO (tempo simulé).
   ========================================================================== */
const NB = 64;
const vhash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const vnoise1 = (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(vhash(i), vhash(i + 1), u); };

const AudioFX = emitter({
  mode: 'auto',
  ctx: null, analyser: null, stream: null, src: null,
  // la capture de l'audio d'un onglet n'existe que dans les navigateurs Chromium sur ordinateur
  supportsLive: !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) &&
    ((navigator.userAgentData && Array.isArray(navigator.userAgentData.brands) && navigator.userAgentData.brands.some((b) => /Chromium/.test(b.brand))) ||
      (/Chrome\/\d+/.test(navigator.userAgent) && !/Firefox|FxiOS|CriOS|EdgiOS/.test(navigator.userAgent))),
  supportsMic: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
  F: {
    level: 0, bass: 0, lowMid: 0, mid: 0, high: 0,
    beat: false, strong: false, kick: 0,
    spectrum: new Float32Array(NB), waveform: new Float32Array(256),
    bpm: CONFIG.audio.defaultBpm,
  },
  _raw: { level: 0, bass: 0, lowMid: 0, mid: 0, high: 0 },
  _spec: new Float32Array(NB),
  _wave: new Float32Array(256),
  _norm: { level: 0.02, bass: 0.02, lowMid: 0.02, mid: 0.02, high: 0.02, flux: 0.001 },
  _specMax: -40,
  _flux: [], _clock: 0, _lastBeat: -10, _beatTimes: [],
  _autoBeat: -1, trackSeed: 0, videoId: '',
  tap: { wall: [], play: [], bpm: 0, offset: 0 },
  tempo: store.get('tempo', {}),

  ensureCtx() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  },

  async startLive() {
    if (!this.supportsLive) { const e = new Error('unsupported'); e.code = 'unsupported'; throw e; }
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser', frameRate: { ideal: 1, max: 5 } },
      audio: { suppressLocalAudioPlayback: false, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude', systemAudio: 'include',
    });
    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach((t) => t.stop());
      const e = new Error('noaudio'); e.code = 'noaudio'; throw e;
    }
    this._attach(stream, 'live');
  },
  async startMic() {
    if (!this.supportsMic) { const e = new Error('unsupported'); e.code = 'unsupported'; throw e; }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    this._attach(stream, 'mic');
  },
  _attach(stream, mode) {
    this.stop(true);
    const ctx = this.ensureCtx();
    if (!ctx) { stream.getTracks().forEach((t) => t.stop()); throw new Error('noaudioctx'); }
    this.stream = stream;
    this.src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = CONFIG.audio.fftSize;
    an.smoothingTimeConstant = CONFIG.audio.smoothing;
    an.minDecibels = -100;
    an.maxDecibels = -15;
    this.src.connect(an);           // jamais vers la sortie : pas de double son
    this.analyser = an;
    this._fr = new Float32Array(an.frequencyBinCount);
    this._mag = new Float32Array(an.frequencyBinCount);
    this._prev = new Float32Array(an.frequencyBinCount);
    this._td = new Float32Array(an.fftSize);
    this._buildBands(ctx.sampleRate, an.fftSize);
    for (const k in this._norm) this._norm[k] = k === 'flux' ? 0.001 : 0.02;
    this._flux.length = 0;
    this.mode = mode;
    const onEnd = () => { if (this.stream === stream) { this.stop(); this.emit('ended', mode); } };
    stream.getTracks().forEach((t) => t.addEventListener('ended', onEnd));
    this.emit('mode', mode);
  },
  stop(silent) {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.src) { try { this.src.disconnect(); } catch { /* ignore */ } }
    this.stream = null; this.src = null; this.analyser = null;
    if (this.mode !== 'auto') { this.mode = 'auto'; if (!silent) this.emit('mode', 'auto'); }
  },
  _buildBands(sr, fft) {
    const bins = fft / 2, hz = sr / fft, lo = 32, hi = 16000;
    this._bands = [];
    for (let b = 0; b < NB; b++) {
      const f0 = lo * Math.pow(hi / lo, b / NB), f1 = lo * Math.pow(hi / lo, (b + 1) / NB);
      const i0 = Math.min(bins - 1, Math.floor(f0 / hz));
      const i1 = Math.min(bins, Math.max(i0 + 1, Math.ceil(f1 / hz)));
      this._bands.push([i0, i1]);
    }
    const rng = (a, b) => { const i0 = Math.floor(a / hz); return [i0, Math.max(i0 + 1, Math.ceil(b / hz))]; };
    this._ranges = { bass: rng(35, 150), lowMid: rng(150, 500), mid: rng(500, 2000), high: rng(2000, 9000), kick: rng(40, 150) };
  },

  /* Tap tempo : cale BPM et phase du mode AUTO à l'oreille */
  tapTempo(t) {
    const now = performance.now() / 1000;
    const T = this.tap;
    if (T.wall.length && now - T.wall[T.wall.length - 1] > 2) { T.wall = []; T.play = []; }
    T.wall.push(now); T.play.push(t);
    if (T.wall.length > 8) { T.wall.shift(); T.play.shift(); }
    if (T.wall.length < 3) return 0;
    const iv = [];
    for (let i = 1; i < T.wall.length; i++) iv.push(T.wall[i] - T.wall[i - 1]);
    iv.sort((a, b) => a - b);
    const bpm = clamp(60 / iv[Math.floor(iv.length / 2)], 60, 200);
    const len = 60 / bpm;
    T.bpm = bpm;
    T.offset = ((t % len) + len) % len;
    if (this.videoId) { this.tempo[this.videoId] = { bpm: Math.round(bpm * 10) / 10, offset: T.offset }; store.set('tempo', this.tempo); }
    return bpm;
  },
  onTrack(videoId, index) {
    this.videoId = videoId || '';
    this.trackSeed = (index || 0) * 13.37 + 1.1;
    const saved = this.tempo[this.videoId];
    this.tap.bpm = saved ? saved.bpm : 0;
    this.tap.offset = saved ? saved.offset : 0;
    this._autoBeat = -1;
  },
  autoBpm() { return this.tap.bpm || CONFIG.bpm[this.videoId] || CONFIG.audio.defaultBpm; },

  _live(dt) {
    const an = this.analyser, fr = this._fr, mag = this._mag, prev = this._prev, td = this._td;
    an.getFloatFrequencyData(fr);
    an.getFloatTimeDomainData(td);
    for (let i = 0; i < fr.length; i++) mag[i] = fr[i] > -160 ? Math.pow(10, fr[i] / 20) : 0;
    const bandE = (r) => { let s = 0; for (let i = r[0]; i < r[1]; i++) s += mag[i] * mag[i]; return Math.sqrt(s / Math.max(1, r[1] - r[0])); };
    const R = this._ranges, raw = this._raw;
    raw.bass = bandE(R.bass); raw.lowMid = bandE(R.lowMid); raw.mid = bandE(R.mid); raw.high = bandE(R.high);
    let rms = 0;
    for (let i = 0; i < td.length; i++) rms += td[i] * td[i];
    raw.level = Math.sqrt(rms / td.length);
    // spectre en dB, relatif à la bande la plus forte
    let mx = -200;
    for (let b = 0; b < NB; b++) {
      const [i0, i1] = this._bands[b];
      let s = 0;
      for (let i = i0; i < i1; i++) s += fr[i] > -160 ? fr[i] : -160;
      const db = s / (i1 - i0);
      this._spec[b] = db;
      if (db > mx) mx = db;
    }
    this._specMax = mx > this._specMax ? mx : this._specMax - dt * 3;
    for (let b = 0; b < NB; b++) this._spec[b] = clamp((this._spec[b] - (this._specMax - 58)) / 58, 0, 1);
    for (let i = 0; i < 256; i++) this._wave[i] = td[Math.floor((i / 256) * td.length)] || 0;
    // flux spectral sur les basses → beats
    let flux = 0;
    for (let i = R.kick[0]; i < R.kick[1]; i++) { const d = mag[i] - prev[i]; if (d > 0) flux += d; }
    prev.set(mag);
    return flux;
  },

  _auto(t, playing) {
    const raw = this._raw;
    const bpm = this.autoBpm();
    const len = 60 / bpm;
    const pos = (t - this.tap.offset) / len;
    const bi = Math.floor(pos), ph = pos - bi;
    const barBeat = ((bi % 4) + 4) % 4;
    const section = Math.floor(bi / 32);
    const inten = 0.55 + 0.45 * vhash(section * 7.1 + this.trackSeed);
    const breakdown = vhash(section * 3.3 + this.trackSeed) < 0.14;
    const kick = Math.exp((-ph * len) / 0.11) * (breakdown ? 0.25 : 1);
    const hat = Math.exp((-(((ph + 0.5) % 1) * len)) / 0.045);
    const snare = barBeat === 1 || barBeat === 3 ? Math.exp((-ph * len) / 0.09) : 0;
    const n1 = vnoise1(t * 1.7 + this.trackSeed), n2 = vnoise1(t * 3.1 + 40), n3 = vnoise1(t * 6.3 + 90);
    raw.bass = (0.22 + 0.78 * kick) * inten;
    raw.lowMid = 0.25 + 0.35 * n1 + 0.35 * snare * inten;
    raw.mid = 0.22 + 0.35 * n2 + 0.38 * snare;
    raw.high = 0.18 + 0.55 * hat * inten + 0.22 * n3;
    raw.level = 0.3 + 0.42 * inten + 0.22 * kick;
    for (let b = 0; b < NB; b++) {
      const x = b / (NB - 1);
      const tilt = Math.pow(1 - x, 0.55) * 0.85 + 0.08;
      const zone = x < 0.22 ? raw.bass : x < 0.6 ? lerp(raw.lowMid, raw.mid, (x - 0.22) / 0.38) : raw.high;
      const nn = vnoise1(t * 4.0 + b * 1.37) * 0.35;
      this._spec[b] = clamp(tilt * (0.45 + 0.7 * zone) + nn - 0.15, 0, 1);
    }
    for (let i = 0; i < 256; i++) {
      const s = i / 256;
      this._wave[i] = (Math.sin(s * 40 + t * 31) * 0.45 + Math.sin(s * 9 - t * 7) * 0.4 * raw.bass + (vnoise1(s * 60 + t * 20) - 0.5) * 0.5 * raw.high) * raw.level * 0.6;
    }
    let beat = false, strong = false;
    if (playing && bi !== this._autoBeat) {
      if (this._autoBeat !== -1) { beat = !breakdown || barBeat === 0; strong = beat && barBeat === 0 && inten > 0.7; }
      this._autoBeat = bi;
    }
    this.F.bpm = bpm;
    return { beat, strong };
  },

  update(dt, t, playing) {
    this._clock += dt;
    const F = this.F, raw = this._raw;
    let beat = false, strong = false;
    if (this.analyser) {
      const flux = this._live(dt);
      // normalisation adaptative
      const decay = Math.exp(-dt * 0.08);
      for (const k of ['level', 'bass', 'lowMid', 'mid', 'high']) {
        this._norm[k] = Math.max(raw[k], this._norm[k] * decay, 1e-4);
        raw[k] = clamp(raw[k] / this._norm[k], 0, 1);
      }
      this._norm.flux = Math.max(flux, this._norm.flux * Math.exp(-dt * 0.12), 1e-5);
      const nf = flux / this._norm.flux;
      const hist = this._flux;
      hist.push(nf);
      if (hist.length > 50) hist.shift();
      const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
      if (nf > mean * CONFIG.audio.beatThreshold + 0.04 && nf > 0.22 && raw.bass > 0.3 && this._clock - this._lastBeat > 0.15) {
        beat = true;
        strong = nf > mean * 2.1 && nf > 0.5;
        this._lastBeat = this._clock;
        const bt = this._beatTimes;
        bt.push(this._clock);
        if (bt.length > 16) bt.shift();
        if (bt.length > 5) {
          const iv = [];
          for (let i = 1; i < bt.length; i++) {
            let d = bt[i] - bt[i - 1];
            if (d < 0.25 || d > 1.6) continue;
            let b = 60 / d;
            while (b < 85) b *= 2;
            while (b > 175) b /= 2;
            iv.push(b);
          }
          if (iv.length > 3) { iv.sort((a, b) => a - b); F.bpm = lerp(F.bpm, iv[Math.floor(iv.length / 2)], 0.3); }
        }
      }
    } else {
      const r = this._auto(t, playing);
      beat = r.beat; strong = r.strong;
    }
    // pause : calme mais vivant
    const idle = !playing;
    const c = this._clock;
    const set = (k, v) => {
      const target = idle ? 0.06 + 0.04 * Math.sin(c * 1.3 + k.length) : v;
      F[k] = target > F[k] ? damp(F[k], target, 28, dt) : damp(F[k], target, idle ? 2.5 : 7, dt);
    };
    set('level', raw.level); set('bass', raw.bass); set('lowMid', raw.lowMid); set('mid', raw.mid); set('high', raw.high);
    for (let b = 0; b < NB; b++) {
      const target = idle ? 0.07 + 0.05 * Math.sin(c * 1.6 + b * 0.35) : this._spec[b];
      F.spectrum[b] = target > F.spectrum[b] ? damp(F.spectrum[b], target, 30, dt) : damp(F.spectrum[b], target, idle ? 3 : 9, dt);
    }
    for (let i = 0; i < 256; i++) {
      const target = idle ? Math.sin(i * 0.05 + c * 1.2) * 0.12 : this._wave[i];
      F.waveform[i] = damp(F.waveform[i], target, 25, dt);
    }
    F.beat = beat && playing;
    F.strong = strong && playing;
    F.kick = F.beat ? 1 : F.kick * Math.exp(-dt / 0.18);
  },
});
