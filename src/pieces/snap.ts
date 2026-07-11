import type { PieceMeta } from '../types';

export type MagnetMode = 'off' | 'grid' | 'edges' | 'both';

export interface MagnetSettings {
  mode: MagnetMode;
  /** World-pixel step for grid snap (1 = every pixel). */
  gridSize: number;
  /** Max distance in world px to snap to edges/neighbors. */
  edgeThreshold: number;
}

export const DEFAULT_MAGNET: MagnetSettings = {
  mode: 'both',
  gridSize: 1,
  edgeThreshold: 8,
};

export function snapPosition(
  x: number,
  y: number,
  w: number,
  h: number,
  neighbors: PieceMeta[],
  canvasW: number,
  canvasH: number,
  magnet: MagnetSettings = DEFAULT_MAGNET,
): { x: number; y: number } {
  let nx = x;
  let ny = y;

  if (magnet.mode === 'off') {
    return {
      x: clamp(Math.round(nx), -w + 1, canvasW - 1),
      y: clamp(Math.round(ny), -h + 1, canvasH - 1),
    };
  }

  const useGrid = magnet.mode === 'grid' || magnet.mode === 'both';
  const useEdges = magnet.mode === 'edges' || magnet.mode === 'both';
  const step = Math.max(1, Math.floor(magnet.gridSize));
  const thresh = Math.max(1, magnet.edgeThreshold);

  if (useGrid) {
    nx = Math.round(nx / step) * step;
    ny = Math.round(ny / step) * step;
  } else {
    nx = Math.round(nx);
    ny = Math.round(ny);
  }

  if (useEdges) {
    // Canvas edges
    if (Math.abs(nx) <= thresh) nx = 0;
    if (Math.abs(ny) <= thresh) ny = 0;
    if (Math.abs(nx + w - canvasW) <= thresh) nx = canvasW - w;
    if (Math.abs(ny + h - canvasH) <= thresh) ny = canvasH - h;

    const edgesX = [0, canvasW];
    const edgesY = [0, canvasH];
    for (const n of neighbors) {
      edgesX.push(n.x, n.x + n.w);
      edgesY.push(n.y, n.y + n.h);
    }

    for (const edge of edgesX) {
      if (Math.abs(nx - edge) <= thresh) nx = edge;
      if (Math.abs(nx + w - edge) <= thresh) nx = edge - w;
    }
    for (const edge of edgesY) {
      if (Math.abs(ny - edge) <= thresh) ny = edge;
      if (Math.abs(ny + h - edge) <= thresh) ny = edge - h;
    }
  }

  return {
    x: clamp(nx, -w + 1, canvasW - 1),
    y: clamp(ny, -h + 1, canvasH - 1),
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function hitTest(pieces: PieceMeta[], wx: number, wy: number): PieceMeta | null {
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i]!;
    if (wx >= p.x && wy >= p.y && wx < p.x + p.w && wy < p.y + p.h) return p;
  }
  return null;
}
