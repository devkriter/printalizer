# Writing a feature

A feature finds something on a part and changes it so it prints better. Each built-in feature is one folder here, and the app finds the folder automatically.

This guide is for people and AI assistants writing a new one.

## The rule that makes it work

**A feature never edits the mesh.** It returns plain data:
- `find()` lists the targets: what it could change, and where.
- `build()` lists solids to add or subtract for one target.

The app does all the cutting. Because of that, every feature gets these for free:
- a preview,
- undo,
- re-applying when settings change,
- a closed result.

## Start

```bash
npm run new-feature -- my-feature
```

This creates `features/my-feature/` with four files:
- `index.ts`: the feature.
- `samples.ts`: small parts the automated checks run it on.
- `README.md`: what it does, for users and reviewers.

Fill them in, run `npm test`, and open a pull request. No other file changes.

## The shape of a feature

```ts
import { defineFeature, number, choice, subtract } from '../../feature-api/index.ts';

export default defineFeature({
  api: 1,                       // feature format version
  id: 'my-feature',             // must match the folder name
  name: 'My feature',           // shown on the rail and in Settings
  single: 'My edit', plural: 'my edits', noun: 'hole',  // "1 my edit", "No hole found here"
  version: '1.0',
  summary: 'One sentence for the features list.',
  icon: '<path d="…"/>',        // inner markup of a 24×24 stroked SVG
  key: '6',                     // default shortcut (optional)
  params: [                     // these build the settings panes and their notches
    number('angle', 'Roof angle', 45, { min: 30, max: 60, step: 1, unit: '°' }),
    choice('roof', 'Roof', ['Teardrop', 'Flat'], 'Teardrop'),
  ],
  measures: [                   // values measured on the part that the user may correct (optional)
    { k: 'd', label: 'Diameter', type: 'number', min: 1, max: 60, step: 0.1, unit: 'mm' },
  ],
  chip: '⌀{d}',                 // label in the edit strip; {k} comes from measures, then params

  find(ctx) {
    return ctx.find.cylinders().filter((c) => c.kind === 'hole').map((c) => ({
      anchor: c.center,          // keeps an edit attached when the part is turned
      tris: c.triangles,         // highlights the target on the model
      measure: { d: c.radius * 2 },
      detail: `⌀${(c.radius * 2).toFixed(1)} hole`,
      data: { axis: c.axis },    // anything else build() needs, as plain data
    }));
  },

  build(target, params, ctx) {
    return [subtract(ctx.solids.cylinder(target.measure.d / 2 + 0.2, 5))];
  },
});
```

## What `ctx` gives you

| Name | What it is |
|---|---|
| `ctx.part` | The part as it sits on the bed (Z up, bed at z = 0): `vert`, `tri`, `min`, `max`. |
| `ctx.setup` | `layer`, `nozzle`, `overhang` (degrees), `bedW`, `bedD`. |
| `ctx.find.cylinders()` | Round holes and bosses, with axis, radius, length, coverage and orientation. |
| `ctx.find.threads()` | ISO threads, with size, pitch, axis and kind. |
| `ctx.find.overhangs(limit)` | Connected regions facing down beyond the limit, with outlines seen from below. |
| `ctx.find.bedFaces()` | The faces on the bed and their area. |
| `ctx.section(z)` | The part's cross-section at height z, as polygons. |
| `ctx.shapes` | 2D operations: `offset`, `union`, `difference`, `intersection`, `area`, `hull`. |
| `ctx.solids` | Builders: `box`, `cylinder`, `extrude` (with optional twist), `union`, `difference`, `intersection`, `translate`, and `place` (build along +Z, then point Z anywhere). |
| `ctx.warn(text)` | Marks the edit's chip and shows the text in its pane. Use it for risky results. |

Finders are computed once per part and orientation, so calling them is cheap.

## Rules

- **Plain data only.** Targets and solids must survive `JSON.stringify`. No functions, classes or cycles.
- **Don't touch the network, the page or storage.** Features run in the geometry worker and only describe shapes.
- **Be clear about risk.** If a result might not work, call `ctx.warn()` with a plain sentence, like "M6×1 at 45° leaves 0.20 mm of thread depth, thinner than one 0.4 mm line."
- **Wording.** Count only what the user did. Never write "issues", "fixes needed" or "3 of 4 applied".
- **Leave other features' targets alone.** Overhang fill, for example, skips hole ceilings and threads.

## Automated checks

`features/checks.test.ts` runs every feature on every sample in its `samples.ts`. Each run must pass four checks:
- It finds at least the number of targets the sample says.
- Applying it everywhere gives a valid closed solid, and the volume changes by less than 30%.
- It achieves what the sample claims:
  - `fewer-overhangs`: the unsupported area a slicer would see at least halves.
  - `smaller-bed-contact`: less of the part touches the bed.
  - `changed`: the part changed.
- Its targets and settings are plain data.

The format is frozen at version 1. A change that breaks existing features needs a new `api` number.
