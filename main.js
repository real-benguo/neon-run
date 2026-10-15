// main.js —— 霓虹狂奔 · 第一人称跑酷
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { makeTextures, makeSky, makeRain, makeLights, makeEnvMap } from './world.js';

// ------------------------------------------------------------------ 参数
const CFG = {
  gravity: 27,
  jumpV: 9.2,        // 跳高约 1.57m
  walk: 6.6,
  run: 9.8,
  groundAccel: 52,
  airAccel: 26,
  friction: 13,
  radius: 0.42,
  height: 1.80,
  eye: 1.63,
  stepMax: 0.74,
  coyote: 0.12,
  jumpBuf: 0.15,
  fallY: -8.0,       // 低于这个高度判定坠落
  sens: 0.0022,
  sensTouch: 0.0052,
};

const isMobile = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(navigator.userAgent);

// ------------------------------------------------------------------ 渲染
const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: !isMobile, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a0e1c, 0.0029);
scene.environmentIntensity = 0.34;

const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.08, 2000);
camera.rotation.order = 'YXZ';

const lights = makeLights(scene);
const sky = makeSky(scene);
const rain = makeRain();
scene.add(rain.mesh);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(innerWidth, innerHeight),
  isMobile ? 0.4 : 0.48, 0.42, 0.86
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ------------------------------------------------------------------ 音效
let actx = null;
function audio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) actx = new AC();
  }
  if (actx && actx.state === 'suspended') actx.resume();
  return actx;
}
function beep(f0, f1, dur, type = 'sine', vol = 0.1) {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, a.currentTime);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), a.currentTime + dur);
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g); g.connect(a.destination);
  o.start(); o.stop(a.currentTime + dur + 0.02);
}
const SFX = {
  jump: () => beep(430, 720, 0.13, 'triangle', 0.075),
  land: () => beep(150, 78, 0.11, 'sine', 0.1),
  cp: () => { beep(760, 760, 0.1, 'sine', 0.09); setTimeout(() => beep(1140, 1140, 0.16, 'sine', 0.08), 90); },
  fall: () => beep(320, 70, 0.42, 'sawtooth', 0.07),
  win: () => { [660, 880, 1100, 1460].forEach((f, i) => setTimeout(() => beep(f, f, 0.3, 'triangle', 0.09), i * 110)); },
};

// ------------------------------------------------------------------ 关卡数据
let SOLIDS = [];        // [x0,x1,y0,y1,z0,z1]
let CPS = [];           // 检查点
let START = new THREE.Vector3();
let FINISH = { pos: new THREE.Vector3(), radius: 7 };

const MATCFG = {
  mat_concrete:  { map: 'concrete', rough: 0.92, metal: 0.0 },
  mat_concrete2: { map: 'concrete', rough: 0.95, metal: 0.0 },
  mat_concrete3: { map: 'concrete', rough: 0.90, metal: 0.0 },
  mat_asphalt:   { map: 'asphalt',  rough: 0.97, metal: 0.0 },
  mat_metal:     { map: 'metal',    rough: 0.42, metal: 0.85 },
  mat_metal_d:   { map: 'metal',    rough: 0.56, metal: 0.70 },
  mat_pipe:      { map: 'metal',    rough: 0.50, metal: 0.60 },
  mat_grid:      { map: 'grid',     rough: 0.60, metal: 0.45 },
  mat_hazard:    { map: 'hazard',   rough: 0.78, white: true },
  mat_rubber:    { map: null,       rough: 0.96, metal: 0.0 },
};

function dressMaterials(root, T) {
  const seen = new Set();
  root.traverse(o => {
    if (!o.isMesh) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of list) {
      if (!m || seen.has(m.uuid)) continue;
      seen.add(m.uuid);
      const cfg = MATCFG[m.name];
      if (!cfg) {                       // 霓虹 / 窗户：保持自发光
        m.toneMapped = true;
        continue;
      }
      if (cfg.map && T[cfg.map]) {
        m.map = T[cfg.map];
        m.color.multiplyScalar(1.16);
      }
      if (cfg.white) m.color.setRGB(1, 1, 1);
      if (cfg.rough !== undefined) m.roughness = cfg.rough;
      if (cfg.metal !== undefined) m.metalness = cfg.metal;
      m.needsUpdate = true;
    }
  });
}

// ------------------------------------------------------------------ 玩家
const P = {
  pos: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  onGround: false,
  coyote: 0,
  buf: 0,
  bob: 0,
  dip: 0,
  airT: 0,
};

function overlapAt(s, x, y, z) {
  const R = CFG.radius, H = CFG.height;
  return (x + R > s[0] && x - R < s[1] &&
          y + H > s[2] && y < s[3] &&
          z + R > s[4] && z - R < s[5]);
}
function blocked(x, y, z) {
  for (let i = 0; i < SOLIDS.length; i++) if (overlapAt(SOLIDS[i], x, y, z)) return true;
  return false;
}
function groundHeight(x, z, yMax, tol) {
  const t = tol === undefined ? 0.35 : tol;
  let best = -Infinity;
  for (const s of SOLIDS) {
    if (x + 0.12 > s[0] && x - 0.12 < s[1] && z + 0.12 > s[4] && z - 0.12 < s[5]) {
      if (s[3] <= yMax + t && s[3] > best) best = s[3];
    }
  }
  return best;
}

function moveX(d) {
  if (!d) return;
  const nx = P.pos.x + d;
  if (!blocked(nx, P.pos.y, P.pos.z)) { P.pos.x = nx; return; }
  if (P.onGround || P.coyote > 0) {
    for (let k = 1; k <= 8; k++) {
      const up = k * 0.0925;
      if (!blocked(nx, P.pos.y + up, P.pos.z)) { P.pos.x = nx; P.pos.y += up; return; }
    }
  }
  P.vel.x = 0;
}
function moveZ(d) {
  if (!d) return;
  const nz = P.pos.z + d;
  if (!blocked(P.pos.x, P.pos.y, nz)) { P.pos.z = nz; return; }
  if (P.onGround || P.coyote > 0) {
    for (let k = 1; k <= 8; k++) {
      const up = k * 0.0925;
      if (!blocked(P.pos.x, P.pos.y + up, nz)) { P.pos.z = nz; P.pos.y += up; return; }
    }
  }
  P.vel.z = 0;
}
function moveY(d) {
  if (!d) return;
  const ny = P.pos.y + d;
  if (d < 0) {
    let top = -Infinity;
    for (const s of SOLIDS) if (overlapAt(s, P.pos.x, ny, P.pos.z)) top = Math.max(top, s[3]);
    if (top > -Infinity) {
      if (!P.onGround && P.airT > 0.18) { P.dip = Math.min(0.26, P.airT * 0.24); SFX.land(); }
      P.pos.y = top; P.vel.y = 0; P.onGround = true; P.airT = 0;
      return;
    }
    P.pos.y = ny;
    P.onGround = false;
  } else {
    let bot = Infinity;
    for (const s of SOLIDS) if (overlapAt(s, P.pos.x, ny, P.pos.z)) bot = Math.min(bot, s[2]);
    if (bot < Infinity) { P.pos.y = bot - CFG.height - 0.002; P.vel.y = 0; return; }
    P.pos.y = ny;
    P.onGround = false;
  }
}

// ------------------------------------------------------------------ 状态
const state = {
  phase: 'menu',     // menu | run | pause | done
  t: 0,
  cp: 0,
  best: parseFloat(localStorage.getItem('neonrun_best') || '0') || 0,
  started: false,
  falls: 0,
};
let yaw = 0, pitch = 0, locked = false;

// ------------------------------------------------------------------ UI
const $ = id => document.getElementById(id);
const el = {
  hud: $('hud'), overlay: $('overlay'), result: $('result'), pause: $('pause'),
  loading: $('loading'), bar: $('barfill'), loadtxt: $('loadtxt'),
  timer: $('timer'), best: $('best'), cpbar: $('cpbar'),
  spdfill: $('spdfill'), spdtxt: $('spdtxt'), toast: $('toast'), flash: $('flash'),
  rTime: $('rTime'), rRows: $('rRows'), rTag: $('rTag'), touch: $('touch'),
};

function fmt(t) {
  if (!t) return '--:--';
  const m = Math.floor(t / 60), s = t % 60;
  return String(m).padStart(2, '0') + ':' + s.toFixed(2).padStart(5, '0');
}
let toastTimer = 0;
function toast(msg, warn) {
  el.toast.textContent = msg;
  el.toast.className = 'show' + (warn ? ' warn' : '');
  toastTimer = 1.6;
}
function flash(kind) {
  el.flash.className = kind;
  setTimeout(() => { el.flash.className = ''; }, 70);
}
function buildCpBar() {
  el.cpbar.innerHTML = '';
  for (let i = 0; i < CPS.length; i++) {
    const d = document.createElement('div');
    d.className = 'cp';
    el.cpbar.appendChild(d);
  }
}
function syncCpBar() {
  const kids = el.cpbar.children;
  for (let i = 0; i < kids.length; i++) {
    kids[i].className = 'cp' + (i < state.cp ? ' on' : i === state.cp ? ' cur' : '');
  }
}

// ------------------------------------------------------------------ 输入
const keys = Object.create(null);
addEventListener('keydown', e => {
  if (e.code === 'Space') e.preventDefault();
  if (keys[e.code]) return;
  keys[e.code] = true;
  if (e.code === 'Space') P.buf = CFG.jumpBuf;
  if (e.code === 'KeyR' && state.phase === 'run') { respawn(true); }
  if (e.code === 'Escape' && state.phase === 'run') document.exitPointerLock();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

addEventListener('mousemove', e => {
  if (!locked || state.phase !== 'run') return;
  yaw -= e.movementX * CFG.sens;
  pitch -= e.movementY * CFG.sens;
  pitch = Math.max(-Math.PI / 2 + 0.02, Math.min(Math.PI / 2 - 0.02, pitch));
});

document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  if (!locked && state.phase === 'run') {
    state.phase = 'pause';
    el.pause.classList.remove('off');
  }
});

// 触屏
let touchMove = { x: 0, y: 0, id: -1 };
let lookId = -1, lookLast = { x: 0, y: 0 };
function setupTouch() {
  const stick = $('stick'), nub = $('stickNub'), look = $('lookzone'), jump = $('jumpBtn');
  const R = 48;
  function stickStart(t) {
    const r = stick.getBoundingClientRect();
    touchMove.id = t.identifier;
    stickOrigin.x = r.left + r.width / 2;
    stickOrigin.y = r.top + r.height / 2;
    stickMove(t);
  }
  const stickOrigin = { x: 0, y: 0 };
  function stickMove(t) {
    let dx = t.clientX - stickOrigin.x, dy = t.clientY - stickOrigin.y;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx = dx / d * R; dy = dy / d * R; }
    nub.style.transform = `translate(${dx}px,${dy}px)`;
    touchMove.x = dx / R;
    touchMove.y = -dy / R;
  }
  stick.addEventListener('touchstart', e => { e.preventDefault(); stickStart(e.changedTouches[0]); }, { passive: false });
  stick.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === touchMove.id) stickMove(t);
  }, { passive: false });
  const stickEnd = e => {
    for (const t of e.changedTouches) if (t.identifier === touchMove.id) {
      touchMove.id = -1; touchMove.x = touchMove.y = 0;
      nub.style.transform = 'translate(0,0)';
    }
  };
  stick.addEventListener('touchend', stickEnd);
  stick.addEventListener('touchcancel', stickEnd);

  look.addEventListener('touchstart', e => {
    e.preventDefault();
    const t = e.changedTouches[0];
    lookId = t.identifier; lookLast.x = t.clientX; lookLast.y = t.clientY;
  }, { passive: false });
  look.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== lookId) continue;
      yaw -= (t.clientX - lookLast.x) * CFG.sensTouch;
      pitch -= (t.clientY - lookLast.y) * CFG.sensTouch;
      pitch = Math.max(-Math.PI / 2 + 0.02, Math.min(Math.PI / 2 - 0.02, pitch));
      lookLast.x = t.clientX; lookLast.y = t.clientY;
    }
  }, { passive: false });
  const lookEnd = e => { for (const t of e.changedTouches) if (t.identifier === lookId) lookId = -1; };
  look.addEventListener('touchend', lookEnd);
  look.addEventListener('touchcancel', lookEnd);

  jump.addEventListener('touchstart', e => { e.preventDefault(); P.buf = CFG.jumpBuf; }, { passive: false });
}

// ------------------------------------------------------------------ 游戏流程
function respawn(manual) {
  const c = CPS[Math.min(state.cp, CPS.length - 1)];
  P.pos.set(c.pos.x, c.pos.y + 0.06, c.pos.z);
  P.vel.set(0, 0, 0);
  P.onGround = false; P.airT = 0; P.dip = 0;
  // 朝向路线前方
  const nxt = CPS[Math.min(state.cp + 1, CPS.length - 1)];
  const dx = nxt.pos.x - c.pos.x, dz = nxt.pos.z - c.pos.z;
  if (dx * dx + dz * dz > 1) yaw = Math.atan2(-dx, -dz);
  if (manual) toast('回到检查点', false);
}
function startRun() {
  audio();
  state.phase = 'run';
  state.t = 0;
  state.cp = 0;
  state.started = false;
  state.falls = 0;
  el.overlay.classList.add('off');
  el.result.classList.add('off');
  el.pause.classList.add('off');
  el.hud.classList.remove('off');
  respawn(false);
  syncCpBar();
  if (!isMobile) renderer.domElement.requestPointerLock();
}
function finishRun() {
  state.phase = 'done';
  if (document.pointerLockElement) document.exitPointerLock();
  const t = state.t;
  const isBest = !state.best || t < state.best;
  if (isBest) { state.best = t; localStorage.setItem('neonrun_best', String(t)); }
  el.rTag.textContent = isBest ? '新纪录' : '通关';
  el.rTime.textContent = fmt(t);
  const rows = [
    ['用时', fmt(t), 'hi'],
    ['检查点', state.cp + ' / ' + (CPS.length - 1), ''],
    ['坠落次数', state.falls + ' 次', state.falls === 0 ? 'gold' : ''],
    ['最佳成绩', fmt(state.best), 'gold'],
  ];
  el.rRows.innerHTML = rows.map(([k, v, c]) =>
    `<div class="row ${c}"><span class="rl">${k}</span><span class="rv">${v}</span></div>`).join('');
  el.result.classList.remove('off');
  el.hud.classList.add('off');
  flash('ok');
  SFX.win();
  el.best.textContent = '最佳 ' + fmt(state.best);
}

// ------------------------------------------------------------------ 落点指示环
let ring, ringDot;
function makeRing() {
  ring = new THREE.Mesh(
    new THREE.RingGeometry(0.30, 0.46, 32),
    new THREE.MeshBasicMaterial({ color: 0x22e6ff, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false, fog: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  ring.renderOrder = 2;
  scene.add(ring);
  ringDot = new THREE.Mesh(
    new THREE.CircleGeometry(0.1, 16),
    new THREE.MeshBasicMaterial({ color: 0x22e6ff, transparent: true, opacity: 0.5, depthWrite: false, fog: false })
  );
  ringDot.rotation.x = -Math.PI / 2;
  ringDot.visible = false;
  ringDot.renderOrder = 2;
  scene.add(ringDot);
}

// ------------------------------------------------------------------ 加载
const loader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath('./lib/draco/');
loader.setDRACOLoader(draco);

const T = makeTextures();

function setProgress(p, txt) {
  el.bar.style.width = Math.round(p * 100) + '%';
  if (txt) el.loadtxt.textContent = txt;
}

const glbP = new Promise((res, rej) => loader.load(
  './assets/city.glb',
  g => res(g),
  e => { if (e.total) setProgress(Math.min(0.94, e.loaded / e.total), '正在点亮这座城市…'); },
  err => rej(err)
));
const dataP = fetch('./assets/city_data.json').then(r => r.json());

Promise.all([glbP, dataP]).then(([gltf, d]) => {
  // ---- 关卡碰撞数据
  SOLIDS = d.solids;
  CPS = d.checkpoints.map(c => ({ pos: new THREE.Vector3(c.pos[0], c.pos[1], c.pos[2]), name: c.name }));
  START.set(d.start[0], d.start[1], d.start[2]);
  FINISH.pos.set(d.finish.pos[0], d.finish.pos[1], d.finish.pos[2]);
  FINISH.radius = d.finish.radius;

  // ---- 场景
  scene.environment = makeEnvMap(renderer);
  dressMaterials(gltf.scene, T);
  scene.add(gltf.scene);

  buildCpBar(); syncCpBar(); makeRing();
  respawn(false);
  el.best.textContent = '最佳 ' + fmt(state.best);
  setProgress(1, '准备就绪');

  setTimeout(() => {
    el.loading.classList.add('gone');
    if (isMobile) {
      document.body.classList.add('touch');
      el.touch.classList.remove('off');
      setupTouch();
    }
  }, 420);
}).catch(err => {
  console.error(err);
  setProgress(1, '加载失败：' + (err && err.message ? err.message : err));
  el.loadtxt.style.color = '#ff6b9d';
});

// ------------------------------------------------------------------ 主循环
const clock = new THREE.Clock();
const camPos = new THREE.Vector3();
const wish = new THREE.Vector3();
const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
let elapsed = 0;

// 固定步长物理：帧率高低都不影响跳跃高度和手感
const FIXED = 1 / 120;
let acc = 0;

function stepPhysics(h) {
  if (state.phase !== 'run') { P.vel.set(0, 0, 0); P.onGround = false; return; }

  // ---- 输入 → 期望方向
  let ix = 0, iz = 0;
  if (keys['KeyW'] || keys['ArrowUp']) iz += 1;
  if (keys['KeyS'] || keys['ArrowDown']) iz -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) ix += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) ix -= 1;
  if (touchMove.id >= 0) { ix += touchMove.x; iz += touchMove.y; }
  const sprint = keys['ShiftLeft'] || keys['ShiftRight'];
  const maxSpd = sprint ? CFG.run : CFG.walk;

  fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  right.set(Math.cos(yaw), 0, -Math.sin(yaw));
  wish.set(0, 0, 0).addScaledVector(fwd, iz).addScaledVector(right, ix);
  if (wish.lengthSq() > 1e-6) wish.normalize();

  // ---- 加速 / 摩擦
  const a = P.onGround ? CFG.groundAccel : CFG.airAccel;
  if (wish.lengthSq() > 0) {
    const tx = wish.x * maxSpd, tz = wish.z * maxSpd;
    const k = Math.min(1, a * h / Math.max(1, maxSpd) * 1.6);
    P.vel.x += (tx - P.vel.x) * k;
    P.vel.z += (tz - P.vel.z) * k;
  } else if (P.onGround) {
    const f = Math.max(0, 1 - CFG.friction * h);
    P.vel.x *= f; P.vel.z *= f;
  }

  // ---- 跳跃（含土狼时间与跳跃缓冲）
  P.buf -= h; P.coyote -= h;
  if (P.onGround) { P.coyote = CFG.coyote; P.airT = 0; } else { P.airT += h; }
  if (P.buf > 0 && P.coyote > 0) {
    P.vel.y = CFG.jumpV;
    P.buf = 0; P.coyote = 0; P.onGround = false;
    SFX.jump();
  }

  // ---- 重力
  P.vel.y -= CFG.gravity * h;
  if (P.vel.y < -60) P.vel.y = -60;

  // ---- 位移（子步，防穿墙）
  const maxD = Math.max(Math.abs(P.vel.x), Math.abs(P.vel.y), Math.abs(P.vel.z)) * h;
  const steps = Math.max(1, Math.min(8, Math.ceil(maxD / 0.06)));
  const sdt = h / steps;
  for (let s = 0; s < steps; s++) {
    moveX(P.vel.x * sdt);
    moveZ(P.vel.z * sdt);
    moveY(P.vel.y * sdt);
  }

  if (!state.started && (Math.abs(P.vel.x) + Math.abs(P.vel.z)) > 0.6) state.started = true;
  if (state.started) state.t += h;
}

function checkTriggers() {
  if (state.phase !== 'run') return;
  for (let i = state.cp + 1; i < CPS.length; i++) {
    const c = CPS[i];
    const dx = P.pos.x - c.pos.x, dz = P.pos.z - c.pos.z, dy = P.pos.y - c.pos.y;
    if (dx * dx + dz * dz < 12 && Math.abs(dy) < 4) {
      state.cp = i;
      syncCpBar();
      toast(c.name, false);
      SFX.cp();
      break;
    }
  }
  if (P.pos.y < CFG.fallY) {
    state.falls++; respawn(false); flash('hit'); toast('坠落', true); SFX.fall();
  }
  const fdx = P.pos.x - FINISH.pos.x, fdz = P.pos.z - FINISH.pos.z;
  if (fdx * fdx + fdz * fdz < FINISH.radius * FINISH.radius) finishRun();
}

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  sky.update(elapsed);

  acc += dt;
  let n = 0;
  while (acc >= FIXED && n < 12) { stepPhysics(FIXED); acc -= FIXED; n++; }
  if (n >= 12) acc = 0;

  const running = state.phase === 'run';
  if (running) checkTriggers();

  // ---- 相机
  const spd = Math.hypot(P.vel.x, P.vel.z);
  P.bob += dt * (P.onGround ? spd * 1.5 : 0);
  P.dip = Math.max(0, P.dip - dt * 1.6);
  const bobY = P.onGround ? Math.sin(P.bob) * Math.min(0.055, spd * 0.0068) : 0;
  const bobX = P.onGround ? Math.cos(P.bob * 0.5) * Math.min(0.032, spd * 0.004) : 0;
  camPos.set(P.pos.x, P.pos.y + CFG.eye - P.dip + bobY, P.pos.z);
  camera.position.copy(camPos);
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
  camera.rotation.z = running ? bobX * 0.5 : 0;

  const targetFov = 74 + (spd / CFG.run) * 9;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 5);
    camera.updateProjectionMatrix();
  }

  // ---- 落点指示
  if (ring) {
    const show = running && !P.onGround && P.vel.y < 1.0;
    ring.visible = show; ringDot.visible = show;
    if (show) {
      const gh = groundHeight(P.pos.x, P.pos.z, P.pos.y);
      if (gh > -Infinity && gh > CFG.fallY) {
        ring.position.set(P.pos.x, gh + 0.06, P.pos.z);
        ringDot.position.set(P.pos.x, gh + 0.055, P.pos.z);
      } else { ring.visible = false; ringDot.visible = false; }
    }
  }

  // ---- 随身光跟着玩家
  lights.torch.position.set(P.pos.x, P.pos.y + 3.0, P.pos.z);

  // ---- 雨
  rain.update(dt, camera.position);

  // ---- HUD
  if (running) {
    el.timer.textContent = fmt(state.t);
    el.spdfill.style.width = Math.min(100, spd / CFG.run * 100) + '%';
    el.spdtxt.textContent = spd.toFixed(1) + ' m/s';
    document.body.classList.toggle('airborne', !P.onGround);
  }
  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) el.toast.className = '';
  }

  composer.render();
}
tick();

// ------------------------------------------------------------------ 事件绑定
$('startBtn').addEventListener('click', startRun);
$('againBtn').addEventListener('click', startRun);
$('resumeBtn').addEventListener('click', () => {
  state.phase = 'run';
  el.pause.classList.add('off');
  if (!isMobile) renderer.domElement.requestPointerLock();
});
addEventListener('resize', () => {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
});
// 首次交互解锁音频
addEventListener('pointerdown', audio, { once: true });

// ------------------------------------------------------------------ 调试 / 自动化接口
window.__game = {
  P, state, CFG, keys, START, FINISH,
  get solids() { return SOLIDS; },
  get cps() { return CPS; },
  get yaw() { return yaw; },
  setYaw: v => { yaw = v; },
  setPitch: v => { pitch = v; },
  groundHeight,
  blocked,
  teleport(x, y, z) { P.pos.set(x, y, z); P.vel.set(0, 0, 0); P.onGround = false; },
  jump() { P.buf = CFG.jumpBuf; },
  advance(sec) {                       // 手动推进物理（自动化测试用）
    const n = Math.round(sec / FIXED);
    for (let i = 0; i < n; i++) { stepPhysics(FIXED); checkTriggers(); }
  },
  startRun, respawn,
  ready: () => CPS.length > 0 && SOLIDS.length > 0,
};
