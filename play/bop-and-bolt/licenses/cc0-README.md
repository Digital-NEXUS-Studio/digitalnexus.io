# Robot Lab CC0 assets

Seven GLB files from [3dassets.dev](https://3dassets.dev) are included unchanged. Their asset records identify them as **CC0 1.0 Universal**; see the exact source pages, download URLs, license records and SHA-256 checksums in `manifest.json`.

- Scout torso, scout legs, scout arm and twin-optic head: **Mech Hangar and Battle Frames**.
- Four-wheel rover: **Robots and Drones Kit**.
- Duck spring rocker and playground roundabout: **City Park and Playground**.

License: https://creativecommons.org/publicdomain/zero/1.0/

## Game adaptation

`scripts/import-cc0-models.mjs` reads the checked-in GLBs using Three.js GLTFLoader and writes `app/cc0-geometry.json`. It preserves every triangle, normal, and authored rigid transform (positions rounded to six decimals). It partitions rigid components at source sockets/pivots so that puzzle pieces have fixed parents. No external texture or model request is needed during play.

The playable copies use Robot Lab's turquoise, sunflower, pink and blue palette. Scout's shoulder, elbow, neck and hip anchors follow the source geometry. The rover retains its four authored wheel pivots and sensor pivot. Robot Lab supplies permanently attached folding flight/travel hardware; the original downloads do not contain those transformation animations. Scenery motion rotates the original deck and rocker nodes, with reduced-motion support.

Rebuild after intentionally updating a source and its manifest:

```sh
node scripts/import-cc0-models.mjs
node --test tests/cc0-assets.test.mjs
```
