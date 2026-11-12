# Phase 0: proving the risky parts

Phase 0 checks the three things the plan depends on before any app is built:
- Real STLs survive import and repair.
- Round holes can be found on real meshes.
- A 3MF with Printalizer's extra data still opens in slicers.

It also produces one test print for tented holes.

The code in `core/` is meant to carry into Phase 1. The scripts here only drive it.

## Running it

```bash
npm install
npm test                 # unit tests for core/
npm run phase0:corpus    # copy the test files listed in phase0/corpus.json into phase0/corpus/
npm run phase0:run       # import, repair and find holes in every file; writes phase0/out/report.json
npm run phase0:view      # http://localhost:8792/viewer/ : the same code in the browser, holes coloured
npm run phase0:print     # the tented-hole test plate (STL and 3MF) in phase0/out/
npm run phase0:3mf       # load, re-save and slice the 3MF in each installed slicer
```

`phase0/corpus.json`, `phase0/corpus/` and `phase0/out/` stay local. They contain other people's models and paths on the owner's computer.

## Results (11 November 2026)

### Import and repair: 29 of 30 files survived

The 30 files were picked from the owner's folders for variety:
- printer parts,
- Gridfinity,
- hole and thread test boards,
- organic models (Benchy, a pug, a cauliflower),
- multi-part plates,
- files with odd names.

| Outcome | Files | What happened |
|---|---|---|
| Clean | 27 | Closed and solid as exported. Separate bodies in one file are united. |
| Repaired | 2 | A Gridfinity bin with paper-thin label fins and bodies pressed face to face. A 1.3-million-triangle filter missing one flat face that has 8 mm holes in it. |
| Refused | 1 | A mesh missing a whole curved side (about 110 × 119 mm). Any patch would be a guess. |

The repair steps, in order:
1. Merge vertices.
2. Drop collapsed and duplicate triangles.
3. Remove internal double walls.
4. Fix winding inside each shell.
5. Split shells that touch along an edge or face. The two orders are tried and the consistent one is kept.
6. Fill small holes with a fan.
7. Fill missing flat faces, islands included, with Manifold's triangulator.
8. Build each shell in Manifold and unite them. Inside-out shells become cavities only when they sit inside the part.

A file is **partial** when a piece with volume had to be left out. None of the 30 ended up partial.

### Hole finding

950 full round holes were found: 60 horizontal and 886 vertical. On the hole and thread boards, the parts lie flat, so their holes are vertical.

The method:
1. Grow runs of wall strips around an axis.
2. Re-estimate the axis from all the normals.
3. Fit a circle.
4. Regrow, accepting any triangle whose corners lie on the cylinder.

Spot-checked by eye in the viewer:
- **Micron front body:** 20 holes found. One hole cut through by another stays unmarked, because less than 300° of its wall is left. The hex nut pocket is correctly ignored.
- **Screw bar:** the rounded ends of slots are correctly not holes.
- **Benchy:** the chimney and the hawse hole are found, and nothing on the curved hull.
- **Filter:** every vent hole is found.

Unit tests also cover:
- holes with 12, 32 and 128 sides,
- angled holes,
- walls cut diagonally,
- holes ending on a slanted face,
- bosses, rounded edges, hex holes and spheres.

Not checked by eye: fan grill and Falcam (0 holes each), Xol carriage, thread board.

### Speed (Node, one thread)

- Most files take under 0.6 s in total.
- Benchy (226k triangles) takes 1.7 s.
- The 1.3-million-triangle filter takes 18 s, and 14 s in the browser.

So the background worker and a progress indicator are needed for big files.

### 3MF with Printalizer's data

The test file carries the printable mesh, the original mesh (`Printalizer/original.stl`) and the edit list (`Printalizer/edits.json`).

| Slicer | Opens the file | Mesh intact | Keeps Printalizer's parts on re-save | Slices from the command line |
|---|---|---|---|---|
| OrcaSlicer | yes | yes, 3,724 of 3,724 triangles | no | not tested: it could not load the Bambu profile files |
| Bambu Studio | yes | yes, 3,724 of 3,724 triangles | no | crashes on any input, plain STL included |
| PrusaSlicer | not installed | | | |

So far, the extra parts do no harm.
- **Saving from a slicer drops them.** The editable copy is the file Printalizer exported, and the app should say so.
- **Not verified:** slicing in the slicer apps themselves, and PrusaSlicer.

### Manifold functions used and working

- **Building solids:** `Mesh` with `merge`, the `Manifold` constructor and `status`.
- **Booleans:** `union` (several solids at once), `difference` and `intersect`.
- **Measuring:** `volume` and `genus`.
- **Reading back:** `getMesh`.
- **Shapes:** `cube`, `cylinder` and `sphere`.
- **Moving and bending:** `translate`, `rotate` and `warp`.
- **2D:** `CrossSection` polygons, `circle`, `square`, `add`, `intersect` and `extrude`.
- **Filling faces:** `triangulate`.

In the API but not exercised yet: `slice` and `splitByPlane`/`trimByPlane` for layer-based features, plus `hull`, `minkowskiSum`, `simplify` and `rayCast`.

### Licence note

The plan named meshfix-wasm for repair. Its npm package is labelled MIT, but it wraps MeshFix, which is distributed elsewhere as GPL-3. It isn't used, and the repair above covers every case in the test set.

## Still to do by hand

- Print `out/tented-hole-test.3mf` (or the `.stl`) standing upright.
  - Bottom row: plain round holes. Middle row: 45° pointed roof. Top row: roof cut flat 0.4 mm above the circle.
  - Diameters are 3, 5, 8 and 12 mm, left to right.
  - The rows are marked with 1, 2 and 3 dimples on the front face, and the top right corner is cut.
- Open `out/tented-hole-test.3mf` in Bambu Studio or OrcaSlicer and slice it there.
