/** Color quantization for palette download. */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export type PaletteProgress = (done: number, total: number, phase: string) => void;

function colorKey(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}

export function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve(), { timeout: 32 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/** Collect opaque unique colors with progress; reduce evenly by luminance; sort light → dark. */
export async function extractPaletteAsync(
  imageData: ImageData,
  maxColors = 128,
  alphaThreshold = 16,
  onProgress?: PaletteProgress,
): Promise<Rgb[]> {
  const max = Math.max(1, Math.min(128, Math.floor(maxColors)));
  const { data, width, height } = imageData;
  const totalPx = width * height;
  const counts = new Map<number, { rgb: Rgb; n: number }>();

  const chunk = Math.max(4096, Math.floor(totalPx / 40));
  for (let i = 0; i < totalPx; i++) {
    const o = i * 4;
    const a = data[o + 3]!;
    if (a >= alphaThreshold) {
      const r = data[o]!;
      const g = data[o + 1]!;
      const b = data[o + 2]!;
      const k = colorKey(r, g, b);
      const prev = counts.get(k);
      if (prev) prev.n++;
      else counts.set(k, { rgb: { r, g, b }, n: 1 });
    }
    if (i > 0 && i % chunk === 0) {
      onProgress?.(i, totalPx, 'scan');
      await yieldToMain();
    }
  }
  onProgress?.(totalPx, totalPx, 'scan');

  let list = [...counts.values()];
  if (list.length === 0) return [];

  list.sort((a, b) => luminance(a.rgb) - luminance(b.rgb));

  if (list.length > max) {
    onProgress?.(0, max, 'reduce');
    const reduced: Array<{ rgb: Rgb; n: number }> = [];
    for (let bucket = 0; bucket < max; bucket++) {
      const start = Math.floor((bucket * list.length) / max);
      const end = Math.floor(((bucket + 1) * list.length) / max);
      if (start >= end) continue;
      let best = list[start]!;
      for (let i = start + 1; i < end; i++) {
        const c = list[i]!;
        if (c.n > best.n) best = c;
      }
      reduced.push(best);
      if (bucket % 16 === 0) {
        onProgress?.(bucket + 1, max, 'reduce');
        await yieldToMain();
      }
    }
    list = reduced;
    onProgress?.(max, max, 'reduce');
  }

  // De-dupe identical picks from adjacent buckets, keep order by luminance
  const seen = new Set<number>();
  const out: Rgb[] = [];
  for (const item of list.sort((a, b) => luminance(a.rgb) - luminance(b.rgb))) {
    const k = colorKey(item.rgb.r, item.rgb.g, item.rgb.b);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item.rgb);
  }
  return out;
}

/** Sync helper (small images). Prefer extractPaletteAsync for UI. */
export function extractPalette(imageData: ImageData, maxColors = 128, alphaThreshold = 16): Rgb[] {
  const max = Math.max(1, Math.min(128, Math.floor(maxColors)));
  const counts = new Map<number, { rgb: Rgb; n: number }>();
  const { data, width, height } = imageData;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const a = data[o + 3]!;
    if (a < alphaThreshold) continue;
    const r = data[o]!;
    const g = data[o + 1]!;
    const b = data[o + 2]!;
    const k = colorKey(r, g, b);
    const prev = counts.get(k);
    if (prev) prev.n++;
    else counts.set(k, { rgb: { r, g, b }, n: 1 });
  }

  let list = [...counts.values()].sort((a, b) => luminance(a.rgb) - luminance(b.rgb));
  if (list.length === 0) return [];
  if (list.length > max) {
    const reduced: Array<{ rgb: Rgb; n: number }> = [];
    for (let bucket = 0; bucket < max; bucket++) {
      const start = Math.floor((bucket * list.length) / max);
      const end = Math.floor(((bucket + 1) * list.length) / max);
      if (start >= end) continue;
      let best = list[start]!;
      for (let i = start + 1; i < end; i++) {
        if (list[i]!.n > best.n) best = list[i]!;
      }
      reduced.push(best);
    }
    list = reduced;
  }

  const seen = new Set<number>();
  const out: Rgb[] = [];
  for (const item of list.sort((a, b) => luminance(a.rgb) - luminance(b.rgb))) {
    const k = colorKey(item.rgb.r, item.rgb.g, item.rgb.b);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item.rgb);
  }
  return out;
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function paletteToGpl(name: string, colors: Rgb[]): string {
  const lines = ['GIMP Palette', `Name: ${name}`, 'Columns: 8', '#'];
  for (const c of colors) {
    lines.push(`${c.r}\t${c.g}\t${c.b}\t${rgbToHex(c)}`);
  }
  return lines.join('\n') + '\n';
}

export function paletteToHexList(colors: Rgb[]): string {
  return colors.map(rgbToHex).join('\n') + '\n';
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** One pixel per color in a row, nearest-neighbor scaled for readability. */
export async function paletteToStripPng(colors: Rgb[], scale = 8): Promise<Blob> {
  if (colors.length === 0) throw new Error('No colors');
  const s = Math.max(1, Math.floor(scale));
  const src = document.createElement('canvas');
  src.width = colors.length;
  src.height = 1;
  const sctx = src.getContext('2d');
  if (!sctx) throw new Error('2d context unavailable');
  const img = sctx.createImageData(colors.length, 1);
  for (let i = 0; i < colors.length; i++) {
    const c = colors[i]!;
    const o = i * 4;
    img.data[o] = c.r;
    img.data[o + 1] = c.g;
    img.data[o + 2] = c.b;
    img.data[o + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);

  const out = document.createElement('canvas');
  out.width = colors.length * s;
  out.height = s;
  const octx = out.getContext('2d');
  if (!octx) throw new Error('2d context unavailable');
  octx.imageSmoothingEnabled = false;
  octx.drawImage(src, 0, 0, out.width, out.height);

  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG encode failed');
  return blob;
}
