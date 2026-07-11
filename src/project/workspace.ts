import type {
  CanvasMeta,
  PieceMeta,
  PieceRecord,
  ProjectFile,
  SaveListItem,
  SceneFile,
  ScenePiece,
} from '../types';
import { PROJECT_VERSION } from '../types';
import * as db from '../db/indexedDb';

type DirHandle = FileSystemDirectoryHandle;

function assertFs(): void {
  if (!('showDirectoryPicker' in window)) {
    throw new Error('File System Access API unavailable. Use Chrome or Edge.');
  }
}

async function writeFile(dir: DirHandle, name: string, data: Blob | string): Promise<void> {
  const fh = await dir.getFileHandle(name, { create: true });
  const writable = await fh.createWritable();
  await writable.write(data);
  await writable.close();
}

async function readText(dir: DirHandle, name: string): Promise<string> {
  const fh = await dir.getFileHandle(name);
  const file = await fh.getFile();
  return file.text();
}

async function fileExists(dir: DirHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

async function ensurePermission(handle: DirHandle, mode: 'read' | 'readwrite' = 'readwrite'): Promise<boolean> {
  const withPerm = handle as DirHandle & {
    queryPermission?: (opts: { mode: string }) => Promise<PermissionState>;
    requestPermission?: (opts: { mode: string }) => Promise<PermissionState>;
  };
  if (withPerm.queryPermission) {
    let state = await withPerm.queryPermission({ mode });
    if (state === 'granted') return true;
    if (withPerm.requestPermission) {
      state = await withPerm.requestPermission({ mode });
      return state === 'granted';
    }
    return false;
  }
  return true;
}

/** Read project title from a folder handle without linking (Gate label). */
export async function peekProjectTitle(
  handle: FileSystemDirectoryHandle,
  requestIfNeeded = false,
): Promise<string | null> {
  const withPerm = handle as FileSystemDirectoryHandle & {
    queryPermission?: (opts: { mode: string }) => Promise<PermissionState>;
    requestPermission?: (opts: { mode: string }) => Promise<PermissionState>;
  };
  if (withPerm.queryPermission) {
    let state = await withPerm.queryPermission({ mode: 'read' });
    if (state !== 'granted') {
      if (!requestIfNeeded || !withPerm.requestPermission) return null;
      state = await withPerm.requestPermission({ mode: 'read' });
      if (state !== 'granted') return null;
    }
  }
  try {
    const fh = await handle.getFileHandle('project.json');
    const text = await (await fh.getFile()).text();
    const project = JSON.parse(text) as ProjectFile;
    const title = typeof project.title === 'string' ? project.title.trim() : '';
    return title || null;
  } catch {
    return null;
  }
}

export function formatSaveId(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`
  );
}

export class ProjectWorkspace {
  root: DirHandle | null = null;
  currentSaveId: string | null = null;
  folderName = '';

  get linked(): boolean {
    return this.root !== null;
  }

  async restoreSavedHandle(): Promise<boolean> {
    const handle = await db.loadDirectoryHandle();
    if (!handle) return false;
    const ok = await ensurePermission(handle, 'readwrite');
    if (!ok) return false;
    this.root = handle;
    this.folderName = handle.name;
    try {
      const project = await this.readProjectFile();
      this.currentSaveId = project.currentSaveId;
    } catch {
      this.currentSaveId = null;
    }
    return true;
  }

  async pickAndLinkFolder(): Promise<void> {
    assertFs();
    const anyWindow = window as unknown as {
      showDirectoryPicker: (opts?: { mode?: string }) => Promise<DirHandle>;
    };
    const handle = await anyWindow.showDirectoryPicker({ mode: 'readwrite' });
    await db.saveDirectoryHandle(handle);
    this.root = handle;
    this.folderName = handle.name;
    await handle.getDirectoryHandle('assets', { create: true });
    await handle.getDirectoryHandle('saves', { create: true });
    if (!(await fileExists(handle, 'project.json'))) {
      await this.writeProjectFile({
        version: PROJECT_VERSION,
        currentSaveId: null,
        title: 'Untitled Canvas',
      });
      this.currentSaveId = null;
    } else {
      const project = await this.readProjectFile();
      this.currentSaveId = project.currentSaveId;
    }
  }

  async unlinkFolder(): Promise<void> {
    await db.clearDirectoryHandle();
    this.root = null;
    this.folderName = '';
    this.currentSaveId = null;
  }

  private requireRoot(): DirHandle {
    if (!this.root) throw new Error('Project folder not linked. Click "Link folder" first.');
    return this.root;
  }

  async readProjectFile(): Promise<ProjectFile> {
    const root = this.requireRoot();
    const text = await readText(root, 'project.json');
    return JSON.parse(text) as ProjectFile;
  }

  async writeProjectFile(project: ProjectFile): Promise<void> {
    const root = this.requireRoot();
    await writeFile(root, 'project.json', JSON.stringify(project, null, 2));
  }

  /** Author-facing project name (not the folder name). */
  async getProjectTitle(): Promise<string | null> {
    try {
      const project = await this.readProjectFile();
      const title = typeof project.title === 'string' ? project.title.trim() : '';
      return title || null;
    } catch {
      return null;
    }
  }

  async updateProjectTitle(title: string): Promise<void> {
    const root = this.requireRoot();
    let current: ProjectFile = {
      version: PROJECT_VERSION,
      currentSaveId: this.currentSaveId,
      title,
    };
    try {
      current = await this.readProjectFile();
    } catch {
      /* new / missing project.json */
    }
    await writeFile(
      root,
      'project.json',
      JSON.stringify(
        {
          version: PROJECT_VERSION,
          currentSaveId: current.currentSaveId ?? this.currentSaveId,
          title,
        },
        null,
        2,
      ),
    );
  }

  async readStyleFile(): Promise<unknown | null> {
    if (!this.root) return null;
    try {
      const text = await readText(this.root, 'style.json');
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }

  async writeStyleFile(json: string): Promise<void> {
    const root = this.requireRoot();
    await writeFile(root, 'style.json', json);
  }

  /** Write asset only if missing — never overwrite (immutable assets). */
  async ensureAssetWritten(assetId: string, blob: Blob): Promise<void> {
    const root = this.requireRoot();
    const assets = await root.getDirectoryHandle('assets', { create: true });
    const name = `${assetId}.png`;
    if (await fileExists(assets, name)) return;
    await writeFile(assets, name, blob);
  }

  async readAssetBlob(assetId: string): Promise<Blob> {
    const root = this.requireRoot();
    const assets = await root.getDirectoryHandle('assets');
    const fh = await assets.getFileHandle(`${assetId}.png`);
    return fh.getFile();
  }

  async saveVersion(
    canvas: CanvasMeta,
    pieces: PieceMeta[],
    getAssetBlob: (assetId: string) => Blob | undefined,
  ): Promise<SaveListItem> {
    const root = this.requireRoot();
    const assetsDir = await root.getDirectoryHandle('assets', { create: true });
    const savesDir = await root.getDirectoryHandle('saves', { create: true });

    // Ensure every referenced asset exists once (including animation frames)
    for (const p of pieces) {
      const ids = [p.assetId, ...(p.frameAssetIds ?? [])];
      for (const assetId of ids) {
        const blob = getAssetBlob(assetId);
        if (!blob) throw new Error(`Missing asset blob for ${assetId}`);
        const name = `${assetId}.png`;
        if (!(await fileExists(assetsDir, name))) {
          await writeFile(assetsDir, name, blob);
        }
      }
    }

    let id = formatSaveId();
    // Avoid collision if saving twice in the same second
    if (await fileExists(savesDir, id)) {
      id = `${id}_${Math.random().toString(36).slice(2, 6)}`;
    }

    const saveDir = await savesDir.getDirectoryHandle(id, { create: true });
    const scene: SceneFile = {
      version: PROJECT_VERSION,
      id,
      createdAt: new Date().toISOString(),
      canvas: { ...canvas, version: PROJECT_VERSION },
      pieces: pieces.map(
        (p): ScenePiece => ({
          id: p.id,
          assetId: p.assetId,
          x: p.x,
          y: p.y,
          w: p.w,
          h: p.h,
          zIndex: p.zIndex,
          updatedAt: p.updatedAt,
          comment: p.comment,
          opacity: p.opacity,
          frameAssetIds: p.frameAssetIds,
          frameDurations: p.frameDurations,
          frameCount: p.frameCount,
        }),
      ),
    };
    await writeFile(saveDir, 'scene.json', JSON.stringify(scene, null, 2));

    await this.writeProjectFile({
      version: PROJECT_VERSION,
      currentSaveId: id,
      title: canvas.title,
    });
    this.currentSaveId = id;

    return {
      id,
      createdAt: scene.createdAt,
      pieceCount: scene.pieces.length,
      title: canvas.title,
    };
  }

  async listSaves(): Promise<SaveListItem[]> {
    const root = this.requireRoot();
    const savesDir = await root.getDirectoryHandle('saves', { create: true });
    const items: SaveListItem[] = [];

    const dir = savesDir as DirHandle & {
      entries: () => AsyncIterableIterator<[string, FileSystemHandle]>;
    };

    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'directory') continue;
      try {
        const saveDir = handle as DirHandle;
        const text = await readText(saveDir, 'scene.json');
        const scene = JSON.parse(text) as SceneFile;
        items.push({
          id: scene.id || name,
          createdAt: scene.createdAt || '',
          pieceCount: scene.pieces?.length ?? 0,
          title: scene.canvas?.title ?? '',
        });
      } catch {
        items.push({ id: name, createdAt: '', pieceCount: 0, title: '' });
      }
    }

    items.sort((a, b) => b.id.localeCompare(a.id));
    return items;
  }

  async loadSave(saveId: string): Promise<{
    canvas: CanvasMeta;
    pieces: PieceRecord[];
    extraAssets: Map<string, Blob>;
  }> {
    const data = await this.readSaveData(saveId);
    let title = data.canvas.title;
    try {
      const prev = await this.readProjectFile();
      if (prev.title?.trim()) title = prev.title.trim();
    } catch {
      /* keep scene title */
    }
    await this.writeProjectFile({
      version: PROJECT_VERSION,
      currentSaveId: saveId,
      title,
    });
    this.currentSaveId = saveId;
    return {
      ...data,
      canvas: { ...data.canvas, title },
    };
  }

  /** Read a save without changing currentSaveId. */
  async readSaveData(saveId: string): Promise<{
    canvas: CanvasMeta;
    pieces: PieceRecord[];
    extraAssets: Map<string, Blob>;
  }> {
    const root = this.requireRoot();
    const savesDir = await root.getDirectoryHandle('saves');
    const saveDir = await savesDir.getDirectoryHandle(saveId);
    const text = await readText(saveDir, 'scene.json');
    const scene = JSON.parse(text) as SceneFile;

    const extraAssets = new Map<string, Blob>();
    const pieces: PieceRecord[] = [];
    for (const p of scene.pieces) {
      const blob = await this.readAssetBlob(p.assetId);
      for (const fid of p.frameAssetIds ?? []) {
        if (!extraAssets.has(fid)) {
          extraAssets.set(fid, await this.readAssetBlob(fid));
        }
      }
      pieces.push({
        id: p.id,
        assetId: p.assetId,
        x: p.x,
        y: p.y,
        w: p.w,
        h: p.h,
        zIndex: p.zIndex,
        updatedAt: p.updatedAt,
        comment: p.comment,
        opacity: p.opacity,
        frameAssetIds: p.frameAssetIds,
        frameDurations: p.frameDurations,
        frameCount: p.frameCount,
        imageBlob: blob,
      });
    }
    return { canvas: scene.canvas, pieces, extraAssets };
  }

  /** Collect every asset id referenced by any save on disk. */
  async collectReferencedAssetIds(): Promise<Set<string>> {
    const root = this.requireRoot();
    const used = new Set<string>();
    const savesDir = await root.getDirectoryHandle('saves', { create: true });
    const dir = savesDir as DirHandle & {
      entries: () => AsyncIterableIterator<[string, FileSystemHandle]>;
    };
    for await (const [, handle] of dir.entries()) {
      if (handle.kind !== 'directory') continue;
      try {
        const text = await readText(handle as DirHandle, 'scene.json');
        const scene = JSON.parse(text) as SceneFile;
        for (const p of scene.pieces ?? []) {
          used.add(p.assetId);
          for (const fid of p.frameAssetIds ?? []) used.add(fid);
        }
      } catch {
        /* skip broken save */
      }
    }
    return used;
  }

  /** Delete asset file from assets/ if present. */
  async deleteAssetFile(assetId: string): Promise<boolean> {
    const root = this.requireRoot();
    try {
      const assets = await root.getDirectoryHandle('assets');
      await assets.removeEntry(`${assetId}.png`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Drop asset files that are not referenced by any save and not in `keep`.
   * Returns list of deleted asset ids.
   */
  async garbageCollectAssets(keep: Iterable<string>): Promise<string[]> {
    const keepSet = new Set(keep);
    const referenced = await this.collectReferencedAssetIds();
    for (const id of referenced) keepSet.add(id);

    const root = this.requireRoot();
    const assets = await root.getDirectoryHandle('assets', { create: true });
    const dir = assets as DirHandle & {
      entries: () => AsyncIterableIterator<[string, FileSystemHandle]>;
    };
    const deleted: string[] = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'file' || !name.endsWith('.png')) continue;
      const id = name.slice(0, -4);
      if (keepSet.has(id)) continue;
      try {
        await assets.removeEntry(name);
        deleted.push(id);
      } catch {
        /* ignore */
      }
    }
    return deleted;
  }

  /** Diff current in-memory scene vs another save (for UI hints). */
  async diffAgainstSave(
    saveId: string,
    current: PieceMeta[],
  ): Promise<{ added: number; removed: number; moved: number; replaced: number }> {
    const root = this.requireRoot();
    const savesDir = await root.getDirectoryHandle('saves');
    const saveDir = await savesDir.getDirectoryHandle(saveId);
    const text = await readText(saveDir, 'scene.json');
    const scene = JSON.parse(text) as SceneFile;
    const prev = new Map(scene.pieces.map((p) => [p.id, p]));
    const curr = new Map(current.map((p) => [p.id, p]));

    let added = 0;
    let removed = 0;
    let moved = 0;
    let replaced = 0;

    for (const [id, p] of curr) {
      const o = prev.get(id);
      if (!o) {
        added++;
        continue;
      }
      if (o.assetId !== p.assetId) replaced++;
      if (o.x !== p.x || o.y !== p.y || o.zIndex !== p.zIndex) moved++;
    }
    for (const id of prev.keys()) {
      if (!curr.has(id)) removed++;
    }
    return { added, removed, moved, replaced };
  }
}
