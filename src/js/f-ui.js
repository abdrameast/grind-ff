/* =============================================================================
   Sons d'interface synthétisés (pschitt de bombe, scratch)
   ========================================================================== */
const SFX = {
  on: store.get('sfx', true),
  ctx: null, buf: null,
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { this.ctx = new AC(); } catch { return null; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  },
  noise() {
    if (this.buf) return this.buf;
    const c = this.ctx, n = Math.floor(c.sampleRate * 0.5);
    this.buf = c.createBuffer(1, n, c.sampleRate);
    const d = this.buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return this.buf;
  },
  shot(f0, f1, dur, gain, q) {
    if (!this.on) return;
    const c = this.ensure();
    if (!c) return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise();
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = q;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(c.destination);
    src.start(t);
    src.stop(t + dur + 0.02);
  },
  spray() { this.shot(5200, 3600, 0.3, 0.07, 0.7); },
  scratch() { this.shot(2600, 520, 0.17, 0.06, 2.2); },
  eject() { this.shot(900, 3200, 0.22, 0.05, 1.4); },
  tick() { this.shot(1800, 1500, 0.05, 0.03, 4); },
};

/* =============================================================================
   HUD
   ========================================================================== */
const UI = {
  els: {},
  accentIdx: 0,
  accentHex: CONFIG.palette.lime,
  accent2Hex: CONFIG.palette.magenta,
  panelOpen: false,
  dragProgress: false,
  lastOno: 0, lastBurst: 0, lastFlash: 0,
  onAirLit: 0,
  modalReturn: null,
  introCardDone: false,
  suppressCard: false,

  init() {
    const ids = ['station', 'freq', 'onair', 'needle', 'btnSync', 'modeTag', 'btnTracks', 'btnSfx', 'btnFs', 'btnHelp', 'discHit', 'cta', 'status',
      'banner', 'modeChip', 'discs', 'tTitle', 'tArtist', 'tNum', 'tTime', 'progress', 'pFill', 'pCap', 'btnPrev', 'btnPlay', 'btnNext', 'icoPlay', 'icoPause',
      'knob', 'volLed', 'tracklist', 'plName', 'discTabs', 'btnCloseTracks', 'tracks', 'card', 'cardKicker', 'cardNum', 'cardTitle', 'interlude', 'toasts',
      'demo', 'demoWhy', 'syncModal', 'helpModal', 'btnLive', 'btnMic', 'btnAuto', 'syncNote', 'tv', 'tvScreen', 'intro', 'introText', 'ytBox', 'boilNoise'];
    for (const id of ids) this.els[id] = document.getElementById(id);
    const E = this.els;
    E.freq.textContent = CONFIG.STATION_FREQ;
    E.btnSfx.setAttribute('aria-pressed', String(SFX.on));

    E.btnPlay.addEventListener('click', () => actPlay());
    E.discHit.addEventListener('click', () => actPlay());
    E.btnPrev.addEventListener('click', () => { SFX.scratch(); Player.prev(); });
    E.btnNext.addEventListener('click', () => { SFX.scratch(); Player.next(); });
    E.btnTracks.addEventListener('click', () => this.togglePanel());
    E.btnCloseTracks.addEventListener('click', () => this.togglePanel(false));
    E.btnSfx.addEventListener('click', () => {
      SFX.on = !SFX.on;
      store.set('sfx', SFX.on);
      E.btnSfx.setAttribute('aria-pressed', String(SFX.on));
      if (SFX.on) SFX.tick();
    });
    E.btnFs.addEventListener('click', () => toggleFullscreen());
    E.btnHelp.addEventListener('click', () => this.openModal('helpModal'));
    E.btnSync.addEventListener('click', () => this.openModal('syncModal'));
    E.btnLive.addEventListener('click', () => startSync('live'));
    E.btnMic.addEventListener('click', () => startSync('mic'));
    E.btnAuto.addEventListener('click', () => { AudioFX.stop(); this.closeModal(); });
    if (!AudioFX.supportsLive) {
      E.btnLive.hidden = true;
      E.syncNote.hidden = false;
      E.syncNote.textContent = "Ce navigateur ne sait pas partager l'audio d'un onglet (c'est possible dans Chrome et Edge sur ordinateur). Le micro reste disponible.";
    }
    if (!AudioFX.supportsMic) E.btnMic.hidden = true;
    for (const m of [E.syncModal, E.helpModal]) {
      m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) this.closeModal(); });
    }
    E.tracks.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      SFX.scratch();
      Player.playAt(Number(b.dataset.i));
    });

    // sélecteur de disque (bandeau) + onglets (tracklist)
    this.buildDiscSwitchers();

    // progression : clic, glisser, clavier
    const seekAt = (clientX) => {
      const r = E.progress.getBoundingClientRect();
      const f = clamp((clientX - r.left) / r.width, 0, 1);
      if (Player.duration > 0) Player.seek(f * Player.duration);
      this.renderProgress(Player.duration > 0 ? f * Player.duration : 0, Player.duration);
    };
    E.progress.addEventListener('pointerdown', (e) => { this.dragProgress = true; E.progress.setPointerCapture(e.pointerId); seekAt(e.clientX); });
    E.progress.addEventListener('pointermove', (e) => { if (this.dragProgress) seekAt(e.clientX); });
    E.progress.addEventListener('pointerup', () => { this.dragProgress = false; });
    E.progress.addEventListener('pointercancel', () => { this.dragProgress = false; });
    E.progress.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault(); e.stopPropagation();
        Player.seek(Player.t + (e.key === 'ArrowRight' ? 5 : -5));
      }
    });

    // molette de volume
    let kStart = null;
    E.knob.addEventListener('pointerdown', (e) => { kStart = { y: e.clientY, v: Player.volume }; E.knob.setPointerCapture(e.pointerId); });
    E.knob.addEventListener('pointermove', (e) => { if (kStart) Player.setVolume(kStart.v + (kStart.y - e.clientY) * 0.6); });
    E.knob.addEventListener('pointerup', () => { kStart = null; });
    E.knob.addEventListener('pointercancel', () => { kStart = null; });
    E.knob.addEventListener('wheel', (e) => { e.preventDefault(); Player.setVolume(Player.volume - Math.sign(e.deltaY) * 4); }, { passive: false });
    E.knob.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); Player.setVolume(Player.volume + 5); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); Player.setVolume(Player.volume - 5); }
    });
    this.renderVolume(Player.volume, Player.muted);
    this.setAccent(0);
    this.showDisc(Player.disc);
  },

  /* ---------- disques ---------- */
  buildDiscSwitchers() {
    const E = this.els;
    const mk = (d, tab) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = tab ? 'disc-tab' : 'disc-btn';
      b.setAttribute('role', 'radio');
      b.dataset.disc = String(d.index);
      b.setAttribute('aria-label', `Disque ${d.index + 1} : ${d.name}${d.year ? ' (' + d.year + ')' : ''}`);
      b.title = `${d.name} — ${d.subtitle}${d.year ? ' (' + d.year + ')' : ''}`;
      const img = document.createElement('img');
      img.alt = '';
      img.width = img.height = tab ? 40 : 30;
      img.src = d.thumb || '';
      if (!d.thumb && d.label && d.label.url) loadImage(d.label.url).then((im) => { d.thumb = inkToThumb(imageToInk(im)); img.src = d.thumb; }).catch(() => {});
      const txt = document.createElement('span');
      txt.className = 'disc-txt';
      const big = document.createElement('b');
      big.textContent = tab ? d.name : d.short;
      const small = document.createElement('small');
      small.textContent = tab ? `DISC ${d.index + 1}${d.year ? ' · ' + d.year : ''}` : String(d.year || `DISC ${d.index + 1}`);
      txt.append(big, small);
      b.append(img, txt);
      b.addEventListener('click', () => switchDisc(d.index));
      return b;
    };
    E.discs.replaceChildren(...CONFIG.DISCS.map((d) => mk(d, false)));
    E.discTabs.replaceChildren(...CONFIG.DISCS.map((d) => mk(d, true)));
    // flèches gauche/droite dans un groupe radio
    for (const group of [E.discs, E.discTabs]) {
      group.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault(); e.stopPropagation();
        const n = CONFIG.DISCS.length;
        const i = (Player.disc.index + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
        switchDisc(i);
        const btn = group.querySelector(`[data-disc="${i}"]`);
        if (btn) btn.focus();
      });
    }
    this.setDiscActive(Player.disc.index);
  },
  setDiscActive(i) {
    for (const b of document.querySelectorAll('.disc-btn, .disc-tab')) {
      const on = Number(b.dataset.disc) === i;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  },
  showDisc(disc) {
    const E = this.els;
    E.plName.textContent = `${disc.name} — ${disc.subtitle}`;
    this.setDiscActive(disc.index);
    this.renderTracklist();
    E.tracks.scrollTop = 0;
    this.trackInfo(Player.index);
  },
  showDiscCard(disc) {
    const E = this.els;
    E.card.classList.remove('station');
    E.card.classList.add('disc');
    E.cardKicker.textContent = `DISC ${disc.index + 1}`;
    E.cardNum.textContent = disc.short;
    E.cardTitle.textContent = `${disc.name}${disc.year ? ' · ' + disc.year : ''}`;
    E.card.classList.remove('show');
    void E.card.offsetWidth;
    E.card.classList.add('show');
  },

  setAccent(i) {
    this.accentIdx = i;
    const [a, b] = ACCENTS[i % ACCENTS.length];
    this.accentHex = CONFIG.palette[a];
    this.accent2Hex = CONFIG.palette[b];
    document.documentElement.style.setProperty('--accent', this.accentHex);
    document.documentElement.style.setProperty('--accent-2', this.accent2Hex);
  },

  status(text) {
    const s = this.els.status;
    if (!text) { s.hidden = true; return; }
    s.hidden = false;
    s.textContent = text;
  },

  setPlaying(p) {
    const E = this.els;
    E.icoPlay.toggleAttribute('hidden', p);
    E.icoPause.toggleAttribute('hidden', !p);
    E.btnPlay.setAttribute('aria-label', p ? 'Pause' : 'Lire');
    E.discHit.setAttribute('aria-label', p ? 'Mettre la radio en pause' : 'Lire la radio');
    E.onair.classList.toggle('live', p);
    document.getElementById('app').classList.toggle('is-playing', p);
  },

  trackInfo(i) {
    const info = Player.info(i);
    const E = this.els;
    E.tTitle.textContent = info.title;
    E.tArtist.textContent = info.artist || ' ';
    E.tNum.textContent = `TR ${pad2(i + 1)}/${pad2(Player.count)}`;
    return info;
  },
  slamTitle() {
    const t = this.els.tTitle;
    t.classList.remove('slam');
    void t.offsetWidth;
    t.classList.add('slam');
  },

  showCard(i, info, station) {
    const E = this.els;
    E.card.classList.remove('disc');
    E.card.classList.toggle('station', !!station);
    E.cardKicker.textContent = station ? 'STATION ID' : 'TRACK';
    E.cardNum.textContent = station ? CONFIG.STATION_NAME : pad2(i + 1);
    E.cardTitle.textContent = station ? `${CONFIG.STATION_FREQ} MHz · ON AIR` : info.title;
    E.card.classList.remove('show');
    void E.card.offsetWidth;
    E.card.classList.add('show');
  },
  interlude() {
    const el = this.els.interlude;
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
  },

  ono(x, y) {
    const now = performance.now();
    if (now - this.lastOno < 420 || reduced()) return;
    this.lastOno = now;
    const words = ['ドン!', 'バン!', 'ズン!', 'ドドン!', 'ブン!'];
    const el = document.createElement('div');
    el.className = 'ono';
    el.textContent = words[Math.floor(Math.random() * words.length)];
    const size = 38 + Math.random() * 30;
    el.style.fontSize = size + 'px';
    el.style.color = Math.random() < 0.5 ? this.accentHex : this.accent2Hex;
    el.style.setProperty('--x', `${Math.round(x - size)}px`);
    el.style.setProperty('--y', `${Math.round(y - size * 0.5)}px`);
    el.style.setProperty('--r', `${Math.round((Math.random() - 0.5) * 30)}deg`);
    $('#hud').appendChild(el);
    setTimeout(() => el.remove(), 800);
  },

  toast(html, kind = '', ms = 3800) {
    const box = this.els.toasts;
    while (box.children.length >= 3) box.firstElementChild.remove();
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.innerHTML = html;
    box.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, ms);
  },

  renderVolume(v, muted) {
    const E = this.els;
    const shown = muted ? 0 : v;
    E.volLed.textContent = muted ? 'MUTE' : String(v);
    E.knob.setAttribute('aria-valuenow', String(shown));
    E.knob.setAttribute('aria-valuetext', muted ? 'Son coupé' : `${v} %`);
    E.knob.style.setProperty('--vol-deg', `${(shown / 100) * 300}deg`);
    E.knob.style.setProperty('--vol-rot', `${-150 + (shown / 100) * 300}deg`);
  },

  renderProgress(t, dur) {
    const E = this.els;
    const f = dur > 0 ? clamp(t / dur, 0, 1) : 0;
    E.pFill.style.width = (f * 100).toFixed(2) + '%';
    E.pCap.style.left = (f * 100).toFixed(2) + '%';
    E.tTime.textContent = `${fmtTime(t)} / ${dur > 0 ? fmtTime(dur) : '-:--'}`;
    E.progress.setAttribute('aria-valuenow', String(Math.round(f * 100)));
    E.progress.setAttribute('aria-valuetext', fmtTime(t));
  },

  renderTracklist() {
    const E = this.els;
    const n = Player.count;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < n; i++) {
      const li = document.createElement('li');
      li.dataset.i = String(i);
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.i = String(i);
      b.innerHTML = '<span class="n"></span><span class="t"><strong></strong><span></span></span><span class="st"></span>';
      li.appendChild(b);
      frag.appendChild(li);
    }
    E.tracks.replaceChildren(frag);
    this.refreshTracklist();
  },
  refreshTracklist() {
    const rows = this.els.tracks.children;
    for (let i = 0; i < rows.length; i++) this.refreshRow(i);
  },
  refreshRow(i) {
    const li = this.els.tracks.children[i];
    if (!li) return;
    const info = Player.info(i);
    const id = Player.ids[i];
    const blocked = id && Player.blocked.has(id);
    const cur = Player.started && i === Player.index;
    li.className = (cur ? 'cur ' : '') + (blocked ? 'blocked ' : '') + (info.unknown ? 'unknown' : '');
    const b = li.firstElementChild;
    b.querySelector('.n').textContent = pad2(i + 1);
    b.querySelector('strong').textContent = info.title;
    b.querySelector('.t span').textContent = info.artist || '';
    b.querySelector('.st').textContent = blocked ? 'BLOCKED' : '';
    b.setAttribute('aria-label', `Piste ${i + 1} : ${info.title}${info.artist ? ', ' + info.artist : ''}${blocked ? ' (indisponible)' : ''}`);
    if (cur) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
  },
  togglePanel(force) {
    const open = typeof force === 'boolean' ? force : !this.panelOpen;
    this.panelOpen = open;
    this.els.tracklist.hidden = !open;
    this.els.btnTracks.setAttribute('aria-expanded', String(open));
    if (open) {
      this.refreshTracklist();
      const cur = this.els.tracks.querySelector('li.cur');
      const list = this.els.tracks;
      list.scrollTop = cur ? Math.max(0, cur.offsetTop - list.offsetTop - list.clientHeight / 2 + cur.offsetHeight / 2) : 0;
    }
  },

  openModal(id) {
    const m = this.els[id];
    if (!m) return;
    this.closeModal();
    this.modalReturn = document.activeElement;
    m.hidden = false;
    const f = m.querySelector('.modal-actions button:not([hidden]), button[data-close]');
    if (f) f.focus();
  },
  closeModal() {
    let closed = false;
    for (const m of [this.els.syncModal, this.els.helpModal]) if (!m.hidden) { m.hidden = true; closed = true; }
    if (closed && this.modalReturn && this.modalReturn.focus) this.modalReturn.focus();
    return closed;
  },

  showDemo(reason) {
    const why = {
      file: "Ouvre le site via un serveur (npx serve) ou héberge-le : YouTube refuse les pages ouvertes en file://.",
      blocked: "YouTube est bloqué ici (bloqueur de pub, réseau ou aperçu intégré). Héberge le site pour écouter les playlists.",
      noready: "YouTube ne répond pas. Vérifie la connexion puis recharge la page.",
    };
    this.els.demoWhy.textContent = why[reason] || why.blocked;
    this.els.demo.hidden = false;
  },

  showTV(show) {
    const E = this.els;
    E.tv.hidden = !show;
    const box = E.ytBox;
    if (show) {
      const r = E.tvScreen.getBoundingClientRect();
      box.style.left = r.left + 'px';
      box.style.top = r.top + 'px';
      box.style.bottom = 'auto';
      box.style.transform = 'rotate(-2deg)';
      box.classList.add('reveal');
    } else {
      box.classList.remove('reveal');
      box.style.left = '0px';
      box.style.top = 'auto';
      box.style.bottom = '0px';
      box.style.transform = '';
    }
  },

  endIntro() {
    const el = this.els.intro;
    if (!el || el.classList.contains('done')) return;
    el.classList.add('done');
    setTimeout(() => { el.hidden = true; }, 420);
  },

  /* placement des éléments liés au disque (CTA, cible clavier, statut) */
  place(disc) {
    const E = this.els;
    const hit = E.discHit.style;
    hit.left = (disc.x - disc.r) + 'px';
    hit.top = (disc.y - disc.r) + 'px';
    hit.width = hit.height = (disc.r * 2) + 'px';
    if (!E.cta.hidden) {
      const ctaW = E.cta.offsetWidth || 220;
      const x = clamp(disc.x + disc.r * 0.55, 12, view.W - ctaW - 16);
      const y = Math.max(8, disc.y - disc.r * 1.02 - 20);
      E.cta.style.setProperty('--cx', x + 'px');
      E.cta.style.setProperty('--cy', y + 'px');
    }
    if (!E.status.hidden) {
      E.status.style.top = Math.max(view.topBottom + 6, disc.y - disc.r - 44) + 'px';
    }
  },

  frame(dt, F) {
    const E = this.els;
    if (!this.dragProgress) this.renderProgress(Player.t, Player.duration);
    // ON AIR clignote sur les temps
    if (F.beat) this.onAirLit = 0.09;
    this.onAirLit -= dt;
    E.onair.classList.toggle('lit', Player.playing && this.onAirLit > 0);
    // sticker holographique : l'irisation suit le pointeur
    if (!this.holoEl) this.holoEl = document.querySelector('.holo');
    if (this.holoEl) this.holoEl.style.setProperty('--holo', `${Math.round((Input.nx * 0.5 + 0.5) * 300 + GL.clock * 20) % 360}deg`);
    // aiguille du cadran
    E.needle.style.left = (60 + (F.level - 0.4) * 9 + Math.sin(GL.clock * 2.3) * 0.6).toFixed(2) + '%';
    // trait vivant (line boil)
    if (!reduced()) {
      this._boilT = (this._boilT || 0) + dt;
      if (this._boilT > 0.1) { this._boilT = 0; E.boilNoise.setAttribute('seed', String(1 + Math.floor(Math.random() * 60))); }
    }
  },
};

/* =============================================================================
   Actions
   ========================================================================== */
function actPlay() {
  SFX.ensure();
  if (!Player.wantPlay) SFX.scratch();
  Player.toggle();
}

async function startSync(mode) {
  const E = UI.els;
  E.syncNote.hidden = true;
  try {
    if (mode === 'live') await AudioFX.startLive();
    else await AudioFX.startMic();
    UI.closeModal();
  } catch (err) {
    const name = (err && (err.code || err.name)) || '';
    let msg;
    if (name === 'unsupported') msg = mode === 'live' ? "Ce navigateur ne sait pas partager l'audio d'un onglet. Essaie Chrome ou Edge, ou le micro." : "Le micro n'est pas disponible ici.";
    else if (name === 'noaudio') msg = "Aucun son partagé : choisis cet onglet et active « Partager l'audio de l'onglet ».";
    else if (name === 'NotAllowedError' || name === 'SecurityError') msg = 'Partage refusé ou bloqué par le navigateur : on reste en AUTO.';
    else msg = "Impossible de démarrer l'analyse du son : on reste en AUTO.";
    E.syncNote.hidden = false;
    E.syncNote.textContent = msg;
  }
}

function toggleFullscreen() {
  try {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => UI.toast('Plein écran indisponible ici', 'warn', 2500));
    else UI.toast('Plein écran indisponible ici', 'warn', 2500);
  } catch { UI.toast('Plein écran indisponible ici', 'warn', 2500); }
}
