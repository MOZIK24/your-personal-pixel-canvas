/** LRU bitmap cache — never keyed by full-canvas buffers. */

export class ImageCache {
  private readonly maxEntries: number;
  private readonly map = new Map<string, HTMLImageElement | HTMLCanvasElement>();
  private readonly inflight = new Map<string, Promise<HTMLImageElement>>();

  constructor(maxEntries = 256) {
    this.maxEntries = maxEntries;
  }

  get(id: string): HTMLImageElement | HTMLCanvasElement | undefined {
    const value = this.map.get(id);
    if (!value) return undefined;
    // refresh LRU order
    this.map.delete(id);
    this.map.set(id, value);
    return value;
  }

  set(id: string, image: HTMLImageElement | HTMLCanvasElement): void {
    if (this.map.has(id)) this.map.delete(id);
    this.map.set(id, image);
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  delete(id: string): void {
    this.map.delete(id);
    this.inflight.delete(id);
  }

  clear(): void {
    this.map.clear();
    this.inflight.clear();
  }

  async loadBlob(id: string, blob: Blob): Promise<HTMLImageElement> {
    const cached = this.get(id);
    if (cached instanceof HTMLImageElement) return cached;

    const existing = this.inflight.get(id);
    if (existing) return existing;

    const promise = (async () => {
      const url = URL.createObjectURL(blob);
      try {
        const img = await loadImage(url);
        this.set(id, img);
        return img;
      } finally {
        URL.revokeObjectURL(url);
        this.inflight.delete(id);
      }
    })();

    this.inflight.set(id, promise);
    return promise;
  }

  /** Downscaled LOD bitmap for distant zoom. */
  async getLod(
    id: string,
    source: HTMLImageElement | HTMLCanvasElement,
    maxEdge: number,
  ): Promise<HTMLCanvasElement> {
    const key = `${id}@lod${maxEdge}`;
    const cached = this.get(key);
    if (cached instanceof HTMLCanvasElement) return cached;

    const sw = source.width;
    const sh = source.height;
    const scale = Math.min(1, maxEdge / Math.max(sw, sh));
    const tw = Math.max(1, Math.round(sw * scale));
    const th = Math.max(1, Math.round(sh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, 0, 0, tw, th);
    this.set(key, canvas);
    return canvas;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image'));
    img.src = url;
  });
}
