# Printalizer

Printalizer rewrites STL and 3MF files so they print better: tented holes, 45° threads, bridge steps, a base chamfer and overhang fill. It runs entirely in your browser, and models never leave your computer. Once loaded it works offline and can be installed as an app.

## Running it

```bash
npm install
npm run dev      # http://localhost:8793
npm test         # core tests and automated feature checks
npm run build    # static site in dist/; host it anywhere
```

## Using it

1. **Open** an STL or 3MF. Drop it on the window, or press Ctrl+O. For a file with several objects, pick one.
2. **Lay it flat.** Click the face that goes on the bed, or press **Auto**, then **Continue**. Only faces the part can rest on light up.
3. **Pick a tool** on the left (keys 1–5). What it can change is outlined on the model and listed in **Found**.
   - Click a target to apply it.
   - Alt+click applies it to every target that matches.
   - With no tool picked, clicking a target shows its settings with **Apply** (A).
4. **Adjust.**
   - Click an edit on the model or in the strip at the bottom to change its settings.
   - Shift+click selects several edits.
   - Right-click a tool to change its defaults. Edits you haven't changed follow the new defaults.
5. **Export.** A 3MF keeps the original and your edits, so it reopens ready to adjust. STL is also offered.

Other tools along the way:
- **Eraser:** hold E and click an edit to remove it.
- **Compare:** hold Space to see the original.
- **See-through (S):** shows features hidden inside the part.
- **Overhangs (O):** shows what would print over air.
- **Undo and redo:** Ctrl+Z and Ctrl+Y.

**Settings** (the gear) holds four things:
- minimal view,
- shortcut hints,
- the shortcut editor,
- the features list.

The tutorial can be shown again from there.

## The features

| Feature | What it does |
|---|---|
| [Tented holes](features/tented-holes/README.md) | Gives horizontal holes a 45° roof (or a flat one) so they don't sag. |
| [45° threads](features/threads-45/README.md) | Re-profiles ISO threads with 45° flanks so they print upright without support. |
| [Bridge steps](features/bridge-steps/README.md) | Adds sacrificial bridge layers to counterbores that face the bed. |
| [Base chamfer](features/base-chamfer/README.md) | Chamfers the edge on the bed against elephant's foot. |
| [Overhang fill](features/overhang-fill/README.md) | Builds a ledge out to 45° so it needs no support. |

Anyone can add a feature. See [CONTRIBUTING.md](CONTRIBUTING.md) and [features/README.md](features/README.md).

## Layout

- **`core/`:** geometry shared by everything:
  - STL and 3MF,
  - repair,
  - finding holes and threads,
  - orientation,
  - overhangs.
- **`feature-api/`:** the feature format (version 1) and the runtime that runs features and combines their edits with Manifold.
- **`features/`:** the built-in features, one folder each, with samples and automated checks.
- **`app/`:**
  - the interface: React panels over a plain three.js view;
  - the geometry worker.
- **`tools/`:** `npm run new-feature`.
- **`phase0/`:** the scripts and results that proved the approach.

## Licence

Copyright © 2026 Printalizer contributors.

Printalizer is free software under the GNU Affero General Public License, version 3 or (at your option) any later version. See [LICENSE](LICENSE). If you run a modified version for others to use over a network, the AGPL asks you to offer them its source code. The app links to its source in Settings › Help.
