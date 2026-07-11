/** Extract ImageData and draw opaque-pixel silhouette outline. */

const outlineCache = new Map<string, HTMLCanvasElement>();

export function clearOutlineCache(assetId?: string): void {
  if (assetId) outlineCache.delete(assetId);
  else outlineCache.clear();
}

export async function getImageDataFromSource(
  source: CanvasImageSource,
  w: number,
  h: number,
): Promise<ImageData> {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2d unavailable');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0);
  return ctx.getImageData(0, 0, w, h);
}

function isOpaque(data: Uint8ClampedArray, w: number, h: number, x: number, y: number, threshold = 8): boolean {
  if (x < 0 || y < 0 || x >= w || y >= h) return false;
  return data[(y * w + x) * 4 + 3]! > threshold;
}

/** Build a canvas with only the outline strokes around opaque pixels. */
export function buildPixelOutlineCanvas(imageData: ImageData, color = '#c45c26'): HTMLCanvasElement {
  const { width: w, height: h, data } = imageData;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  if (!ctx) return out;
  const img = ctx.createImageData(w, h);
  const od = img.data;
  const [cr, cg, cb] = hexToRgb(color);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isOpaque(data, w, h, x, y)) continue;
      const edge =
        !isOpaque(data, w, h, x - 1, y) ||
        !isOpaque(data, w, h, x + 1, y) ||
        !isOpaque(data, w, h, x, y - 1) ||
        !isOpaque(data, w, h, x, y + 1);
      if (!edge) continue;
      const i = (y * w + x) * 4;
      od[i] = cr;
      od[i + 1] = cg;
      od[i + 2] = cb;
      od[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

export async function getCachedOutline(
  assetId: string,
  source: CanvasImageSource,
  w: number,
  h: number,
): Promise<HTMLCanvasElement> {
  const cached = outlineCache.get(assetId);
  if (cached) return cached;
  const imageData = await getImageDataFromSource(source, w, h);
  const outline = buildPixelOutlineCanvas(imageData);
  outlineCache.set(assetId, outline);
  return outline;
}

export function peekOutline(assetId: string): HTMLCanvasElement | undefined {
  return outlineCache.get(assetId);
}

export function sampleAlpha(
  imageData: ImageData,
  localX: number,
  localY: number,
  threshold = 8,
): boolean {
  const x = Math.floor(localX);
  const y = Math.floor(localY);
  if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) return false;
  return imageData.data[(y * imageData.width + x) * 4 + 3]! > threshold;
}

export function sampleColor(
  imageData: ImageData,
  localX: number,
  localY: number,
): { r: number; g: number; b: number; a: number } | null {
  const x = Math.floor(localX);
  const y = Math.floor(localY);
  if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) return null;
  const i = (y * imageData.width + x) * 4;
  return {
    r: imageData.data[i]!,
    g: imageData.data[i + 1]!,
    b: imageData.data[i + 2]!,
    a: imageData.data[i + 3]!,
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
