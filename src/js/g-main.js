/* =============================================================================
   Entrées, boucle, câblage
   ========================================================================== */
const Perf = {
  dprCap: 1.75, acc: 0, frames: 0, level: 0, warm: 0,
  sample(dt) {
    this.warm += dt;
    if (this.warm < 5) return;
    this.acc += dt; this.frames++;
    if (this.acc < 3) return;
    const avg = this.acc / this.frames;
    this.acc = 0; this.frames = 0;
    if (avg > 1 / 42 && this.level < 3) { this.level++; this.degrade(); }
  },
  degrade() {
    if (this.level === 1) { this.dprCap = 1.25; layout(); FX2D.resize(); }
    else if (this.level === 2) { this.dprCap = 1; layout(); FX2D.resize(); }
    else if (this.level === 3) { FX2D.lite = true; GL.finalPass.uniforms.uHal.value = 0; }
  },
};

const Input = { x: 0, y: 0, nx: 0, ny: 0, down: null, last: null, overDisc: false, lastMove: -1e9 };
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function hitDisc(x, y) {
  if (!GL.hit) return false;
  ndc.set((x / view.W) * 2 - 1, -(y / view.H) * 2 + 1);
  GL.camera.updateMatrixWorld();
  ray.setFromCamera(ndc, GL.camera);
  return ray.intersectObject(GL.hit, false).length > 0;
}

const live = {
  pointer: new THREE.Vector2(), keyPos: new THREE.Vector3(1.6, 1.5, 3.2),
  flash: 0, sun: 0, punch: 0, shadowAmt: 0.75, diffBoost: 0, disc: { x: 0, y: 0, r: 100 },
  offBg: new THREE.Vector2(), offChar: new THREE.Vector2(),
};
const _n = new THREE.Vector3(), _l = new THREE.Vector3(), _r = new THREE.Vector3(), _p = new THREE.Vector3();

/* =============================================================================
   Disques : textures, couleur du décor, changement
   ========================================================================== */
const Theme = { recolor: 0, target: 0, line: srgb255(META.line), lineTarget: srgb255(META.line) };
function themeFor(disc, instant) {
  if (disc.lines) { Theme.target = 1; Theme.lineTarget.set(disc.lines); } else Theme.target = 0;
  if (instant) { Theme.recolor = Theme.target; Theme.line.copy(Theme.lineTarget); }
}

async function loadDiscTexture(disc) {
  if (disc._tex) return disc._tex;
  let src = disc.ink, custom = false;
  if (disc.label && disc.label.url) { src = disc.label.url; custom = true; }
  if (!src) { disc._tex = GL.blankInk; return disc._tex; }
  let img;
  try {
    img = await loadImage(src);
  } catch {
    if (!custom || !disc.ink) { disc._tex = GL.blankInk; return disc._tex; }
    img = await loadImage(disc.ink);
    custom = false;
  }
  const tex = new THREE.Texture(custom ? imageToInk(img) : img);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = GL.maxAniso;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  applyLabelTransform(tex, disc.label || {});
  tex.needsUpdate = true;
  disc._tex = tex;
  return tex;
}
function discDetail(disc) { return disc._detail || (disc._detail = makeMirrorDetail(GL.maxAniso, disc)); }

const Discs = emitter({ busy: false, queued: null });
function switchDisc(i) {
  const n = CONFIG.DISCS.length;
  i = ((i % n) + n) % n;
  const disc = CONFIG.DISCS[i];
  if (Discs.busy) { Discs.queued = i; UI.setDiscActive(i); return; }
  if (disc === Player.disc) { UI.setDiscActive(i); return; }
  SFX.ensure();
  SFX.eject();
  UI.setDiscActive(i);
  UI.suppressCard = true;
  UI.showDiscCard(disc);
  const play = Player.wantPlay;
  const apply = () => {
    if (GL.labelMat) {
      setDiscTextures(disc._tex || GL.blankInk, discDetail(disc));
      if (!disc._tex) loadDiscTexture(disc).then((t) => { if (Player.disc === disc) setDiscTextures(t, discDetail(disc)); });
      // le nouveau disque arrive face label
      const full = Math.PI * 2;
      Motion.flip = Motion.flipTarget = Math.round(Motion.flip / full) * full;
      Motion.flipVel = 0;
      Motion.nextFlip = GL.clock + CONFIG.motion.flipEvery;
    }
    themeFor(disc, !GL.bgU);
    Player.setDisc(disc, play);
    UI.showDisc(disc);
    Discs.emit('disc', disc);
  };
  if (!GL.discRoot || reduced()) { apply(); return; }
  Discs.busy = true;
  startSwap(apply, () => {
    Discs.busy = false;
    const q = Discs.queued;
    Discs.queued = null;
    if (q != null && q !== Player.disc.index) switchDisc(q);
    else UI.setDiscActive(Player.disc.index);
  });
}

/* =============================================================================
   Entrées
   ========================================================================== */
function bindInput() {
  const cv = $('#gl');
  window.addEventListener('pointermove', (e) => {
    Input.x = e.clientX; Input.y = e.clientY;
    Input.nx = (e.clientX / view.W) * 2 - 1;
    Input.ny = (e.clientY / view.H) * 2 - 1;
    Input.lastMove = performance.now();
  }, { passive: true });
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const onDisc = hitDisc(e.clientX, e.clientY);
    Input.down = { x: e.clientX, y: e.clientY, t: performance.now(), onDisc, moved: 0 };
    Input.last = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (onDisc) {
      Motion.dragging = true;
      Motion.angVel.set(0, 0, 0);
      cv.classList.add('dragging');
      try { cv.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!Input.down) {
      const over = hitDisc(e.clientX, e.clientY);
      if (over !== Input.overDisc) { Input.overDisc = over; cv.classList.toggle('on-disc', over); }
      return;
    }
    const L = Input.last, now = performance.now();
    const dx = e.clientX - L.x, dy = e.clientY - L.y;
    Input.down.moved += Math.hypot(dx, dy);
    Input.last = { x: e.clientX, y: e.clientY, t: now };
    if (!Motion.dragging) return;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) return;
    const axis = _v.b.set(dy, dx, 0).normalize();
    const ang = (len * Math.PI) / (view.r * 2.2);
    _q.c.setFromAxisAngle(axis, ang);
    Motion.qDrag.premultiply(_q.c);
    const ddt = Math.max(0.008, (now - L.t) / 1000);
    Motion.angVel.lerp(_v.a.copy(axis).multiplyScalar(Math.min(ang / ddt, 14)), 0.5);
    Motion.lastTouch = GL.clock;
  });
  const end = (e, cancel) => {
    const d = Input.down;
    Input.down = null;
    if (Motion.dragging) {
      Motion.dragging = false;
      Motion.lastTouch = GL.clock;
      cv.classList.remove('dragging');
      if (performance.now() - (Input.last ? Input.last.t : 0) > 90) Motion.angVel.set(0, 0, 0);
    }
    if (!d || cancel) return;
    const isClick = d.moved < 6 && performance.now() - d.t < 320;
    if (!isClick) return;
    if (d.onDisc) {
      Motion.angVel.set(0, 0, 0);
      actPlay();
    } else {
      const col = Math.random() < 0.5 ? UI.accentHex : UI.accent2Hex;
      spawnSplat(e.clientX, e.clientY, 34 + Math.random() * 30, new THREE.Color(col));
      FX2D.spray(e.clientX, e.clientY, col);
      SFX.spray();
    }
  };
  cv.addEventListener('pointerup', (e) => end(e, false));
  cv.addEventListener('pointercancel', (e) => end(e, true));
  cv.addEventListener('wheel', (e) => {
    if (!hitDisc(e.clientX, e.clientY)) return;
    e.preventDefault();
    Player.setVolume(Player.volume - Math.sign(e.deltaY) * 4);
  }, { passive: false });

  let rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { layout(); FX2D.resize(); }, 60);
  });
}

function bindKeys() {
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tgt = e.target;
    if (tgt && tgt.closest && tgt.closest('input, textarea, select, [contenteditable="true"], .lil-gui')) return;
    const onButton = tgt && tgt.tagName === 'BUTTON';
    const k = e.key;
    if (k === 'Escape') { if (!UI.closeModal() && UI.panelOpen) UI.togglePanel(false); return; }
    if (k === ' ' || k === 'Spacebar') { if (onButton) return; e.preventDefault(); actPlay(); return; }
    if (k === 'ArrowRight') { e.preventDefault(); SFX.scratch(); Player.next(); return; }
    if (k === 'ArrowLeft') { e.preventDefault(); SFX.scratch(); Player.prev(); return; }
    if (k === 'ArrowUp') { e.preventDefault(); Player.setVolume(Player.volume + 5); return; }
    if (k === 'ArrowDown') { e.preventDefault(); Player.setVolume(Player.volume - 5); return; }
    if (/^[1-9]$/.test(k)) { const i = Number(k) - 1; if (CONFIG.DISCS[i]) switchDisc(i); return; }
    switch (k.toLowerCase()) {
      case 'c': switchDisc(Player.disc.index + 1); break;
      case 'm': Player.toggleMute(); UI.toast(Player.muted ? '<strong>MUTE</strong>Son coupé' : '<strong>VOL</strong>Son rétabli', '', 1800); break;
      case 'l': {
        setLabelMode(CONFIG.labelMode === 'silver' ? 'white' : 'silver');
        UI.toast(CONFIG.labelMode === 'silver' ? '<strong>LABEL</strong>Argent : seul le trait est imprimé' : '<strong>LABEL</strong>Sérigraphie blanche', '', 2200);
        break;
      }
      case 't': {
        if (AudioFX.mode !== 'auto') { UI.toast('<strong>TAP</strong>Le tap tempo sert au mode AUTO', 'warn', 2200); break; }
        const bpm = AudioFX.tapTempo(Player.t);
        UI.toast(bpm ? `<strong>TAP</strong>${Math.round(bpm)} BPM calés sur cette piste` : '<strong>TAP</strong>Continue à taper en rythme…', '', 1400);
        break;
      }
      case 's': UI.openModal('syncModal'); break;
      case 'f': toggleFullscreen(); break;
      case 'd': openDebug(); break;
      case '?': case 'h': UI.openModal('helpModal'); break;
      default: break;
    }
  });
}

function bindPlayer() {
  const E = UI.els;
  Player.on('ready', () => {
    if (!Player.started) UI.status(Player.wantPlay ? 'ON CALE LA RADIO…' : '');
  });
  Player.on('pending', () => UI.status('TUNING… LA RADIO DÉMARRE DÈS QU\'ELLE EST CALÉE'));
  Player.on('playlist', () => {
    UI.renderTracklist();
    UI.trackInfo(Math.max(0, Player.index));
  });
  Player.on('demo', (reason) => {
    UI.showDemo(reason);
    UI.toast('<strong>DÉMO</strong>YouTube indisponible ici : visuels sans son', 'warn', 5200);
  });
  Player.on('playing', (p) => {
    UI.setPlaying(p);
    if (p) { E.cta.hidden = true; UI.status(''); }
  });
  const showPendingCard = () => {
    const c = Player._cardPending;
    if (!c) return;
    Player._cardPending = null;
    UI.showCard(c.i, c.info, Player.duration > 0 && Player.duration < 30);
  };
  Player.on('started', () => {
    UI.showTV(false);
    E.cta.hidden = true;
    UI.status('');
    if (!UI.introCardDone) {
      UI.introCardDone = true;
      const info = UI.trackInfo(Player.index);
      UI.refreshTracklist();
      UI.slamTitle();
      live.diffBoost = 1;
      Player._cardPending = { i: Player.index, info, at: performance.now() };
      if (Player.kind === 'demo' || Player.duration > 0) showPendingCard();
    }
  });
  Player.on('state', (s) => {
    if (Player.started) UI.status(s === 3 && Player.wantPlay ? 'BUFFERING…' : '');
  });
  Player.on('track', (i) => {
    const info = UI.trackInfo(i);
    UI.setAccent(i);
    AudioFX.onTrack(Player.kind === 'youtube' ? Player.videoId : `demo-${Player.disc.id}-${i}`, i);
    UI.refreshTracklist();
    const suppress = UI.suppressCard;
    UI.suppressCard = false;
    if (!UI.introCardDone) return;
    UI.slamTitle();
    if (suppress) return;           // juste après un changement de disque : le carton DISC suffit
    triggerFlip();
    UI.interlude();
    live.diffBoost = 1;
    Player._cardPending = { i, info, at: performance.now() };
    if (Player.kind === 'demo') showPendingCard();
  });
  Player.on('duration', () => {
    const c = Player._cardPending;
    if (c && c.i === Player.index) showPendingCard();
  });
  Player.on('blocked', (i) => {
    if (Player._cardPending && Player._cardPending.i === i) Player._cardPending = null;
    UI.refreshRow(i);
    UI.toast(`<strong>PISTE ${pad2(i + 1)}</strong>Bloquée par YouTube, on passe à la suivante`, 'warn', 3200);
  });
  Player.on('fatal', (code) => {
    if (code === 153) UI.toast('<strong>ERREUR 153</strong>YouTube exige un en-tête Referer : sers le site en http(s), sans Referrer-Policy stricte.', 'bad', 9000);
    else UI.toast("<strong>STOP</strong>Aucune piste lisible pour l'instant. Réessaie plus tard ou change de disque.", 'bad', 8000);
  });
  Player.on('needtap', () => {
    if (Player.kind !== 'youtube') return;
    E.cta.hidden = true;
    UI.status('');
    UI.showTV(true);
  });
  Player.on('volume', (v, m) => UI.renderVolume(v, m));
  Titles.on('update', (id) => {
    const i = Player.ids.indexOf(id);
    if (i >= 0) UI.refreshTracklist();
    if (id === Player.videoId || Player.ids[Player.index] === id || i >= 0) {
      const info = UI.trackInfo(Math.max(0, Player.index));
      const c = Player._cardPending;
      if (c && c.i === Player.index) c.info = info;
    }
  });
  AudioFX.on('mode', (m) => {
    const label = m.toUpperCase();
    E.modeTag.textContent = label;
    $('#modeChip').textContent = label;
    if (m === 'live') UI.toast("<strong>LIVE</strong>Les visuels suivent l'audio de l'onglet", '', 3000);
    if (m === 'mic') UI.toast('<strong>MICRO</strong>Les visuels écoutent tes haut-parleurs', '', 3000);
  });
  AudioFX.on('ended', () => UI.toast('<strong>AUTO</strong>Partage arrêté, retour au tempo simulé', 'warn', 3200));
}

/* =============================================================================
   Boucle
   ========================================================================== */
let lastFrame = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1000));
  lastFrame = now;
  GL.clock += dt;
  const t = GL.clock;

  Player.update(dt);
  AudioFX.update(dt, Player.t, Player.playing);
  const F = AudioFX.F;

  // un carton de piste en attente sans durée connue : on l'affiche quand même
  const cp = Player._cardPending;
  if (cp && performance.now() - cp.at > 1500) { Player._cardPending = null; UI.showCard(cp.i, cp.info, Player.duration > 0 && Player.duration < 30); }

  // panneau tracklist : le disque se décale à gauche sur grand écran
  const shiftTarget = UI.panelOpen && view.W > 980 ? -Math.min(190, view.W * 0.14) : 0;
  if (Math.abs(shiftTarget - view.shiftX) > 0.3) {
    view.shiftX = damp(view.shiftX, shiftTarget, 7, dt);
    view.cx = view.baseCx + view.shiftX;
    applyViewOffset();
  }

  updateMotion(dt, F, { playing: Player.playing, buffering: Player.buffering });

  // déclencheurs rythmiques
  const rm = reduced();
  if (F.strong && !rm) {
    if (now - UI.lastBurst > 450) { UI.lastBurst = now; FX2D.burst(); }
    if (now - UI.lastFlash > 340) { UI.lastFlash = now; live.flash = 1; }
    const a = Math.random() * Math.PI * 2;
    UI.ono(live.disc.x + Math.cos(a) * live.disc.r * 1.45, live.disc.y + Math.sin(a) * live.disc.r * 1.25);
  }
  if (F.beat) {
    live.punch = 1;
    if (Motion.spinRps > 1.1 && !rm && !Motion.swap) FX2D.fling(live.disc, 1 + Math.round(F.bass * 3));
  }
  live.flash *= Math.exp(-dt * 9);
  live.punch *= Math.exp(-dt * 8);
  live.diffBoost *= Math.exp(-dt * 2.2);
  Motion.roll = damp(Motion.roll, (F.mid - 0.4) * 2, 3, dt);

  // caméra : petit coup de zoom sur les kicks
  const z = 1 + (rm ? 0 : 0.02 * live.punch);
  if (Math.abs(GL.camera.zoom - z) > 1e-4) { GL.camera.zoom = z; GL.camera.updateProjectionMatrix(); }

  // position écran du disque (pour les calques 2D)
  _p.copy(GL.discRoot.position).project(GL.camera);
  live.disc.x = (_p.x * 0.5 + 0.5) * view.W;
  live.disc.y = (-_p.y * 0.5 + 0.5) * view.H;
  live.disc.r = view.r * z;

  // pointeur lissé ; sans mouvement depuis un moment, il dérive doucement (parallaxe et reflets restent vivants)
  const idle = performance.now() - Input.lastMove > 4000;
  const tx = idle ? Math.sin(t * 0.21) * 0.35 : Input.nx;
  const ty = idle ? Math.cos(t * 0.17) * 0.22 : Input.ny;
  live.pointer.x = damp(live.pointer.x, tx, idle ? 0.8 : 3, dt);
  live.pointer.y = damp(live.pointer.y, ty, idle ? 0.8 : 3, dt);

  // lumières : la key light suit le pointeur
  live.keyPos.set(1.4 + live.pointer.x * 2.6, 1.4 - live.pointer.y * 2.0, 3.0);
  const L = GL.lights;
  L.key.position.copy(live.keyPos);
  L.rimA.position.set(-3.1, 1.3, 1.4);
  L.rimB.position.set(3.2, -1.1, 1.8);
  const lp = GL.mirrorDiffMat.uniforms.uLightPos.value, lc = GL.mirrorDiffMat.uniforms.uLightCol.value;
  lp[0].copy(live.keyPos); lp[1].copy(L.rimA.position); lp[2].copy(L.rimB.position); lp[3].set(0.3, 3.4, 2.6); lp[4].set(-0.8, -3.0, 3.0); lp[5].set(0.9 - live.pointer.x * 0.6, -0.4, 4.5);
  lc[0].set(1, 1, 1); lc[1].set(0.85, 0.55, 0.75); lc[2].set(0.55, 0.8, 0.95); lc[3].set(0.75, 0.75, 0.75); lc[4].set(0.6, 0.55, 0.5); lc[5].set(0.6, 0.6, 0.6);
  const di = CONFIG.fx.diffraction * (1 + 0.55 * F.level + 0.9 * live.diffBoost);
  for (const m of [GL.mirrorDiffMat, GL.labelDiffMat]) {
    m.uniforms.uLightPos.value = lp;
    m.uniforms.uLightCol.value = lc;
    m.uniforms.uIntensity.value = di;
    m.uniforms.uSigma.value = CONFIG.fx.sigma;
  }

  // décor : parallaxe du décor et du personnage, couleur du disque
  const U = GL.bgU, dpr = view.dpr, S = CONFIG.scene;
  const nod = rm ? 0 : live.punch * 2.2;
  live.offBg.set(-live.pointer.x * S.parallaxBg, -live.pointer.y * S.parallaxBg * 0.7);
  live.offChar.set(-live.pointer.x * S.parallaxChar, -live.pointer.y * S.parallaxChar * 0.6 + nod);
  layerXf(live.offBg, U.uBgXf.value);
  layerXf(live.offChar, U.uCharXf.value);
  U.uCharShadowOff.value.set(16 + (live.offChar.x - live.offBg.x) * 0.6 / view.bg.s, 11 + (live.offChar.y - live.offBg.y) * 0.6 / view.bg.s);
  U.uCharShadow.value = S.charShadow;
  Theme.recolor = damp(Theme.recolor, Theme.target, 3.5, dt);
  Theme.line.lerp(Theme.lineTarget, 1 - Math.exp(-3.5 * dt));
  U.cLine.value.copy(Theme.line);
  U.uRecolor.value = Theme.recolor;
  U.uTime.value = t;
  U.uDisc.value.set(live.disc.x * dpr, (view.H - live.disc.y) * dpr, live.disc.r * dpr);
  U.uBass.value = F.bass; U.uLevel.value = F.level;
  live.sun += dt * (0.04 + 0.22 * F.level) * (rm ? 0.3 : 1);
  U.uSunRot.value = live.sun;
  U.uFlash.value = live.flash;
  U.uFlashCol.value.set(UI.accentHex);
  // ombre du disque + arcs-en-ciel projetés
  labelNormal(_n);
  const facing = _n.z >= 0 ? 1 : -1;
  _n.multiplyScalar(facing);
  const ang = Math.atan2(_n.y, _n.x) + Math.PI / 2;
  U.uShadow.value.set((live.disc.x + live.disc.r * 0.14) * dpr, (view.H - live.disc.y - live.disc.r * 0.2) * dpr, live.disc.r * dpr, live.disc.r * Math.max(0.1, Math.abs(_n.z)) * dpr);
  U.uShadowRot.value = ang;
  const metal = facing < 0 ? 1 : (CONFIG.labelMode === 'silver' ? 0.7 : 0.12);
  const spotFrom = (lightPos, out, k) => {
    _l.copy(lightPos).normalize();
    _r.copy(_n).multiplyScalar(2 * _n.dot(_l)).sub(_l);
    const len = Math.hypot(_r.x, _r.y);
    const amt = metal * smooth(0.12, 0.55, len) * (0.55 + 0.7 * F.level) * k;
    out.set((live.disc.x + _r.x * live.disc.r * 2.2) * dpr, (view.H - live.disc.y + _r.y * live.disc.r * 2.2) * dpr, Math.atan2(_r.y, _r.x), amt);
  };
  spotFrom(live.keyPos, U.uSpot0.value, 0.5);
  spotFrom(_p.set(0.3, 3.4, 2.6), U.uSpot1.value, 0.32);

  GL.splats.mat.uniforms.uTime.value = t;
  GL.bloom.strength = CONFIG.fx.bloom * (0.85 + 0.55 * F.level) + live.flash * 0.25;
  GL.bloom.radius = CONFIG.fx.bloomRadius;
  GL.bloom.threshold = CONFIG.fx.bloomThreshold;
  const fin = GL.finalPass.uniforms;
  fin.uTime.value = t;
  fin.uCenter.value.set(live.disc.x / view.W, 1 - live.disc.y / view.H);
  fin.uChroma.value = CONFIG.fx.chroma * (1 + 0.8 * F.kick);
  fin.uGrain.value = CONFIG.fx.grain;
  if (Perf.level < 3) fin.uHal.value = CONFIG.fx.halation;

  FX2D.draw(dt, F, live.disc, UI.accentHex);
  UI.place(live.disc);
  UI.frame(dt, F);

  GL.composer.render(dt);
  Perf.sample(dt);
}

/* Réglages fins (touche D) */
let gui = null;
async function openDebug() {
  if (gui) { gui.show(gui._hidden); return; }
  try {
    const { default: GUI } = await import('https://cdn.jsdelivr.net/npm/lil-gui@0.19.2/dist/lil-gui.esm.min.js');
    gui = new GUI({ title: 'GRIND//FM · réglages' });
    const lab = gui.addFolder('Label du disque affiché');
    const cal = { offsetX: 0, offsetY: 0, scale: 1, rotation: 0 };
    const pull = () => { Object.assign(cal, { offsetX: 0, offsetY: 0, scale: 1, rotation: 0 }, Player.disc.label || {}); lab.controllers.forEach((c) => c.updateDisplay()); };
    const push = () => {
      const d = Player.disc;
      d.label = Object.assign(d.label || {}, cal);
      if (d._tex && d._tex !== GL.blankInk) applyLabelTransform(d._tex, d.label);
    };
    lab.add(CONFIG, 'labelMode', ['white', 'silver']).name('mode').onChange(setLabelMode);
    lab.add(cal, 'offsetX', -0.1, 0.1, 0.001).onChange(push);
    lab.add(cal, 'offsetY', -0.1, 0.1, 0.001).onChange(push);
    lab.add(cal, 'scale', 0.8, 1.2, 0.001).onChange(push);
    lab.add(cal, 'rotation', -180, 180, 0.5).onChange(push);
    pull();
    Discs.on('disc', pull);
    const sc = gui.addFolder('Décor');
    sc.add(CONFIG.scene, 'parallaxBg', 0, 30, 0.5).name('parallaxe décor (px)');
    sc.add(CONFIG.scene, 'parallaxChar', 0, 40, 0.5).name('parallaxe personnage (px)');
    sc.add(CONFIG.scene, 'charShadow', 0, 1, 0.01).name('ombre du personnage');
    sc.add(CONFIG.scene, 'focusX', 0, 1, 0.01).name('cadrage horizontal').onChange(() => layout());
    sc.add(CONFIG.scene, 'focusY', 0, 1, 0.01).name('cadrage vertical').onChange(() => layout());
    sc.add(CONFIG.scene, 'zoom', 1, 1.4, 0.005).name('zoom').onChange(() => layout());
    sc.add(CONFIG.scene, 'discShiftX', -0.2, 0.2, 0.005).name('décalage du disque').onChange(() => layout());
    const fx = gui.addFolder('Effets');
    fx.add(CONFIG.fx, 'diffraction', 0, 1.5, 0.01);
    fx.add(CONFIG.fx, 'sigma', 0.03, 0.5, 0.005);
    fx.add(CONFIG.fx, 'bloom', 0, 2, 0.01);
    fx.add(CONFIG.fx, 'bloomRadius', 0, 1, 0.01);
    fx.add(CONFIG.fx, 'bloomThreshold', 0, 4, 0.01);
    fx.add(CONFIG.fx, 'halation', 0, 2, 0.01);
    fx.add(CONFIG.fx, 'chroma', 0, 0.01, 0.0001);
    fx.add(CONFIG.fx, 'grain', 0, 0.2, 0.005);
    fx.add(CONFIG.fx, 'toneMapping', ['neutral', 'agx', 'aces', 'none']).onChange((v) => { GL.renderer.toneMapping = TONEMAPS()[v]; });
    fx.add(CONFIG.fx, 'outlinePx', 0, 8, 0.5).onChange(() => layout());
    const lt = gui.addFolder('Lumières');
    lt.add(GL.lights.key, 'intensity', 0, 8, 0.05).name('key');
    lt.add(GL.lights.rimA, 'intensity', 0, 5, 0.05).name('rim magenta');
    lt.add(GL.lights.rimB, 'intensity', 0, 5, 0.05).name('rim cyan');
    lt.add(GL.scene, 'environmentIntensity', 0, 3, 0.01).name('reflets env');
    const mo = gui.addFolder('Mouvement');
    mo.add(CONFIG.spin, 'playRps', 0, 6, 0.05).name('tours/s en lecture');
    mo.add(CONFIG.spin, 'idleRps', 0, 1, 0.01).name('tours/s au repos');
    mo.add(CONFIG.motion, 'precessionDeg', 0, 45, 0.5).name('précession (°)');
    mo.add(CONFIG.motion, 'flipEvery', 4, 40, 0.5).name('flip toutes les (s)');
    for (const f of [sc, fx, lt, mo]) f.close();
  } catch {
    UI.toast('<strong>DEBUG</strong>Panneau de réglages indisponible hors connexion', 'warn', 2600);
  }
}

/* Repli sans WebGL : décor en images, disque 2D qui tourne, la radio fonctionne quand même. */
function fallback2D() {
  const app = $('#app');
  const mkLayer = (src, z) => {
    const im = document.createElement('img');
    im.src = src;
    im.alt = '';
    im.style.cssText = `position:absolute;z-index:${z};pointer-events:none;max-width:none`;
    app.prepend(im);
    return im;
  };
  const bgImg = ASSETS && ASSETS.bg ? mkLayer(ASSETS.bg, 0) : null;
  const chImg = ASSETS && ASSETS.gum ? mkLayer(ASSETS.gum, 0) : null;
  const place = () => {
    layout();
    const b = view.bg;
    if (bgImg) Object.assign(bgImg.style, { left: b.left + 'px', top: b.top + 'px', width: META.w * b.s + 'px' });
    if (chImg) {
      const [x, y, w] = META.gumRect;
      Object.assign(chImg.style, { left: b.left + x * b.s + 'px', top: b.top + y * b.s + 'px', width: w * b.s + 'px' });
    }
  };
  place();
  window.addEventListener('resize', place);
  $('#gl').hidden = true;
  document.body.style.background = `rgb(${META.paper.join(',')})`;

  const box = document.createElement('div');
  box.setAttribute('role', 'button');
  box.setAttribute('aria-label', 'Lire la radio');
  box.tabIndex = 0;
  box.style.cssText = 'position:absolute;left:50%;top:44%;width:min(70vw,52vh);aspect-ratio:1;max-width:100%;transform:translate(-50%,-50%);border-radius:50%;border:4px solid #0E0E10;overflow:hidden;cursor:pointer;z-index:2;background:#F3F0E6;pointer-events:auto';
  const img = document.createElement('img');
  img.src = Player.disc.ink;
  img.alt = '';
  img.style.cssText = 'width:100%;height:100%;filter:invert(1);mix-blend-mode:multiply;animation:spin 3.2s linear infinite;animation-play-state:paused';
  const rainbow = document.createElement('div');
  rainbow.style.cssText = 'position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 20deg,#fff0,#ff2d9588,#ffe14a88,#a6f00088,#1ad1ff88,#7a3cff88,#fff0 40%,#fff0 60%,#1ad1ff66,#ff2d9566,#fff0);mix-blend-mode:color-dodge;pointer-events:none';
  const hole = document.createElement('div');
  hole.style.cssText = `position:absolute;left:50%;top:50%;width:25%;height:25%;transform:translate(-50%,-50%);border-radius:50%;background:rgb(${META.paper.join(',')});border:4px solid #0E0E10;pointer-events:none`;
  box.append(img, rainbow, hole);
  $('#hud').appendChild(box);
  const go = () => { actPlay(); };
  box.addEventListener('click', go);
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  Player.on('playing', (p) => { img.style.animationPlayState = p ? 'running' : 'paused'; });
  Discs.on('disc', (d) => { img.src = d.ink || ''; });
  UI.toast('<strong>2D</strong>WebGL indisponible : version simplifiée du disque', 'warn', 6000);
  bindPlayer();
  bindKeys();
  Player.init();
  setTimeout(() => UI.endIntro(), 900);
  setInterval(() => { Player.update(0.25); UI.renderProgress(Player.t, Player.duration); }, 250);
}

async function waitFonts() {
  if (!document.fonts || !document.fonts.load) return;
  const loads = [
    document.fonts.load('400 120px "Bungee"', 'GRIND//FM 20.24'),
    document.fonts.load('400 120px "Dela Gothic One"', 'ラジオストリートドン!ゴー東京'),
    document.fonts.load('400 20px "DotGothic16"', '0123456789'),
  ];
  await Promise.race([Promise.allSettled(loads), sleep(3500)]);
}

async function init() {
  document.documentElement.style.setProperty('--static', `url(${makeStaticDataURL()})`);
  document.documentElement.style.setProperty('--cursor-spray', sprayCursorCSS());
  UI.init();
  FX2D.init();
  try {
    initRenderer();
  } catch (e) {
    console.warn('WebGL indisponible', e);
    fallback2D();
    return;
  }
  bindPlayer();
  Player.init();
  buildBackground();
  buildSplats();
  const disc = Player.disc;
  const tex = await loadDiscTexture(disc);
  buildDisc(tex, discDetail(disc));
  themeFor(disc, true);
  GL.scene.environment = makeEnvironment(GL.renderer);
  GL.scene.environmentIntensity = 1.0;
  buildPost();
  layout();
  FX2D.resize();
  bindInput();
  bindKeys();
  requestAnimationFrame((n) => { lastFrame = n; frame(n); });
  setTimeout(() => UI.endIntro(), 1300);
  loadSceneImages();
  for (const d of CONFIG.DISCS) if (d !== disc) loadDiscTexture(d);
  window.__grindfm = { CONFIG, GL, Player, AudioFX, Motion, UI, Titles, FX2D, view, Perf, Theme, Discs, layout, spawnSplat, setLabelMode, triggerFlip, switchDisc };
  // micro-texte gravé : redessiné une fois les polices chargées
  waitFonts().then(() => {
    for (const d of CONFIG.DISCS) if (d._detail) { d._detail.dispose(); d._detail = null; }
    if (GL.mirrorMat) GL.mirrorMat.roughnessMap = discDetail(Player.disc);
  });
}

init();
