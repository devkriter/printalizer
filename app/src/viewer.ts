// The 3D view: bed, part, found targets, applied edits, previews and picking. Plain three.js.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import type { PartMesh, ResultMesh } from './protocol.ts';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

declare module 'three' {
  interface BufferGeometry {
    computeBoundsTree: typeof computeBoundsTree;
    disposeBoundsTree: typeof disposeBoundsTree;
  }
}

export type Vec3 = [number, number, number];

/** What the pointer is over. */
export type Item = { kind: 'edit'; id: number } | { kind: 'target'; key: string } | { kind: 'part' };

/** How things should look. Set as a whole; the viewer works out what changed. */
export interface Look {
  mode: 'lay' | 'edit';
  /** Target keys ("feature:index") that are clickable now, and those picked before applying. */
  active: Set<string>;
  picked: Set<string>;
  selected: Set<number>;
  hover: Item | null;
  overhang: Uint8Array | null;
  eraser: boolean;
}

const C = {
  part: new THREE.Color(0x8894a1),
  overhang: new THREE.Color(0xb48cff),
  found: new THREE.Color(0xdbe6f2),
  ap: new THREE.Color(0x4d8dff),
  apHi: new THREE.Color(0x80aeff),
  apSel: new THREE.Color(0xb6d0ff),
  lay: new THREE.Color(0x8db4ff),
};
const tmp = new THREE.Color();

export class Viewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.1, 20000);
  private controls: OrbitControls;
  private bed = new THREE.Group();
  private bedSize = { w: 180, d: 180 };
  private host: HTMLElement;
  private mesh: THREE.Mesh | null = null;
  private original: THREE.Mesh | null = null;
  private preview = new THREE.Group();
  private material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.75, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  private result: ResultMesh | null = null;
  private normals = new Float32Array(0);
  private planeD = new Float32Array(0);
  /** Per part triangle: index into targetKeys, or -1. */
  private baseTarget = new Int32Array(0);
  private targetKeys: string[] = [];
  private look: Look = { mode: 'lay', active: new Set(), picked: new Set(), selected: new Set(), hover: null, overhang: null, eraser: false };
  private layRegion: number[] = [];
  private layKey = -1;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private downAt: { x: number; y: number } | null = null;
  private frame = 0;
  private anim: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t0: number } | null = null;
  onPickFace: ((normal: Vec3) => void) | null = null;
  onHover: ((item: Item | null, x: number, y: number) => void) | null = null;
  onClick: ((item: Item | null, e: { shift: boolean; alt: boolean }) => void) | null = null;
  onLayHover: ((over: boolean) => void) | null = null;

  constructor(host: HTMLElement) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    host.appendChild(this.renderer.domElement);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.addEventListener('change', () => this.render());
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x2a3038, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(-1, 1.5, 1);
    key.target.position.set(0, 0, -4);
    this.camera.add(key, key.target);
    this.scene.add(this.camera, this.bed, this.preview);
    this.raycaster.firstHitOnly = true;
    this.setBed(180, 180);
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    const el = this.renderer.domElement;
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerdown', (e) => { if (e.button === 0) this.downAt = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointerleave', () => { this.setLayRegion([], -1); this.onHover?.(null, 0, 0); });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.fit();
  }

  private resize() {
    const r = this.host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.renderer.setSize(r.width, r.height);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  render() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      let again = this.controls.update();
      if (this.anim) {
        const k = Math.min(1, (performance.now() - this.anim.t0) / 450);
        const e = k * k * (3 - 2 * k);
        this.camera.position.lerpVectors(this.anim.from, this.anim.to, e);
        this.controls.target.lerpVectors(this.anim.tFrom, this.anim.tTo, e);
        if (k >= 1) this.anim = null; else again = true;
      }
      this.renderer.render(this.scene, this.camera);
      if (again) this.render();
    });
  }

  /** Draw now, without waiting for a frame (for screenshots while the page is hidden). */
  renderNow() { this.controls.update(); this.renderer.render(this.scene, this.camera); }

  setBed(w: number, d: number) {
    this.bedSize = { w, d };
    this.bed.clear();
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: 0x23282f, roughness: 0.95, transparent: true, opacity: 0.92 }));
    plate.position.set(w / 2, d / 2, -0.05);
    this.bed.add(plate);
    const lines: number[] = [];
    for (let x = 0; x <= w + 1e-6; x += 10) lines.push(x, 0, 0, x, d, 0);
    for (let y = 0; y <= d + 1e-6; y += 10) lines.push(0, y, 0, w, y, 0);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    this.bed.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x343b44 })));
    const edge = new THREE.BufferGeometry();
    edge.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, w, 0, 0, w, 0, 0, w, d, 0, w, d, 0, 0, d, 0, 0, d, 0, 0, 0, 0], 3));
    this.bed.add(new THREE.LineSegments(edge, new THREE.LineBasicMaterial({ color: 0x55606c })));
    this.render();
  }

  private flatGeometry(vert: Float32Array, tri: Uint32Array, withColor: boolean) {
    const nt = tri.length / 3;
    const pos = new Float32Array(nt * 9);
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
      const v = tri[t * 3 + k] * 3;
      pos[t * 9 + k * 3] = vert[v]; pos[t * 9 + k * 3 + 1] = vert[v + 1]; pos[t * 9 + k * 3 + 2] = vert[v + 2];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (withColor) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nt * 9), 3));
    g.computeVertexNormals();
    return g;
  }

  private dispose(m: THREE.Mesh | null) {
    if (!m) return;
    m.parent?.remove(m);
    m.geometry.disposeBoundsTree?.();
    m.geometry.dispose();
  }

  clear() {
    this.dispose(this.mesh); this.mesh = null;
    this.dispose(this.original); this.original = null;
    this.result = null;
    this.clearPreview();
    this.render();
  }

  /** The part as opened or placed, before edits. Kept for comparing (hold Space). */
  setOriginal(m: PartMesh) {
    this.dispose(this.original);
    this.original = new THREE.Mesh(this.flatGeometry(m.vert, m.tri, false), new THREE.MeshStandardMaterial({ color: 0x8894a1, flatShading: true, roughness: 0.75, side: THREE.DoubleSide }));
    this.original.visible = false;
    this.scene.add(this.original);
  }

  /** Which part triangles belong to which found target. Call after each find. */
  setTargets(targets: Array<{ key: string; tris: number[] }>, partTriangles: number) {
    this.targetKeys = targets.map((t) => t.key);
    this.baseTarget = new Int32Array(partTriangles).fill(-1);
    targets.forEach((t, i) => { for (const x of t.tris) if (x < partTriangles) this.baseTarget[x] = i; });
    this.paintAll();
  }

  /** The part with edits applied. */
  setResult(r: ResultMesh, refit = false) {
    this.dispose(this.mesh);
    this.result = r;
    const nt = r.tri.length / 3;
    const g = this.flatGeometry(r.vert, r.tri, true);
    const pos = (g.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    this.normals = new Float32Array(nt * 3);
    this.planeD = new Float32Array(nt);
    for (let t = 0; t < nt; t++) {
      const o = t * 9;
      const ux = pos[o + 3] - pos[o], uy = pos[o + 4] - pos[o + 1], uz = pos[o + 5] - pos[o + 2];
      const vx = pos[o + 6] - pos[o], vy = pos[o + 7] - pos[o + 1], vz = pos[o + 8] - pos[o + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      this.normals[t * 3] = nx; this.normals[t * 3 + 1] = ny; this.normals[t * 3 + 2] = nz;
      this.planeD[t] = nx * pos[o] + ny * pos[o + 1] + nz * pos[o + 2];
    }
    g.computeBoundsTree();
    this.mesh = new THREE.Mesh(g, this.material);
    this.scene.add(this.mesh);
    this.layRegion = [];
    this.layKey = -1;
    this.paintAll();
    if (refit) this.fit();
    this.render();
  }

  setLook(look: Look) {
    this.look = look;
    if (look.mode !== 'lay') this.setLayRegion([], -1);
    this.paintAll();
  }

  setXray(on: boolean) {
    this.material.transparent = on;
    this.material.opacity = on ? 0.35 : 1;
    this.material.depthWrite = !on;
    this.material.needsUpdate = true;
    this.render();
  }

  /** Hold to see the part before any edits. */
  setCompare(on: boolean) {
    if (!this.original || !this.mesh) return;
    this.original.visible = on;
    this.mesh.visible = !on;
    this.render();
  }

  setPreview(add: PartMesh | null, sub: PartMesh | null) {
    this.clearPreview();
    const mk = (m: PartMesh, color: number, opacity: number) => {
      const mesh = new THREE.Mesh(this.flatGeometry(m.vert, m.tri, false), new THREE.MeshStandardMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, flatShading: true }));
      mesh.renderOrder = 2;
      this.preview.add(mesh);
    };
    if (add) mk(add, 0x4d8dff, 0.5);
    if (sub) mk(sub, 0xdbe6f2, 0.42);
    this.render();
  }

  clearPreview() {
    for (const c of [...this.preview.children]) this.dispose(c as THREE.Mesh);
    this.render();
  }

  fit() {
    const box = new THREE.Box3();
    box.expandByPoint(new THREE.Vector3(0, 0, 0)).expandByPoint(new THREE.Vector3(this.bedSize.w, this.bedSize.d, 0));
    const partBox = this.mesh ? new THREE.Box3().setFromObject(this.mesh) : null;
    const partSize = partBox ? partBox.getSize(new THREE.Vector3()).length() : Infinity;
    const useBox = partBox && partSize < Math.max(this.bedSize.w, this.bedSize.d) * 0.6 ? partBox : (partBox ? box.union(partBox) : box);
    const center = useBox.getCenter(new THREE.Vector3());
    const size = useBox.getSize(new THREE.Vector3()).length() || 100;
    const dist = (size / 2) / Math.sin((this.camera.fov * Math.PI) / 360) * 1.15;
    this.anim = null;
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(0.55, -1, 0.75).normalize().multiplyScalar(dist));
    this.camera.near = Math.max(0.01, size / 2000);
    this.camera.far = size * 50;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.render();
  }

  /** Turn the view to look at a point from a direction, keeping the distance comfortable. */
  faceTo(point: Vec3, from: Vec3) {
    const target = new THREE.Vector3(...point);
    let dir = new THREE.Vector3(...from);
    if (dir.lengthSq() < 1e-9) dir = this.camera.position.clone().sub(this.controls.target);
    dir.normalize();
    // Keep a little height so the bed stays in view.
    if (dir.z < 0.25) dir.z = 0.25;
    dir.normalize();
    const dist = Math.max(25, Math.min(this.camera.position.distanceTo(this.controls.target), 220));
    this.anim = { from: this.camera.position.clone(), to: target.clone().add(dir.multiplyScalar(dist)), tFrom: this.controls.target.clone(), tTo: target, t0: performance.now() };
    this.render();
  }

  /** Average outward direction of an item's faces, for faceTo. */
  directionOf(item: Item): { point: Vec3; dir: Vec3 } | null {
    const r = this.result;
    if (!r) return null;
    let px = 0, py = 0, pz = 0, dx = 0, dy = 0, dz = 0, n = 0;
    for (let t = 0; t < r.tri.length / 3; t++) {
      if (!this.belongs(t, item)) continue;
      const v = r.tri[t * 3] * 3;
      px += r.vert[v]; py += r.vert[v + 1]; pz += r.vert[v + 2];
      dx += this.normals[t * 3]; dy += this.normals[t * 3 + 1]; dz += this.normals[t * 3 + 2];
      n++;
    }
    if (!n) return null;
    return { point: [px / n, py / n, pz / n], dir: [dx, dy, dz] };
  }

  private belongs(t: number, item: Item): boolean {
    const r = this.result!;
    if (item.kind === 'edit') return r.owner[t] === item.id;
    if (item.kind === 'target') { const b = r.baseFace[t]; return b >= 0 && b < this.baseTarget.length && this.targetKeys[this.baseTarget[b]] === item.key; }
    return false;
  }

  /** The item a result triangle belongs to under the current look. */
  private itemAt(t: number): Item {
    const r = this.result!;
    const o = r.owner[t];
    if (o >= 0) return { kind: 'edit', id: o };
    const b = r.baseFace[t];
    if (b >= 0 && b < this.baseTarget.length) {
      const i = this.baseTarget[b];
      if (i >= 0 && this.look.active.has(this.targetKeys[i])) return { kind: 'target', key: this.targetKeys[i] };
    }
    return { kind: 'part' };
  }

  private colorOf(t: number): THREE.Color {
    const L = this.look;
    if (L.mode === 'lay') return L.overhang?.[t] ? C.overhang : C.part;
    const item = this.itemAt(t);
    const hov = L.hover;
    if (item.kind === 'edit') {
      if (L.selected.has(item.id)) return C.apSel;
      if (hov?.kind === 'edit' && hov.id === item.id) return C.apHi;
      return C.ap;
    }
    if (item.kind === 'target') {
      const hovered = hov?.kind === 'target' && hov.key === item.key;
      const picked = L.picked.has(item.key);
      const base = L.overhang?.[t] ? C.overhang : C.part;
      return tmp.copy(base).lerp(C.found, picked ? 0.85 : hovered ? 0.7 : 0.38);
    }
    return L.overhang?.[t] ? C.overhang : C.part;
  }

  private paintAll() {
    if (!this.mesh || !this.result) return;
    const a = this.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const arr = a.array as Float32Array;
    const nt = this.planeD.length;
    for (let t = 0; t < nt; t++) {
      const c = this.colorOf(t);
      for (let k = 0; k < 3; k++) { arr[t * 9 + k * 3] = c.r; arr[t * 9 + k * 3 + 1] = c.g; arr[t * 9 + k * 3 + 2] = c.b; }
    }
    for (const t of this.layRegion) for (let k = 0; k < 3; k++) { arr[t * 9 + k * 3] = C.lay.r; arr[t * 9 + k * 3 + 1] = C.lay.g; arr[t * 9 + k * 3 + 2] = C.lay.b; }
    a.needsUpdate = true;
    this.render();
  }

  // ---------- lay flat ----------

  private setLayRegion(tris: number[], key: number) {
    if (key === this.layKey) return;
    this.layRegion = tris;
    this.layKey = key;
    this.paintAll();
    this.onLayHover?.(tris.length > 0);
  }

  /** Every triangle on the same plane as `t`, if the part can rest on that plane. */
  private flatFace(t: number): number[] {
    const n = this.normals, d = this.planeD;
    const nx = n[t * 3], ny = n[t * 3 + 1], nz = n[t * 3 + 2], dt = d[t];
    const tol = 0.02;
    const pos = (this.mesh!.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < pos.length; i += 3) if (nx * pos[i] + ny * pos[i + 1] + nz * pos[i + 2] > dt + tol) return [];
    const out: number[] = [];
    for (let i = 0; i < d.length; i++) {
      if (Math.abs(d[i] - dt) > tol) continue;
      if (nx * n[i * 3] + ny * n[i * 3 + 1] + nz * n[i * 3 + 2] < 0.99995) continue;
      out.push(i);
    }
    return out;
  }

  // ---------- pointer ----------

  private hit(e: PointerEvent): number {
    if (!this.mesh || !this.mesh.visible) return -1;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const h = this.raycaster.intersectObject(this.mesh, false)[0];
    if (h?.faceIndex == null) return -1;
    // The picking index reorders triangles; each drawn triangle owns three consecutive vertices.
    const index = this.mesh.geometry.index;
    return index ? Math.floor(index.getX(h.faceIndex * 3) / 3) : h.faceIndex;
  }

  private onMove(e: PointerEvent) {
    if (e.buttons) return;
    const t = this.hit(e);
    if (this.look.mode === 'lay') {
      if (t < 0) { this.setLayRegion([], -1); return; }
      if (t === this.layKey || this.layRegion.includes(t)) return;
      this.setLayRegion(this.flatFace(t), t);
      return;
    }
    this.onHover?.(t < 0 ? null : this.itemAt(t), e.clientX, e.clientY);
  }

  private onUp(e: PointerEvent) {
    const d = this.downAt;
    this.downAt = null;
    if (e.button !== 0 || !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
    const t = this.hit(e);
    if (this.look.mode === 'lay') {
      if (t < 0 || !this.layRegion.includes(t)) return;
      this.onPickFace?.([this.normals[t * 3], this.normals[t * 3 + 1], this.normals[t * 3 + 2]]);
      return;
    }
    this.onClick?.(t < 0 ? null : this.itemAt(t), { shift: e.shiftKey, alt: e.altKey });
  }
}
