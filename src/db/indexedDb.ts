import type { CanvasMeta, PieceMeta, PieceRecord } from '../types';
import { DEFAULT_CANVAS, PROJECT_VERSION } from '../types';

const DB_NAME = 'personal-pixel-studio';
const DB_VERSION = 2;
const STORE_META = 'meta';
const STORE_PIECES = 'pieces';
const STORE_HANDLES = 'handles';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META);
      }
      if (!db.objectStoreNames.contains(STORE_PIECES)) {
        db.createObjectStore(STORE_PIECES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_HANDLES)) {
        db.createObjectStore(STORE_HANDLES);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function loadCanvasMeta(): Promise<CanvasMeta> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readonly');
    const req = tx.objectStore(STORE_META).get('canvas');
    req.onsuccess = () => {
      const value = req.result as CanvasMeta | undefined;
      resolve(value ?? { ...DEFAULT_CANVAS });
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveCanvasMeta(meta: CanvasMeta): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_META, 'readwrite');
  tx.objectStore(STORE_META).put({ ...meta, version: PROJECT_VERSION }, 'canvas');
  await txDone(tx);
}

function normalizePiece(raw: PieceRecord): PieceRecord {
  const assetId = raw.assetId || raw.id;
  return { ...raw, assetId };
}

export async function loadAllPieces(): Promise<PieceRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PIECES, 'readonly');
    const req = tx.objectStore(STORE_PIECES).getAll();
    req.onsuccess = () => {
      const list = ((req.result as PieceRecord[]) ?? []).map(normalizePiece);
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function putPiece(piece: PieceRecord): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_PIECES, 'readwrite');
  tx.objectStore(STORE_PIECES).put(normalizePiece(piece));
  await txDone(tx);
}

export async function deletePiece(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_PIECES, 'readwrite');
  tx.objectStore(STORE_PIECES).delete(id);
  await txDone(tx);
}

export async function clearAllPieces(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_PIECES, 'readwrite');
  tx.objectStore(STORE_PIECES).clear();
  await txDone(tx);
}

export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_HANDLES, 'readwrite');
  tx.objectStore(STORE_HANDLES).put(handle, 'projectRoot');
  await txDone(tx);
}

export async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HANDLES, 'readonly');
    const req = tx.objectStore(STORE_HANDLES).get('projectRoot');
    req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function clearDirectoryHandle(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_HANDLES, 'readwrite');
  tx.objectStore(STORE_HANDLES).delete('projectRoot');
  await txDone(tx);
}

export function pieceMetaOf(p: PieceRecord): PieceMeta {
  const { imageBlob: _blob, ...meta } = p;
  return meta;
}
