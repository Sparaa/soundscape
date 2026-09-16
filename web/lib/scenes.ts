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

/** Radial analyzer (the reference look): a dark disc with a slowly rotating emblem, a ring of pale bars, and long
 * colored rays per log-spaced frequency bin — bass at the bottom in red, highs at the top in pale yellow, mirrored
 * left/right. Bright rays follow the spectrum with a fast attack and slow decay; dim "afterglow" beams hold the peaks
 * and recede into depth. The emblem is a placeholder trefoil until a logo texture (public/logo.png) is supplied. */
export function radial(bins = 64): Scene {
  const N = bins * 2;                              // mirrored
  const group = new THREE.Group();
  const R_RING = 1.0, RING_H = 0.18, R_RAY = 1.32;
  const dummy = new THREE.Object3D();
  // ring segments (pale, thin)
  const ringGeo = new THREE.BoxGeometry(0.026, 1, 0.03);
  ringGeo.translate(0, 0.5, 0);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  const ring = new THREE.InstancedMesh(ringGeo, ringMat, N);
  // rays (bright, colored by angle) + afterglow beams (dim, long, deeper)
  const rayGeo = new THREE.BoxGeometry(0.05, 1, 0.05);
  rayGeo.translate(0, 0.5, 0);
  const rayMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 });
  const rays = new THREE.InstancedMesh(rayGeo, rayMat, N);
  const glowGeo = new THREE.BoxGeometry(0.05, 1, 0.9);
  glowGeo.translate(0, 0.5, -0.45);
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
  const glow = new THREE.InstancedMesh(glowGeo, glowMat, N);
  for (const m of [ring, rays, glow]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(m); }
  // disc, starfield, emblem
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R_RING - 0.03, 96), new THREE.MeshBasicMaterial({ color: 0x140406 }));
  disc.position.z = -0.02;
  group.add(disc);
  const starGeo = new THREE.BufferGeometry();
  const sp = new Float32Array(600 * 3);
  for (let i = 0; i < 600; i++) { const r = Math.sqrt(Math.random()) * (R_RING - 0.08), a = Math.random() * Math.PI * 2; sp.set([r * Math.cos(a), r * Math.sin(a), 0.001], i * 3); }
  starGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.012, transparent: true, opacity: 0.6 }));
  group.add(stars);
  const emblem = new THREE.Group();
  const emblemMat = new THREE.LineBasicMaterial({ color: 0x7a1010, transparent: true, opacity: 0.9 });
  const circle: THREE.Vector3[] = [];
  for (let k = 0; k <= 72; k++) { const a = (k / 72) * Math.PI * 2; circle.push(new THREE.Vector3(0.42 * Math.cos(a), 0.42 * Math.sin(a), 0)); }
  emblem.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(circle), emblemMat));
  for (let i = 0; i < 3; i++) {                     // trefoil placeholder: three arcs meeting at the centre
    const a0 = (i / 3) * Math.PI * 2 + Math.PI / 2, pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 24; k++) { const t = k / 24, r = 0.42 * (1 - t), ang = a0 + t * 0.9; pts.push(new THREE.Vector3(r * Math.cos(ang), r * Math.sin(ang), 0.002)); }
    emblem.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), emblemMat));
  }
  emblem.position.z = 0.01;
  group.add(emblem);
  const loader = new THREE.TextureLoader();
  let logo: THREE.Mesh | null = null;
  loader.load("/logo.png", (tex) => {                // optional real logo: replaces the trefoil
    emblem.visible = false;
    logo = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85 }));
    logo.position.z = 0.01;
    group.add(logo);
  }, undefined, () => undefined);
  // smoothing state
  const level = new Float32Array(bins), peak = new Float32Array(bins), color = new THREE.Color();
  let t = 0;
  const angleOf = (i: number, side: number) => {    // i: 0 = bass … bins-1 = highs; bass at the bottom, highs at the top
    const frac = i / (bins - 1);
    return -Math.PI / 2 + side * frac * Math.PI;    // side +1 = right half, -1 = left half
  };
  return {
    name: "radial", object: group,
    update(f, dt) {
      t += dt;
      const spec = f.spectrum ?? new Array(bins).fill(f.bands.rms);
      for (let i = 0; i < bins; i++) {
        const v = Math.pow(spec[Math.min(spec.length - 1, Math.floor((i / bins) * spec.length))] ?? 0, 1.4);
        level[i] = v > level[i] ? level[i] + (v - level[i]) * 0.6 : level[i] + (v - level[i]) * 0.12;
        peak[i] = Math.max(level[i], peak[i] - dt * 0.35);
      }
      const hueBase = f.palette.name === "neutral" ? 0 : (f.palette.hue - 20 + 360) % 360;   // warm reference look unless the station says otherwise
      for (let k = 0; k < N; k++) {
        const i = k % bins, side = k < bins ? 1 : -1, a = angleOf(i, side);
        const cx = Math.cos(a), cy = Math.sin(a), rot = a - Math.PI / 2;
        const lv = level[i], pk = peak[i];
        // ring bar
        dummy.position.set(cx * R_RING, cy * R_RING, 0); dummy.rotation.set(0, 0, rot); dummy.scale.set(1, RING_H * (0.25 + lv * 1.2), 1);
        dummy.updateMatrix(); ring.setMatrixAt(k, dummy.matrix);
        // bright ray
        const len = 0.05 + lv * 2.6 * (1 + 0.15 * f.beat.hit);
        dummy.position.set(cx * R_RAY, cy * R_RAY, 0.02); dummy.scale.set(1 + lv * 0.6, len, 1); dummy.updateMatrix(); rays.setMatrixAt(k, dummy.matrix);
        // colour by angle: bottom (bass) red → sides orange → top pale yellow; palette hue shifts the whole gradient
        const up = (cy + 1) / 2;                                              // 0 bottom … 1 top
        color.setHSL(((hueBase + up * 55) % 360) / 360, 0.95 - up * 0.35, 0.42 + up * 0.35 + 0.1 * f.beat.hit);
        rays.setColorAt(k, color);
        // afterglow beam: holds the peak, darker, longer, recedes in depth
        dummy.position.set(cx * R_RAY, cy * R_RAY, -0.05); dummy.scale.set(1, 0.3 + pk * 4.5, 1); dummy.updateMatrix(); glow.setMatrixAt(k, dummy.matrix);
        color.setHSL(((hueBase + up * 55) % 360) / 360, 0.9, 0.12 + pk * 0.25);
        glow.setColorAt(k, color);
      }
      ring.instanceMatrix.needsUpdate = true; rays.instanceMatrix.needsUpdate = true; glow.instanceMatrix.needsUpdate = true;
      if (rays.instanceColor) rays.instanceColor.needsUpdate = true;
      if (glow.instanceColor) glow.instanceColor.needsUpdate = true;
      ringMat.opacity = 0.7 + 0.3 * f.beat.hit;
      emblem.rotation.z = -t * 0.25 - f.beat.hit * 0.05;
      if (logo) logo.rotation.z = -t * 0.25;
      const pulse = 1 + 0.04 * f.bands.bass + 0.03 * f.beat.hit;
      disc.scale.setScalar(pulse); stars.rotation.z = t * 0.02;
      (disc.material as THREE.MeshBasicMaterial).color.setHSL(((hueBase) % 360) / 360, 0.6, 0.05 + 0.05 * f.bands.bass);
    },
    dispose() { for (const g of [ringGeo, rayGeo, glowGeo, starGeo]) g.dispose(); for (const m of [ringMat, rayMat, glowMat, emblemMat]) m.dispose(); },
  };
}
SCENES.radial = radial;
