import type { Camera, Viewport } from '../types';

export function createCamera(): Camera {
  return { x: 0, y: 0, scale: 1 };
}

/** World-space viewport covered by the screen, with optional margin in world px. */
export function cameraViewport(
  camera: Camera,
  screenW: number,
  screenH: number,
  marginWorld = 0,
): Viewport {
  const w = screenW / camera.scale;
  const h = screenH / camera.scale;
  return {
    x: -camera.x / camera.scale - marginWorld,
    y: -camera.y / camera.scale - marginWorld,
    w: w + marginWorld * 2,
    h: h + marginWorld * 2,
  };
}

export function screenToWorld(camera: Camera, sx: number, sy: number): { x: number; y: number } {
  return {
    x: (sx - camera.x) / camera.scale,
    y: (sy - camera.y) / camera.scale,
  };
}

export function zoomAt(camera: Camera, factor: number, sx: number, sy: number, min = 0.01, max = 64): void {
  const old = camera.scale;
  const next = Math.min(max, Math.max(min, old * factor));
  if (next === old) return;
  camera.x = sx - ((sx - camera.x) * next) / old;
  camera.y = sy - ((sy - camera.y) * next) / old;
  camera.scale = next;
}

export function fitCamera(
  camera: Camera,
  canvasW: number,
  canvasH: number,
  screenW: number,
  screenH: number,
  padding = 0.9,
): void {
  const sx = (screenW / canvasW) * padding;
  const sy = (screenH / canvasH) * padding;
  camera.scale = Math.min(sx, sy);
  camera.x = (screenW - canvasW * camera.scale) / 2;
  camera.y = (screenH - canvasH * camera.scale) / 2;
}
