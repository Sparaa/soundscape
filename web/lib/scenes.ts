/** three.js scenes for the visualizer. Each scene gets a VisualFrame per tick. Shaders are raw GLSL (points +
 * additive blending) so the look survives a later native port. */
import * as THREE from "three";
import type { VisualFrame } from "./visual";

export interface Scene {
  name: string;
  object: THREE.Object3D;
  update(f: VisualFrame, dt: number): void;
  dispose(): void;
}

const hsl = (h: number, s: number, l: number) => new THREE.Color().setHSL(((h % 360) + 360) % 360 / 360, s, l);

/** Nebula: 24k particles on a wobbling shell. Bass swells the shell, treble sparkles, beats burst, sections re-tint. */
export function nebula(count = 24000): Scene {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3), rnd = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const u = Math.random(), v = Math.random(), th = 2 * Math.PI * u, ph = Math.acos(2 * v - 1), r = 1 + Math.random() * 0.6;
    pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph)], i * 3);
    rnd.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("rnd", new THREE.BufferAttribute(rnd, 4));
  const u = { uTime: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 }, uTreble: { value: 0 }, uHit: { value: 0 }, uPhase: { value: 0 },
    uColorA: { value: hsl(260, 0.6, 0.55) }, uColorB: { value: hsl(50, 0.8, 0.6) }, uSection: { value: 0 }, uPixel: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec4 rnd; uniform float uTime, uBass, uMid, uTreble, uHit, uPhase, uSection, uPixel; varying float vA; varying vec3 vC;
      uniform vec3 uColorA, uColorB;
      float n(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
      void main(){
        vec3 p = position;
        float breathe = 1.0 + 0.35 * uBass + 0.12 * sin(uTime * 0.7 + rnd.x * 6.2831);
        float swirl = uTime * (0.08 + 0.25 * uMid) + rnd.y * 6.2831 + uSection * 1.5;
        float c = cos(swirl * 0.3), s = sin(swirl * 0.3);
        p.xz = mat2(c, -s, s, c) * p.xz;
        p *= breathe + uHit * 0.25 * rnd.z;
        p += 0.08 * uTreble * vec3(sin(uTime * 3.0 + rnd.w * 40.0), cos(uTime * 2.3 + rnd.x * 40.0), sin(uTime * 1.7 + rnd.y * 40.0));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float sz = (1.2 + 2.5 * rnd.w * rnd.w) * (1.0 + 1.5 * uHit * step(0.7, rnd.z)) * uPixel;
        gl_PointSize = sz * (180.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
        float pulse = 0.5 + 0.5 * cos(6.2831 * uPhase);
        vA = 0.35 + 0.45 * rnd.x + 0.3 * uHit + 0.15 * pulse * step(0.5, rnd.y);
        vC = mix(uColorA, uColorB, smoothstep(0.2, 0.9, rnd.z + 0.4 * uTreble));
      }`,
    fragmentShader: `
      varying float vA; varying vec3 vC;
      void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d, d) * 4.0; float a = exp(-r * 3.0) * vA; gl_FragColor = vec4(vC * a, a); }`,
  });
  const points = new THREE.Points(geo, mat);
  let lastSection = -1, sectionMix = 0;
  return {
    name: "nebula", object: points,
    update(f, dt) {
      u.uTime.value += dt; u.uBass.value += (f.bands.bass - u.uBass.value) * 0.35; u.uMid.value += (f.bands.mid - u.uMid.value) * 0.2;
      u.uTreble.value += (f.bands.treble - u.uTreble.value) * 0.4; u.uHit.value = Math.max(f.beat.hit, u.uHit.value * 0.9); u.uPhase.value = f.beat.phase;
      if (f.section && f.section.index !== lastSection) { lastSection = f.section.index; sectionMix = (sectionMix + 1) % 4; }
      const chorus = f.section?.label.includes("chorus") ?? false;
      u.uSection.value += ((sectionMix + (chorus ? 0.5 : 0)) - u.uSection.value) * 0.02;
      const target = hsl(f.palette.hue + sectionMix * 20 + (chorus ? 25 : 0), f.palette.sat, f.palette.light + (chorus ? 0.1 : 0));
      const targetB = hsl(f.palette.accentHue + sectionMix * 20, 0.85, chorus ? 0.7 : 0.6);
      (u.uColorA.value as THREE.Color).lerp(target, 0.03); (u.uColorB.value as THREE.Color).lerp(targetB, 0.03);
      points.rotation.y += dt * (0.05 + 0.2 * f.bands.mid); points.rotation.x = 0.2 * Math.sin(u.uTime.value * 0.1);
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

/** Rings: 48 concentric line rings; each ring's radius follows one FFT-ish band slice, beats flash the inner rings. */
export function rings(n = 48): Scene {
  const group = new THREE.Group();
  const mats: THREE.LineBasicMaterial[] = [], meshes: THREE.LineLoop[] = [];
  for (let i = 0; i < n; i++) {
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 96; k++) { const a = (k / 96) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0)); }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const m = new THREE.LineBasicMaterial({ color: hsl(200, 0.7, 0.6), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending });
    const loop = new THREE.LineLoop(g, m);
    loop.position.z = -i * 0.35;
    group.add(loop); mats.push(m); meshes.push(loop);
  }
  let t = 0;
  return {
    name: "rings", object: group,
    update(f, dt) {
      t += dt;
      for (let i = 0; i < n; i++) {
        const band = i < n / 3 ? f.bands.bass : i < (2 * n) / 3 ? f.bands.mid : f.bands.treble;
        const s = 0.6 + 1.8 * band + (i < 6 ? 0.6 * f.beat.hit : 0) + 0.1 * Math.sin(t * 2 + i * 0.4);
        meshes[i].scale.setScalar(s);
        meshes[i].rotation.z = t * 0.1 * (i % 2 ? 1 : -1) + f.beat.phase * 0.2;
        mats[i].color.copy(hsl(f.palette.hue + i * 3 + (f.section?.label.includes("chorus") ? 30 : 0), f.palette.sat, 0.4 + 0.4 * band));
        mats[i].opacity = 0.25 + 0.6 * band + 0.3 * f.beat.hit * (i < 6 ? 1 : 0);
      }
      group.position.z = 2 + 1.5 * f.bands.bass;
    },
    dispose() { for (const m of meshes) { m.geometry.dispose(); } for (const m of mats) m.dispose(); },
  };
}

export const SCENES: Record<string, () => Scene> = { nebula, rings };   // radial is added below and is the default

/** Radial analyzer, mid-century modern. Everything is FLAT geometry on separate z layers with depth testing off
 * (boxes on a shared plane z-fought and neighbouring bars overlapped into a smeared ring): shadow bars → bright bars →
 * ring ticks → disc → grooves → wheel. 36 bins per side keep a visible gap between chunky bars. The centre is a large
 * spinning wheel (ring + three curved spokes) built from real geometry so it has thickness; web/public/logo.png
 * replaces it when present. Bass at the bottom, highs at the top, mirrored. */
export function radial(bins = 36): Scene {
  const N = bins * 2;
  const group = new THREE.Group();
  const R_RING = 1.0, R_RAY = 1.2;
  const dummy = new THREE.Object3D(), color = new THREE.Color();
  const PALETTE = [0xc8452b, 0xe07a1f, 0xe9b83a, 0xf0dfb5, 0x3f8f8a, 0x6b7f3a];
  const spacing = (2 * Math.PI * R_RAY) / N;                       // arc length per bar at the ray radius
  const bar = (w: number) => { const g = new THREE.PlaneGeometry(w, 1); g.translate(0, 0.5, 0); return g; };
  const flatMat = () => new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false });
  const rayGeo = bar(spacing * 0.72), shadowGeo = bar(spacing * 0.72), tickGeo = bar(((2 * Math.PI * R_RING) / N) * 0.6);
  const shadow = new THREE.InstancedMesh(shadowGeo, flatMat(), N), rays = new THREE.InstancedMesh(rayGeo, flatMat(), N), ticks = new THREE.InstancedMesh(tickGeo, flatMat(), N);
  [shadow, rays, ticks].forEach((m, i) => { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.renderOrder = i; m.frustumCulled = false; group.add(m); });
  const discMat = new THREE.MeshBasicMaterial({ color: 0x1b2430, depthTest: false, depthWrite: false });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R_RING - 0.05, 128), discMat); disc.renderOrder = 3; group.add(disc);
  const grooveMat = new THREE.MeshBasicMaterial({ color: 0x263242, depthTest: false, depthWrite: false });
  const grooves: THREE.Mesh[] = [];
  for (let g = 0; g < 4; g++) { const r = 0.72 + g * 0.055; const m = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.006, 128), grooveMat); m.renderOrder = 4; group.add(m); grooves.push(m); }
  // the wheel: a thick ring and three curved spokes as ribbons
  const wheel = new THREE.Group();
  const wheelMat = new THREE.MeshBasicMaterial({ color: 0xf0dfb5, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  const R_WHEEL = 0.62, T = 0.045;
  const rim = new THREE.Mesh(new THREE.RingGeometry(R_WHEEL - T, R_WHEEL, 128), wheelMat); rim.renderOrder = 5; wheel.add(rim);
  const hub = new THREE.Mesh(new THREE.CircleGeometry(T * 1.4, 32), wheelMat); hub.renderOrder = 5; wheel.add(hub);
  const ribbon = (pts: THREE.Vector2[], width: number) => {        // a strip of quads along a polyline
    const pos: number[] = [], idx: number[] = [];
    for (let k = 0; k < pts.length; k++) {
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
      const nx = -(b.y - a.y), ny = b.x - a.x, len = Math.hypot(nx, ny) || 1;
      pos.push(pts[k].x + (nx / len) * width / 2, pts[k].y + (ny / len) * width / 2, 0, pts[k].x - (nx / len) * width / 2, pts[k].y - (ny / len) * width / 2, 0);
      if (k < pts.length - 1) idx.push(2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 1, 2 * k + 3, 2 * k + 2);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g;
  };
  const spokeGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const a0 = (i / 3) * Math.PI * 2 + Math.PI / 2, pts: THREE.Vector2[] = [];
    for (let k = 0; k <= 32; k++) { const t = k / 32, r = (R_WHEEL - T / 2) * (1 - t), ang = a0 + t * 1.0; pts.push(new THREE.Vector2(r * Math.cos(ang), r * Math.sin(ang))); }
    const g = ribbon(pts, T * 0.9); spokeGeos.push(g);
    const m = new THREE.Mesh(g, wheelMat); m.renderOrder = 5; wheel.add(m);
  }
  group.add(wheel);
  let logo: THREE.Mesh | null = null;
  new THREE.TextureLoader().load("/logo.png", (tex) => {
    wheel.visible = false;
    logo = new THREE.Mesh(new THREE.PlaneGeometry(R_WHEEL * 2, R_WHEEL * 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    logo.renderOrder = 5; group.add(logo);
  }, undefined, () => undefined);
  const level = new Float32Array(bins), peak = new Float32Array(bins);
  let t = 0;
  const angleOf = (i: number, side: number) => -Math.PI / 2 + side * ((i + 0.5) / bins) * Math.PI;   // +0.5: no bar exactly on the mirror seam
  return {
    name: "radial", object: group,
    update(f, dt) {
      t += dt;
      const spec = f.spectrum ?? new Array(bins).fill(f.bands.rms);
      for (let i = 0; i < bins; i++) {
        const v = Math.pow(spec[Math.min(spec.length - 1, Math.floor((i / bins) * spec.length))] ?? 0, 1.15);
        level[i] = v > level[i] ? level[i] + (v - level[i]) * 0.55 : level[i] + (v - level[i]) * 0.1;
        peak[i] = Math.max(level[i], peak[i] - dt * 0.3);
      }
      for (let k = 0; k < N; k++) {
        const i = k % bins, side = k < bins ? 1 : -1, a = angleOf(i, side);
        const cx = Math.cos(a), cy = Math.sin(a), rot = a - Math.PI / 2, lv = level[i], pk = peak[i];
        color.setHex(PALETTE[Math.min(PALETTE.length - 1, Math.floor((i / bins) * PALETTE.length))]);
        dummy.rotation.set(0, 0, rot);
        dummy.position.set(cx * R_RAY, cy * R_RAY, 0); dummy.scale.set(1, 0.06 + pk * 2.8, 1); dummy.updateMatrix(); shadow.setMatrixAt(k, dummy.matrix);
        shadow.setColorAt(k, color.clone().multiplyScalar(0.33));
        dummy.scale.set(1, 0.05 + lv * 2.6 * (1 + 0.12 * f.beat.hit), 1); dummy.updateMatrix(); rays.setMatrixAt(k, dummy.matrix);
        rays.setColorAt(k, color);
        dummy.position.set(cx * (R_RING + 0.02), cy * (R_RING + 0.02), 0); dummy.scale.set(1, 0.07 + lv * 0.08, 1); dummy.updateMatrix(); ticks.setMatrixAt(k, dummy.matrix);
        ticks.setColorAt(k, color.clone().offsetHSL(0, -0.25, 0.22));
      }
      for (const m of [shadow, rays, ticks]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
      grooves.forEach((g, i) => g.scale.setScalar(1 + 0.03 * f.bands.bass * (1 - i / 4)));
      wheel.rotation.z = -t * 0.35 - f.beat.hit * 0.04; wheel.scale.setScalar(1 + 0.03 * f.beat.hit);
      if (logo) { logo.rotation.z = -t * 0.35; logo.scale.setScalar(1 + 0.03 * f.beat.hit); }
    },
    dispose() { for (const g of [rayGeo, shadowGeo, tickGeo, ...spokeGeos]) g.dispose(); for (const m of [shadow.material, rays.material, ticks.material, discMat, grooveMat, wheelMat]) (m as THREE.Material).dispose(); },
  };
}
SCENES.radial = radial;


/** Pulse: the radial analyzer in GPU Pulse's red-phosphor CRT language. One hue. Each ray is a column of SEGMENTS like
 * a ▰▰▰▱▱ meter — lit segments bright red, unlit ones a dim ember, a hot segment riding the held peak — with an additive
 * glow pass behind the lit segments. Dark disc with range rings and a crosshair, the wheel in red. Scanlines, vignette
 * and the telemetry HUD are drawn by the Visualizer over the canvas. */
export function pulse(bins = 36, segments = 14): Scene {
  const N = bins * 2, TOTAL = N * segments;
  const group = new THREE.Group();
  const R_RING = 1.0, R_RAY = 1.18, SEG_LEN = 0.115, SEG_GAP = 0.03;
  const dummy = new THREE.Object3D(), color = new THREE.Color();
  const HOT = new THREE.Color(0xff2a3c), LIT = new THREE.Color(0xe01428), DIM = new THREE.Color(0x3a0a10), PEAK = new THREE.Color(0xffb0b8);
  const spacing = (2 * Math.PI * R_RAY) / N;
  const segGeo = new THREE.PlaneGeometry(spacing * 0.7, SEG_LEN); segGeo.translate(0, SEG_LEN / 2, 0);
  const glowGeo = new THREE.PlaneGeometry(spacing * 1.5, SEG_LEN * 1.9); glowGeo.translate(0, SEG_LEN / 2, 0);
  const flat = (extra: THREE.MeshBasicMaterialParameters = {}) => new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false, ...extra });
  const glow = new THREE.InstancedMesh(glowGeo, flat({ transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending }), TOTAL);
  const segs = new THREE.InstancedMesh(segGeo, flat(), TOTAL);
  [glow, segs].forEach((m, i) => { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.renderOrder = i; m.frustumCulled = false; group.add(m); });
  // static transforms: segment (k, j) sits at radius R_RAY + j * (SEG_LEN + SEG_GAP) along bar k's direction
  const angleOf = (i: number, side: number) => -Math.PI / 2 + side * ((i + 0.5) / bins) * Math.PI;
  for (let k = 0; k < N; k++) {
    const i = k % bins, side = k < bins ? 1 : -1, a = angleOf(i, side), cx = Math.cos(a), cy = Math.sin(a);
    for (let j = 0; j < segments; j++) {
      const r = R_RAY + j * (SEG_LEN + SEG_GAP);
      dummy.position.set(cx * r, cy * r, 0); dummy.rotation.set(0, 0, a - Math.PI / 2); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      segs.setMatrixAt(k * segments + j, dummy.matrix); glow.setMatrixAt(k * segments + j, dummy.matrix);
    }
  }
  // ring ticks, disc, range rings, crosshair, wheel
  const tickGeo = new THREE.PlaneGeometry(((2 * Math.PI * R_RING) / N) * 0.55, 0.06); tickGeo.translate(0, 0.03, 0);
  const ticks = new THREE.InstancedMesh(tickGeo, flat(), N); ticks.renderOrder = 2; ticks.frustumCulled = false; group.add(ticks);
  for (let k = 0; k < N; k++) { const a = angleOf(k % bins, k < bins ? 1 : -1); dummy.position.set(Math.cos(a) * (R_RING + 0.02), Math.sin(a) * (R_RING + 0.02), 0); dummy.rotation.set(0, 0, a - Math.PI / 2); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); ticks.setMatrixAt(k, dummy.matrix); }
  const discMat = flat({ color: 0x0d0203 });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R_RING - 0.05, 128), discMat); disc.renderOrder = 3; group.add(disc);
  const lineMat = flat({ color: 0x5a0d14 });
  const statics: THREE.BufferGeometry[] = [];
  for (let g = 0; g < 5; g++) { const r = 0.2 + g * 0.17, geo = new THREE.RingGeometry(r, r + 0.005, 128); statics.push(geo); const m = new THREE.Mesh(geo, lineMat); m.renderOrder = 4; group.add(m); }
  for (const rot of [0, Math.PI / 2]) { const geo = new THREE.PlaneGeometry((R_RING - 0.05) * 2, 0.004); statics.push(geo); const m = new THREE.Mesh(geo, lineMat); m.rotation.z = rot; m.renderOrder = 4; group.add(m); }
  const wheel = new THREE.Group();
  const wheelMat = flat({ color: 0xe01428, side: THREE.DoubleSide });
  const wheelGlow = flat({ color: 0xff2a3c, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const R_WHEEL = 0.62, T = 0.04;
  const ribbon = (pts: THREE.Vector2[], width: number) => {
    const pos: number[] = [], idx: number[] = [];
    for (let k = 0; k < pts.length; k++) {
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)], nx = -(b.y - a.y), ny = b.x - a.x, len = Math.hypot(nx, ny) || 1;
      pos.push(pts[k].x + (nx / len) * width / 2, pts[k].y + (ny / len) * width / 2, 0, pts[k].x - (nx / len) * width / 2, pts[k].y - (ny / len) * width / 2, 0);
      if (k < pts.length - 1) idx.push(2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 1, 2 * k + 3, 2 * k + 2);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g;
  };
  for (const [mat, grow, order] of [[wheelGlow, 2.4, 5], [wheelMat, 1, 6]] as [THREE.Material, number, number][]) {
    const rimGeo = new THREE.RingGeometry(R_WHEEL - T * grow, R_WHEEL + T * (grow - 1), 128); statics.push(rimGeo);
    const rim = new THREE.Mesh(rimGeo, mat); rim.renderOrder = order; wheel.add(rim);
    for (let i = 0; i < 3; i++) {
      const a0 = (i / 3) * Math.PI * 2 + Math.PI / 2, pts: THREE.Vector2[] = [];
      for (let k = 0; k <= 32; k++) { const t = k / 32, r = (R_WHEEL - T / 2) * (1 - t), ang = a0 + t * 1.0; pts.push(new THREE.Vector2(r * Math.cos(ang), r * Math.sin(ang))); }
      const g = ribbon(pts, T * 0.9 * grow); statics.push(g); const m = new THREE.Mesh(g, mat); m.renderOrder = order; wheel.add(m);
    }
  }
  group.add(wheel);
  const level = new Float32Array(bins), peak = new Float32Array(bins);
  let t = 0;
  return {
    name: "pulse", object: group,
    update(f, dt) {
      t += dt;
      const spec = f.spectrum ?? new Array(bins).fill(f.bands.rms);
      for (let i = 0; i < bins; i++) {
        const v = Math.pow(spec[Math.min(spec.length - 1, Math.floor((i / bins) * spec.length))] ?? 0, 1.1);
        level[i] = v > level[i] ? level[i] + (v - level[i]) * 0.6 : level[i] + (v - level[i]) * 0.12;
        peak[i] = Math.max(level[i], peak[i] - dt * 0.28);
      }
      const flicker = 0.94 + 0.06 * Math.sin(t * 47.0) * Math.sin(t * 13.0);          // faint CRT instability
      for (let k = 0; k < N; k++) {
        const i = k % bins, lit = Math.round(level[i] * segments * (1 + 0.1 * f.beat.hit)), pk = Math.min(segments - 1, Math.round(peak[i] * segments));
        for (let j = 0; j < segments; j++) {
          const idx = k * segments + j, on = j < lit;
          if (j === pk && pk >= lit && pk > 0) color.copy(PEAK).multiplyScalar(0.8 * flicker);
          else if (on) color.copy(j >= lit - 1 ? HOT : LIT).multiplyScalar(flicker * (0.75 + 0.25 * (j / segments)));
          else color.copy(DIM);
          segs.setColorAt(idx, color);
          glow.setColorAt(idx, on ? color : color.setRGB(0, 0, 0));
        }
        ticks.setColorAt(k, color.copy(level[i] > 0.05 ? LIT : DIM).multiplyScalar(0.6 + 0.4 * f.beat.hit));
      }
      for (const m of [segs, glow, ticks]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
      wheel.rotation.z = -t * 0.35 - f.beat.hit * 0.04; wheel.scale.setScalar(1 + 0.03 * f.beat.hit);
      wheelGlow.opacity = 0.12 + 0.25 * f.bands.bass + 0.2 * f.beat.hit;
      discMat.color.setRGB(0.05 + 0.05 * f.bands.bass, 0.008, 0.012);
    },
    dispose() { for (const g of [segGeo, glowGeo, tickGeo, ...statics]) g.dispose(); for (const m of [segs.material, glow.material, ticks.material, discMat, lineMat, wheelMat, wheelGlow]) (m as THREE.Material).dispose(); },
  };
}
SCENES.pulse = pulse;
