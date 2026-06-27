# Furniture GLB models

Drop real `.glb` furniture models here and the 3D view renders them instead of
the hand-built procedural meshes. **Models are auto-discovered** — there is no
list to maintain. A type with no file here just renders procedurally (and makes
no network request, so no 404s). The app works with this folder empty.

## How to add a model

1. Name the file after the furniture `type` from `src/model/furniture.ts` and
   drop it in this folder:

   ```
   src/assets/models/sofa.glb
   src/assets/models/double_bed.glb
   src/assets/models/dining_table.glb
   ```

2. Restart the dev server if it doesn't hot-pick-up the new file. That's it —
   the loader auto-fits each model to its catalog footprint (preserving aspect
   ratio) and rests it on the floor.

Valid type names (file = `<type>.glb`):
`sofa, double_bed, single_bed, wardrobe, side_table, coffee_table, tv_unit,
bookshelf, dining_table, chair, kitchen_counter, kitchen_island, kitchen_sink,
stove, fridge, chimney, toilet, wash_basin, vanity, shower, bathtub, mirror,
towel_rail, geyser, washing_machine, desk, staircase, pooja_unit`.

## Per-model tweaks (only if needed)

Most models need nothing. If one looks wrong, add an entry to `ASSET_OVERRIDES`
in `src/components/Viewer3D/furnitureAssets.ts`, keyed by type:

- `yawDeg` — rotate if the model's front doesn't face +Z (try 90 / 180 / 270).
- `scale` — force a fixed scale instead of auto-fit.
- `keepModelY: true` — for wall-mounted items (mirror, geyser, towel rail) so
  they aren't dropped to the floor.

## Assets & licensing

Use models you have the rights to. Good CC0 sources: **Poly Pizza**, **Kenney**,
**Quaternius**, and **Sketchfab** (filter to CC0). Keep files small — they're
bundled and shipped to the browser. Compress with `gltf-transform`:

```bash
npx @gltf-transform/cli optimize src/assets/models/sofa.glb src/assets/models/sofa.glb \
  --compress draco --texture-compress webp
```

> Licensing is on you: only commit assets whose license permits redistribution,
> and keep attribution where the license requires it. A 10 MB+ raw download
> should be compressed before committing.
