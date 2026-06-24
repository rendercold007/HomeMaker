---
name: fragile-areas
description: HomeMaker geometry/room/3D spots that are subtly wrong or easy to break — scrutinize these harder in reviews
metadata:
  type: project
---

Areas that have gotten edits wrong or hide latent bugs:

- **Room polygon ordering — FIXED 2026-06-24.** `roomRing` is now a single pure export in `src/model/roomDetect.ts(roomRing)`, consumed by both `RoomsLayer` (2D) and `RoomSlab` (3D). The old centroid-angle sort in `RoomSlab` is gone. Signature: `roomRing(room, points, walls): Vec2[]`. Still walks adjacency (see ring-walk caveat below), not the authoritative face walker.
- **3D floor z-flip — FIXED 2026-06-24.** Pre-fix `RoomSlab` mapped plan-y to shape +y while `WallMesh` used -y; both rotate -90° about X, so floors landed on the opposite z from walls. Fix negates shape-y in `RoomSlab` (`-ring[i].y * CM`) to match walls. Label still uses raw +cy (correct: shape -y then -90°X rotation → world +z = +planY). Convention to preserve: any 3D plan-y→shape mapping must negate y to match the wall extrusion.
- **`roomRing` ring-walk loop bound.** Loops `room.wallIds.length` times and stops on `next === startId`. Fine for a simple cycle but assumes each vertex has exactly two of the room's walls; junctions/shared walls can mis-walk. The model's `detectRooms` is the authoritative face walker — prefer reusing it.
- **Opening validation — HARDENED 2026-06-24.** `addOpening` (planEdits) now validates: real wall + endpoints, `0 < width <= wallLen - thickness` (margins = thickness/2 each end), offset clamped onto wall, half-open overlap rejection. Rejects return `{ plan (unchanged), openingId: '' }`. The `''` sentinel is safe: CanvasStage ignores it and `commit` skips no-op (`resolved === present`) so no spurious undo step. `buildSegments` (now WallMesh.tsx) now clamps gapStart/gapEnd to `[0,wallLenCm]` and skips overlaps via `gapStart <= cursor` — defensive, no negative/overshoot segments. RESIDUAL (pre-existing, low): the window-glass & door-post meshes in WallMesh iterate openings directly with RAW op.width/offset, bypassing buildSegments' clamp — so a stale overhanging/overlapping opening's glass can float without a matching hole. Only reachable with invalid data addOpening now blocks. Also: CanvasStage door/window handler still does its own offset clamp (lines ~210-215) duplicating addOpening's clamp — harmless but redundant.
- **`solidSpans` (WallsLayer) for openings** still independently filters/sorts/clamps (separate from buildSegments — it only emits solid spans, no lintel/sill). Kept in sync by convention, not shared code.
- **`signedPolygonArea` sign convention.** CW in y-down → positive. `roomDetect` relies on this to drop the outer face. Any change to coordinate convention silently inverts room detection.
- **Miter math duplication — FIXED 2026-06-24.** The two inline `edge(d, side)` helpers are now one pure export `src/model/miter.ts(wallEdgePoint)(quad, a, b, thickness, d, side)`. Corners destructure `[leftA, leftB, rightB, rightA]`; side +1 = left (dir rotated +90° = (-diry, dirx)), -1 = right. Both WallsLayer and WallMesh call it. Behaviorally identical to the originals (added a harmless `len===0` guard).
- **Float drift in snapping.** CLAUDE.md wants integer-friendly cm, but snap/move results are not rounded to integers (movePoint stores raw floats from screenToWorld). Watch for accumulation.
