import type { PieceMeta, Viewport } from '../types';

/** Uniform grid spatial index — O(cells touched) queries, never O(canvas area). */
export class GridIndex {
  private readonly cellSize: number;
  private readonly cells = new Map<string, Set<string>>();
  private readonly pieces = new Map<string, PieceMeta>();

  constructor(cellSize = 512) {
    this.cellSize = cellSize;
  }

  clear(): void {
    this.cells.clear();
    this.pieces.clear();
  }

  upsert(piece: PieceMeta): void {
    this.remove(piece.id);
    this.pieces.set(piece.id, piece);
    for (const key of this.keysForRect(piece.x, piece.y, piece.w, piece.h)) {
      let set = this.cells.get(key);
      if (!set) {
        set = new Set();
        this.cells.set(key, set);
      }
      set.add(piece.id);
    }
  }

  remove(id: string): void {
    const existing = this.pieces.get(id);
    if (!existing) return;
    for (const key of this.keysForRect(existing.x, existing.y, existing.w, existing.h)) {
      const set = this.cells.get(key);
      if (!set) continue;
      set.delete(id);
      if (set.size === 0) this.cells.delete(key);
    }
    this.pieces.delete(id);
  }

  query(viewport: Viewport): PieceMeta[] {
    const ids = new Set<string>();
    for (const key of this.keysForRect(viewport.x, viewport.y, viewport.w, viewport.h)) {
      const set = this.cells.get(key);
      if (!set) continue;
      for (const id of set) ids.add(id);
    }
    const out: PieceMeta[] = [];
    for (const id of ids) {
      const p = this.pieces.get(id);
      if (!p) continue;
      if (rectsOverlap(p.x, p.y, p.w, p.h, viewport.x, viewport.y, viewport.w, viewport.h)) {
        out.push(p);
      }
    }
    out.sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));
    return out;
  }

  /** Neighbors near a rect for snap (expanded search box). */
  neighborsNear(x: number, y: number, w: number, h: number, margin: number, excludeId?: string): PieceMeta[] {
    return this.query({
      x: x - margin,
      y: y - margin,
      w: w + margin * 2,
      h: h + margin * 2,
    }).filter((p) => p.id !== excludeId);
  }

  all(): PieceMeta[] {
    return [...this.pieces.values()].sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));
  }

  get(id: string): PieceMeta | undefined {
    return this.pieces.get(id);
  }

  get size(): number {
    return this.pieces.size;
  }

  private keysForRect(x: number, y: number, w: number, h: number): string[] {
    const cs = this.cellSize;
    const x0 = Math.floor(x / cs);
    const y0 = Math.floor(y / cs);
    const x1 = Math.floor((x + Math.max(w - 1, 0)) / cs);
    const y1 = Math.floor((y + Math.max(h - 1, 0)) / cs);
    const keys: string[] = [];
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        keys.push(`${cx}:${cy}`);
      }
    }
    return keys;
  }
}

function rectsOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}
