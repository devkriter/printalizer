# Tented holes

**What it does:** gives horizontal round holes a pointed roof, also called a teardrop, so the top of the hole prints without sagging. Large holes can use a flat roof instead, set a little above the circle to allow for the bridge drooping.

**What it finds:** round holes at least 1.5 mm across whose axis is within 3° of the bed, with at least 300° of their wall present. It skips thread crests and roots.

**What it changes:** it cuts only the roof, a wedge above the circle that runs the length of the hole. The rest of the hole isn't touched.

## Settings

| Setting | Default | Range | Why |
|---|---|---|---|
| Roof | Teardrop | Teardrop, Flat | Flat suits large holes, where a pointed roof would be tall. |
| Roof angle | 45° | 30–60° | Steeper prints more reliably and takes more material away. |
| Roof height | 0.4 mm | 0–1 mm | Flat roof only: how far above the circle the bridge sits. |
| Diameter (measured) | from the part | | Correct it if the hole was modelled with few sides. |

## Limits

A hole cut through by another hole has less than 300° of its wall left, so it isn't found.
