/**
 * CanvasStage — the editor surface.
 *
 * Owns all TRANSIENT, high-frequency state (viewport pan/zoom, the rubber-band
 * wall, the in-progress point/furniture drag) in local state/refs. Writes to
 * PlanContext only on discrete commits — finishing a segment, ending a drag,
 * deleting — exactly as the state rules in CLAUDE.md require.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layer, Stage } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';

import {
  IDENTITY_VIEWPORT,
  screenToWorld,
  screenLengthToWorld,
  panBy,
  zoomAt,
  distance,
  distanceToSegment,
  type Viewport,
  type Vec2,
} from '../../model/geometry';
import type { ID } from '../../model/types';
import {
  drawWall,
  movePoint,
  deleteWall,
  deletePoint,
  addOpening,
  deleteOpening,
  addFurniture,
  moveFurniture,
  rotateFurniture,
  deleteFurniture,
  DEFAULT_WALL_THICKNESS,
  DEFAULT_DOOR_WIDTH,
  DEFAULT_WINDOW_WIDTH,
} from '../../model/planEdits';
import { usePlan } from '../../state/PlanContext';
import { useTool } from '../../state/ToolContext';
import { useSelection } from '../../state/SelectionContext';

import { useElementSize } from './useElementSize';
import { snapWorldPoint, type SnapCandidate } from './snapping';
import { GridLayer } from './GridLayer';
import { RoomsLayer } from './RoomsLayer';
import { WallsLayer } from './WallsLayer';
import { OpeningsLayer } from './OpeningsLayer';
import { FurnitureLayer } from './FurnitureLayer';
import { DraftLayer } from './DraftLayer';

/** Point-snap tolerance in screen pixels. */
const SNAP_PX = 12;
/** Wall hit tolerance in screen pixels for placing openings. */
const WALL_HIT_PX = 20;
const ZOOM_STEP = 1.1;

interface DraftStart {
  id?: ID;
  pos: Vec2;
}

export function CanvasStage() {
  const { plan, commit, undo, redo } = usePlan();
  const { tool, setTool, grid, activeFurnitureType } = useTool();
  const { selection, select, clear } = useSelection();

  const floor = plan.floors[0]!;
  const floorId = floor.id;

  const [containerRef, size] = useElementSize<HTMLDivElement>();
  const [viewport, setViewport] = useState<Viewport>(IDENTITY_VIEWPORT);
  const [cursor, setCursor] = useState<{ pos: Vec2; snapped: boolean } | null>(null);
  const [draftStart, setDraftStart] = useState<DraftStart | null>(null);
  const [override, setOverride] = useState<Record<ID, Vec2>>({});
  const [furnitureOverride, setFurnitureOverride] = useState<Record<ID, Vec2>>({});
  const [spaceDown, setSpaceDown] = useState(false);

  const panning = useRef<{ active: boolean; last: Vec2 }>({
    active: false,
    last: { x: 0, y: 0 },
  });
  const didInitView = useRef(false);

  // Center the default plot in view once we know the container size.
  useEffect(() => {
    if (didInitView.current || size.width === 0) return;
    didInitView.current = true;
    setViewport({ zoom: 0.35, pan: { x: 90, y: 90 } });
  }, [size.width]);

  const invZoom = 1 / viewport.zoom;

  const candidates = useMemo<SnapCandidate[]>(
    () => floor.points.map((p) => ({ id: p.id, x: p.x, y: p.y })),
    [floor.points],
  );

  const snapAt = useCallback(
    (raw: Vec2, opts: { shift: boolean; anchor?: Vec2 | null; excludeId?: ID }) =>
      snapWorldPoint(raw, {
        candidates,
        exclude: opts.excludeId ? new Set([opts.excludeId]) : undefined,
        gridCm: grid.sizeCm,
        gridSnap: grid.snap,
        shift: opts.shift,
        anchor: opts.anchor ?? null,
        thresholdCm: screenLengthToWorld(SNAP_PX, viewport),
      }),
    [candidates, grid.sizeCm, grid.snap, viewport],
  );

  const pointerWorld = (stage: import('konva/lib/Stage').Stage): Vec2 | null => {
    const ptr = stage.getPointerPosition();
    if (!ptr) return null;
    return screenToWorld(ptr, viewport);
  };

  /* ----------------------------- Mouse events ---------------------------- */

  const handleWheel = useCallback((e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    const ptr = stage?.getPointerPosition();
    if (!ptr) return;
    const factor = e.evt.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
    setViewport((vp) => zoomAt(vp, ptr, vp.zoom * factor));
  }, []);

  const handleMouseDown = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      const evt = e.evt;
      const stage = e.target.getStage();
      if (!stage) return;

      // Pan: middle mouse, or Space + left drag.
      if (evt.button === 1 || (evt.button === 0 && spaceDown)) {
        panning.current = { active: true, last: { x: evt.clientX, y: evt.clientY } };
        return;
      }

      if (evt.button !== 0) return;

      const world = pointerWorld(stage);
      if (!world) return;

      /* ---- Wall tool ---- */
      if (tool === 'wall') {
        const snap = snapAt(world, { shift: evt.shiftKey, anchor: draftStart?.pos ?? null });
        if (!draftStart) {
          setDraftStart({ id: snap.pointId, pos: { x: snap.x, y: snap.y } });
          return;
        }
        if (distance(draftStart.pos, snap) < 1) return;
        const result = drawWall(
          plan, floorId,
          { id: draftStart.id, x: draftStart.pos.x, y: draftStart.pos.y },
          { id: snap.pointId, x: snap.x, y: snap.y },
          DEFAULT_WALL_THICKNESS,
        );
        commit(result.plan);
        setDraftStart({ id: result.endId, pos: { x: snap.x, y: snap.y } });
        return;
      }

      /* ---- Door / Window tool ---- */
      if (tool === 'door' || tool === 'window') {
        const thresholdCm = screenLengthToWorld(WALL_HIT_PX, viewport);
        let bestWall: { id: ID; offset: number; thickness: number } | null = null;
        let bestDist = thresholdCm;

        for (const wall of floor.walls) {
          const ptA = floor.points.find((p) => p.id === wall.a);
          const ptB = floor.points.find((p) => p.id === wall.b);
          if (!ptA || !ptB) continue;
          const { distance: dist, closest } = distanceToSegment(world, ptA, ptB);
          if (dist < bestDist) {
            bestDist = dist;
            const offsetFromA = distance(ptA, closest);
            bestWall = { id: wall.id, offset: offsetFromA, thickness: wall.thickness };
          }
        }

        if (!bestWall) return;

        const theWall = floor.walls.find((w) => w.id === bestWall!.id)!;
        const ptA = floor.points.find((p) => p.id === theWall.a)!;
        const ptB = floor.points.find((p) => p.id === theWall.b)!;
        const wallLen = distance(ptA, ptB);
        const opWidth = tool === 'door' ? DEFAULT_DOOR_WIDTH : DEFAULT_WINDOW_WIDTH;
        const margin = theWall.thickness / 2;
        if (wallLen < opWidth + margin * 2) return; // wall too short

        // Center opening on click projection, then clamp to valid range.
        let offset = bestWall.offset - opWidth / 2;
        offset = Math.max(margin, Math.min(wallLen - opWidth - margin, offset));

        const { plan: newPlan } = addOpening(plan, floorId, {
          wallId: bestWall.id,
          kind: tool,
          offset,
          width: opWidth,
        });
        commit(newPlan);
        return;
      }

      /* ---- Furniture placement tool ---- */
      if (tool === 'furniture' && activeFurnitureType) {
        const snap = snapAt(world, { shift: false });
        const { plan: newPlan } = addFurniture(plan, floorId, {
          type: activeFurnitureType,
          x: snap.x,
          y: snap.y,
          rotationDeg: 0,
        });
        commit(newPlan);
        setTool('select');
        return;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spaceDown, tool, draftStart, snapAt, plan, floorId, viewport, activeFurnitureType, commit, setTool, floor],
  );

  const handleMouseMove = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      const evt = e.evt;
      const stage = e.target.getStage();
      if (!stage) return;

      if (panning.current.active) {
        const dx = evt.clientX - panning.current.last.x;
        const dy = evt.clientY - panning.current.last.y;
        panning.current.last = { x: evt.clientX, y: evt.clientY };
        setViewport((vp) => panBy(vp, { x: dx, y: dy }));
        return;
      }

      if (tool === 'wall') {
        const world = pointerWorld(stage);
        if (!world) return;
        const snap = snapAt(world, { shift: evt.shiftKey, anchor: draftStart?.pos ?? null });
        setCursor({ pos: { x: snap.x, y: snap.y }, snapped: snap.pointId !== undefined });
      } else if (cursor) {
        setCursor(null);
      }
    },
    [tool, draftStart, snapAt, cursor],
  );

  const endPan = useCallback(() => { panning.current.active = false; }, []);

  const handleClick = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      if (tool === 'select' && e.target === e.target.getStage()) {
        clear();
      }
    },
    [tool, clear],
  );

  /* ----------------------------- Point drag ------------------------------ */

  const handlePointDragMove = useCallback(
    (id: ID, raw: Vec2): Vec2 => {
      const snap = snapAt(raw, { shift: false, excludeId: id });
      const pos = { x: snap.x, y: snap.y };
      setOverride({ [id]: pos });
      return pos;
    },
    [snapAt],
  );

  const handlePointDragEnd = useCallback(
    (id: ID, raw: Vec2) => {
      const snap = snapAt(raw, { shift: false, excludeId: id });
      commit(movePoint(plan, floorId, id, snap.x, snap.y));
      setOverride({});
    },
    [snapAt, commit, plan, floorId],
  );

  /* -------------------------- Furniture drag ----------------------------- */

  const handleFurnitureDragMove = useCallback(
    (id: ID, raw: Vec2): Vec2 => {
      const snap = snapAt(raw, { shift: false });
      const pos = { x: snap.x, y: snap.y };
      setFurnitureOverride({ [id]: pos });
      return pos;
    },
    [snapAt],
  );

  const handleFurnitureDragEnd = useCallback(
    (id: ID, raw: Vec2) => {
      const snap = snapAt(raw, { shift: false });
      commit(moveFurniture(plan, floorId, id, snap.x, snap.y));
      setFurnitureOverride({});
    },
    [snapAt, commit, plan, floorId],
  );

  /* --------------------------- Keyboard input ---------------------------- */

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;

      if (e.key === ' ') { setSpaceDown(true); return; }
      if (e.key === 'Escape') { setDraftStart(null); clear(); setTool('select'); return; }

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }

      if (!mod) {
        // Tool shortcuts
        if (e.key === 'v' || e.key === 'V') { setTool('select'); return; }
        if (e.key === 'w' || e.key === 'W') { setTool('wall'); return; }
        if (e.key === 'd' || e.key === 'D') { setTool('door'); return; }
        if (e.key === 'n' || e.key === 'N') { setTool('window'); return; }
        if (e.key === 'f' || e.key === 'F') { setTool('furniture'); return; }

        // Rotate selected furniture
        if (e.key === 'r' || e.key === 'R') {
          if (selection?.kind === 'furniture') {
            const item = floor.furniture.find((f) => f.id === selection.id);
            if (item) {
              commit(rotateFurniture(plan, floorId, selection.id, (item.rotationDeg + 90) % 360));
            }
          }
          return;
        }
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selection) return;
        e.preventDefault();
        if (selection.kind === 'wall') commit(deleteWall(plan, floorId, selection.id));
        else if (selection.kind === 'point') commit(deletePoint(plan, floorId, selection.id));
        else if (selection.kind === 'opening') commit(deleteOpening(plan, floorId, selection.id));
        else if (selection.kind === 'furniture') commit(deleteFurniture(plan, floorId, selection.id));
        clear();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === ' ') setSpaceDown(false); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [selection, plan, floorId, floor, commit, clear, undo, redo, setTool]);

  /* ------------------------------- Render -------------------------------- */

  const worldMin = screenToWorld({ x: 0, y: 0 }, viewport);
  const worldMax = screenToWorld({ x: size.width, y: size.height }, viewport);

  const cursorStyle =
    panning.current.active || spaceDown ? 'grab'
    : tool === 'wall' ? 'crosshair'
    : (tool === 'door' || tool === 'window') ? 'crosshair'
    : tool === 'furniture' ? 'copy'
    : 'default';

  const selectedOpeningId = selection?.kind === 'opening' ? selection.id : null;
  const selectedFurnitureId = selection?.kind === 'furniture' ? selection.id : null;

  const statusHint =
    tool === 'wall' ? 'Click to place points · Shift = 45° lock · Esc to finish'
    : tool === 'door' ? 'Click a wall to place door · Esc to cancel'
    : tool === 'window' ? 'Click a wall to place window · Esc to cancel'
    : tool === 'furniture' ? 'Pick an item in the palette, then click to place · Esc to cancel'
    : selection?.kind === 'furniture' ? 'Drag to move · R to rotate · Del to remove'
    : null;

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-white">
      {size.width > 0 && (
        <Stage
          width={size.width}
          height={size.height}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={endPan}
          onMouseLeave={endPan}
          onClick={handleClick}
          onContextMenu={(e) => e.evt.preventDefault()}
          style={{ cursor: cursorStyle }}
        >
          <Layer x={viewport.pan.x} y={viewport.pan.y} scaleX={viewport.zoom} scaleY={viewport.zoom}>
            {grid.visible && (
              <GridLayer min={worldMin} max={worldMax} gridCm={grid.sizeCm} invZoom={invZoom} />
            )}
            <RoomsLayer floor={floor} invZoom={invZoom} />
            <WallsLayer
              floor={floor}
              override={override}
              tool={tool}
              selectedWallId={selection?.kind === 'wall' ? selection.id : null}
              selectedPointId={selection?.kind === 'point' ? selection.id : null}
              invZoom={invZoom}
              onSelectWall={(id) => select({ kind: 'wall', id })}
              onSelectPoint={(id) => select({ kind: 'point', id })}
              onPointDragMove={handlePointDragMove}
              onPointDragEnd={handlePointDragEnd}
            />
            <OpeningsLayer
              floor={floor}
              invZoom={invZoom}
              selectedOpeningId={selectedOpeningId}
              onSelectOpening={(id) => select({ kind: 'opening', id })}
            />
            <FurnitureLayer
              floor={floor}
              override={furnitureOverride}
              tool={tool}
              selectedFurnitureId={selectedFurnitureId}
              invZoom={invZoom}
              onSelectFurniture={(id) => select({ kind: 'furniture', id })}
              onFurnitureDragMove={handleFurnitureDragMove}
              onFurnitureDragEnd={handleFurnitureDragEnd}
            />
            {tool === 'wall' && (
              <DraftLayer
                start={draftStart?.pos ?? null}
                cursor={cursor?.pos ?? null}
                snapped={cursor?.snapped ?? false}
                invZoom={invZoom}
              />
            )}
          </Layer>
        </Stage>
      )}

      {/* Status HUD */}
      <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-slate-800/80 px-2 py-1 text-xs text-white">
        {Math.round(viewport.zoom * 100)}% · grid {grid.sizeCm}cm
      </div>

      {statusHint && (
        <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-slate-800/80 px-2 py-1 text-xs text-white">
          {statusHint}
        </div>
      )}
    </div>
  );
}
