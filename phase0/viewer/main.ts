// Phase 0 viewer: runs the same import, repair and hole finding in the browser and colours what it found.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { importSTL, meshOf } from '../../core/geometry.ts';
import { findCylinders } from '../../core/holes.ts';
import type { Cylinder } from '../../core/holes.ts';
import type { IndexedMesh } from '../../core/mesh.ts';

const COLORS = { base: 0x8894a1, horizontal: 0x4d8dff, vertical: 0xb48cff, angled: 0x3ecf93, open: 0xffffff };

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(devicePixelRatio);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101317);
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
camera.up.set(0, 0, 1);
const controls = new OrbitControls(camera, canvas);
scene.add(new THREE.HemisphereLight(0xffffff, 0x303840, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(1, -1.5, 2);
scene.add(sun);
let current: THREE.Object3D | null = null;

function resize() {
  const r = canvas.parentElement!.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

function buildMesh(m: IndexedMesh, holes: Cylinder[]): THREE.Group {
  const triColor = new Uint32Array(m.tri.length / 3).fill(COLORS.base);
  for (const h of holes) for (const t of h.triangles) triColor[t] = COLORS[h.orientation];
  // Unindexed so each triangle gets a flat colour.
  const n = m.tri.length;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const v = m.tri[i];
    pos[i * 3] = m.vert[v * 3]; pos[i * 3 + 1] = m.vert[v * 3 + 1]; pos[i * 3 + 2] = m.vert[v * 3 + 2];
    c.setHex(triColor[Math.floor(i / 3)]);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const group = new THREE.Group();
  group.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7, side: THREE.DoubleSide })));
  return group;
}

/** White lines along edges used by only one triangle: where the surface is open. */
function openEdges(m: IndexedMesh): THREE.LineSegments | null {
  const count = new Map<string, number>();
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  for (let i = 0; i < m.tri.length; i += 3) for (let k = 0; k < 3; k++) {
    const kk = key(m.tri[i + k], m.tri[i + ((k + 1) % 3)]);
    count.set(kk, (count.get(kk) ?? 0) + 1);
  }
  const pts: number[] = [];
  for (const [kk, n] of count) {
    if (n === 2) continue;
    const [a, b] = kk.split(',').map(Number);
    pts.push(...m.vert.subarray(a * 3, a * 3 + 3), ...m.vert.subarray(b * 3, b * 3 + 3));
  }
  if (!pts.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: COLORS.open, depthTest: false }));
}

function frame(obj: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3()).length();
  const center = box.getCenter(new THREE.Vector3());
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(0.6, -1, 0.7).normalize().multiplyScalar(size * 1.4));
  camera.near = size / 1000; camera.far = size * 20;
  camera.updateProjectionMatrix();
}

const info = document.getElementById('info')!;

async function show(id: string) {
  info.textContent = `Loading ${id}…`;
  const bytes = new Uint8Array(await (await fetch(`/corpus/${id}.stl`)).arrayBuffer());
  const t0 = performance.now();
  const { report, solid, welded } = await importSTL(bytes);
  let holes: Cylinder[] = [];
  let mesh: IndexedMesh = welded;
  if (solid) { mesh = meshOf(solid); holes = findCylinders(mesh); solid.delete(); }
  const ms = performance.now() - t0;
  const full = holes.filter((h) => h.kind === 'hole' && h.coverage >= 300);
  if (current) scene.remove(current);
  const group = buildMesh(mesh, full);
  if (!solid) { const e = openEdges(welded); if (e) group.add(e); }
  current = group;
  scene.add(group);
  frame(group);
  const cnt = (o: string) => full.filter((h) => h.orientation === o).length;
  info.innerHTML = `<b>${id}</b> · ${report.outcome}${report.reason ? ` · ${report.reason}` : ''}<br>`
    + `${report.trianglesIn.toLocaleString()} triangles · ${report.size.map((x) => x.toFixed(1)).join(' × ')} mm · ${(ms / 1000).toFixed(2)} s in the browser<br>`
    + `<span class="key"><span class="sw" style="background:#4d8dff"></span>horizontal ${cnt('horizontal')}</span>`
    + `<span class="key"><span class="sw" style="background:#b48cff"></span>vertical ${cnt('vertical')}</span>`
    + `<span class="key"><span class="sw" style="background:#3ecf93"></span>angled ${cnt('angled')}</span>`
    + (solid ? '' : `<span class="key"><span class="sw" style="background:#fff"></span>open edges</span>`)
    + `<div id="holes">${full.slice(0, 200).map((h) => `⌀${(h.radius * 2).toFixed(2)} · ${h.orientation} · ${h.length.toFixed(1)} long · ${h.segments} sides · ${Math.round(h.coverage)}°`).join('<br>')}</div>`;
  (window as unknown as { lastResult: unknown }).lastResult = { id, outcome: report.outcome, holes: full.length, ms };
}

// Hooks for checking the viewer from a script, which also works while the page is not being drawn.
Object.assign(window, {
  viewer: {
    show,
    renderNow: () => { controls.update(); renderer.render(scene, camera); },
    look(dir: [number, number, number], zoom = 1.4) {
      if (!current) return;
      const box = new THREE.Box3().setFromObject(current);
      const size = box.getSize(new THREE.Vector3()).length();
      const center = box.getCenter(new THREE.Vector3());
      controls.target.copy(center);
      camera.position.copy(center).add(new THREE.Vector3(...dir).normalize().multiplyScalar(size * zoom));
      controls.update();
      renderer.render(scene, camera);
    },
    chrome(visible: boolean) {
      document.getElementById('info')!.style.display = visible ? '' : 'none';
      document.querySelector('aside')!.setAttribute('style', visible ? '' : 'display:none');
      document.body.style.gridTemplateColumns = visible ? '' : '1fr';
      resize();
      renderer.render(scene, camera);
    },
  },
});

const list = document.getElementById('list')!;
const rows = (await (await fetch('/out/report.json')).json()) as Array<{ id: string; kind: string; outcome: string; trianglesIn: number; holes?: { full: number; horizontal: number; vertical: number } }>;
for (const r of rows) {
  const el = document.createElement('div');
  el.className = 'row';
  el.dataset.id = r.id;
  el.innerHTML = `<span>${r.id}</span><span class="tag ${r.outcome}">${r.outcome}</span><small>${r.kind} · ${r.holes ? `${r.holes.full} holes (${r.holes.horizontal} horizontal)` : ''}</small>`;
  el.onclick = () => { list.querySelectorAll('.row').forEach((x) => x.classList.remove('on')); el.classList.add('on'); show(r.id); location.hash = r.id; };
  list.append(el);
}
const start = location.hash.slice(1) || rows[0]?.id;
(list.querySelector(`[data-id="${start}"]`) as HTMLElement | null)?.click();
