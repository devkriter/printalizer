# Printalizer

Printalizer rewrites STL files so they print better: tented holes, counterbore steps, base chamfers and more. It runs entirely in the browser. Models never leave your computer.

**Status:** Phase 1, the app shell. You can open a part, lay it on the bed, check its overhangs and export it. The editing features start in Phase 2.

## Running it

```bash
npm install
npm run dev      # http://localhost:8793
npm test         # unit tests for core/
npm run build    # static site in dist/
```

## Layout

- `core/` holds the geometry, shared by the app and the tests:
  - reading and writing STL and 3MF,
  - repair,
  - hole finding,
  - orientation,
  - overhangs.
- `app/` is the interface. It has React panels and a plain three.js view, plus `worker.ts`, which does all the heavy work off the page.
- `phase0/` contains the scripts and the results that proved the approach. See [phase0/README.md](phase0/README.md).

## What the app does now

- Opens STL and 3MF files, including Bambu Studio and OrcaSlicer projects. When a file holds several objects, it asks which one to open.
- Repairs files where that's safe, and says what it changed. It refuses files with large openings instead of guessing.
- **Lay flat:** click the face that goes on the bed. Only faces the part can actually rest on light up. **Auto** picks the largest such face, and the turn button rotates the part 90°.
- The part card shows size, volume, triangles, bed contact and overhang area. The overhang map (O) shows overhangs in violet.
- **Print setup** holds the printer bed, nozzle, layer height and overhang limit. It is saved in the browser.
- **Export:** 3MF (with the original kept inside) or STL.
- **Keys:** F resets the view, S toggles see-through, O toggles overhangs, Enter continues from lay flat, and Ctrl+O opens a file.

## Licence

MIT. See [LICENSE](LICENSE).
