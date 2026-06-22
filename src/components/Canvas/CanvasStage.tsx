/**
 * CanvasStage — the editor surface.
 *
 * Owns all TRANSIENT, high-frequency state (viewport pan/zoom, the rubber-band
 * wall, the in-progress point drag) in local state/refs. It writes to
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
  type Viewport,
  type Vec2,
} from '../../model/geometry';
import type { ID } from '../../model/types';
import {
  drawWall,
  movePoint,
  deleteWall,
  deletePoint,
  DEFAULT_WALL_THICKNESS,
} from '../../model/planEdits';
import { usePlan } from '../../state/PlanContext';
import { useTool } from '../../state/ToolContext';
import { useSelection } from '../../state/SelectionContext';

import { useElementSize } from './useElementSize';
import { snapWorldPoint, type SnapCandidate } from './snapping';
import { GridLayer } from './GridLayer';
import { RoomsLayer } from './RoomsLayer';
import { WallsLayer } from './WallsLayer';
import { DraftLayer } from './DraftLayer';

/** Point-snap tolerance in screen pixels. */
const SNAP_PX = 12;
const ZOOM_STEP = 1.1;

interface DraftStart {
  id?: ID;
  pos: Vec2;
}

export function CanvasStage() {
  const { plan, commit, undo, redo } = usePlan();
  const { tool, grid } = useTool();
  const { selection, select, clear } = useSelection();

  const floor = plan.floors[0]!;
  const floorId = floor.id;

  const [containerRef, size] = useElementSize<HTMLDivElement>();
  const [viewport, setViewport] = useState<Viewport>(IDENTITY_VIEWPORT);
  const [cursor, setCursor] = useState<{ pos: Vec2; snapped: boolean } | null>(null);
  const [draftStart, setDraftStart] = useState<DraftStart | null>(null);
  const [override, setOverride] = useState<Record<ID, Vec2>>({});
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
    const zoom = 0.35;
    setViewport({
      zoom,
      pan: { x: 90, y: 90 },
    });
  }, [size.width]);

  const invZoom = 1 / viewport.zoom;

  const candidates = useMemo<SnapCandidate[]>(
    () => floor.points.map((p) => ({ id: p.id, x: p.x, y: p.y })),
    [floor.points],
  );

  /** Snap a raw world point under current settings. */
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

      if (tool === 'wall' && evt.button === 0) {
        const world = pointerWorld(stage);
        if (!world) return;
        const snap = snapAt(world, {
          shift: evt.shiftKey,
          anchor: draftStart?.pos ?? null,
        });
        if (!draftStart) {
          setDraftStart({ id: snap.pointId, pos: { x: snap.x, y: snap.y } });
          return;
        }
        // Ignore zero-length segments.
        if (distance(draftStart.pos, snap) < 1) return;
        const result = drawWall(
          plan,
          floorId,
          { id: draftStart.id, x: draftStart.pos.x, y: draftStart.pos.y },
          { id: snap.pointId, x: snap.x, y: snap.y },
          DEFAULT_WALL_THICKNESS,
        );
        commit(result.plan);
        // Chain: the just-placed end becomes the next start.
        setDraftStart({ id: result.endId, pos: { x: snap.x, y: snap.y } });
      }
    },
    [spaceDown, tool, draftStart, snapAt, plan, floorId, commit],
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
        const snap = snapAt(world, {
          shift: evt.shiftKey,
          anchor: draftStart?.pos ?? null,
        });
        setCursor({ pos: { x: snap.x, y: snap.y }, snapped: snap.pointId !== undefined });
      } else if (cursor) {
        setCursor(null);
      }
    },
    [tool, draftStart, snapAt, cursor],
  );

  const endPan = useCallback(() => {
    panning.current.active = false;
  }, []);

  const handleClick = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      // Empty-space click in Select tool clears the selection.
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

  /* --------------------------- Keyboard input ---------------------------- */

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === ' ') {
        setSpaceDown(true);
        return;
      }
      if (e.key === 'Escape') {
        setDraftStart(null);
        clear();
        return;
      }
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selection) return;
        e.preventDefault();
        commit(
          selection.kind === 'wall'
            ? deleteWall(plan, floorId, selection.id)
            : deletePoint(plan, floorId, selection.id),
        );
        clear();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceDown(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [selection, plan, floorId, commit, clear, undo, redo]);

  /* ------------------------------- Render -------------------------------- */

  const worldMin = screenToWorld({ x: 0, y: 0 }, viewport);
  const worldMax = screenToWorld({ x: size.width, y: size.height }, viewport);

  const cursorStyle = panning.current.active || spaceDown
    ? 'grab'
    : tool === 'wall'
      ? 'crosshair'
      : 'default';

  const interactive = tool === 'select';

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

      {!interactive && (
        <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-slate-800/80 px-2 py-1 text-xs text-white">
          Click to place points · Shift = 45° lock · Esc to finish
        </div>
      )}
    </div>
  );
}
