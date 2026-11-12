// The 3D view: bed, part, picking faces, overhang colours and see-through. Plain three.js.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

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

const COL = {
  part: new THREE.Color(0x8894a1),
  overhang: new THREE.Color(0xb48cff),
  hover: new THREE.Color(0x8db4ff),
};

export class Viewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.1, 20000);
  private controls: OrbitControls;
  private bed = new THREE.Group();
  private bedSize = { w: 180, d: 180 };
  private part: THREE.Mesh | null = null;
  private material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
  /** Per triangle: unit normal and plane offset, for finding a whole flat face. */
  private normals = new Float32Array(0);
  private planeD = new Float32Array(0);
  private overhang: Uint8Array | null = null;
  private showOverhang = false;
  private region: number[] = [];
  private regionKey = -1;
  private mode: 'lay' | 'view' = 'view';
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private downAt: { x: number; y: number } | null = null;
  private frame = 0;
  onPickFace: ((normal: Vec3) => void) | null = null;
  onHover: ((over: boolean) => void) | null = null;

  private host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    host.appendChild(this.renderer.domElement);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.addEventListener('change', () => this.render());
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x2a3038, 2.1));
    // A key light that moves with the camera, from above and to the left of the view.
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(-1, 1.5, 1);
    key.target.position.set(0, 0, -4);
    this.camera.add(key, key.target);
    this.scene.add(this.camera);
    this.scene.add(this.bed);
    this.raycaster.firstHitOnly = true;
    this.setBed(180, 180);
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    const el = this.renderer.domElement;
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerdown', (e) => { this.downAt = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointerleave', () => this.setRegion([], -1));
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

  /** Draws on the next frame; repeated calls in one frame draw once. */
  render() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.controls.update()) this.render();
      this.renderer.render(this.scene, this.camera);
    });
  }

  /** Draw now, without waiting for a frame (for screenshots while the page is hidden). */
  renderNow() { this.controls.update(); this.renderer.render(this.scene, this.camera); }

  setBed(w: number, d: number) {
    this.bedSize = { w, d };
    this.bed.clear();
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshStandardMaterial({ color: 0x23282f, roughness: 0.95, transparent: true, opacity: 0.92 }),
    );
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

  /** Show a new part. `vert` and `tri` are indexed; the view draws flat triangles. */
  setPart(vert: Float32Array, tri: Uint32Array, keepCamera = false) {
    if (this.part) {
      this.scene.remove(this.part);
      this.part.geometry.disposeBoundsTree();
      this.part.geometry.dispose();
    }
    const nt = tri.length / 3;
    const pos = new Float32Array(nt * 9);
    this.normals = new Float32Array(nt * 3);
    this.planeD = new Float32Array(nt);
    for (let t = 0; t < nt; t++) {
      for (let k = 0; k < 3; k++) {
        const v = tri[t * 3 + k] * 3;
        pos[t * 9 + k * 3] = vert[v]; pos[t * 9 + k * 3 + 1] = vert[v + 1]; pos[t * 9 + k * 3 + 2] = vert[v + 2];
      }
      const o = t * 9;
      const ux = pos[o + 3] - pos[o], uy = pos[o + 4] - pos[o + 1], uz = pos[o + 5] - pos[o + 2];
      const vx = pos[o + 6] - pos[o], vy = pos[o + 7] - pos[o + 1], vz = pos[o + 8] - pos[o + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      this.normals[t * 3] = nx; this.normals[t * 3 + 1] = ny; this.normals[t * 3 + 2] = nz;
      this.planeD[t] = nx * pos[o] + ny * pos[o + 1] + nz * pos[o + 2];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nt * 9), 3));
    g.computeVertexNormals();
    g.computeBoundsTree();
    this.part = new THREE.Mesh(g, this.material);
    this.scene.add(this.part);
    this.region = [];
    this.regionKey = -1;
    this.overhang = null;
    this.paintAll();
    if (!keepCamera) this.fit();
    this.render();
  }

  clearPart() {
    if (!this.part) return;
    this.scene.remove(this.part);
    this.part.geometry.disposeBoundsTree();
    this.part.geometry.dispose();
    this.part = null;
    this.region = [];
    this.regionKey = -1;
    this.render();
  }

  setOverhangs(flags: Uint8Array | null, show: boolean) {
    this.overhang = flags;
    this.showOverhang = show;
    this.paintAll();
  }

  setMode(mode: 'lay' | 'view') {
    this.mode = mode;
    this.setRegion([], -1);
  }

  setXray(on: boolean) {
    this.material.transparent = on;
    this.material.opacity = on ? 0.35 : 1;
    this.material.depthWrite = !on;
    this.material.needsUpdate = true;
    this.render();
  }

  fit() {
    const box = new THREE.Box3();
    if (this.part) box.setFromObject(this.part);
    box.expandByPoint(new THREE.Vector3(0, 0, 0)).expandByPoint(new THREE.Vector3(this.bedSize.w, this.bedSize.d, 0));
    // Frame the part when it is much smaller than the bed, otherwise the whole bed.
    const partBox = this.part ? new THREE.Box3().setFromObject(this.part) : box;
    const partSize = partBox.getSize(new THREE.Vector3()).length();
    const useBox = partSize < Math.max(this.bedSize.w, this.bedSize.d) * 0.6 ? partBox : box;
    const center = useBox.getCenter(new THREE.Vector3());
    const size = useBox.getSize(new THREE.Vector3()).length() || 100;
    const dist = (size / 2) / Math.sin((this.camera.fov * Math.PI) / 360) * 1.15;
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(0.55, -1, 0.75).normalize().multiplyScalar(dist));
    this.camera.near = Math.max(0.01, size / 2000);
    this.camera.far = size * 50;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.render();
  }

  private colorOf(t: number): THREE.Color {
    if (this.showOverhang && this.overhang?.[t]) return COL.overhang;
    return COL.part;
  }

  private paint(t: number, c: THREE.Color) {
    if (!this.part) return;
    const a = this.part.geometry.getAttribute('color') as THREE.BufferAttribute;
    const arr = a.array as Float32Array;
    for (let k = 0; k < 3; k++) { arr[t * 9 + k * 3] = c.r; arr[t * 9 + k * 3 + 1] = c.g; arr[t * 9 + k * 3 + 2] = c.b; }
  }

  private paintAll() {
    if (!this.part) return;
    const nt = this.planeD.length;
    for (let t = 0; t < nt; t++) this.paint(t, this.colorOf(t));
    for (const t of this.region) this.paint(t, COL.hover);
    (this.part.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    this.render();
  }

  private setRegion(tris: number[], key: number) {
    if (key === this.regionKey) return;
    for (const t of this.region) this.paint(t, this.colorOf(t));
    this.region = tris;
    this.regionKey = key;
    for (const t of tris) this.paint(t, COL.hover);
    if (this.part) (this.part.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    this.onHover?.(tris.length > 0);
    this.render();
  }

  /**
   * Every triangle on the same plane as `t`: the flat face the pointer is over. Empty when the
   * part can't rest on that plane because something sticks out beyond it.
   */
  private flatFace(t: number): number[] {
    const n = this.normals, d = this.planeD;
    const nx = n[t * 3], ny = n[t * 3 + 1], nz = n[t * 3 + 2], dt = d[t];
    const out: number[] = [];
    const tol = 0.02;
    const pos = (this.part!.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < pos.length; i += 3) if (nx * pos[i] + ny * pos[i + 1] + nz * pos[i + 2] > dt + tol) return out;
    for (let i = 0; i < d.length; i++) {
      if (Math.abs(d[i] - dt) > tol) continue;
      if (nx * n[i * 3] + ny * n[i * 3 + 1] + nz * n[i * 3 + 2] < 0.99995) continue;
      out.push(i);
    }
    return out;
  }

  private hit(e: PointerEvent): number {
    if (!this.part) return -1;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const h = this.raycaster.intersectObject(this.part, false)[0];
    if (h?.faceIndex == null) return -1;
    // The picking index reorders triangles; each drawn triangle owns three consecutive vertices.
    const index = this.part.geometry.index;
    return index ? Math.floor(index.getX(h.faceIndex * 3) / 3) : h.faceIndex;
  }

  private onMove(e: PointerEvent) {
    if (this.mode !== 'lay' || e.buttons) return;
    const t = this.hit(e);
    if (t < 0) { this.setRegion([], -1); return; }
    if (t === this.regionKey || this.region.includes(t)) return;
    this.setRegion(this.flatFace(t), t);
  }

  private onUp(e: PointerEvent) {
    const d = this.downAt;
    this.downAt = null;
    if (this.mode !== 'lay' || e.button !== 0 || !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
    const t = this.hit(e);
    if (t < 0 || !this.region.includes(t)) return;
    this.onPickFace?.([this.normals[t * 3], this.normals[t * 3 + 1], this.normals[t * 3 + 2]]);
  }
}
