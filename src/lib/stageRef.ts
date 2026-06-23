import type Konva from 'konva';

let _stage: Konva.Stage | null = null;

export function setStageRef(stage: Konva.Stage | null) { _stage = stage; }
export function getStageRef(): Konva.Stage | null       { return _stage; }

/**
 * Exports the current canvas as a PNG data URL, framed to the drawing's
 * bounding box (so pan/zoom doesn't affect the result). Returns null if the
 * stage isn't mounted or has no content. Used as a structural reference image
 * for AI rendering so the output matches the actual 2D layout.
 */
export function captureStagePng(): string | null {
  const stage = _stage;
  if (!stage) return null;

  // getClientRect across the whole stage gives the bounds of all drawn content
  // in screen pixels (already accounts for pan/zoom).
  const rect = stage.getClientRect({ skipTransform: false });
  if (!isFinite(rect.width) || !isFinite(rect.height) || rect.width < 1 || rect.height < 1) {
    return null;
  }

  const pad = 24;
  const x = Math.max(0, rect.x - pad);
  const y = Math.max(0, rect.y - pad);
  const width  = Math.min(stage.width()  - x, rect.width  + pad * 2);
  const height = Math.min(stage.height() - y, rect.height + pad * 2);

  try {
    return stage.toDataURL({ x, y, width, height, pixelRatio: 2, mimeType: 'image/png' });
  } catch {
    return null;
  }
}
