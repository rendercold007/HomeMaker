---
name: codebase-map
description: Locations and contracts of HomeMaker's key modules (model, state, canvas, 3D) — orient fast before reviewing
metadata:
  type: project
---

Module map (verify paths before relying on them; code moves):

- `src/model/types.ts` — the `Plan` schema (single source of truth). Coords in cm, y-down.
- `src/model/geometry.ts` — pure: viewport transform (worldToScreen/screenToWorld), distance, snapToGrid, snapToNearestPoint, applyAngleLock, distanceToSegment, lineIntersection, signedPolygonArea (CW polygon → POSITIVE in y-down).
- `src/model/planEdits.ts` — immutable Plan edits; every wall-graph edit funnels through `recomputeRooms` → `detectRooms`. `carryRoomMeta` ports name/type onto re-derived rooms; room id = sorted wall set.
- `src/model/roomDetect.ts` — face-traversal cycle detection (next CW half-edge). Outer face dropped via negative signed area.
- `src/model/miter.ts` — `computeWallQuads(points, walls) → Map<wallId, WallQuad>`; quad corners ordered leftA, leftB, rightB, rightA. MITER_LIMIT clamps acute spikes. Also `wallEdgePoint(quad, a, b, thickness, d, side)` — shared pure edge-point helper (mitered ends, square interior cuts) used by both 2D WallsLayer and 3D WallMesh.
- `src/model/roomDetect.ts` — also exports `roomRing(room, points, walls): Vec2[]` (adjacency walk; correct for concave); shared by RoomsLayer (2D) and RoomSlab (3D).
- `src/state/store.ts` — Zustand store; past/present/future undo stack; hooks usePlan/useTool/useSelection/useActiveFloor each use `useShallow`. `commit(next | producer)`.
- `src/components/Canvas/CanvasStage.tsx` — owns ALL transient state (viewport, draftStart, override drag maps) in local state/refs; commits only on mouseup/discrete actions. Good reference for the state-discipline rule.
- `src/components/Canvas/WallsLayer.tsx` + `Viewer3D/WallMesh.tsx` — both reconstruct wall edge geometry; now BOTH call `wallEdgePoint` from `model/miter` (no longer duplicated inline).
- `src/components/Canvas/RoomsLayer.tsx` — consumes `roomRing` from `model/roomDetect` (no longer a local copy).
- **`src/components/Viewer3D/` was split (2026-06-24)** from one 1119-line file into modules: `Viewer3D.tsx` (orchestrator: Scene/FloorGroup/CameraRig/error boundary/Canvas; keeps `extend({ THREE })` at top before any JSX), `constants.ts` (CM, WALL_H, DOOR_H, SILL_H, LINTEL_H), `textures.ts` (makePlasterTexture), `WallMesh.tsx` (+ `buildSegments`, only definition), `RoomSlab.tsx` (uses shared roomRing + negated shape-y), `FurnitureMesh.tsx` (the giant per-type switch), `PostFX.tsx` (SSAO/SMAA/ToneMapping).
- `src/lib/` — storage (localStorage), export (PNG/PDF via jsPDF), units (cm→ft-in/m display only), stageRef (module-global Konva stage singleton).
