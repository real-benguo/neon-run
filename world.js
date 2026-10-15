// world.js —— 雨夜赛博都市的视觉：程序化纹理 / 夜空 / 雨 / 灯光 / 环境反射
import * as THREE from 'three';

// ------------------------------------------------------------------ 纹理
function cv(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { c, x: c.getContext('2d') };
}

function finish(c, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function noise(x, size, amount, alpha, cell) {
  const img = x.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    if (alpha !== undefined) d[i + 3] = alpha;
  }
  x.putImageData(img, 0, 0);
  if (cell) { /* 保持接口一致 */ }
}

export function makeTextures() {
  const T = {};

  // ---- 混凝土（楼顶面）
  {
    const { c, x } = cv(256);
    x.fillStyle = '#e6eaf1';
    x.fillRect(0, 0, 256, 256);
    noise(x, 256, 34);
    // 大块斑驳
    for (let i = 0; i < 26; i++) {
      const r = 10 + Math.random() * 46;
      x.beginPath();
      x.arc(Math.random() * 256, Math.random() * 256, r, 0, 7);
      x.fillStyle = `rgba(${140 + Math.random() * 60 | 0},${150 + Math.random() * 60 | 0},${168 + Math.random() * 60 | 0},.2)`;
      x.fill();
    }
    // 细裂纹
    x.strokeStyle = 'rgba(20,24,34,.5)';
    for (let i = 0; i < 12; i++) {
      x.lineWidth = Math.random() * 1.4 + 0.3;
      x.beginPath();
      let px = Math.random() * 256, py = Math.random() * 256;
      x.moveTo(px, py);
      for (let k = 0; k < 6; k++) {
        px += (Math.random() - 0.5) * 60;
        py += (Math.random() - 0.5) * 60;
        x.lineTo(px, py);
      }
      x.stroke();
    }
    T.concrete = finish(c, 0.25);        // 4m 一次
  }

  // ---- 金属（拉丝）
  {
    const { c, x } = cv(256);
    x.fillStyle = '#eef1f6';
    x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
      const y = Math.random() * 256;
      x.strokeStyle = `rgba(${190 + Math.random() * 65 | 0},${196 + Math.random() * 59 | 0},${210 + Math.random() * 45 | 0},.16)`;
      x.lineWidth = Math.random() * 1.3;
      x.beginPath();
      x.moveTo(0, y);
      x.lineTo(256, y + (Math.random() - 0.5) * 4);
      x.stroke();
    }
    noise(x, 256, 18);
    // 铆钉 / 拼缝
    x.strokeStyle = 'rgba(28,32,42,.55)';
    x.lineWidth = 2;
    x.strokeRect(2, 2, 252, 252);
    T.metal = finish(c, 0.4);
  }

  // ---- 沥青 / 防水层
  {
    const { c, x } = cv(256);
    x.fillStyle = '#dde2ea';
    x.fillRect(0, 0, 256, 256);
    noise(x, 256, 30);
    for (let i = 0; i < 1400; i++) {
      x.fillStyle = `rgba(${170 + Math.random() * 70 | 0},${176 + Math.random() * 70 | 0},${190 + Math.random() * 65 | 0},${Math.random() * .26})`;
      x.fillRect(Math.random() * 256, Math.random() * 256, 1.6, 1.6);
    }
    T.asphalt = finish(c, 0.3);
  }

  // ---- 警示斜纹
  {
    const { c, x } = cv(128);
    x.fillStyle = '#e8b93a';
    x.fillRect(0, 0, 128, 128);
    x.fillStyle = '#16181f';
    x.save();
    x.translate(64, 64);
    x.rotate(-Math.PI / 4);
    for (let i = -6; i < 6; i += 2) x.fillRect(i * 22, -128, 11, 256);
    x.restore();
    noise(x, 128, 22);
    T.hazard = finish(c, 1.6);
  }

  // ---- 格栅 / 网板
  {
    const { c, x } = cv(128);
    x.fillStyle = '#e2e6ee';
    x.fillRect(0, 0, 128, 128);
    x.strokeStyle = '#9aa3b4';
    x.lineWidth = 5;
    for (let i = 0; i <= 128; i += 16) {
      x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 128); x.stroke();
      x.beginPath(); x.moveTo(0, i); x.lineTo(128, i); x.stroke();
    }
    T.grid = finish(c, 0.5);
  }

  return T;
}

// ------------------------------------------------------------------ 夜空
export function makeSky(scene) {
  const uni = {
    cTop: { value: new THREE.Color(0x02040a) },
    cMid: { value: new THREE.Color(0x141c38) },
    cHaze: { value: new THREE.Color(0x5a2a46) },
    cLow: { value: new THREE.Color(0x2a1830) },
    uTime: { value: 0 }
  };
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: uni,
    vertexShader: `
      varying vec3 vDir;
      void main(){
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 cTop, cMid, cHaze, cLow;
      uniform float uTime;
      varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 c = mix(cLow, cMid, smoothstep(-0.25, 0.22, h));
        c = mix(c, cTop, smoothstep(0.12, 0.78, h));
        // 地平线光污染
        float glow = pow(max(0.0, 1.0 - abs(h) * 2.6), 3.0);
        c += cHaze * glow * 0.55;
        // 星星
        if (h > 0.06) {
          vec2 uv = d.xz / max(h, 0.001) * 6.0;
          float s = hash(floor(uv * 26.0));
          float tw = 0.5 + 0.5 * sin(uTime * 2.2 + s * 40.0);
          c += vec3(0.75, 0.85, 1.0) * smoothstep(0.9975, 1.0, s) * tw * h;
        }
        gl_FragColor = vec4(c, 1.0);
      }`
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 20), mat);
  sky.frustumCulled = false;
  scene.add(sky);
  return { mesh: sky, update: (t) => { uni.uTime.value = t; } };
}

// ------------------------------------------------------------------ 雨
export function makeRain() {
  const N = 2200;
  const W = 90, H = 70, D = 90;
  const pos = new Float32Array(N * 6);
  const vy = new Float32Array(N);
  const len = new Float32Array(N);
  const x0 = new Float32Array(N), y0 = new Float32Array(N), z0 = new Float32Array(N);

  for (let i = 0; i < N; i++) {
    x0[i] = (Math.random() - 0.5) * W;
    y0[i] = Math.random() * H;
    z0[i] = (Math.random() - 0.5) * D;
    vy[i] = 26 + Math.random() * 22;
    len[i] = 0.7 + Math.random() * 1.5;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0xa8d8ff, transparent: true, opacity: 0.34,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false
  });
  const mesh = new THREE.LineSegments(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;

  function update(dt, cam) {
    // 雨幕跟随相机（网格对齐，避免“雨粘在脸上”）
    const gx = Math.round(cam.x / 10) * 10;
    const gz = Math.round(cam.z / 10) * 10;
    mesh.position.set(gx, -H * 0.35, gz);
    const tilt = 0.16;   // 雨的斜度
    for (let i = 0; i < N; i++) {
      y0[i] -= vy[i] * dt;
      if (y0[i] < 0) y0[i] += H;
      const o = i * 6;
      const y = y0[i];
      pos[o] = x0[i]; pos[o + 1] = y; pos[o + 2] = z0[i];
      pos[o + 3] = x0[i] + tilt * len[i];
      pos[o + 4] = y - len[i];
      pos[o + 5] = z0[i] + tilt * 0.4 * len[i];
    }
    geo.attributes.position.needsUpdate = true;
  }
  return { mesh, update };
}

// ------------------------------------------------------------------ 灯光
export function makeLights(scene) {
  scene.add(new THREE.HemisphereLight(0x44557e, 0x10141f, 0.55));

  const moon = new THREE.DirectionalLight(0x9fc4ff, 0.62);
  moon.position.set(-60, 120, 40);
  scene.add(moon);

  const fill = new THREE.DirectionalLight(0xff5aa0, 0.12);
  fill.position.set(70, 40, -120);
  scene.add(fill);

  const amb = new THREE.AmbientLight(0x1f2a40, 0.7);
  scene.add(amb);

  // 随身光：夜景跑酷必须看得清脚下的路
  const torch = new THREE.PointLight(0xb6ccf0, 17, 34, 1.9);
  scene.add(torch);
  return { torch };
}

// ------------------------------------------------------------------ 环境反射
export function makeEnvMap(renderer) {
  const w = 512, h = 256;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');

  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0.00, '#03050c');
  g.addColorStop(0.36, '#101a36');
  g.addColorStop(0.50, '#3d2145');
  g.addColorStop(0.56, '#7a3455');
  g.addColorStop(0.70, '#241528');
  g.addColorStop(1.00, '#0a0c14');
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);

  // 城市霓虹光斑
  const cols = ['#ff2e7e', '#22e6ff', '#9b5cff', '#ffa32e', '#3dff9e'];
  for (let i = 0; i < 46; i++) {
    const px = Math.random() * w;
    const py = h * 0.46 + Math.random() * h * 0.28;
    const r = 6 + Math.random() * 34;
    const rg = x.createRadialGradient(px, py, 0, px, py, r);
    const col = cols[i % cols.length];
    rg.addColorStop(0, col + 'cc');
    rg.addColorStop(1, col + '00');
    x.fillStyle = rg;
    x.fillRect(px - r, py - r, r * 2, r * 2);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const rt = pmrem.fromEquirectangular(tex);
  tex.dispose();
  pmrem.dispose();
  return rt.texture;
}
