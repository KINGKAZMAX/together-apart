# Character assets

The four character models are from **Mini Characters 1.0** by **Kenney**, published under **CC0 1.0 Universal**. The creator’s official page and the bundled license both identify CC0. Checked and downloaded on 2026-10-26.

- Official asset page: https://kenney.nl/assets/mini-characters
- Official archive: https://kenney.nl/media/pages/assets/mini-characters/bfc7e272b4-1774770718/kenney_mini-characters.zip
- License deed: https://creativecommons.org/publicdomain/zero/1.0/
- Original license, preserved verbatim: `public/models/LICENSE.Kenney.txt`
- Original archive SHA-256: `9e1d48e6d7b8479ebbe84df71eb5bd8e1b3f0da546dea641890dccc8a02d0999`

CC0 permits copying, modification, redistribution, and commercial use. Attribution is not required; the application voluntarily credits Kenney.

## Files used

| Local file | Original GLB filename | Bytes | Bind-pose height |
| --- | --- | ---: | ---: |
| alex.glb | character-male-a.glb | 255,212 | 0.671 |
| maya.glb | character-female-a.glb | 281,740 | 0.776 |
| jordan.glb | character-male-c.glb | 271,400 | 0.793 |
| sam.glb | character-female-d.glb | 267,056 | 0.776 |

Local display names Alex, Maya, Jordan, and Sam are application labels; they are not names supplied by the creator. The small preview PNGs beside the models are the corresponding original Kenney previews, under the same CC0 license.

## Packaging and integration

The original GLBs reference a shared `Textures/colormap.png`. That original 512 × 512 PNG has been embedded into each local GLB as a buffer view. Geometry, skeletons, materials, and all original animations are preserved. No model or texture depends on a remote runtime request. Models use glTF Y-up and face **+Z**, verified with a Blender render. Their feet are at approximately Y = 0. Normalize to the desired scene height and start the `idle` animation; the default bind pose has arms extended.

Each file contains 32 animations, including `idle`, `walk`, `sprint`, `sit`, `emote-yes`, and `emote-no`. Use skeleton-aware cloning for multiple animated instances. `public/models/characters.json` is the application manifest. `public/models/validation.json` records file hashes, bind-pose bounds, and exact animation names and durations.

## Validation

All four local files have valid glTF 2.0 binary headers, JSON and binary chunks, in-range buffer views, and embedded texture references. All four have been imported successfully by Blender with their 32 animations and 512 × 512 texture. Alex was rendered from glTF +Z to verify front direction and intact material appearance.
