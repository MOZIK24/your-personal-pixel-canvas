import type { CanvasMeta, PieceMeta, PieceRecord } from '../types';
import { DEFAULT_CANVAS } from '../types';
import * as db from '../db/indexedDb';
import { GridIndex } from '../spatial/gridIndex';

export type StoreListener = () => void;

export class ProjectStore {
  canvas: CanvasMeta = { ...DEFAULT_CANVAS };
  readonly index = new GridIndex(512);
  /** Immutable asset blobs keyed by assetId */
  private readonly assets = new Map<string, Blob>();
  private readonly listeners = new Set<StoreListener>();
  selectedId: string | null = null;
  dirty = false;

  subscribe(fn: StoreListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  async hydrate(): Promise<void> {
    this.canvas = await db.loadCanvasMeta();
    const pieces = await db.loadAllPieces();
    this.index.clear();
    this.assets.clear();
    for (const p of pieces) {
      const assetId = p.assetId || p.id;
      this.assets.set(assetId, p.imageBlob);
      this.index.upsert({ ...p, assetId });
    }
    this.dirty = false;
    this.emit();
  }

  /** Empty working copy (IndexedDB + memory). */
  async clearWorkingCopy(title = 'Untitled Canvas'): Promise<void> {
    await db.clearAllPieces();
    this.canvas = { ...DEFAULT_CANVAS, title };
    await db.saveCanvasMeta(this.canvas);
    this.index.clear();
    this.assets.clear();
    this.selectedId = null;
    this.dirty = false;
    this.emit();
  }

  async replaceAll(
    canvas: CanvasMeta,
    pieces: PieceRecord[],
    extraAssets?: Map<string, Blob>,
  ): Promise<void> {
    await db.clearAllPieces();
    this.canvas = canvas;
    await db.saveCanvasMeta(canvas);
    this.index.clear();
    this.assets.clear();
    this.selectedId = null;
    if (extraAssets) {
      for (const [id, blob] of extraAssets) this.assets.set(id, blob);
    }
    for (const p of pieces) {
      const assetId = p.assetId || p.id;
      const record: PieceRecord = { ...p, assetId };
      await db.putPiece(record);
      this.assets.set(assetId, p.imageBlob);
      this.index.upsert(record);
    }
    this.dirty = false;
    this.emit();
  }

  /** Blob for a piece (resolves via assetId). */
  getBlob(pieceId: string): Blob | undefined {
    const meta = this.index.get(pieceId);
    if (!meta) return undefined;
    return this.assets.get(meta.assetId);
  }

  getAssetBlob(assetId: string): Blob | undefined {
    return this.assets.get(assetId);
  }

  cacheKey(pieceId: string): string | null {
    const meta = this.index.get(pieceId);
    return meta ? meta.assetId : null;
  }

  async setCanvasSize(width: number, height: number): Promise<void> {
    this.canvas = {
      ...this.canvas,
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height)),
    };
    await db.saveCanvasMeta(this.canvas);
    this.dirty = true;
    this.emit();
  }

  async setTitle(title: string): Promise<void> {
    this.canvas = { ...this.canvas, title };
    await db.saveCanvasMeta(this.canvas);
    this.dirty = true;
    this.emit();
  }

  async addPieceFromFile(file: File, x: number, y: number): Promise<string> {
    const bitmap = await createImageBitmap(file);
    const w = bitmap.width;
    const h = bitmap.height;
    bitmap.close();

    const pieceId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    const zIndex = (this.index.all().at(-1)?.zIndex ?? 0) + 1;
    const blob = file.type ? file.slice(0, file.size, file.type || 'image/png') : file;
    const record: PieceRecord = {
      id: pieceId,
      assetId,
      x: Math.round(x),
      y: Math.round(y),
      w,
      h,
      zIndex,
      updatedAt: Date.now(),
      imageBlob: blob,
    };
    await db.putPiece(record);
    this.assets.set(assetId, blob);
    this.index.upsert(record);
    this.selectedId = pieceId;
    this.dirty = true;
    this.emit();
    return pieceId;
  }

  /**
   * Replace image of an existing object. Position/z stay the same.
   * Old assetId is kept on disk for older saves; current piece points to a new asset.
   */
  async replacePieceAsset(pieceId: string, file: File): Promise<string> {
    const meta = this.index.get(pieceId);
    if (!meta) throw new Error('Piece not selected');

    const bitmap = await createImageBitmap(file);
    const w = bitmap.width;
    const h = bitmap.height;
    bitmap.close();

    const newAssetId = crypto.randomUUID();
    const blob = file.type ? file.slice(0, file.size, file.type || 'image/png') : file;
    const record: PieceRecord = {
      ...meta,
      assetId: newAssetId,
      w,
      h,
      frameAssetIds: undefined,
      frameDurations: undefined,
      frameCount: 1,
      updatedAt: Date.now(),
      imageBlob: blob,
    };
    await db.putPiece(record);
    this.assets.set(newAssetId, blob);
    this.index.upsert(record);
    this.dirty = true;
    this.emit();
    return newAssetId;
  }

  async updatePieceTransform(
    id: string,
    patch: Partial<Pick<PieceRecord, 'x' | 'y' | 'zIndex'>>,
  ): Promise<void> {
    const meta = this.index.get(id);
    const blob = meta ? this.assets.get(meta.assetId) : undefined;
    if (!meta || !blob) return;
    const next: PieceRecord = {
      ...meta,
      ...patch,
      x: patch.x !== undefined ? Math.round(patch.x) : meta.x,
      y: patch.y !== undefined ? Math.round(patch.y) : meta.y,
      updatedAt: Date.now(),
      imageBlob: blob,
    };
    await db.putPiece(next);
    this.index.upsert(next);
    this.dirty = true;
    this.emit();
  }

  /**
   * Remove piece from working copy. Optionally drop orphan asset blobs from memory
   * when `orphanAssetIds` is provided (caller decides after scanning saves).
   */
  async removePiece(id: string, orphanAssetIds?: string[]): Promise<string[]> {
    const meta = this.index.get(id);
    const candidateIds = meta ? this.allAssetIdsFor(meta) : [];
    await db.deletePiece(id);
    this.index.remove(id);
    if (this.selectedId === id) this.selectedId = null;

    const stillUsed = new Set(this.assetIdsInUse());
    const orphans: string[] = [];
    const toCheck = orphanAssetIds ?? candidateIds;
    for (const aid of toCheck) {
      if (stillUsed.has(aid)) continue;
      this.assets.delete(aid);
      orphans.push(aid);
    }

    this.dirty = true;
    this.emit();
    return orphans;
  }

  /** Drop asset blobs from memory that are no longer referenced by any piece. */
  dropUnusedAssets(extraKeep?: Iterable<string>): string[] {
    const keep = new Set(this.assetIdsInUse());
    if (extraKeep) for (const id of extraKeep) keep.add(id);
    const dropped: string[] = [];
    for (const id of [...this.assets.keys()]) {
      if (keep.has(id)) continue;
      this.assets.delete(id);
      dropped.push(id);
    }
    return dropped;
  }

  async setPieceLayer(id: string, zIndex: number): Promise<void> {
    await this.updatePieceTransform(id, { zIndex: Math.round(zIndex) });
  }

  async bringToFront(id: string): Promise<void> {
    const all = this.index.all();
    const maxZ = all.reduce((m, p) => Math.max(m, p.zIndex), 0);
    await this.updatePieceTransform(id, { zIndex: maxZ + 1 });
  }

  async sendToBack(id: string): Promise<void> {
    const all = this.index.all();
    const minZ = all.reduce((m, p) => Math.min(m, p.zIndex), 0);
    await this.updatePieceTransform(id, { zIndex: minZ - 1 });
  }

  async bringForward(id: string): Promise<void> {
    const all = this.index.all();
    const idx = all.findIndex((p) => p.id === id);
    if (idx < 0 || idx >= all.length - 1) return;
    const a = all[idx]!;
    const b = all[idx + 1]!;
    await this.updatePieceTransform(a.id, { zIndex: b.zIndex });
    await this.updatePieceTransform(b.id, { zIndex: a.zIndex });
  }

  async sendBackward(id: string): Promise<void> {
    const all = this.index.all();
    const idx = all.findIndex((p) => p.id === id);
    if (idx <= 0) return;
    const a = all[idx]!;
    const b = all[idx - 1]!;
    await this.updatePieceTransform(a.id, { zIndex: b.zIndex });
    await this.updatePieceTransform(b.id, { zIndex: a.zIndex });
  }

  async setComment(id: string, comment: string): Promise<void> {
    const meta = this.index.get(id);
    const blob = meta ? this.assets.get(meta.assetId) : undefined;
    if (!meta || !blob) return;
    const next: PieceRecord = {
      ...meta,
      comment,
      updatedAt: Date.now(),
      imageBlob: blob,
    };
    await db.putPiece(next);
    this.index.upsert(next);
    this.dirty = true;
    this.emit();
  }

  async setOpacity(id: string, opacity: number): Promise<void> {
    const meta = this.index.get(id);
    const blob = meta ? this.assets.get(meta.assetId) : undefined;
    if (!meta || !blob) return;
    const next: PieceRecord = {
      ...meta,
      opacity: Math.min(1, Math.max(0, opacity)),
      updatedAt: Date.now(),
      imageBlob: blob,
    };
    await db.putPiece(next);
    this.index.upsert(next);
    this.dirty = true;
    this.emit();
  }

  /** Animated piece: frame 0 = assetId, rest in frameAssetIds. */
  async addAnimatedPiece(
    frames: Array<{ blob: Blob; durationMs: number; width: number; height: number }>,
    x: number,
    y: number,
  ): Promise<string> {
    if (frames.length === 0) throw new Error('No frames');
    const first = frames[0]!;
    const pieceId = crypto.randomUUID();
    const assetIds: string[] = [];
    const durations: number[] = [];
    for (const f of frames) {
      const id = crypto.randomUUID();
      this.assets.set(id, f.blob);
      assetIds.push(id);
      durations.push(Math.max(1, f.durationMs));
    }
    const zIndex = (this.index.all().at(-1)?.zIndex ?? 0) + 1;
    const record: PieceRecord = {
      id: pieceId,
      assetId: assetIds[0]!,
      frameAssetIds: assetIds.length > 1 ? assetIds.slice(1) : undefined,
      frameDurations: durations,
      frameCount: frames.length,
      x: Math.round(x),
      y: Math.round(y),
      w: first.width,
      h: first.height,
      zIndex,
      updatedAt: Date.now(),
      imageBlob: first.blob,
    };
    await db.putPiece(record);
    this.index.upsert(record);
    this.selectedId = pieceId;
    this.dirty = true;
    this.emit();
    return pieceId;
  }

  allAssetIdsFor(piece: PieceMeta): string[] {
    return [piece.assetId, ...(piece.frameAssetIds ?? [])];
  }

  /** Which asset to draw at time t (ms). */
  activeAssetId(piece: PieceMeta, nowMs: number): string {
    const ids = this.allAssetIdsFor(piece);
    if (ids.length <= 1) return piece.assetId;
    const durs = piece.frameDurations ?? ids.map(() => 100);
    const total = durs.reduce((a, b) => a + b, 0) || 1;
    let t = nowMs % total;
    for (let i = 0; i < ids.length; i++) {
      t -= durs[i] ?? 100;
      if (t < 0) return ids[i]!;
    }
    return ids[ids.length - 1]!;
  }

  select(id: string | null): void {
    this.selectedId = id;
    this.emit();
  }

  /** All unique asset ids currently on the canvas (including anim frames). */
  assetIdsInUse(): string[] {
    const set = new Set<string>();
    for (const p of this.index.all()) {
      for (const id of this.allAssetIdsFor(p)) set.add(id);
    }
    return [...set];
  }
}

export type { PieceMeta };
