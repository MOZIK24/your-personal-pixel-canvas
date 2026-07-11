/** Core project types — never allocate width*height*4 buffers. */

export interface CanvasMeta {
  width: number;
  height: number;
  title: string;
  version: number;
}

/** Piece on the canvas — references an immutable asset file. */
export interface PieceMeta {
  id: string;
  /** Shared image in assets/{assetId}.png — not copied per save. */
  assetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  zIndex: number;
  updatedAt: number;
  /** Author comment shown in object info. */
  comment?: string;
  /** Draw opacity 0…1 (default 1). */
  opacity?: number;
  /** Animation: extra frame asset ids (assetId is frame 0). */
  frameAssetIds?: string[];
  /** Duration per frame in ms (same length as 1 + frameAssetIds). */
  frameDurations?: number[];
  frameCount?: number;
  authorId?: string;
}

export interface PieceRecord extends PieceMeta {
  imageBlob: Blob;
}

export interface ScenePiece {
  id: string;
  assetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  zIndex: number;
  updatedAt: number;
  comment?: string;
  opacity?: number;
  frameAssetIds?: string[];
  frameDurations?: number[];
  frameCount?: number;
}

export interface SceneFile {
  version: number;
  id: string;
  createdAt: string;
  canvas: CanvasMeta;
  pieces: ScenePiece[];
}

export interface ProjectFile {
  version: number;
  currentSaveId: string | null;
  title: string;
}

export interface SaveListItem {
  id: string;
  createdAt: string;
  pieceCount: number;
  title: string;
}

export interface ExportPiece {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  zIndex: number;
  comment?: string;
  opacity?: number;
  /** Frame asset ids (length >= 1); blobs live in ExportPayload.assets. */
  frameAssetIds: string[];
  durations: number[];
}

export interface ExportVersion {
  id: string;
  label: string;
  canvas: CanvasMeta;
  pieces: ExportPiece[];
}

export interface ExportPayload {
  title: string;
  /** Shared data URLs keyed by assetId — deduped across versions. */
  assets: Record<string, string>;
  versions: ExportVersion[];
  /** Viewer chrome style (no tool icons). */
  style?: ExportViewerStyle;
}

export type ToolIconId =
  | 'upload'
  | 'fit'
  | 'magnet'
  | 'grid'
  | 'outline'
  | 'eyedrop'
  | 'solo'
  | 'save'
  | 'html'
  | 'publish'
  | 'settings';

export interface StyleColors {
  /** Area behind / outside the canvas. */
  bg1: string;
  /** Canvas surface and chrome panels. */
  bg2: string;
  title: string;
  grid: string;
  accent: string;
  topbar: string;
  button: string;
  author: string;
}

export interface StudioStylePack {
  version: 1;
  name: string;
  showTitle: boolean;
  colors: StyleColors;
  authorText: string;
  icons: Partial<Record<ToolIconId, string>>;
  topbarImage?: string;
}

/** Subset embedded in exported HTML for readers. */
export interface ExportViewerStyle {
  showTitle: boolean;
  title: string;
  colors: StyleColors;
  authorText: string;
  topbarImage?: string;
}

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

export interface Viewport {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PublishSettings {
  token: string;
  owner: string;
  repo: string;
  branch: string;
}

export const PROJECT_VERSION = 3;
export const DEFAULT_CANVAS: CanvasMeta = {
  width: 4096,
  height: 4096,
  title: 'Untitled Canvas',
  version: PROJECT_VERSION,
};
