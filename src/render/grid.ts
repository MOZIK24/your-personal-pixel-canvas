import type { Camera, Viewport } from '../types';

const STEP_CANDIDATES = [
  1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768,
];

/**
 * Pick world-space grid step so lines stay readable on screen.
 * Strong zoom-in → fine grid (1px); zoom-out → coarser grid.
 */
export function adaptiveGridStep(scale: number, minScreenPx = 10): number {
  for (const step of STEP_CANDIDATES) {
    if (step * scale >= minScreenPx) return step;
  }
  return STEP_CANDIDATES[STEP_CANDIDATES.length - 1]!;
}

/** Major lines every N minor cells (or next power-of-two step up). */
export function majorGridStep(minor: number): number {
  const idx = STEP_CANDIDATES.indexOf(minor);
  if (idx >= 0 && idx + 2 < STEP_CANDIDATES.length) return STEP_CANDIDATES[idx + 2]!;
  return Math.max(minor * 4, minor);
}

export function drawWorldGrid(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  viewport: Viewport,
  canvasW: number,
  canvasH: number,
  gridColor = 'rgba(200, 194, 180, 0.28)',
): void {
  const minor = adaptiveGridStep(camera.scale, 10);
  const major = majorGridStep(minor);

  const x0 = Math.max(0, Math.floor(viewport.x));
  const y0 = Math.max(0, Math.floor(viewport.y));
  const x1 = Math.min(canvasW, Math.ceil(viewport.x + viewport.w));
  const y1 = Math.min(canvasH, Math.ceil(viewport.y + viewport.h));

  const startX = Math.floor(x0 / minor) * minor;
  const startY = Math.floor(y0 / minor) * minor;

  // Derive a lighter minor from major color if rgba; else fade via globalAlpha
  const minorColor = gridColor.includes('rgba')
    ? gridColor.replace(/[\d.]+\)$/, (m) => {
        const a = Number.parseFloat(m);
        return `${Math.min(a * 0.45, 0.2)})`;
      })
    : gridColor;

  ctx.save();
  ctx.lineWidth = 1 / camera.scale;

  ctx.strokeStyle = minorColor;
  ctx.globalAlpha = gridColor.includes('rgba') ? 1 : 0.35;
  ctx.beginPath();
  for (let x = startX; x <= x1; x += minor) {
    if (x < 0 || x > canvasW) continue;
    if (x % major === 0) continue;
    ctx.moveTo(x + 0.5 / camera.scale, y0);
    ctx.lineTo(x + 0.5 / camera.scale, y1);
  }
  for (let y = startY; y <= y1; y += minor) {
    if (y < 0 || y > canvasH) continue;
    if (y % major === 0) continue;
    ctx.moveTo(x0, y + 0.5 / camera.scale);
    ctx.lineTo(x1, y + 0.5 / camera.scale);
  }
  ctx.stroke();

  ctx.strokeStyle = gridColor;
  ctx.globalAlpha = 1;
  ctx.beginPath();
  const majStartX = Math.floor(x0 / major) * major;
  const majStartY = Math.floor(y0 / major) * major;
  for (let x = majStartX; x <= x1; x += major) {
    if (x < 0 || x > canvasW) continue;
    ctx.moveTo(x + 0.5 / camera.scale, y0);
    ctx.lineTo(x + 0.5 / camera.scale, y1);
  }
  for (let y = majStartY; y <= y1; y += major) {
    if (y < 0 || y > canvasH) continue;
    ctx.moveTo(x0, y + 0.5 / camera.scale);
    ctx.lineTo(x1, y + 0.5 / camera.scale);
  }
  ctx.stroke();

  ctx.restore();
}
