import { Buffer } from 'buffer';
import Aseprite from 'ase-parser';

export interface AseFrame {
  blob: Blob;
  durationMs: number;
  width: number;
  height: number;
}

function compositeFrame(
  width: number,
  height: number,
  cels: Array<{ xpos: number; ypos: number; w: number; h: number; rawCelData?: Buffer; layerIndex: number }>,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const sorted = [...cels].sort((a, b) => a.layerIndex - b.layerIndex);
  for (const cel of sorted) {
    if (!cel.rawCelData) continue;
    for (let y = 0; y < cel.h; y++) {
      for (let x = 0; x < cel.w; x++) {
        const si = (y * cel.w + x) * 4;
        const a = cel.rawCelData[si + 3]!;
        if (a === 0) continue;
        const dx = cel.xpos + x;
        const dy = cel.ypos + y;
        if (dx < 0 || dy < 0 || dx >= width || dy >= height) continue;
        const di = (dy * width + dx) * 4;
        out[di] = cel.rawCelData[si]!;
        out[di + 1] = cel.rawCelData[si + 1]!;
        out[di + 2] = cel.rawCelData[si + 2]!;
        out[di + 3] = a;
      }
    }
  }
  return out;
}

async function imageDataToPngBlob(data: Uint8ClampedArray, w: number, h: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d unavailable');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png');
  });
}

/** Parse .ase / .aseprite into PNG frame blobs. */
export async function parseAsepriteFile(file: File): Promise<AseFrame[]> {
  const ab = await file.arrayBuffer();
  const buffer = Buffer.from(ab);
  const ase = new Aseprite(buffer, file.name);
  ase.parse();
  if (!ase.frames?.length) throw new Error('No frames in Aseprite file');

  const width = ase.width as number;
  const height = ase.height as number;
  const frames: AseFrame[] = [];

  for (const frame of ase.frames as Array<{
    cels: Array<{ xpos: number; ypos: number; w: number; h: number; rawCelData?: Buffer; layerIndex: number }>;
    frameDuration?: number;
  }>) {
    const pixels = compositeFrame(width, height, frame.cels || []);
    const blob = await imageDataToPngBlob(pixels, width, height);
    frames.push({
      blob,
      durationMs: Math.max(1, frame.frameDuration ?? 100),
      width,
      height,
    });
  }
  return frames;
}

export function isAsepriteFile(file: File): boolean {
  const n = file.name.toLowerCase();
  return n.endsWith('.ase') || n.endsWith('.aseprite');
}
