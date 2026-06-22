/**
 * GridLayer — renders the world grid inside the scaled Konva layer.
 *
 * Lines are drawn in world cm. Stroke widths are divided by zoom so they stay
 * ~1px on screen regardless of zoom. Origin axes are emphasized.
 */
import { Group, Line } from 'react-konva';
import type { Vec2 } from '../../model/geometry';

interface GridLayerProps {
  /** Visible world rectangle: top-left and bottom-right in cm. */
  min: Vec2;
  max: Vec2;
  gridCm: number;
  /** 1 / zoom — multiply pixel sizes by this to keep them screen-constant. */
  invZoom: number;
}

/** Cap on drawn lines so extreme zoom-out can't lock the browser. */
const MAX_LINES = 400;

export function GridLayer({ min, max, gridCm, invZoom }: GridLayerProps) {
  // Coarsen spacing if the visible range would produce too many lines.
  let step = gridCm;
  while ((max.x - min.x) / step + (max.y - min.y) / step > MAX_LINES) {
    step *= 2;
  }

  const startX = Math.floor(min.x / step) * step;
  const startY = Math.floor(min.y / step) * step;

  const lines: React.ReactNode[] = [];
  const thin = invZoom; // ~1px
  const axis = invZoom * 1.5;

  for (let x = startX; x <= max.x; x += step) {
    const isAxis = x === 0;
    lines.push(
      <Line
        key={`v${x}`}
        points={[x, min.y, x, max.y]}
        stroke={isAxis ? '#94a3b8' : '#e2e8f0'}
        strokeWidth={isAxis ? axis : thin}
        listening={false}
      />,
    );
  }
  for (let y = startY; y <= max.y; y += step) {
    const isAxis = y === 0;
    lines.push(
      <Line
        key={`h${y}`}
        points={[min.x, y, max.x, y]}
        stroke={isAxis ? '#94a3b8' : '#e2e8f0'}
        strokeWidth={isAxis ? axis : thin}
        listening={false}
      />,
    );
  }

  return <Group listening={false}>{lines}</Group>;
}
