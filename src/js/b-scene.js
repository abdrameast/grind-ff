/* =============================================================================
   Shaders
   ========================================================================== */
const SHADER_COMMON = /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 rainbow(float h){ return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
`;

/* Décor plein écran : l'illustration (bâtiments), le personnage sur son propre calque (parallaxe),
   les ombres tramées, la trame qui respire avec les basses et les reflets arc-en-ciel du disque.
   La sortie est pré-compensée du tone mapping Neutral : les images gardent leurs vraies couleurs. */
const BG_FRAG = /* glsl */`
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uDisc;            // x, y (px device, origine en bas), rayon px
uniform float uBass, uLevel;
uniform float uFlash; uniform vec3 uFlashCol;
uniform float uSunRot;
uniform vec4 uSpot0, uSpot1;   // x, y, angle, intensité
uniform vec4 uShadow;          // x, y, demi-grand axe, demi-petit axe
uniform float uShadowRot, uShadowAmt;
uniform sampler2D uBg, uChar;
uniform float uReady;
uniform vec3 uBgXf, uCharXf;   // échelle (px device par px image), gauche, haut (px device, origine en haut)
uniform vec4 uCharRect;        // x, y, w, h du personnage dans l'image (px image)
uniform vec2 uImg;             // taille de l'image
uniform vec2 uCharShadowOff;   // décalage de l'ombre du personnage (px image)
uniform float uCharShadow;
uniform vec3 cPaper, cLineSrc, cLine;
uniform float uRecolor;
${SHADER_COMMON}
float halftone(vec2 px, float cell, float amount){
  vec2 q = mat2(0.7071, -0.7071, 0.7071, 0.7071) * px / cell;
  vec2 f = fract(q) - 0.5;
  float rad = sqrt(clamp(amount, 0.0, 1.0)) * 0.64;
  return 1.0 - smoothstep(rad - 0.07, rad + 0.07, length(f));
}
vec4 spot(vec2 frag, vec4 s, float len){
  if (s.w < 0.002) return vec4(0.0);
  vec2 d = frag - s.xy;
  vec2 dir = vec2(cos(s.z), sin(s.z));
  float al = dot(d, dir), ac = dot(d, vec2(-dir.y, dir.x));
  float wid = len * 0.2;
  float env = exp(-(ac * ac) / (wid * wid)) * exp(-(al * al) / (len * len));
  float h = clamp(al / len * 0.5 + 0.5, 0.0, 1.0);
  return vec4(rainbow(0.82 * (1.0 - h)), env * s.w);
}
/* inverse du tone mapping Khronos PBR Neutral (exposition 1) */
vec3 invNeutral(vec3 o){
  const float S = 0.76;
  const float D = 0.15;
  float P = max(o.r, max(o.g, o.b));
  vec3 c1 = o;
  if (P >= S) {
    float Pc = min(P, 0.95);
    o *= Pc / P;
    P = Pc;
    float d = 1.0 - S;
    float p = d * d / (1.0 - P) - d + S;
    float g = 1.0 - 1.0 / (D * (p - P) + 1.0);
    c1 = max((o - P * g) / (1.0 - g), 0.0) * (p / P);
  }
  float m = min(c1.r, min(c1.g, c1.b));
  float x = m < 0.04 ? sqrt(max(m, 0.0) / 6.25) : m + 0.04;
  float off = x < 0.08 ? x - 6.25 * x * x : 0.04;
  return c1 + off;
}
vec2 imgPx(vec2 frag, vec3 xf){ return vec2(frag.x - xf.y, (uRes.y - frag.y) - xf.z) / xf.x; }
float inside01(vec2 uv){ return step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0); }
void main(){
  vec2 frag = gl_FragCoord.xy;
  float u = uRes.y / 1000.0;
  vec3 lineNow = mix(cLineSrc, cLine, uRecolor);
  vec3 col = cPaper;

  /* ---- illustration : bâtiments, recolorables par disque ---- */
  if (uReady > 0.5) {
    vec2 ip = imgPx(frag, uBgXf);
    vec2 buv = clamp(vec2(ip.x / uImg.x, 1.0 - ip.y / uImg.y), vec2(0.0), vec2(1.0));
    vec3 c = texture2D(uBg, buv).rgb;
    vec3 ax = cPaper - cLineSrc;
    float t = clamp(dot(cPaper - c, ax) / dot(ax, ax), 0.0, 1.4);
    col = mix(c, max(cPaper + (cLine - cPaper) * t, 0.0), uRecolor);
  }

  /* ---- rayons très légers autour du disque ---- */
  vec2 dd = frag - uDisc.xy;
  float dist = length(dd);
  float a = (atan(dd.y, dd.x) + uSunRot) / 6.2831853 * 24.0;
  float aw = 24.0 / (6.2831853 * max(dist, 1.0));
  float rays = smoothstep(0.5 - aw, 0.5 + aw, fract(a)) * (1.0 - smoothstep(1.0 - aw, 1.0, fract(a)));
  float rayMask = (1.0 - smoothstep(uDisc.z * 1.05, uDisc.z * 4.0, dist)) * smoothstep(uDisc.z * 0.98, uDisc.z * 1.15, dist);
  col = mix(col, col * mix(vec3(1.0), lineNow, 0.45), rays * rayMask * (0.07 + 0.16 * uLevel));

  /* ---- trame dans les coins, qui respire avec les basses ---- */
  vec2 q = frag / uRes - 0.5;
  q.x *= uRes.x / uRes.y;
  float edge = smoothstep(0.62, 1.1, length(q) * 1.25);
  float dots = halftone(frag, 8.0 * u, edge * (0.22 + 0.5 * uBass));
  col = mix(col, col * mix(vec3(1.0), lineNow, 0.6), dots * 0.5);

  /* ---- personnage : calque séparé + ombre tramée sur le décor ---- */
  if (uReady > 0.5) {
    vec2 cp = imgPx(frag, uCharXf) - uCharRect.xy;
    vec2 sp = cp - uCharShadowOff;
    vec2 suv = vec2(sp.x / uCharRect.z, 1.0 - sp.y / uCharRect.w);
    float sa = texture2D(uChar, clamp(suv, 0.0, 1.0)).a * inside01(suv);
    float sdots = halftone(frag, 6.0 * u, 0.55);
    col = mix(col, col * mix(vec3(1.0), lineNow, 0.8), sa * sdots * uCharShadow);
    vec2 cuv = vec2(cp.x / uCharRect.z, 1.0 - cp.y / uCharRect.w);
    vec4 ch = texture2D(uChar, clamp(cuv, 0.0, 1.0));
    col = mix(col, ch.rgb, ch.a * inside01(cuv));
  }

  /* ---- ombre tramée du disque ---- */
  {
    vec2 q2 = frag - uShadow.xy;
    float cs = cos(uShadowRot), sn = sin(uShadowRot);
    q2 = mat2(cs, -sn, sn, cs) * q2;
    float e = length(q2 / max(uShadow.zw, vec2(1.0)));
    float ins = (1.0 - smoothstep(0.95, 1.03, e)) * smoothstep(0.11, 0.14, e);
    float sd = halftone(frag, 7.0 * u, 0.8);
    col = mix(col, col * mix(vec3(1.0), lineNow, 0.85) * 0.8, ins * sd * uShadowAmt);
  }

  /* ---- arcs-en-ciel projetés par le disque (lumière colorée sur le papier) ---- */
  vec4 s0 = spot(frag, uSpot0, uDisc.z * 1.15);
  vec4 s1 = spot(frag, uSpot1, uDisc.z * 0.85);
  col *= 1.0 - s0.a * 0.75 * (1.0 - s0.rgb);
  col *= 1.0 - s1.a * 0.75 * (1.0 - s1.rgb);

  col = mix(col, uFlashCol, uFlash * 0.16);
  gl_FragColor = vec4(invNeutral(col), 1.0);
}
`;

/* Diffraction d'un réseau circulaire (pas 1,6 µm) : bandes arc-en-ciel radiales. */
const DIFF_VERT = /* glsl */`
varying vec3 vPosW; varying vec3 vNrmW; varying vec3 vRadW; varying vec3 vTanW; varying vec2 vUv2; varying float vR;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  mat3 m = mat3(modelMatrix);
  vNrmW = normalize(m * normal);
  vec2 p = position.xy;
  float r = max(length(p), 1e-5);
  vR = r;
  vec3 radL = vec3(p / r, 0.0);
  vRadW = normalize(m * radL);
  vTanW = normalize(m * vec3(-radL.y, radL.x, 0.0));
  vUv2 = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const DIFF_FRAG = /* glsl */`
#define NL 6
uniform vec3 uLightPos[NL];
uniform vec3 uLightCol[NL];
uniform float uIntensity, uSigma, uUseMask, uEnable, uRMin, uRMax;
uniform sampler2D uMask; uniform mat3 uMaskXf;
varying vec3 vPosW; varying vec3 vNrmW; varying vec3 vRadW; varying vec3 vTanW; varying vec2 vUv2; varying float vR;
float gfit(float x, float mu, float s1, float s2){ float t = (x - mu) / (x < mu ? s1 : s2); return exp(-0.5 * t * t); }
vec3 spectral(float l){
  float X = 1.056 * gfit(l, 599.8, 37.9, 31.0) + 0.362 * gfit(l, 442.0, 16.0, 26.7) - 0.065 * gfit(l, 501.1, 20.4, 26.2);
  float Y = 0.821 * gfit(l, 568.8, 46.9, 40.5) + 0.286 * gfit(l, 530.9, 16.3, 31.1);
  float Z = 1.217 * gfit(l, 437.0, 11.8, 36.0) + 0.681 * gfit(l, 459.0, 26.0, 13.8);
  vec3 rgb = mat3(3.2406, -0.9689, 0.0557, -1.5372, 1.8758, -0.2040, -0.4986, 0.0415, 1.0570) * vec3(X, Y, Z);
  return max(rgb, 0.0);
}
void main(){
  float ring = smoothstep(uRMin, uRMin + 0.012, vR) * (1.0 - smoothstep(uRMax - 0.008, uRMax, vR));
  float mask = 1.0;
  if (uUseMask > 0.5) { vec2 muv = (uMaskXf * vec3(vUv2, 1.0)).xy; mask = 1.0 - texture2D(uMask, muv).r; }
  float k = ring * mask * uEnable;
  if (k < 0.002) discard;
  vec3 N = normalize(vNrmW);
  vec3 V = normalize(cameraPosition - vPosW);
  float nv = dot(N, V);
  if (nv <= 0.0) discard;
  vec3 g = normalize(vRadW), t = normalize(vTanW);
  vec3 col = vec3(0.0);
  for (int i = 0; i < NL; i++) {
    vec3 L = normalize(uLightPos[i] - vPosW);
    float nl = dot(N, L);
    if (nl <= 0.0) continue;
    vec3 Hh = L + V;
    float w = dot(t, Hh);
    float lobe = exp(-(w * w) / (uSigma * uSigma)) + 0.2 * exp(-(w * w) / 0.36);
    if (lobe < 0.003) continue;
    float uu = abs(dot(g, Hh));
    vec3 c = spectral(1600.0 * uu) + spectral(800.0 * uu) * 0.34 + spectral(533.3 * uu) * 0.16;
    col += c * lobe * uLightCol[i] * smoothstep(0.0, 0.25, nl);
  }
  col *= 0.65 + 0.55 * pow(1.0 - nv, 2.0);
  gl_FragColor = vec4(col * uIntensity * k, 1.0);
}
`;

/* Contour encré : coque inversée extrudée en espace écran. */
const OUTLINE_VERT = /* glsl */`
uniform float uWidth; uniform vec2 uRes;
void main(){
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vec3 nV = normalize(normalMatrix * normal);
  vec2 d = (projectionMatrix * vec4(nV, 0.0)).xy;
  float len = length(d);
  if (len > 1e-5) clip.xy += (d / len) * min(1.0, len * 6.0) * uWidth * 2.0 / uRes * clip.w;
  gl_Position = clip;
}
`;

/* Splats de peinture (instanciés, en espace écran). */
const SPLAT_VERT = /* glsl */`
uniform vec2 uRes; uniform float uTime;
attribute vec3 iData; attribute vec4 iCol; attribute float iBirth;
varying vec2 vP; varying vec3 vCol; varying float vSeed; varying float vAge;
void main(){
  float age = uTime - iBirth;
  float grow = 1.0 - pow(1.0 - clamp(age / 0.14, 0.0, 1.0), 3.0);
  vec2 local = position.xy * vec2(1.45, 1.95) + vec2(0.0, -0.6);
  vec2 px = iData.xy + local * iData.z * max(grow, 0.02);
  gl_Position = vec4(px / uRes * 2.0 - 1.0, 0.0, 1.0);
  vP = local; vCol = iCol.rgb; vSeed = iCol.a; vAge = age;
}
`;
const SPLAT_FRAG = /* glsl */`
uniform vec3 uInk;
varying vec2 vP; varying vec3 vCol; varying float vSeed; varying float vAge;
float h1(float n){ return fract(sin(n * 12.9898) * 43758.5453); }
float disk(vec2 p, vec2 c, float r){ return 1.0 - smoothstep(r - 0.02, r + 0.02, length(p - c)); }
float field(vec2 p, float s, float age, float dil){
  float a = atan(p.y, p.x), r = length(p);
  float rad = 0.72 + 0.1 * sin(a * 5.0 + s * 6.28) + 0.07 * sin(a * 9.0 + s * 17.0) + 0.05 * sin(a * 14.0 + s * 3.0) + dil;
  float f = 1.0 - smoothstep(rad - 0.02, rad + 0.02, r);
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float da = h1(s * 91.0 + fi * 7.3) * 6.2831853;
    float dr = 0.98 + h1(s * 17.0 + fi * 3.1) * 0.32;
    f = max(f, disk(p, vec2(cos(da), sin(da)) * dr, 0.05 + h1(s * 7.0 + fi * 1.7) * 0.08 + dil));
  }
  float dg = clamp((age - 0.12) / 1.8, 0.0, 1.0);
  dg = 1.0 - (1.0 - dg) * (1.0 - dg);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float x = (h1(s * 13.0 + fi * 5.0) - 0.5);
    float w = 0.06 + h1(s * 29.0 + fi * 2.3) * 0.05 + dil;
    float top = -0.35;
    float yEnd = top - (0.45 + h1(s * 3.3 + fi * 2.0) * 1.2) * dg;
    float body = (1.0 - smoothstep(w - 0.02, w + 0.02, abs(p.x - x))) * step(yEnd, p.y) * step(p.y, top + 0.3);
    f = max(f, max(body, disk(p, vec2(x, yEnd), w * 1.35)));
  }
  return f;
}
void main(){
  float fill = field(vP, vSeed, vAge, 0.0);
  float outer = field(vP, vSeed, vAge, 0.075);
  if (outer < 0.01) discard;
  vec3 col = mix(vCol, vCol * 0.8, smoothstep(0.5, 5.0, vAge));
  float sheen = (1.0 - smoothstep(0.0, 0.3, length(vP - vec2(-0.26, 0.3)))) * (1.0 - smoothstep(0.3, 2.5, vAge));
  col += sheen * 0.45;
  float fade = 1.0 - smoothstep(9.0, 11.0, vAge);
  gl_FragColor = vec4(mix(uInk, col, fill), outer * fade);
}
`;

/* Passe finale : aberration chromatique sur les hautes lumières, grain, vignette légère. */
const FINAL_SHADER = {
  uniforms: {
    tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
    uChroma: { value: CONFIG.fx.chroma }, uGrain: { value: CONFIG.fx.grain }, uHal: { value: CONFIG.fx.halation },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uTime, uChroma, uGrain, uHal; uniform vec2 uCenter;
    varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec4 base = texture2D(tDiffuse, vUv);
      float lum = dot(base.rgb, vec3(0.299, 0.587, 0.114));
      vec2 dir = (vUv - uCenter);
      float amt = uChroma * uHal * (0.1 + 1.6 * smoothstep(0.975, 1.0, lum));
      float r = texture2D(tDiffuse, vUv + dir * amt * 4.0).r;
      float b = texture2D(tDiffuse, vUv - dir * amt * 4.0).b;
      vec3 col = vec3(r, base.g, b);
      col += (h(vUv * uRes + fract(uTime * 7.31) * 311.0) - 0.5) * uGrain;
      float v = smoothstep(1.3, 0.45, length((vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0)));
      col *= mix(0.93, 1.0, v);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

/* =============================================================================
   Rendu, scène, disque
   ========================================================================== */
const GL = {};          // tout l'état WebGL
const view = { W: 1, H: 1, dpr: 1, cx: 0, cy: 0, r: 100, shiftX: 0, baseCx: 0, bg: { s: 1, left: 0, top: 0 } };
const DISC = { T: 0.02, R_HOLE: 0.125, R_HUB: 0.19, R_BAND: 0.283, R_GROOVE: 0.383, R_METAL: 0.975, R_EDGE: 1.0 };
const TONEMAPS = () => ({ neutral: THREE.NeutralToneMapping, agx: THREE.AgXToneMapping, aces: THREE.ACESFilmicToneMapping, none: THREE.NoToneMapping });
const META = (ASSETS && ASSETS.meta) || { w: 1920, h: 1080, gumRect: [0, 0, 1, 1], paper: [248, 241, 225], line: [43, 151, 106] };

function ringGeo(r0, r1, segs = 256) {
  const g = new THREE.RingGeometry(r0, r1, segs, 1);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * 0.5 + 0.5, p.getY(i) * 0.5 + 0.5);
  return g;
}
function latheZ(points, segs = 200) {
  const g = new THREE.LatheGeometry(points, segs);
  g.rotateX(Math.PI / 2);
  return g;
}
function blankTexture(rgba) {
  const t = new THREE.DataTexture(new Uint8Array(rgba), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}

function initRenderer() {
  const canvas = $('#gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance' });
  if (!renderer.capabilities.isWebGL2) throw new Error('webgl2');
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = TONEMAPS()[CONFIG.fx.toneMapping] ?? THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(srgb255(META.paper), 1);
  GL.renderer = renderer;
  GL.maxAniso = renderer.capabilities.getMaxAnisotropy();
  GL.scene = new THREE.Scene();
  GL.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  GL.clock = 0;
  GL.blankInk = blankTexture([0, 0, 0, 255]);
}

function buildBackground() {
  const blank = blankTexture([0, 0, 0, 0]);
  const U = {
    uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
    uDisc: { value: new THREE.Vector3() }, uBass: { value: 0 }, uLevel: { value: 0 },
    uFlash: { value: 0 }, uFlashCol: { value: PAL.paper.clone() }, uSunRot: { value: 0 },
    uSpot0: { value: new THREE.Vector4() }, uSpot1: { value: new THREE.Vector4() },
    uShadow: { value: new THREE.Vector4() }, uShadowRot: { value: 0 }, uShadowAmt: { value: 0.75 },
    uBg: { value: blank }, uChar: { value: blank }, uReady: { value: 0 },
    uBgXf: { value: new THREE.Vector3(1, 0, 0) }, uCharXf: { value: new THREE.Vector3(1, 0, 0) },
    uCharRect: { value: new THREE.Vector4(...META.gumRect) }, uImg: { value: new THREE.Vector2(META.w, META.h) },
    uCharShadowOff: { value: new THREE.Vector2(16, 11) }, uCharShadow: { value: CONFIG.scene.charShadow },
    cPaper: { value: srgb255(META.paper) }, cLineSrc: { value: srgb255(META.line) }, cLine: { value: srgb255(META.line) },
    uRecolor: { value: 0 },
  };
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms: U, vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: BG_FRAG, depthTest: false, depthWrite: false }),
  );
  m.frustumCulled = false;
  m.renderOrder = -1000;
  GL.scene.add(m);
  GL.bg = m;
  GL.bgU = U;
}

/* Décor + personnage : chargés à part pour ne pas retarder l'affichage du disque. */
async function loadSceneImages() {
  if (!ASSETS || !ASSETS.bg || !ASSETS.gum) return;
  try {
    const [bgImg, charImg] = await Promise.all([loadImage(ASSETS.bg), loadImage(ASSETS.gum)]);
    const mk = (img) => {
      const t = new THREE.Texture(img);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = GL.maxAniso;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.needsUpdate = true;
      return t;
    };
    GL.bgU.uBg.value = mk(bgImg);
    GL.bgU.uChar.value = mk(charImg);
    GL.bgU.uReady.value = 1;
  } catch (e) {
    console.warn('décor indisponible', e);
  }
}

function buildSplats() {
  const MAX = 64;
  const base = new THREE.PlaneGeometry(2, 2);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.attributes.position);
  const iData = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
  const iCol = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
  const iBirth = new THREE.InstancedBufferAttribute(new Float32Array(MAX).fill(-1e4), 1);
  for (const a of [iData, iCol, iBirth]) a.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('iData', iData); g.setAttribute('iCol', iCol); g.setAttribute('iBirth', iBirth);
  g.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uInk: { value: PAL.ink } },
    vertexShader: SPLAT_VERT, fragmentShader: SPLAT_FRAG,
    transparent: true, depthTest: false, depthWrite: false,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -900;
  GL.scene.add(mesh);
  GL.splats = { MAX, list: [], mesh, mat, iData, iCol, iBirth };
}
function writeSplats() {
  const S = GL.splats, dpr = view.dpr;
  S.list.forEach((s, i) => {
    S.iData.setXYZ(i, s.x * dpr, (view.H - s.y) * dpr, s.size * dpr);
    S.iCol.setXYZW(i, s.color.r, s.color.g, s.color.b, s.seed);
    S.iBirth.setX(i, s.birth);
  });
  S.mesh.geometry.instanceCount = S.list.length;
  S.iData.needsUpdate = S.iCol.needsUpdate = S.iBirth.needsUpdate = true;
}
function spawnSplat(x, y, size, color) {
  if (!GL.splats) return;
  const S = GL.splats;
  S.list = S.list.filter((s) => GL.clock - s.birth < 11);
  if (S.list.length >= S.MAX) S.list.shift();
  S.list.push({ x, y, size, color: color.clone(), seed: Math.random(), birth: GL.clock });
  writeSplats();
}

function makeDiffMat(maskTex, useMask) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uLightPos: { value: [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector3()) },
      uLightCol: { value: [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector3(1, 1, 1)) },
      uIntensity: { value: CONFIG.fx.diffraction }, uSigma: { value: CONFIG.fx.sigma },
      uUseMask: { value: useMask ? 1 : 0 }, uEnable: { value: 1 },
      uRMin: { value: DISC.R_GROOVE }, uRMax: { value: DISC.R_METAL },
      uMask: { value: maskTex }, uMaskXf: { value: maskTex ? maskTex.matrix : new THREE.Matrix3() },
    },
    vertexShader: DIFF_VERT, fragmentShader: DIFF_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

function makeLabelMaterial(inkTex, anisoTex) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: inkTex, roughness: 0.5, metalness: 0,
    clearcoat: 0.5, clearcoatRoughness: 0.22,
    anisotropy: 0.8, anisotropyMap: anisoTex,
    envMapIntensity: 0.45,
  });
  const U = {
    uPaper: { value: new THREE.Color('#F6F3EC') }, uInkCol: { value: new THREE.Color('#121214') },
    uSilver: { value: CONFIG.labelMode === 'silver' ? 1 : 0 },
    uPaperRough: { value: 0.5 }, uInkRough: { value: 0.3 }, uMetalRough: { value: 0.09 }, uBlur: { value: 0 },
  };
  m.userData.U = U;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = 'uniform vec3 uPaper; uniform vec3 uInkCol; uniform float uSilver; uniform float uPaperRough; uniform float uInkRough; uniform float uMetalRough; uniform float uBlur;\n' +
      sh.fragmentShader
        .replace('#include <map_fragment>', `
          float labelInk = 0.0;
          #ifdef USE_MAP
            if ( uBlur > 0.002 ) {
              vec2 lc = vMapUv - 0.5;
              float jit = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
              for ( int k = 0; k < 12; k ++ ) {
                float la = uBlur * ( ( float( k ) + jit ) / 12.0 - 0.5 );
                float lca = cos( la ), lsa = sin( la );
                labelInk += texture2D( map, 0.5 + mat2( lca, lsa, - lsa, lca ) * lc ).r;
              }
              labelInk *= 1.0 / 12.0;
            } else {
              labelInk = texture2D( map, vMapUv ).r;
            }
          #endif
          float lgN = fract( sin( dot( floor( vMapUv * 1500.0 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
          vec3 lPaper = uPaper * ( 0.975 + 0.05 * lgN );
          vec3 lBase = mix( lPaper, vec3( 0.95, 0.955, 0.965 ), uSilver );
          diffuseColor.rgb *= mix( lBase, uInkCol, labelInk );`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix( mix( uPaperRough, uMetalRough, uSilver ), uInkRough, labelInk );')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = uSilver * ( 1.0 - labelInk );')
        .replace('#include <lights_physical_fragment>', THREE.ShaderChunk.lights_physical_fragment
          .replace('material.anisotropy = length( anisotropyV );', 'material.anisotropy = length( anisotropyV ) * uSilver * ( 1.0 - labelInk );'));
  };
  m.customProgramCacheKey = () => 'grindfm-label-v3';
  return m;
}

function buildDisc(inkTex, detailTex) {
  const { T, R_HOLE, R_HUB, R_BAND, R_GROOVE, R_METAL, R_EDGE } = DISC;
  const HT = T / 2, EPS = 0.0004;
  const root = new THREE.Group();
  const spin = new THREE.Group();
  root.add(spin);
  GL.scene.add(root);
  GL.discRoot = root; GL.discSpin = spin;

  const aniso = makeAnisoTexture(256);

  // face label
  const labelMat = makeLabelMaterial(inkTex, aniso);
  const label = new THREE.Mesh(ringGeo(R_HUB, R_METAL), labelMat);
  label.position.z = HT + EPS;
  spin.add(label);
  const labelDiffMat = makeDiffMat(inkTex, true);
  labelDiffMat.uniforms.uEnable.value = CONFIG.labelMode === 'silver' ? 1 : 0;
  const labelDiff = new THREE.Mesh(ringGeo(R_GROOVE, R_METAL), labelDiffMat);
  labelDiff.position.z = HT + EPS * 2.5;
  labelDiff.renderOrder = 2;
  spin.add(labelDiff);

  // face données (miroir)
  const mirrorMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#e4e8ef'), metalness: 1, roughness: 1, roughnessMap: detailTex,
    anisotropy: 0.75, anisotropyMap: aniso,
    iridescence: 0.25, iridescenceIOR: 1.45, iridescenceThicknessRange: [180, 520],
    clearcoat: 1, clearcoatRoughness: 0.04,
  });
  const mirrorGeo = ringGeo(R_BAND, R_METAL);
  mirrorGeo.rotateY(Math.PI);
  const mirror = new THREE.Mesh(mirrorGeo, mirrorMat);
  mirror.position.z = -(HT + EPS);
  spin.add(mirror);
  const mirrorDiffMat = makeDiffMat(null, false);
  const mdGeo = ringGeo(R_GROOVE, R_METAL);
  mdGeo.rotateY(Math.PI);
  const mirrorDiff = new THREE.Mesh(mdGeo, mirrorDiffMat);
  mirrorDiff.position.z = -(HT + EPS * 2.5);
  mirrorDiff.renderOrder = 2;
  spin.add(mirrorDiff);
  // dos de l'impression vu à travers le moyeu, côté données
  const backGeo = ringGeo(R_HUB, R_BAND);
  backGeo.rotateY(Math.PI);
  const back = new THREE.Mesh(backGeo, new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#e6e2d9'), roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.05 }));
  back.position.z = -(HT + EPS);
  spin.add(back);

  // corps en polycarbonate : moyeu + anneau d'empilement + liseré extérieur
  const er = HT, V = (x, y) => new THREE.Vector2(x, y);
  const prof = [];
  for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + (Math.PI * i) / 10; prof.push(V(R_EDGE - er + er * Math.cos(a), er * Math.sin(a))); }
  prof.push(V(0.205, HT), V(0.188, HT + 0.0016), V(0.176, HT + 0.0048), V(0.158, HT + 0.0048), V(0.148, HT + 0.0016), V(0.138, HT), V(0.13, HT));
  prof.push(V(R_HOLE, HT - 0.002), V(R_HOLE, -HT + 0.002), V(0.13, -HT), V(0.205, -HT), V(R_EDGE - er, -HT));
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#e2e9f2'), transparent: true, opacity: 0.5, roughness: 0.1, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.03, ior: 1.58, depthWrite: false, side: THREE.DoubleSide,
  });
  const body = new THREE.Mesh(latheZ(prof, 220), bodyMat);
  body.renderOrder = 1;
  spin.add(body);

  // contour encré (bord extérieur) + anneaux d'encre autour du trou
  const oprof = [];
  oprof.push(V(R_EDGE - er - 0.003, -HT));
  for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + (Math.PI * i) / 10; oprof.push(V(R_EDGE - er + er * Math.cos(a), er * Math.sin(a))); }
  oprof.push(V(R_EDGE - er - 0.003, HT));
  const outlineMat = new THREE.ShaderMaterial({
    uniforms: { uWidth: { value: CONFIG.fx.outlinePx }, uRes: { value: new THREE.Vector2(1, 1) }, uColor: { value: PAL.ink } },
    vertexShader: OUTLINE_VERT,
    fragmentShader: 'uniform vec3 uColor; void main(){ gl_FragColor = vec4(uColor, 1.0); }',
    side: THREE.BackSide,
  });
  const outline = new THREE.Mesh(latheZ(oprof, 220), outlineMat);
  spin.add(outline);
  const inkMat = new THREE.MeshBasicMaterial({ color: PAL.ink });
  const holeTop = new THREE.Mesh(ringGeo(R_HOLE, R_HOLE + 0.01, 96), inkMat);
  holeTop.position.z = HT + EPS * 2;
  const holeBot = new THREE.Mesh(ringGeo(R_HOLE, R_HOLE + 0.01, 96), inkMat);
  holeBot.rotation.y = Math.PI;
  holeBot.position.z = -(HT + EPS * 2);
  spin.add(holeTop, holeBot);

  // cible de clic (invisible)
  const hit = new THREE.Mesh(new THREE.CircleGeometry(1.0, 64), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  hit.material.visible = false;
  root.add(hit);

  // lumières
  const key = new THREE.PointLight(0xffffff, 1.7, 0, 0);
  const rimA = new THREE.PointLight(PAL.magenta, 0.9, 0, 0);
  const rimB = new THREE.PointLight(PAL.cyan, 1.3, 0, 0);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x5b4a9e, 0.22);
  GL.scene.add(key, rimA, rimB, hemi);

  Object.assign(GL, {
    label, labelMat, labelDiff, labelDiffMat, mirror, mirrorMat, mirrorDiff, mirrorDiffMat, body, outline, outlineMat,
    holeTop, holeBot, hit, lights: { key, rimA, rimB, hemi }, inkTex, aniso,
  });
}

/* Pose les textures d'un disque sur le modèle (même programme GPU : pas de recompilation). */
function setDiscTextures(inkTex, detailTex) {
  GL.inkTex = inkTex;
  GL.labelMat.map = inkTex;
  GL.labelDiffMat.uniforms.uMask.value = inkTex;
  GL.labelDiffMat.uniforms.uMaskXf.value = inkTex.matrix;
  if (detailTex) GL.mirrorMat.roughnessMap = detailTex;
}

function setHoleInkWidth() {
  if (!GL.holeTop) return;
  const w = clamp((CONFIG.fx.outlinePx * 0.85) / Math.max(view.r, 40), 0.003, 0.03);
  for (const m of [GL.holeTop, GL.holeBot]) {
    m.geometry.dispose();
    m.geometry = ringGeo(DISC.R_HOLE, DISC.R_HOLE + w, 96);
  }
}

function setLabelMode(mode) {
  CONFIG.labelMode = mode;
  const s = mode === 'silver' ? 1 : 0;
  if (GL.labelMat) GL.labelMat.userData.U.uSilver.value = s;
  if (GL.labelDiffMat) GL.labelDiffMat.uniforms.uEnable.value = s;
}

function buildPost() {
  const { renderer, scene, camera } = GL;
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), CONFIG.fx.bloom, CONFIG.fx.bloomRadius, CONFIG.fx.bloomThreshold);
  const tints = [[1, 1, 1], [1, 0.95, 1], [1, 0.7, 0.78], [0.8, 0.72, 1], [0.62, 0.92, 1]];
  bloom.bloomTintColors.forEach((v, i) => v.set(...tints[i]));
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const fin = new ShaderPass(FINAL_SHADER);
  composer.addPass(fin);
  Object.assign(GL, { composer, bloom, finalPass: fin });
}

/* Mise en page : le disque se cale entre la barre du haut et le bandeau ; le décor couvre l'écran. */
function layout() {
  const W = Math.max(1, window.innerWidth), H = Math.max(1, window.innerHeight);
  view.W = W; view.H = H;
  const narrow = W < 721;
  const topRect = $('#topbar').getBoundingClientRect();
  const banRect = $('#banner').getBoundingClientRect();
  const top = topRect.bottom + (narrow ? 14 : 10);
  const bottom = banRect.top + 22 - (narrow ? 26 : 34);
  const avail = Math.max(140, bottom - top);
  const D = Math.min(avail * (narrow ? 0.9 : 0.86), W * (narrow ? 0.8 : 0.52), 760);
  view.r = D / 2;
  view.baseCx = W / 2 + (!narrow && W / H > 1.25 ? W * CONFIG.scene.discShiftX : 0);
  view.cy = top + avail / 2;
  view.cx = view.baseCx + view.shiftX;
  view.topBottom = topRect.bottom;
  view.waveY = banRect.top - 4;
  // décor : couverture de l'écran, avec une marge pour la parallaxe
  // le bandeau est opaque : le décor n'a besoin de couvrir l'écran que jusqu'à lui
  const S = CONFIG.scene;
  const Hc = Math.min(H, banRect.top + 70);
  const s = Math.max(W / META.w, Hc / META.h) * S.zoom;
  const fx = W / H < 1 ? S.focusXPortrait : S.focusX;
  view.bg = { s, left: (W - META.w * s) * fx, top: (Hc - META.h * s) * S.focusY, Hc };
  if (!GL.renderer) return;
  view.dpr = Math.min(window.devicePixelRatio || 1, Perf.dprCap);
  const { renderer, camera, composer } = GL;
  renderer.setPixelRatio(view.dpr);
  renderer.setSize(W, H, false);
  composer.setPixelRatio(view.dpr);
  composer.setSize(W, H);
  camera.aspect = W / H;
  const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  GL.camDist = (H / 2) / (view.r * tanH);
  camera.position.set(0, 0, GL.camDist);
  camera.near = Math.max(0.05, GL.camDist - 6);
  camera.far = GL.camDist + 20;
  applyViewOffset();
  const bw = W * view.dpr, bh = H * view.dpr;
  GL.bgU.uRes.value.set(bw, bh);
  GL.splats.mat.uniforms.uRes.value.set(bw, bh);
  GL.outlineMat.uniforms.uRes.value.set(bw, bh);
  GL.outlineMat.uniforms.uWidth.value = CONFIG.fx.outlinePx * view.dpr;
  GL.finalPass.uniforms.uRes.value.set(bw, bh);
  GL.bloom.resolution.set(W * view.dpr * 0.5, H * view.dpr * 0.5);
  setHoleInkWidth();
  writeSplats();
}
function applyViewOffset() {
  const { camera } = GL;
  camera.setViewOffset(view.W, view.H, view.W / 2 - view.cx, view.H / 2 - view.cy, view.W, view.H);
  camera.updateProjectionMatrix();
}

/* Position d'un calque du décor (px CSS) avec sa parallaxe, sans jamais découvrir ses bords. */
function layerXf(off, out) {
  const b = view.bg, w = META.w * b.s, h = META.h * b.s;
  const left = clamp(b.left + off.x, view.W - w, 0);
  const top = clamp(b.top + off.y, (b.Hc || view.H) - h, 0);
  return out.set(b.s * view.dpr, left * view.dpr, top * view.dpr);
}

/* =============================================================================
   Mouvement du disque : spin, précession, flips, inclinaison, drag, changement de disque
   ========================================================================== */
const Motion = {
  spin: 0, spinRps: CONFIG.spin.idleRps,
  flip: 0, flipVel: 0, flipTarget: 0, nextFlip: 9,
  prec: 0, tiltX: 0, tiltY: 0, bob: 0,
  qDrag: new THREE.Quaternion(), angVel: new THREE.Vector3(), dragging: false, lastTouch: -1e3,
  wobble: 0, punch: 0, roll: 0,
  swap: null,
};
const _q = { a: new THREE.Quaternion(), b: new THREE.Quaternion(), c: new THREE.Quaternion(), d: new THREE.Quaternion() };
const _v = { a: new THREE.Vector3(), b: new THREE.Vector3(), z: new THREE.Vector3(0, 0, 1), x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0) };
const _e = new THREE.Euler();

function triggerFlip() {
  Motion.flipTarget += Math.PI;
  Motion.nextFlip = GL.clock + CONFIG.motion.flipEvery * (0.8 + Math.random() * 0.5);
}

/* Éjection du disque vers la gauche, échange, retour par la droite.
   Minuté en temps réel : même durée quelle que soit la fluidité, et terminé d'office si l'onglet est en arrière-plan. */
function startSwap(onMid, onDone) {
  const S = { start: performance.now(), dur: 1.15, onMid, onDone, mid: false };
  Motion.swap = S;
  setTimeout(() => { if (Motion.swap === S) finishSwap(S); }, S.dur * 1000 + 600);
}
function finishSwap(S) {
  if (!S.mid) { S.mid = true; if (S.onMid) S.onMid(); }
  if (Motion.swap === S) Motion.swap = null;
  if (S.onDone) S.onDone();
}

function updateMotion(dt, F, st) {
  const M = Motion;
  const rm = reduced();
  // spin (tours/s) : montée en ~1,5 s, modulée par les basses
  const target = st.playing ? CONFIG.spin.playRps * (rm ? 0.35 : 1) * (1 + 0.14 * F.bass) : CONFIG.spin.idleRps;
  const rate = st.playing ? 3 / CONFIG.spin.spinUpSeconds : 1.6;
  M.spinRps = damp(M.spinRps, target, rate, dt);
  // changement de disque
  let swapX = 0, swapYaw = 0;
  const S = M.swap;
  if (S) {
    const k = Math.min(1, (performance.now() - S.start) / (S.dur * 1000));
    const outX = -(view.cx + view.r * 1.35) / view.r;
    const inX = (view.W - view.cx + view.r * 1.35) / view.r;
    if (k < 0.45) {
      const e = easeInBack(k / 0.45);
      swapX = outX * e; swapYaw = -0.9 * e;
    } else {
      if (!S.mid) { S.mid = true; if (S.onMid) S.onMid(); }
      const e = easeOutBack((k - 0.45) / 0.55);
      swapX = inX * (1 - e); swapYaw = 0.9 * (1 - e);
    }
    M.spinRps = Math.max(M.spinRps, 1.4);
    if (k >= 1) { swapX = 0; swapYaw = 0; finishSwap(S); }
  }
  M.spin -= M.spinRps * Math.PI * 2 * dt;
  // flips réguliers pour alterner label / face irisée
  if (!M.dragging && !M.swap && GL.clock - M.lastTouch > 3 && GL.clock > M.nextFlip) triggerFlip();
  const k = 70, c = 10.5;
  M.flipVel += (k * (M.flipTarget - M.flip) - c * M.flipVel) * dt;
  M.flip += M.flipVel * dt;
  // précession : l'axe décrit un cône
  M.prec += dt * (Math.PI * 2) / 9.5;
  const pa = THREE.MathUtils.degToRad(CONFIG.motion.precessionDeg) * (rm ? 0.5 : 1);
  // inclinaison vers le pointeur
  M.tiltX = damp(M.tiltX, Input.ny * 0.2, 4, dt);
  M.tiltY = damp(M.tiltY, Input.nx * 0.3, 4, dt);
  // hésitation en buffering
  M.wobble = damp(M.wobble, st.buffering ? 1 : 0, 6, dt);
  const wob = M.wobble * 0.07 * Math.sin(GL.clock * 23.0);
  // inertie du drag, puis retour doux au mouvement auto
  if (!M.dragging) {
    const sp = M.angVel.length();
    if (sp > 1e-4) {
      _q.a.setFromAxisAngle(_v.a.copy(M.angVel).normalize(), sp * dt);
      M.qDrag.premultiply(_q.a);
      M.angVel.multiplyScalar(Math.exp(-2.6 * dt));
    }
    if (GL.clock - M.lastTouch > 2) M.qDrag.slerp(_q.d.identity(), 1 - Math.exp(-1.4 * dt));
  }
  // composition
  _e.set(pa * Math.sin(M.prec) + M.tiltX + wob, pa * Math.cos(M.prec) * 0.8 + M.tiltY + swapYaw, M.roll * 0.04);
  _q.a.setFromEuler(_e);
  _q.b.setFromAxisAngle(_v.y, M.flip);
  GL.discRoot.quaternion.copy(M.qDrag).multiply(_q.a).multiply(_q.b);
  M.bob = Math.sin(GL.clock * 1.25) * 0.022 * (rm ? 0.3 : 1);
  GL.discRoot.position.set(swapX, M.bob, 0);
  GL.discSpin.rotation.z = M.spin;
  if (GL.labelMat) GL.labelMat.userData.U.uBlur.value = smooth(0.9, 1.6, M.spinRps) * M.spinRps * Math.PI * 2 * (1 / 60) * 1.1;
}

/* Normale monde de la face label (hors spin) */
function labelNormal(out) {
  return out.copy(_v.z).applyQuaternion(GL.discRoot.quaternion).normalize();
}
