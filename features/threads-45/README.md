# 45° threads

**What it does:** re-profiles ISO threads with 45° flanks and a small flat crest, so a vertical thread's underside is no steeper than 45° and prints without support.

**What it finds:** helical surfaces whose flanks lean 30° from the plane across the axis (ISO 60° threads), wrapping all the way round over more than a turn and a half. It finds them around the part's main axes and around any hole or boss. The nearest ISO coarse size is matched from the major diameter and the measured pitch.

**What it changes:** it fills the old thread with a plain cylinder, then cuts the new helix: a threaded hole for internal threads, a groove for external ones. Left-hand threads stay left-hand.

## Settings

| Setting | Default | Range | Why |
|---|---|---|---|
| Flank angle | 45° | 30–60° | The angle from the plane across the axis. 45° prints upright without support. |
| Crest flat | 0.30 mm | 0.1–0.8 mm | A flat crest and root keep the points from printing as blobs. |
| Clearance | 0.15 mm | 0–0.5 mm | Radial play between printed halves. |
| Size (measured) | from the part | M2–M24 | Correct it if the size was matched wrong. |

## Limits

- **Shallow threads:** the new groove is shallow. M6×1 leaves 0.2 mm of depth, which the feature warns about when it's thinner than three quarters of the nozzle.
- **Metal bolts:** a re-profiled thread mates with other converted threads, not with a standard metal bolt.
- **Testing:** only verified on generated ISO threads so far. None of the real files tested contained modelled threads.
