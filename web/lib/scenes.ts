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

export const SCENES: Record<string, () => Scene> = { nebula, rings };
