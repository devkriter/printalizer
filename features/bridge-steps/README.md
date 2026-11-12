# Bridge steps

**What it does:** the ceiling of a counterbore that faces the bed has nothing to anchor to. This cuts a slot one layer deep across the bore, then a square on the next layer. Each bridge then has solid ends, and the part needs no cleanup afterwards.

**What it finds:** vertical round holes with a wider coaxial bore directly below them, where the bore's top sits above the bed.

**What it changes:** it subtracts the slot (as wide as the hole, spanning the bore) and then the square (as wide as the hole), each `Layers per step` layers deep, clipped to the bore.

## Settings

| Setting | Default | Range | Why |
|---|---|---|---|
| Layers per step | 1 | 1–3 | Big bores bridge better with thicker steps. |
| Bore (measured) | from the part | | |

## Limits

It depends on the layer height in print setup, so slice at that layer height. The export summary says so.
