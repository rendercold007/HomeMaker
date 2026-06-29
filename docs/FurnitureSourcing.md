# Furniture sourcing worksheet (photoreal CC0)

Goal: replace the blocky procedural placeholders with real photoreal models for
the **26 missing types**. The pipeline is already built — drop a correctly-named
`.glb` into `src/assets/models/` and it auto-wires (fits to footprint, rests on
floor, falls back to procedural if missing/broken). See that folder's README.

**Done & signed off (11):** `sofa`, `double_bed`, `bookshelf`, `chair`, `dining_table`,
`single_bed`, `wardrobe`, `fridge`, `toilet`, `shower`, `washing_machine` — all
compressed (**draco** + webp, ≤3 MB each; see the compression note below for why
draco and not meshopt) and eyeballed in the 3D view: upright, on the floor,
sensibly scaled.

**Notes on the latest batch:**
- `chair.glb` is an **office chair**, not a dining chair — fine as generic
  seating, swap later if you want a dining-set chair.
- `dining_table.glb` ships **with its own chairs** (it's a full dining set). Looks
  good standalone, but the solver shouldn't also scatter separate `chair` items
  around it or you'll get chairs-in-chairs.
- `kitchen_counter.glb` is **excluded** (renders procedurally). The file you
  dropped is a whole kitchen run — ≈5.5 m wide × 2.9 m tall with upper wall
  cabinets — so auto-fit to a 180×60 footprint squashes it into an
  unrecognisable slab, and no scale fixes the baked-in cabinet height. Re-source
  a **single base-counter segment**, then drop `'kitchen_counter'` from
  `EXCLUDED_TYPES` in `src/components/Viewer3D/furnitureAssets.ts`.

> **Compression note — use `draco`, not `meshopt`.** We originally used meshopt
> (decoder is bundled into drei, so it works offline). But meshopt's `optimize`
> also adds **`KHR_mesh_quantization`**, and that breaks the **path tracer**:
> `three-mesh-bvh` reads the quantized normalized-integer positions at raw scale,
> so models explode to giant size (e.g. a dining set's chairs floated overhead at
> ~12 m). draco decodes its quantization back to floats before the BVH sees the
> geometry, so it renders correctly in both the rasteriser and the path tracer.
> All 8 GLBs were re-compressed to draco for this reason. Trade-off: draco fetches
> its decoder from a gstatic CDN at runtime (online-only); acceptable since the
> app is online anyway. Command:
> ```bash
> npx @gltf-transform/cli optimize in.glb src/assets/models/<type>.glb \
>   --compress draco --texture-compress webp --texture-size 2048
> ```

## The loop (you source, I sign off)

1. **You** find a CC0 model, download the `.glb`/`.gltf`, name it exactly
   `<type>.glb` (table below), drop it in `src/assets/models/`.
2. **Ping me** with the source URL + license. I:
   - verify the license actually permits redistribution (CC0 / public domain),
   - add an `ASSET_OVERRIDES` entry if it faces the wrong way / is mis-scaled /
     is wall-mounted,
   - compress it (command below) so we don't ship a 20 MB sofa,
   - eyeball it in the 3D view and confirm it sits right.
3. Repeat. Each one that lands instantly improves any generated plan.

**Compression (I'll run this per file):**
```bash
npx @gltf-transform/cli optimize in.glb src/assets/models/<type>.glb \
  --compress meshopt --texture-compress webp --texture-size 2048
```

## Where to look (photoreal CC0)

- **Sketchfab** — filter **Downloadable + CC0**. The deepest well for photoreal
  furniture; needs a free account to download. Most Tier 1/2 items live here.
- **Poly Haven** — true CC0, direct download, but **thin on furniture** (more
  props/decor). Worth checking for a few hero items.
- **ambientCG / Poly Haven HDRIs** — materials/lighting, not models (already
  covered by our procedural PBR + HDR env).
- Skip Quaternius/Kenney for this set — excellent CC0 but **low-poly**, which
  clashes with the photoreal target you chose.

> Reality check: photoreal CC0 is scarce for some bathroom/kitchen fixtures and
> the long tail. Where nothing good exists, ping me and we just keep the
> procedural mesh for that type rather than mixing a low-poly model into a
> photoreal room.

## Priority 1 — hero items (always in view, do these first)

| Type | Filename | Footprint W×D (cm) | Notes |
|------|----------|--------------------|-------|
| dining_table | `dining_table.glb` | 120 × 75 | pair with chairs |
| chair | `chair.glb` | 45 × 45 | repeated → I'll instance it |
| wardrobe | `wardrobe.glb` | 120 × 60 | tall; front = doors |
| tv_unit | `tv_unit.glb` | 150 × 40 | low media console |
| coffee_table | `coffee_table.glb` | 110 × 60 | |
| single_bed | `single_bed.glb` | 90 × 195 | |
| side_table | `side_table.glb` | 45 × 45 | |
| desk | `desk.glb` | 120 × 60 | |

## Priority 2 — kitchen & bath fixtures

| Type | Filename | Footprint W×D (cm) | Notes |
|------|----------|--------------------|-------|
| kitchen_counter | `kitchen_counter.glb` | 180 × 60 | |
| kitchen_island | `kitchen_island.glb` | 120 × 80 | |
| kitchen_sink | `kitchen_sink.glb` | 80 × 55 | |
| stove | `stove.glb` | 60 × 60 | |
| fridge | `fridge.glb` | 70 × 70 | tall |
| toilet | `toilet.glb` | 40 × 60 | |
| wash_basin | `wash_basin.glb` | 50 × 40 | |
| vanity | `vanity.glb` | 90 × 50 | basin + cabinet |
| shower | `shower.glb` | 90 × 90 | enclosure |
| washing_machine | `washing_machine.glb` | 60 × 60 | |

## Priority 3 — long tail (some may stay procedural)

| Type | Filename | Footprint W×D (cm) | Notes |
|------|----------|--------------------|-------|
| bathtub | `bathtub.glb` | 170 × 75 | |
| chimney | `chimney.glb` | 60 × 40 | over-stove hood |
| mirror | `mirror.glb` | 60 × 10 | **wall-mounted** → `keepModelY` |
| towel_rail | `towel_rail.glb` | 60 × 10 | **wall-mounted** → `keepModelY` |
| geyser | `geyser.glb` | 45 × 30 | **wall-mounted** → `keepModelY` |
| staircase | `staircase.glb` | 100 × 250 | we already model stairs; optional |
| pooja_unit | `pooja_unit.glb` | 90 × 45 | optional |

## Notes

- **Footprint is a guide, not a hard size** — the loader auto-fits any model to
  these dims (preserving aspect ratio), so pick the best-looking model and don't
  sweat exact dimensions. Just get the *proportions* roughly right.
- **Orientation:** our "front" faces **+Z**. If a model faces another way I'll
  add `yawDeg` (90/180/270) in `ASSET_OVERRIDES` — you don't need to fix it.
- **Keep raw downloads out of the commit** — hand me the file, I compress before
  it's committed.
