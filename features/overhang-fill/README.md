# Overhang fill

**What it does:** builds material out under a ledge at a printable angle, so it needs no support. A fillet that faces the bed becomes, in effect, a chamfer.

**What it finds:** connected regions facing down more steeply than the overhang limit in print setup, not counting faces on the bed. It leaves alone the ceilings of horizontal holes (Tented holes), thread flanks (45° threads) and ceilings inside vertical holes and counterbores (Bridge steps).

**What it changes:** it works down from the top of the overhang one layer at a time. Within the overhang's footprint, each layer gets enough material to hold up the layer above, shrunk inwards by one layer's step at the chosen angle.

## Settings

| Setting | Default | Range | Why |
|---|---|---|---|
| Overhang angle | 45° | 30–60° | The slope of the fill. Steeper uses less material. |

## Limits

- **Staircase:** the fill is a staircase at the layer height. The slicer would print it that way anyway.
- **Long fills:** a fill that reaches more than 30 mm down shows a warning.
