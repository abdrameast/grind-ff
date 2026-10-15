/* =============================================================================
   Titres des pistes : Data API (si clé) → oEmbed → noembed → getVideoData()
   ========================================================================== */
function parseTitle(raw, author) {
  let t = String(raw || '').replace(/\s+/g, ' ').trim();
  const keep = /remix|mix|edit|version|ver\.|feat|ft\.|instrumental|live/i;
  t = t.replace(/\[([^\]]*)\]/g, (m, inner) => (keep.test(inner) ? `(${inner})` : ''));
  t = t.replace(/\(([^)]*)\)/g, (m, inner) => (keep.test(inner) ? m : ''));
  t = t.replace(/\b(HQ|HD|4K|1080p|720p|OST|Official\s+(Audio|Video|Music\s+Video)|Audio|Lyrics?|Full\s+Song)\b/gi, '');
  t = t.replace(/Jet Set Radio( Future)?( Soundtrack)?|\bJSRF?\b|\bJGR\b/gi, '');
  t = t.replace(/\s+/g, ' ').replace(/^[\s\-–—|:~·]+|[\s\-–—|:~·]+$/g, '').trim();
  let artist = '', title = t;
  const parts = t.split(/\s+[-–—|]\s+|\s*[–—]\s*/);
  if (parts.length >= 2 && parts[0].length <= 48) {
    artist = parts[0].trim();
    title = parts.slice(1).join(' - ').trim();
  }
  title = title.replace(/^["“'«]\s*|\s*["”'»]$/g, '').trim() || t || raw;
  return { title, artist, author: author || '' };
}

/* Rapproche un titre YouTube de la tracklist de référence du disque (−1 si aucun). */
function matchKnown(disc, raw) {
  if (!disc || !disc._known.length) return -1;
  const n = trackKey(raw);
  let best = -1, bestScore = 0;
  disc._known.forEach((k, j) => {
    let score = 0;
    if (k.full.length >= 3 && n.includes(k.full)) score = k.full.length + 100;
    else if (k.base.length >= 4 && n.includes(k.base)) score = k.base.length;
    if (!score) return;
    if (k.akey.length >= 3 && n.includes(k.akey)) score += 20;
    if (score > bestScore) { bestScore = score; best = j; }
  });
  return best;
}
/* Pour une piste dont le titre n'est pas encore arrivé : on suit l'alignement des voisines. */
function guessKnown(disc, i) {
  const m = disc._match;
  for (let k = i - 1; k >= 0; k--) if (m[k] != null) return m[k] + (i - k);
  for (let k = i + 1; k < i + 60; k++) if (m[k] != null) return m[k] - (k - i);
  return i;
}

const Titles = emitter({
  map: store.get('titles', {}),
  oembedOk: true,
  get(id) { return id ? this.map[id] || null : null; },
  remember(id, raw, author) {
    if (!id || !raw) return;
    const prev = this.map[id];
    if (prev && prev.raw === raw) return;
    this.map[id] = { raw, ...parseTitle(raw, author) };
    this.save();
    this.emit('update', id);
  },
  save: debounce(() => store.set('titles', Titles.map), 600),
  async load(ids, playlistId) {
    if (!ids || !ids.length) return;
    if (CONFIG.YT_API_KEY) {
      try { await this.fromDataAPI(playlistId); return; } catch { /* repli oEmbed */ }
    }
    const todo = ids.filter((id) => !this.map[id]);
    let i = 0;
    const worker = async () => { while (i < todo.length) { const id = todo[i++]; await this.fetchOne(id); } };
    await Promise.all([worker(), worker(), worker(), worker()]);
  },
  async fetchOne(id) {
    const u = encodeURIComponent('https://www.youtube.com/watch?v=' + id);
    const urls = [];
    if (this.oembedOk) urls.push(`https://www.youtube.com/oembed?url=${u}&format=json`);
    urls.push(`https://noembed.com/embed?url=${u}`);
    for (const url of urls) {
      try {
        const r = await fetchTimeout(url, 6000);
        if (!r.ok) continue;
        const j = await r.json();
        if (j && j.title) { this.remember(id, j.title, j.author_name); return; }
      } catch {
        if (url.includes('youtube.com/oembed')) this.oembedOk = false;
      }
    }
  },
  async fromDataAPI(playlistId) {
    let token = '';
    let n = 0;
    do {
      const r = await fetchTimeout(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${playlistId}&key=${CONFIG.YT_API_KEY}${token ? '&pageToken=' + token : ''}`, 8000);
      if (!r.ok) throw new Error('api');
      const j = await r.json();
      for (const it of j.items || []) {
        const s = it.snippet || {};
        if (s.resourceId && s.resourceId.videoId) this.remember(s.resourceId.videoId, s.title, s.videoOwnerChannelTitle);
      }
      token = j.nextPageToken || '';
    } while (token && ++n < 6);
  },
});

/* =============================================================================
   Lecteur : YouTube IFrame API (invisible) ou mode démo si YouTube est indisponible
   ========================================================================== */
function loadYouTubeAPI(timeout) {
  return new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) { resolve(); return; }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (typeof prev === 'function') prev(); resolve(); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => reject(new Error('blocked'));
    document.head.appendChild(s);
    setTimeout(() => { if (window.YT && window.YT.Player) resolve(); else reject(new Error('timeout')); }, timeout);
  });
}

const Player = emitter({
  kind: 'pending',       // 'youtube' | 'demo'
  ready: false,
  wantPlay: false,
  state: -1,
  disc: CONFIG.DISCS[CONFIG.DEFAULT_DISC] || CONFIG.DISCS[0],
  index: 0,
  ids: [],
  videoId: '',
  blocked: new Set(),
  volume: clamp(store.get('volume', CONFIG.VOLUME), 0, 100),
  muted: !!store.get('muted', false),
  duration: 0,
  t: 0, _raw: -1, _base: 0, _stamp: 0,
  errors: 0,
  demo: null,
  started: false,
  switching: false,
  _sig: '',

  get playing() { return this.kind === 'demo' ? !!(this.demo && this.demo.playing) : (this.state === 1 || (this.state === 3 && this.wantPlay)); },
  get buffering() { return this.kind === 'youtube' && this.state === 3 && this.wantPlay; },
  get count() { return this.ids.length || this.disc._known.length || this.disc.countHint || 30; },

  async init() {
    if (location.protocol === 'file:') { this.toDemo('file'); return; }
    try {
      await loadYouTubeAPI(25000);
    } catch {
      this.toDemo('blocked');
      return;
    }
    this.kind = 'youtube';
    this._createdWith = this.disc.playlistId;
    try {
      this.yt = new YT.Player('yt', {
        width: 200, height: 200,
        playerVars: {
          listType: 'playlist', list: this.disc.playlistId,
          autoplay: 0, controls: 0, disablekb: 1, fs: 0, playsinline: 1, rel: 0, iv_load_policy: 3,
          origin: location.origin,
        },
        events: {
          onReady: () => this._onReady(),
          onStateChange: (e) => this._onState(e.data),
          onError: (e) => this._onError(e.data),
          onAutoplayBlocked: () => this.emit('needtap', 'autoplay'),
        },
      });
    } catch {
      this.toDemo('blocked');
      return;
    }
    this._readyT = setTimeout(() => { if (!this.ready) this.toDemo('noready'); }, 25000);
  },

  _onReady() {
    if (this.kind !== 'youtube') return;
    clearTimeout(this._readyT);
    this.ready = true;
    this.applyVolume();
    this._loopFlags();
    this.emit('ready');
    if (this.disc.playlistId !== this._createdWith) {
      // le disque a changé pendant le chargement de YouTube
      this._loadList(this.wantPlay);
      return;
    }
    this._pollPlaylist(0, '');
    if (this.wantPlay) this.play();
  },
  _loopFlags() {
    try { this.yt.setShuffle(false); this.yt.setLoop(true); } catch { /* lecteur pas prêt */ }
  },
  _pollPlaylist(n, notSig) {
    const token = this._pollToken = (this._pollToken || 0) + 1;
    const step = (k) => {
      if (token !== this._pollToken) return;
      let ids = null;
      try { ids = this.yt.getPlaylist(); } catch { ids = null; }
      const ok = Array.isArray(ids) && ids.length;
      const sig = ok ? ids.join(',') : '';
      if (ok && (sig !== notSig || k >= 40)) {
        this.ids = ids.slice();
        this._sig = sig;
        this.disc._match = {};
        this.switching = false;
        this._loopFlags();
        this.emit('playlist', this.ids);
        Titles.load(this.ids, this.disc.playlistId);
        this.index = -1;
        this.videoId = '';
        this._checkIndex();
        return;
      }
      if (k < 60) setTimeout(() => step(k + 1), 300);
      else this.switching = false;
    };
    step(n);
  },
  _checkIndex() {
    if (this.kind !== 'youtube' || !this.ready || this.switching) return;
    let i = -1, data = null;
    try { i = this.yt.getPlaylistIndex(); data = this.yt.getVideoData ? this.yt.getVideoData() : null; } catch { /* ignore */ }
    const dataId = data && data.video_id;
    if (data && data.title && dataId) Titles.remember(dataId, data.title, data.author);
    // l'ordre de la playlist fait foi : getVideoData() peut encore renvoyer la piste précédente
    const vid = this.ids[i] || dataId || '';
    if (typeof i === 'number' && i >= 0 && (i !== this.index || (vid && vid !== this.videoId))) {
      const first = !this.videoId;
      this.index = i;
      this.videoId = vid;
      this.duration = 0;
      this.emit('track', i, first);
    }
  },
  _onState(s) {
    const wasPlaying = this.playing;
    this.state = s;
    if (s === 1) {
      this.errors = 0;
      this.started = true;
      clearTimeout(this._watch);
      this.emit('started');
    }
    this._checkIndex();
    this.emit('state', s);
    if (wasPlaying !== this.playing) this.emit('playing', this.playing);
  },
  _onError(code) {
    if (code === 153) { this.emit('fatal', 153); return; }
    this._checkIndex();
    const id = this.ids[this.index] || this.videoId;
    if (id) this.blocked.add(id);
    this.emit('blocked', this.index, code);
    this.errors++;
    if (this.errors >= Math.min(this.count || 8, 8)) { this.emit('fatal', 'all'); return; }
    clearTimeout(this._skip);
    this._skip = setTimeout(() => { try { this.yt.nextVideo(); } catch { /* ignore */ } }, 1000);
  },
  _armWatchdog() {
    clearTimeout(this._watch);
    this._watch = setTimeout(() => {
      if (this.kind === 'youtube' && this.wantPlay && this.state !== 1 && this.state !== 3) this.emit('needtap', 'watchdog');
    }, 2200);
  },

  /* Change de disque : charge sa playlist (et la lance si la radio jouait). */
  setDisc(disc, play) {
    this.disc = disc;
    this.ids = [];
    this.index = 0;
    this.videoId = '';
    this.blocked = new Set();
    this.errors = 0;
    this.duration = 0;
    this.t = 0; this._raw = -1; this._base = 0;
    this._cardPending = null;
    clearTimeout(this._skip);
    clearTimeout(this._watch);
    this.wantPlay = !!play;
    if (this.kind === 'demo') {
      this._demoInit();
      this.emit('playlist', null);
      if (play) this._demoGo(0); else this.emit('track', 0, true);
      return;
    }
    this.emit('playlist', null);
    if (this.kind !== 'youtube' || !this.ready) return;   // appliqué dès que YouTube est prêt
    this._loadList(play);
  },
  _loadList(play) {
    this.switching = true;
    // signature de la liste actuellement chargée : on attend que YouTube en renvoie une autre
    let cur = this._sig;
    try { const ids = this.yt.getPlaylist(); if (Array.isArray(ids) && ids.length) cur = ids.join(','); } catch { /* ignore */ }
    this._sig = cur;
    const opts = { listType: 'playlist', list: this.disc.playlistId, index: 0, startSeconds: 0 };
    try {
      if (play) this.yt.loadPlaylist(opts); else this.yt.cuePlaylist(opts);
    } catch { /* ignore */ }
    if (play) this._armWatchdog();
    this._pollPlaylist(0, this._sig);
  },

  _demoInit() {
    const rnd = mulberry32(35 + this.disc.index * 7);
    const n = this.count;
    this.demo = { playing: false, t: 0, durs: Array.from({ length: n }, (_, i) => (i % 9 === 8 ? 12 : 150 + rnd() * 110)) };
    this.duration = this.demo.durs[0];
  },
  toDemo(reason) {
    clearTimeout(this._readyT);
    this.kind = 'demo';
    this.ready = true;
    this._demoInit();
    this.emit('demo', reason);
    this.emit('ready');
    this.emit('playlist', null);
    if (this.wantPlay) this.play();
  },

  play() {
    this.wantPlay = true;
    if (!this.ready) { this.emit('pending'); return; }
    if (this.kind === 'demo') {
      const was = this.demo.playing;
      this.demo.playing = true;
      if (!this.started) { this.started = true; this.emit('track', this.index, true); }
      if (!was) { this.emit('started'); this.emit('playing', true); }
      return;
    }
    try {
      if (this.state === 0 && this.index >= this.count - 1) this.yt.playVideoAt(0);
      else this.yt.playVideo();
    } catch { /* ignore */ }
    this._armWatchdog();
  },
  pause() {
    this.wantPlay = false;
    if (this.kind === 'demo') {
      if (this.demo && this.demo.playing) { this.demo.playing = false; this.emit('playing', false); }
      return;
    }
    try { this.yt.pauseVideo(); } catch { /* ignore */ }
  },
  toggle() { if (this.wantPlay) this.pause(); else this.play(); },
  next() {
    if (this.kind === 'demo') { this._demoGo((this.index + 1) % this.count); return; }
    if (!this.ready || this.switching) return;
    this.wantPlay = true;
    try { this.yt.nextVideo(); } catch { /* ignore */ }
  },
  prev() {
    if (this.kind === 'demo') { if (this.t > 3) this.seek(0); else this._demoGo((this.index - 1 + this.count) % this.count); return; }
    if (!this.ready || this.switching) return;
    this.wantPlay = true;
    try { if (this.t > 3) this.yt.seekTo(0, true); else this.yt.previousVideo(); } catch { /* ignore */ }
  },
  playAt(i) {
    if (this.kind === 'demo') { this._demoGo(i); return; }
    if (!this.ready || this.switching) return;
    this.wantPlay = true;
    try { this.yt.playVideoAt(i); } catch { /* ignore */ }
    this._armWatchdog();
  },
  seek(s) {
    s = Math.max(0, s);
    if (this.kind === 'demo') { this.demo.t = Math.min(s, this.duration - 0.2); this.t = this.demo.t; return; }
    if (!this.ready) return;
    try { this.yt.seekTo(s, true); } catch { /* ignore */ }
    this._base = s; this._stamp = performance.now(); this.t = s;
  },
  _demoGo(i) {
    this.index = (i + this.count) % this.count;
    this.demo.t = 0;
    this.t = 0;
    this.duration = this.demo.durs[this.index] || 180;
    this.wantPlay = true;
    const was = this.demo.playing;
    this.demo.playing = true;
    this.started = true;
    this.emit('track', this.index, false);
    if (!was) { this.emit('started'); this.emit('playing', true); }
  },
  setVolume(v) {
    this.volume = clamp(Math.round(v), 0, 100);
    if (this.volume > 0 && this.muted) this.muted = false;
    store.set('volume', this.volume);
    store.set('muted', this.muted);
    this.applyVolume();
    this.emit('volume', this.volume, this.muted);
  },
  toggleMute() {
    this.muted = !this.muted;
    store.set('muted', this.muted);
    this.applyVolume();
    this.emit('volume', this.volume, this.muted);
  },
  applyVolume() {
    if (this.kind !== 'youtube' || !this.yt) return;
    try {
      this.yt.setVolume(this.volume);
      if (this.muted) this.yt.mute(); else this.yt.unMute();
    } catch { /* ignore */ }
  },

  update(dt) {
    if (this.kind === 'demo') {
      const d = this.demo;
      if (d.playing) {
        d.t += dt;
        if (d.t >= this.duration) this._demoGo(this.index + 1);
      }
      this.t = d.t;
      return;
    }
    if (this.kind !== 'youtube' || !this.ready || this.switching) return;
    const now = performance.now();
    let raw = 0, dur = 0;
    try { raw = this.yt.getCurrentTime() || 0; dur = this.yt.getDuration() || 0; } catch { /* ignore */ }
    if (raw !== this._raw) {
      this._raw = raw;
      if (this.state !== 1 || raw > this.t || Math.abs(raw - this.t) > 0.35) { this._base = raw; this._stamp = now; }
    }
    const est = this.state === 1 ? this._base + (now - this._stamp) / 1000 : raw;
    this.t = dur ? Math.min(est, dur) : est;
    if (dur && Math.abs(dur - this.duration) > 0.5) { this.duration = dur; this.emit('duration', dur); }
    this._pollT = (this._pollT || 0) + dt;
    if (this._pollT > 0.5) { this._pollT = 0; this._checkIndex(); }
  },

  info(i = this.index) {
    const disc = this.disc;
    const known = disc._known;
    const id = this.ids[i] || (i === this.index ? this.videoId : '');
    const t = Titles.get(id);
    if (t) {
      const j = matchKnown(disc, t.raw);
      if (j >= 0) { disc._match[i] = j; return { title: known[j].title, artist: known[j].artist, unknown: false }; }
      return { title: t.title, artist: t.artist || (t.author ? 'via ' + t.author : ''), unknown: false };
    }
    if (known.length) {
      const j = guessKnown(disc, i);
      if (j >= 0 && j < known.length) return { title: known[j].title, artist: known[j].artist, unknown: false };
    }
    if (this.kind === 'demo') return { title: `PISTE ${pad2(i + 1)}`, artist: 'Mode démo · sans son', unknown: true };
    return { title: `PISTE ${pad2(i + 1)}`, artist: 'Titre en cours de chargement', unknown: true };
  },
});
