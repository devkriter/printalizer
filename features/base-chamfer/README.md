# Base chamfer

**What it does:** the first layer squashes outwards (elephant's foot), which stops parts fitting together. A small 45° chamfer around everything on the bed hides the flare.

**What it finds:** the outline of the faces on the bed, holes included. A part has at most one, so the edit follows the part when it's laid flat again.

**What it changes:** it subtracts a band around the outline that narrows upwards. The band is made of fine steps (0.05 mm, at least 4) that approximate a 45° slope.

## Settings

| Setting | Default | Range | Why |
|---|---|---|---|
| Size | 0.40 mm | 0.2–1.5 mm | About one or two first-layer widths of squash. |

## Limits

Very thin walls on the bed can lose their whole bottom edge to the chamfer.
