import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* =============================================================================
   CONFIG : tous les réglages du site sont ici
   ========================================================================== */
const CONFIG = {
  STATION_NAME: 'GRIND//FM',
  STATION_FREQ: '20.24',
  YT_API_KEY: '',                  // clé YouTube Data API v3 (optionnelle) : charge tous les titres d'un coup
  VOLUME: 80,
  DEFAULT_DISC: 0,                 // disque présenté à l'arrivée (0 = Jet Set Radio)
  DISCS: [
    {
      id: 'jsr', short: 'JSR', name: 'Jet Set Radio', subtitle: 'The Complete Soundtrack', year: 2000,
      playlistId: 'PLE3VL-5NEtZiefRHaaTUGnU7JhOkbd3mT',
      label: { url: '', offsetX: 0, offsetY: 0, scale: 1, rotation: 0 },
      lines: null,                 // couleur des bâtiments du décor ; null = couleurs d'origine
      // Tracklist de référence : sert à afficher des titres propres (les titres YouTube y sont rapprochés)
      tracks: [
        'Hideki Naganuma - Let Mom Sleep',
        'Hideki Naganuma - Humming the Bassline',
        'Idol Taxi - O.K.!?House!!!!!?????',
        "Hideki Naganuma - That's Enough",
        'Richard Jacques - Everybody Jump Around',
        'Deavid Soul - Dunny Boy Williamson Show',
        'Hideki Naganuma - Sneakman',
        "Reps - 'Bout the City",
        'Castle Logical - Mischievous Boy',
        'Hideki Naganuma - Sweet Soul Brother',
        'Hideki Naganuma - Rock It On',
        'Guitar Vader - Super Brothers',
        'Guitar Vader - Magical Girl',
        'F-Fields - Yellow Bream',
        'Deavid Soul - Miller Ball Breakers',
        'Deavid Soul - Up-Set Attack',
        'Deavid Soul - On the Bowl (A. Fargus Mix)',
        'B.B. Rights - Funky Radio',
        'Deavid Soul - Yappie Feet',
        'Toronto - Electric Tooth Brush',
        'Rob Zombie - Dragula (Si Non Oscillas, Noli Tintinnare Mix)',
        'Professional Murder Music - Slow',
        'Cold - Just Got Wicked',
        'Mix Master Mike - Patrol Knob',
        'Jurassic 5 - Improvise',
        'Featurecast - Recipe for the Perfect Afro',
        'O.B. One - Many Styles',
        'Semi Detached - Funky Plucker!',
        'Jurassic 5 - Improvise (Instrumental)',
        "Hideki Naganuma - Moody's Shuffle",
        'Hideki Naganuma - Grace & Glory',
        'Hideki Naganuma - Jet Set Medley',
        'Toronto feat. DJ-K - Jet Set Station',
        'Hideki Naganuma - Jet Set Groove #1',
        'Hideki Naganuma - Jet Set Groove #2',
      ],
    },
    {
      id: 'jsrf', short: 'JSRF', name: 'Jet Set Radio Future', subtitle: 'The Complete Soundtrack', year: 2002,
      playlistId: 'PLE3VL-5NEtZjU9Ne8KSJbPgI9HfRcZRP0',
      label: { url: '', offsetX: 0, offsetY: 0, scale: 1, rotation: 0 },
      lines: '#5B3FD0',
      tracks: [],                  // vide : les titres viennent de YouTube
      countHint: 35,
    },
  ],
  labelMode: 'white',              // 'white' (sérigraphie blanche) | 'silver' (seul le trait est imprimé)
  scene: {
    focusX: 0.32,                  // cadrage du décor sur écran large (0 = bord gauche, 1 = bord droit)
    focusXPortrait: 0.2,           // cadrage sur téléphone en portrait
    focusY: 0.4,
    zoom: 1.06,                    // marge autour du décor pour la parallaxe
    parallaxBg: 7,                 // px : amplitude de la parallaxe du décor
    parallaxChar: 18,              // px : amplitude de la parallaxe du personnage (plus proche, il bouge plus)
    charShadow: 0.32,              // ombre tramée du personnage sur le décor (0 = aucune)
    discShiftX: 0.05,              // décalage du disque vers la droite sur écran large (part de la largeur)
  },
  spin: { idleRps: 0.06, playRps: 2.0, spinUpSeconds: 1.5 },
  motion: { precessionDeg: 20, flipEvery: 11 },
  fx: {
    diffraction: 0.6, sigma: 0.2,
    bloom: 0.55, bloomRadius: 0.45, bloomThreshold: 1.8,
    halation: 1.0, chroma: 0.0028, grain: 0.04,
    toneMapping: 'neutral',        // 'neutral' | 'agx' | 'aces' | 'none'
    outlinePx: 3,
  },
  audio: { fftSize: 2048, smoothing: 0.75, beatThreshold: 1.4, defaultBpm: 120 },
  bpm: {},                         // { videoId: bpm } : tempo par piste pour le mode AUTO
  palette: {
    ink: '#0E0E10', paper: '#F3F0E6', lime: '#A6F000', magenta: '#FF2D95',
    cyan: '#1AD1FF', yellow: '#FFE14A', orange: '#FF6B1A', violet: '#7A3CFF',
  },
};

/* Images intégrées : labels (masques d'encre, 255 = encre, disque plein cadre), miniatures,
   décor sans le personnage, personnage détouré, et leurs mesures. */
const ASSETS = '__ASSETS__';

/* =============================================================================
   Utilitaires
   ========================================================================== */
const $ = (s) => document.querySelector(s);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const easeInBack = (x) => 2.70158 * x * x * x - 1.70158 * x * x;
const easeOutBack = (x) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);
const pad2 = (n) => String(n).padStart(2, '0');
const fmtTime = (s) => {
  s = Math.max(0, Number.isFinite(s) ? s : 0);
  const m = Math.floor(s / 60);
  return m + ':' + pad2(Math.floor(s % 60));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const store = {
  get(k, d) { try { const v = localStorage.getItem('grindfm.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('grindfm.' + k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
};
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function fetchTimeout(url, ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { signal: c.signal, credentials: 'omit' }).finally(() => clearTimeout(t));
}
const mqReduced = matchMedia('(prefers-reduced-motion: reduce)');
const reduced = () => mqReduced.matches;
const isCoarse = matchMedia('(pointer: coarse)').matches;

const PAL = {};
for (const [k, v] of Object.entries(CONFIG.palette)) PAL[k] = new THREE.Color(v);
const ACCENTS = [['lime', 'magenta'], ['magenta', 'cyan'], ['cyan', 'yellow'], ['yellow', 'violet'], ['orange', 'cyan']];
const srgb255 = (a) => new THREE.Color().setRGB(a[0] / 255, a[1] / 255, a[2] / 255, THREE.SRGBColorSpace);

/* Petit bus d'événements */
function emitter(obj) {
  const map = {};
  obj.on = (ev, fn) => { (map[ev] ||= []).push(fn); return obj; };
  obj.emit = (ev, ...a) => { (map[ev] || []).forEach((f) => { try { f(...a); } catch (e) { console.error(e); } }); };
  return obj;
}

/* Disques : index, tracklist de référence, images */
function trackKey(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
}
CONFIG.DISCS.forEach((d, i) => {
  d.index = i;
  d.tracks = d.tracks || [];
  d._known = d.tracks.map((line) => {
    const cut = line.indexOf(' - ');
    const artist = cut > 0 ? line.slice(0, cut).trim() : '';
    const title = cut > 0 ? line.slice(cut + 3).trim() : line.trim();
    return { artist, title, full: trackKey(title), base: trackKey(title.replace(/\s*\([^)]*\)\s*/g, ' ')), akey: trackKey(artist) };
  });
  d._match = {};
  d.ink = (ASSETS && ASSETS['label_' + d.id]) || '';
  d.thumb = (ASSETS && ASSETS['thumb_' + d.id]) || '';
});

/* =============================================================================
   Textures générées
   ========================================================================== */
function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('image'));
    im.src = src;
  });
}

/* Image perso → masque d'encre (canal rouge = encre). */
function imageToInk(img) {
  const N = 2048;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff';
  g.fillRect(0, 0, N, N);
  const s = Math.max(N / img.width, N / img.height);
  const w = img.width * s, h = img.height * s;
  g.drawImage(img, (N - w) / 2, (N - h) / 2, w, h);
  const d = g.getImageData(0, 0, N, N);
  const a = d.data;
  for (let i = 0; i < a.length; i += 4) {
    const al = a[i + 3] / 255;
    const L = ((a[i] * 0.2126 + a[i + 1] * 0.7152 + a[i + 2] * 0.0722) / 255) * al + (1 - al);
    const ink = clamp((0.8 - L) / 0.4, 0, 1);
    a[i] = a[i + 1] = a[i + 2] = Math.round(ink * 255);
    a[i + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  return c;
}

/* Miniature ronde d'un disque (pour un disque ajouté sans miniature intégrée) */
function inkToThumb(src) {
  const S = 144, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#F6F3EC';
  g.beginPath(); g.arc(S / 2, S / 2, S * 0.49, 0, Math.PI * 2); g.fill();
  if (src) {
    g.save();
    g.globalCompositeOperation = 'multiply';
    g.filter = 'invert(1)';
    g.drawImage(src, 0, 0, S, S);
    g.restore();
  }
  g.globalCompositeOperation = 'destination-out';
  g.beginPath(); g.arc(S / 2, S / 2, S * 0.0625, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = 'source-over';
  g.lineWidth = 4; g.strokeStyle = '#121214';
  g.beginPath(); g.arc(S / 2, S / 2, S * 0.475, 0, Math.PI * 2); g.stroke();
  return c.toDataURL('image/png');
}

function applyLabelTransform(tex, L) {
  tex.center.set(0.5, 0.5);
  tex.offset.set(L.offsetX || 0, L.offsetY || 0);
  const s = Math.max(0.05, L.scale || 1);
  tex.repeat.set(1 / s, 1 / s);
  tex.rotation = ((L.rotation || 0) * Math.PI) / 180;
  tex.updateMatrix();
}

/* Direction d'anisotropie radiale (RG) + force (B) uniquement sur la zone gravée. */
function makeAnisoTexture(N = 256) {
  const data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = ((i + 0.5) / N) * 2 - 1, y = ((j + 0.5) / N) * 2 - 1;
      const r = Math.hypot(x, y) || 1e-6;
      const k = (j * N + i) * 4;
      data[k] = Math.round(((x / r) * 0.5 + 0.5) * 255);
      data[k + 1] = Math.round(((y / r) * 0.5 + 0.5) * 255);
      data[k + 2] = Math.round(smooth(0.37, 0.4, r) * (1 - smooth(0.965, 0.98, r)) * 255);
      data[k + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.colorSpace = THREE.NoColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/* Rugosité de la face gravée : rayures, poussière, micro-texte de matrice (propre à chaque disque). */
function makeMirrorDetail(maxAniso, disc) {
  const N = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const rnd = mulberry32(7 + disc.index * 101);
  const C = N / 2, R = N / 2;
  g.fillStyle = 'rgb(24,24,24)';
  g.fillRect(0, 0, N, N);
  // voile très léger, concentrique
  for (let i = 0; i < 90; i++) {
    const r = (0.39 + rnd() * 0.58) * R;
    g.strokeStyle = `rgba(70,70,70,${0.12 + rnd() * 0.22})`;
    g.lineWidth = 0.6 + rnd() * 1.4;
    const a0 = rnd() * Math.PI * 2;
    g.beginPath();
    g.arc(C + (rnd() - 0.5) * 3, C + (rnd() - 0.5) * 3, r, a0, a0 + 0.3 + rnd() * 2.6);
    g.stroke();
  }
  // rayures droites
  for (let i = 0; i < 30; i++) {
    const a = rnd() * Math.PI * 2, r = (0.42 + rnd() * 0.5) * R;
    const x = C + Math.cos(a) * r, y = C + Math.sin(a) * r;
    const b = a + (rnd() - 0.5) * 2.2, len = 20 + rnd() * 110;
    g.strokeStyle = `rgba(150,150,150,${0.25 + rnd() * 0.35})`;
    g.lineWidth = 0.5 + rnd() * 0.9;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(b) * len, y + Math.sin(b) * len);
    g.stroke();
  }
  // poussière
  for (let i = 0; i < 260; i++) {
    const a = rnd() * Math.PI * 2, r = (0.3 + rnd() * 0.67) * R;
    g.fillStyle = `rgba(210,210,210,${0.35 + rnd() * 0.65})`;
    g.beginPath();
    g.arc(C + Math.cos(a) * r, C + Math.sin(a) * r, 0.5 + rnd() * 1.6, 0, Math.PI * 2);
    g.fill();
  }
  // micro-texte gravé sur la bande miroir
  const ringText = (txt, radius, size, color) => {
    g.save();
    g.translate(C, C);
    g.font = `${size}px Bungee, "Arial Black", sans-serif`;
    g.fillStyle = color;
    g.textBaseline = 'middle';
    let a = -Math.PI / 2;
    const total = g.measureText(txt).width;
    const reps = Math.max(1, Math.floor((2 * Math.PI * radius) / total));
    const full = txt.repeat(reps);
    const step = (2 * Math.PI) / g.measureText(full).width;
    for (const ch of full) {
      const w = g.measureText(ch).width;
      g.save();
      g.rotate(a + (w / 2) * step);
      g.translate(radius, 0);
      g.rotate(Math.PI / 2);
      g.fillText(ch, -w / 2, 0);
      g.restore();
      a += w * step;
    }
    g.restore();
  };
  ringText(` GRIND//FM ${CONFIG.STATION_FREQ} · DISC ${disc.index + 1} · ${disc.short} ${disc.year || ''} · PRESSED IN TOKYO ·`, 0.345 * R, Math.round(N * 0.0115), 'rgb(150,150,150)');
  ringText(` SIDE A · ${pad2(disc.index + 1)} ·`, 0.305 * R, Math.round(N * 0.009), 'rgb(120,120,120)');
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = maxAniso;
  return t;
}

/* Environnement studio pour les reflets : softbox + panneaux aux couleurs de la palette. */
function makeEnvironment(renderer) {
  const s = new THREE.Scene();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(20, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { top: { value: new THREE.Color('#cfd8e6') }, mid: { value: new THREE.Color('#5d5f73') }, bot: { value: new THREE.Color('#1b1726') } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top, mid, bot; varying vec3 vP; void main(){ float y = vP.y; vec3 c = y > 0.0 ? mix(mid, top, smoothstep(0.0, 0.8, y)) : mix(mid, bot, smoothstep(0.0, 0.6, -y)); gl_FragColor = vec4(c, 1.0); }',
    }),
  );
  s.add(sky);
  const panel = (w, h, color, k, x, y, z) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }),
    );
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  panel(9, 4, '#ffffff', 5.0, 0, 9, 6);        // grande softbox au-dessus
  panel(1.4, 12, '#ffffff', 3.2, -10, 0, 3);   // strip gauche
  panel(1.4, 12, '#ffffff', 2.4, 10, 1, -2);   // strip droite
  panel(6, 3, CONFIG.palette.magenta, 1.0, -8, -6, 5);
  panel(6, 3, CONFIG.palette.cyan, 2.6, 8, -5, 6);
  panel(8, 2, CONFIG.palette.lime, 1.8, 0, -10, 3);
  panel(4, 4, CONFIG.palette.yellow, 2.4, 8, 8, -5);
  panel(7, 5, '#ffffff', 1.25, 0, 3, 12);      // derrière la caméra
  panel(5, 3, CONFIG.palette.violet, 1.2, -9, 6, -6);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.035);
  pm.dispose();
  return rt.texture;
}

/* Neige TV (intro, interludes). */
function makeStaticDataURL() {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const d = g.createImageData(N, N);
  const rnd = mulberry32(99);
  for (let y = 0; y < N; y++) {
    const scan = y % 3 === 0 ? 0.65 : 1;
    for (let x = 0; x < N; x++) {
      const v = Math.floor(rnd() * 255 * scan);
      const k = (y * N + x) * 4;
      d.data[k] = d.data[k + 1] = d.data[k + 2] = v;
      d.data[k + 3] = 255;
    }
  }
  g.putImageData(d, 0, 0);
  return c.toDataURL('image/png');
}

function sprayCursorCSS() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34"><g stroke="#0E0E10" stroke-width="2.4" stroke-linejoin="round"><rect x="12" y="13" width="14" height="18" rx="3" fill="#F3F0E6"/><rect x="15" y="7" width="8" height="7" rx="2" fill="#FF2D95"/></g><g fill="#0E0E10"><circle cx="6" cy="6" r="1.6"/><circle cx="10" cy="3.4" r="1.1"/><circle cx="3.4" cy="10.2" r="1.1"/><circle cx="9.6" cy="8.6" r="0.9"/></g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 6 6`;
}
