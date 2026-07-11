import '../styles.css';
import { ProjectStore } from '../project/store';
import { ProjectWorkspace } from '../project/workspace';
import {
  cameraViewport,
  createCamera,
  fitCamera,
  screenToWorld,
  zoomAt,
} from '../render/camera';
import { ImageCache } from '../render/imageCache';
import { hitTest, snapPosition, DEFAULT_MAGNET, type MagnetSettings, type MagnetMode } from '../pieces/snap';
import { drawWorldGrid } from '../render/grid';
import {
  buildExportVersion,
  buildSelfContainedHtml,
  downloadTextFile,
  estimatePayloadBytes,
} from '../export/buildHtml';
import {
  PUBLISH_INSTRUCTIONS,
  clearPublishSettings,
  loadPublishSettings,
  publishHtmlFile,
  savePublishSettings,
} from '../publish/github';
import { clearOutlineCache, getCachedOutline, peekOutline, getImageDataFromSource, sampleAlpha, sampleColor } from '../render/pixelOutline';
import { downloadBlob, extractPaletteAsync, paletteToStripPng, rgbToHex } from '../pieces/palette';
import { isAsepriteFile, parseAsepriteFile } from '../pieces/aseprite';
import { PROJECT_VERSION } from '../types';
import type { Camera, ExportPayload, PublishSettings, SaveListItem, StudioStylePack, ToolIconId } from '../types';
import {
  TOOL_ICON_IDS,
  DEFAULT_TOOL_EMOJI,
  applyStyleToDom,
  createDefaultStylePack,
  cssColorToHex,
  fileToDataUrl,
  hexToRgbaGrid,
  normalizeIconTo32DataUrl,
  parseStylePack,
  serializeStylePack,
  toExportViewerStyle,
} from '../project/stylePack';
import type { ProjectBootMode } from './projectGate';

export async function mountStudio(
  root: HTMLElement,
  boot: { mode: ProjectBootMode } = { mode: 'open' },
): Promise<void> {
  const store = new ProjectStore();
  const workspace = new ProjectWorkspace();

  if (boot.mode === 'create') {
    await store.clearWorkingCopy('Untitled Canvas');
  } else {
    await store.hydrate();
  }

  const camera: Camera = createCamera();
  const imageCache = new ImageCache(256);
  let saves: SaveListItem[] = [];
  const magnet: MagnetSettings = { ...DEFAULT_MAGNET, gridSize: 8 };
  let showGrid = true;
  let showOutline = true;
  let toolMode: 'select' | 'eyedropper' = 'select';
  /** When set, only pieces with this zIndex are drawn. */
  let soloLayer: number | null = null;
  const imageDataByAsset = new Map<string, ImageData>();
  let stylePack: StudioStylePack = createDefaultStylePack();
  let stylePersistTimer = 0;

  root.innerHTML = `
    <header class="topbar">
      <div class="brand-block">
        <div class="brand">Untitled</div>
      </div>
      <div class="brand-author" id="brand-author" hidden></div>
      <div class="tool-strip" role="toolbar">
        <button type="button" class="tool-btn" id="btn-upload" title="Upload PNG / Aseprite">➕</button>
        <input type="file" id="file-piece" accept="image/png,image/webp,image/*,.ase,.aseprite" hidden />
        <input type="file" id="file-replace" accept="image/png,image/webp,image/*" hidden />
        <button type="button" class="tool-btn" id="btn-fit" title="Fit canvas">🖼️</button>
        <div class="tool-popover-wrap">
          <button type="button" class="tool-btn" id="btn-magnet" title="Magnet snap">🧲</button>
          <div class="tool-popover" id="magnet-pop" hidden>
            <label class="field">Mode
              <select id="magnet-mode">
                <option value="both">Grid + edges</option>
                <option value="grid">Grid only</option>
                <option value="edges">Edges only</option>
                <option value="off">Off</option>
              </select>
            </label>
            <label class="field">Step
              <select id="magnet-step">
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="4">4</option>
                <option value="8" selected>8</option>
                <option value="16">16</option>
                <option value="32">32</option>
                <option value="64">64</option>
              </select>
            </label>
          </div>
        </div>
        <button type="button" class="tool-btn active" id="btn-grid" title="Grid" aria-pressed="true">🔲</button>
        <button type="button" class="tool-btn active" id="btn-outline" title="Outline" aria-pressed="true">🟧</button>
        <button type="button" class="tool-btn" id="btn-eyedrop" title="Eyedropper" aria-pressed="false">💉</button>
        <button type="button" class="eye-chip" id="eye-color" title="Copy hex" hidden>
          <span class="swatch" id="eye-swatch"></span>
          <span id="eye-hex"></span>
        </button>
        <button type="button" class="tool-btn" id="btn-solo-layer" title="Solo layer (off)" hidden>👁️</button>
      </div>
      <div class="topbar-actions">
        <span class="status toast" id="status">Ready</span>
        <button type="button" class="ghost tool-btn" id="btn-save-version" disabled title="Save version">💾</button>
        <button type="button" class="primary tool-btn" id="btn-download" title="Download HTML">📄</button>
        <button type="button" class="primary tool-btn" id="btn-publish" title="Publish">🚀</button>
        <button type="button" class="tool-btn" id="btn-settings" title="Project settings">⚙️</button>
      </div>
    </header>
    <div class="stage-wrap">
      <canvas id="stage"></canvas>
      <div id="eye-loupe" class="eye-loupe" hidden>
        <span class="swatch" id="loupe-swatch"></span>
        <canvas id="loupe-c" width="72" height="72"></canvas>
      </div>
      <div id="object-panel" class="object-panel" hidden>
        <div class="op-head">
          <strong>Object</strong>
          <span id="op-size" class="op-meta"></span>
        </div>
        <div class="op-block">
          <span class="op-label">Layer</span>
          <div class="op-layer">
            <button type="button" id="op-back" title="Down">⬇️</button>
            <input type="number" id="op-z" step="1" />
            <button type="button" id="op-forward" title="Up">⬆️</button>
            <button type="button" id="op-solo" title="Solo this layer">👁️</button>
          </div>
        </div>
        <div class="op-block">
          <div class="op-row">
            <span class="op-label">Opacity</span>
            <input type="range" id="op-opacity" min="0" max="100" value="100" />
            <span id="op-opacity-val" class="op-meta">100%</span>
          </div>
        </div>
        <label class="field op-comment">Comment
          <textarea id="op-comment" rows="2" placeholder="Note…"></textarea>
        </label>
        <div class="op-actions">
          <button type="button" id="op-replace">🔄 Replace</button>
          <button type="button" id="op-palette">🎨 Palette</button>
          <button type="button" id="op-delete" class="danger">🗑️ Delete</button>
        </div>
      </div>
      <div id="busy-overlay" class="busy-overlay" hidden>
        <div class="busy-card">
          <div class="busy-title" id="busy-title">Working…</div>
          <div class="busy-bar"><div class="busy-fill" id="busy-fill"></div></div>
          <div class="busy-meta" id="busy-meta"></div>
        </div>
      </div>
    </div>
    <div class="modal-backdrop" id="settings-modal" hidden>
      <div class="modal settings-modal" role="dialog" aria-modal="true">
        <h2>Project</h2>
        <p class="status" id="folder-status">No folder</p>
        <label class="field">Title
          <input type="text" id="title" />
        </label>
        <label class="check-row"><input type="checkbox" id="style-show-title" checked /> Show title in top bar</label>
        <div class="btn-row">
          <label class="field">Width
            <input type="number" id="width" min="1" step="1" />
          </label>
          <label class="field">Height
            <input type="number" id="height" min="1" step="1" />
          </label>
        </div>
        <button type="button" id="btn-apply-size">Apply size</button>

        <div class="section-title">Appearance</div>
        <label class="field">Author text
          <textarea id="style-author-text" rows="3" placeholder="Credit / links… (Enter = new line)"></textarea>
        </label>
        <div class="color-grid">
          <label class="field">Background 1 <input type="color" id="style-c-bg1" /></label>
          <label class="field">Background 2 <input type="color" id="style-c-bg2" /></label>
          <label class="field">Title <input type="color" id="style-c-title" /></label>
          <label class="field">Grid <input type="color" id="style-c-grid" /></label>
          <label class="field">Accent <input type="color" id="style-c-accent" /></label>
          <label class="field">Top bar <input type="color" id="style-c-topbar" /></label>
          <label class="field">Buttons <input type="color" id="style-c-button" /></label>
          <label class="field">Author <input type="color" id="style-c-author" /></label>
        </div>
        <label class="field">Top bar image (~1360×52)
          <input type="file" id="style-topbar-img" accept="image/png,image/webp,image/*" />
        </label>
        <div class="btn-row">
          <button type="button" class="ghost" id="style-clear-topbar">Clear top bar image</button>
          <a class="file-btn" id="style-dl-template" href="/template/topbar-1360x52.png" download="topbar-1360x52.png">Download panel template</a>
        </div>
        <div class="section-title">Icons 32×32</div>
        <div class="icon-grid" id="style-icon-grid"></div>
        <div class="btn-row">
          <button type="button" class="primary" id="style-save-file">Save style</button>
          <label class="file-btn">Load style
            <input type="file" id="style-load-file" accept=".ppsstyle,.json,application/json" />
          </label>
          <button type="button" class="ghost" id="style-clear">Clear style</button>
        </div>

        <div class="section-title">Versions</div>
        <div class="btn-row">
          <button type="button" class="primary" id="btn-link-folder">Link folder</button>
          <button type="button" class="ghost" id="btn-unlink-folder" disabled>Unlink</button>
        </div>
        <p class="hint" id="diff-hint"></p>
        <ul class="save-list" id="save-list"></ul>
        <div class="actions">
          <button type="button" class="ghost" id="settings-close">Close</button>
        </div>
      </div>
    </div>
  `;

  const stage = root.querySelector('#stage') as HTMLCanvasElement;
  const ctxOrNull = stage.getContext('2d', { alpha: false });
  if (!ctxOrNull) throw new Error('2d context unavailable');
  const ctx = ctxOrNull;

  const titleInput = root.querySelector('#title') as HTMLInputElement;
  const widthInput = root.querySelector('#width') as HTMLInputElement;
  const heightInput = root.querySelector('#height') as HTMLInputElement;
  const saveList = root.querySelector('#save-list') as HTMLUListElement;
  const statusEl = root.querySelector('#status') as HTMLSpanElement;
  const folderStatus = root.querySelector('#folder-status') as HTMLParagraphElement;
  const diffHint = root.querySelector('#diff-hint') as HTMLParagraphElement;
  const btnSaveVersion = root.querySelector('#btn-save-version') as HTMLButtonElement;
  const btnUnlink = root.querySelector('#btn-unlink-folder') as HTMLButtonElement;
  const filePiece = root.querySelector('#file-piece') as HTMLInputElement;
  const fileReplace = root.querySelector('#file-replace') as HTMLInputElement;
  const magnetModeEl = root.querySelector('#magnet-mode') as HTMLSelectElement;
  const magnetStepEl = root.querySelector('#magnet-step') as HTMLSelectElement;
  const magnetPop = root.querySelector('#magnet-pop') as HTMLDivElement;
  const btnMagnet = root.querySelector('#btn-magnet') as HTMLButtonElement;
  const btnGrid = root.querySelector('#btn-grid') as HTMLButtonElement;
  const btnOutline = root.querySelector('#btn-outline') as HTMLButtonElement;
  const btnEyedrop = root.querySelector('#btn-eyedrop') as HTMLButtonElement;
  const eyeColorEl = root.querySelector('#eye-color') as HTMLButtonElement;
  const eyeSwatchEl = root.querySelector('#eye-swatch') as HTMLSpanElement;
  const eyeHexEl = root.querySelector('#eye-hex') as HTMLSpanElement;
  const eyeLoupeEl = root.querySelector('#eye-loupe') as HTMLDivElement;
  const loupeCanvas = root.querySelector('#loupe-c') as HTMLCanvasElement;
  const loupeSwatchEl = root.querySelector('#loupe-swatch') as HTMLSpanElement;
  const objectPanel = root.querySelector('#object-panel') as HTMLDivElement;
  const opSize = root.querySelector('#op-size') as HTMLSpanElement;
  const opZ = root.querySelector('#op-z') as HTMLInputElement;
  const opOpacity = root.querySelector('#op-opacity') as HTMLInputElement;
  const opOpacityVal = root.querySelector('#op-opacity-val') as HTMLSpanElement;
  const opComment = root.querySelector('#op-comment') as HTMLTextAreaElement;
  const settingsModal = root.querySelector('#settings-modal') as HTMLDivElement;
  const busyOverlay = root.querySelector('#busy-overlay') as HTMLDivElement;
  const busyTitle = root.querySelector('#busy-title') as HTMLDivElement;
  const busyFill = root.querySelector('#busy-fill') as HTMLDivElement;
  const busyMeta = root.querySelector('#busy-meta') as HTMLDivElement;
  const btnSoloLayer = root.querySelector('#btn-solo-layer') as HTMLButtonElement;
  const opSoloBtn = root.querySelector('#op-solo') as HTMLButtonElement;
  const styleShowTitle = root.querySelector('#style-show-title') as HTMLInputElement;
  const styleAuthorText = root.querySelector('#style-author-text') as HTMLTextAreaElement;
  const styleTopbarImg = root.querySelector('#style-topbar-img') as HTMLInputElement;
  const styleIconGrid = root.querySelector('#style-icon-grid') as HTMLDivElement;
  const styleLoadFile = root.querySelector('#style-load-file') as HTMLInputElement;
  const colorInputs = {
    bg1: root.querySelector('#style-c-bg1') as HTMLInputElement,
    bg2: root.querySelector('#style-c-bg2') as HTMLInputElement,
    title: root.querySelector('#style-c-title') as HTMLInputElement,
    grid: root.querySelector('#style-c-grid') as HTMLInputElement,
    accent: root.querySelector('#style-c-accent') as HTMLInputElement,
    topbar: root.querySelector('#style-c-topbar') as HTMLInputElement,
    button: root.querySelector('#style-c-button') as HTMLInputElement,
    author: root.querySelector('#style-c-author') as HTMLInputElement,
  };
  const loupeCtx = loupeCanvas.getContext('2d')!;
  loupeCtx.imageSmoothingEnabled = false;

  let renderQueued = false;
  let panning = false;
  let lastPtr = { x: 0, y: 0 };
  let draggingPiece = false;
  let dragOffset = { x: 0, y: 0 };
  let spaceDown = false;
  let pinnedHex = '';
  let ctxPieceId: string | null = null;
  let statusTimer = 0;

  function setStatus(text: string, kind: '' | 'ok' | 'err' = ''): void {
    statusEl.textContent = text;
    statusEl.className = `status toast${kind ? ` ${kind}` : ''}`;
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      statusEl.textContent = '';
      statusEl.className = 'status toast';
    }, 3200);
  }

  function applyCurrentStyle(): void {
    applyStyleToDom(root, stylePack, store.canvas.title);
    // Re-apply toggle active classes after icon rebuild
    setToggle(btnGrid, showGrid);
    setToggle(btnOutline, showOutline);
    setToggle(btnEyedrop, toolMode === 'eyedropper');
    syncSoloUi();
    requestRender();
  }

  function scheduleStylePersist(): void {
    window.clearTimeout(stylePersistTimer);
    stylePersistTimer = window.setTimeout(() => {
      void persistStyle();
    }, 400);
  }

  async function persistStyle(): Promise<void> {
    if (!workspace.linked) return;
    try {
      await workspace.writeStyleFile(serializeStylePack(stylePack));
    } catch {
      /* ignore */
    }
  }

  function syncStyleForm(): void {
    styleShowTitle.checked = stylePack.showTitle;
    styleAuthorText.value = stylePack.authorText;
    colorInputs.bg1.value = cssColorToHex(stylePack.colors.bg1);
    colorInputs.bg2.value = cssColorToHex(stylePack.colors.bg2);
    colorInputs.title.value = cssColorToHex(stylePack.colors.title);
    colorInputs.grid.value = cssColorToHex(stylePack.colors.grid);
    colorInputs.accent.value = cssColorToHex(stylePack.colors.accent);
    colorInputs.topbar.value = cssColorToHex(stylePack.colors.topbar);
    colorInputs.button.value = cssColorToHex(stylePack.colors.button);
    colorInputs.author.value = cssColorToHex(stylePack.colors.author);
    rebuildIconGrid();
  }

  function rebuildIconGrid(): void {
    styleIconGrid.innerHTML = TOOL_ICON_IDS.map((id) => {
      const src = stylePack.icons[id];
      const preview = src
        ? `<img src="${src}" width="32" height="32" alt="" />`
        : `<span class="icon-emoji">${DEFAULT_TOOL_EMOJI[id]}</span>`;
      return `<label class="icon-slot" data-icon="${id}">
        <span class="icon-preview">${preview}</span>
        <span class="icon-name">${id}</span>
        <input type="file" accept="image/png,image/webp,image/*" data-icon-file="${id}" />
      </label>`;
    }).join('');
  }

  function setToggle(btn: HTMLButtonElement, on: boolean): void {
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function setBusy(on: boolean, title = 'Working…', pct = 0, meta = ''): void {
    busyOverlay.hidden = !on;
    if (!on) return;
    busyTitle.textContent = title;
    busyFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    busyMeta.textContent = meta;
  }

  function syncSoloUi(): void {
    const on = soloLayer !== null;
    btnSoloLayer.hidden = !on;
    setToggle(btnSoloLayer, on);
    btnSoloLayer.title = on ? `Solo layer ${soloLayer} (click to clear)` : 'Solo layer (off)';
    opSoloBtn.classList.toggle('active', on);
  }

  function setSoloLayer(z: number | null): void {
    soloLayer = z;
    syncSoloUi();
    requestRender();
    if (z === null) setStatus('Showing all layers', 'ok');
    else setStatus(`Solo layer ${z}`, 'ok');
  }

  function syncFolderUi(): void {
    const linked = workspace.linked;
    btnSaveVersion.disabled = !linked;
    btnUnlink.disabled = !linked;
    folderStatus.textContent = linked
      ? `Folder: ${workspace.folderName}${workspace.currentSaveId ? ` · ${workspace.currentSaveId}` : ''}`
      : 'No folder linked';
    folderStatus.className = linked ? 'status ok' : 'status';

    saveList.innerHTML = saves
      .map((s) => {
        const active = s.id === workspace.currentSaveId ? 'active' : '';
        const when = s.createdAt ? new Date(s.createdAt).toLocaleString() : s.id;
        return `<li class="${active}" data-save="${s.id}">
          <div>
            <div>${s.id}</div>
            <div class="meta">${when} · ${s.pieceCount} pieces</div>
          </div>
        </li>`;
      })
      .join('');
  }

  function syncForm(): void {
    titleInput.value = store.canvas.title;
    widthInput.value = String(store.canvas.width);
    heightInput.value = String(store.canvas.height);
    if (ctxPieceId && objectPanel.hidden === false) {
      syncObjectPanel(ctxPieceId);
    }
    syncFolderUi();
    const brand = root.querySelector('.brand') as HTMLElement | null;
    if (brand && stylePack.showTitle) {
      brand.textContent = store.canvas.title || 'Untitled';
    }
  }

  function syncObjectPanel(pieceId: string): void {
    const meta = store.index.get(pieceId);
    if (!meta) {
      hideObjectPanel();
      return;
    }
    opSize.textContent = `${meta.w}×${meta.h}`;
    opZ.value = String(meta.zIndex);
    const pct = Math.round((meta.opacity ?? 1) * 100);
    opOpacity.value = String(pct);
    opOpacityVal.textContent = `${pct}%`;
    opComment.value = meta.comment ?? '';
    opSoloBtn.classList.toggle('active', soloLayer === meta.zIndex);
  }

  function requestRender(): void {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  async function ensureImages(pieceIds: string[]): Promise<void> {
    await Promise.all(
      pieceIds.map(async (pieceId) => {
        const key = store.cacheKey(pieceId);
        if (!key || imageCache.get(key)) return;
        const blob = store.getBlob(pieceId);
        if (!blob) return;
        try {
          await imageCache.loadBlob(key, blob);
        } catch {
          /* skip */
        }
      }),
    );
  }

  async function ensureAssetImageData(assetId: string): Promise<ImageData | null> {
    if (imageDataByAsset.has(assetId)) return imageDataByAsset.get(assetId)!;
    const img = imageCache.get(assetId);
    if (!(img instanceof HTMLImageElement) && !(img instanceof HTMLCanvasElement)) {
      const blob = store.getAssetBlob(assetId);
      if (!blob) return null;
      await imageCache.loadBlob(assetId, blob);
    }
    const source = imageCache.get(assetId);
    if (!source) return null;
    const w = 'naturalWidth' in source ? source.naturalWidth || source.width : source.width;
    const h = 'naturalHeight' in source ? source.naturalHeight || source.height : source.height;
    const data = await getImageDataFromSource(source, w, h);
    imageDataByAsset.set(assetId, data);
    return data;
  }

  function drawPieceImage(
    img: HTMLImageElement | HTMLCanvasElement,
    p: { x: number; y: number; w: number; h: number; opacity?: number },
    lod: HTMLImageElement | HTMLCanvasElement | undefined,
    useLod: boolean,
  ): void {
    const alpha = p.opacity ?? 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (useLod && p.w * camera.scale < 3 && p.h * camera.scale < 3) {
      ctx.fillStyle = '#8a8480';
      ctx.fillRect(p.x, p.y, Math.max(p.w, 1), Math.max(p.h, 1));
    } else if (useLod && lod) {
      ctx.drawImage(lod, p.x, p.y, p.w, p.h);
    } else {
      ctx.drawImage(img, p.x, p.y, p.w, p.h);
    }
    ctx.restore();
  }

  function render(): void {
    const wrap = stage.parentElement!;
    const cssW = wrap.clientWidth;
    const cssH = wrap.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.max(1, Math.floor(cssW * dpr));
    const bh = Math.max(1, Math.floor(cssH * dpr));
    if (stage.width !== bw || stage.height !== bh) {
      stage.width = bw;
      stage.height = bh;
      stage.style.width = `${cssW}px`;
      stage.style.height = `${cssH}px`;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = stylePack.colors.bg1;
    ctx.fillRect(0, 0, cssW, cssH);

    ctx.save();
    ctx.translate(camera.x, camera.y);
    ctx.scale(camera.scale, camera.scale);
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = stylePack.colors.bg2;
    ctx.fillRect(0, 0, store.canvas.width, store.canvas.height);
    ctx.strokeStyle = '#3f4650';
    ctx.lineWidth = 1 / camera.scale;
    ctx.strokeRect(0, 0, store.canvas.width, store.canvas.height);

    const margin = 128;
    const vp = cameraViewport(camera, cssW, cssH, margin);

    if (showGrid) {
      drawWorldGrid(ctx, camera, vp, store.canvas.width, store.canvas.height, stylePack.colors.grid);
    }

    const visible = store.index.query(vp);
    const useLod = camera.scale < 0.2;
    const now = performance.now();
    let hasAnim = false;

    for (const p of visible) {
      if (soloLayer !== null && p.zIndex !== soloLayer) continue;
      if ((p.frameCount ?? 1) > 1) hasAnim = true;
      const assetId = store.activeAssetId(p, now);
      const img = imageCache.get(assetId);
      if (!img) {
        const blob = store.getAssetBlob(assetId);
        if (blob) void imageCache.loadBlob(assetId, blob).then(() => requestRender());
        ctx.save();
        ctx.globalAlpha = p.opacity ?? 1;
        ctx.fillStyle = '#3a4248';
        ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.restore();
        continue;
      }

      if (useLod) {
        void imageCache.getLod(assetId, img, 64).then(() => requestRender());
      }
      const lod = imageCache.get(`${assetId}@lod64`);
      drawPieceImage(img, p, lod, useLod);

      if (showOutline && p.id === store.selectedId) {
        const cached = peekOutline(assetId);
        if (cached) {
          ctx.save();
          ctx.globalAlpha = p.opacity ?? 1;
          ctx.drawImage(cached, p.x, p.y, p.w, p.h);
          ctx.restore();
        } else {
          void getCachedOutline(assetId, img, p.w, p.h).then(() => requestRender());
        }
      }
    }

    ctx.restore();
    if (hasAnim) requestRender();
  }

  function fit(): void {
    const wrap = stage.parentElement!;
    fitCamera(camera, store.canvas.width, store.canvas.height, wrap.clientWidth, wrap.clientHeight);
    requestRender();
  }

  async function refreshSaves(): Promise<void> {
    if (!workspace.linked) {
      saves = [];
      diffHint.textContent = '';
      syncFolderUi();
      return;
    }
    saves = await workspace.listSaves();
    syncFolderUi();
  }

  async function showDiffHint(): Promise<void> {
    if (!workspace.linked || !workspace.currentSaveId) {
      diffHint.textContent = '';
      return;
    }
    try {
      const d = await workspace.diffAgainstSave(workspace.currentSaveId, store.index.all());
      if (d.added + d.removed + d.moved + d.replaced === 0) {
        diffHint.textContent = 'Working copy matches this save.';
      } else {
        diffHint.textContent = `vs ${workspace.currentSaveId}: +${d.added} / -${d.removed} / moved ${d.moved} / replaced ${d.replaced}`;
      }
    } catch {
      diffHint.textContent = '';
    }
  }

  store.subscribe(() => {
    syncForm();
    const visible = store.index.query(
      cameraViewport(camera, stage.parentElement!.clientWidth, stage.parentElement!.clientHeight, 256),
    );
    void ensureImages(visible.map((p) => p.id)).then(() => requestRender());
    void showDiffHint();
    requestRender();
  });

  syncForm();
  fit();

  try {
    const restored = await workspace.restoreSavedHandle();
    if (restored) {
      await refreshSaves();
      if (boot.mode === 'open' && workspace.currentSaveId) {
        const loaded = await workspace.loadSave(workspace.currentSaveId);
        imageCache.clear();
        clearOutlineCache();
        imageDataByAsset.clear();
        await store.replaceAll(loaded.canvas, loaded.pieces, loaded.extraAssets);
        fit();
        setStatus(`Opened ${workspace.currentSaveId}`, 'ok');
      } else if (boot.mode === 'create') {
        await workspace.writeProjectFile({
          version: PROJECT_VERSION,
          currentSaveId: null,
          title: store.canvas.title,
        });
        setStatus(`New project · ${workspace.folderName}`, 'ok');
      } else {
        setStatus(`Folder: ${workspace.folderName}`, 'ok');
      }
      // Project title from project.json is source of truth (not folder name / stale scene).
      if (boot.mode !== 'create') {
        const projectTitle = await workspace.getProjectTitle();
        if (projectTitle) await store.setTitle(projectTitle);
      }
      await refreshSaves();
      await showDiffHint();
      const rawStyle = await workspace.readStyleFile();
      if (rawStyle) {
        stylePack = parseStylePack(rawStyle);
      } else if (boot.mode === 'create') {
        stylePack = createDefaultStylePack();
        await persistStyle();
      }
      applyCurrentStyle();
      syncStyleForm();
    } else {
      setStatus('No folder — open settings', 'err');
      applyCurrentStyle();
    }
  } catch {
    setStatus(`${store.index.size} pieces`);
    applyCurrentStyle();
  }

  root.querySelector('#btn-fit')!.addEventListener('click', fit);
  root.querySelector('#btn-upload')!.addEventListener('click', () => filePiece.click());

  root.querySelector('#btn-apply-size')!.addEventListener('click', async () => {
    const w = Number(widthInput.value);
    const h = Number(heightInput.value);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) {
      setStatus('Invalid canvas size', 'err');
      return;
    }
    await store.setCanvasSize(w, h);
    fit();
    setStatus(`Canvas ${w}×${h}`, 'ok');
  });

  async function commitTitle(): Promise<void> {
    const title = titleInput.value.trim() || 'Untitled Canvas';
    if (title !== store.canvas.title) {
      await store.setTitle(title);
    }
    if (workspace.linked) {
      try {
        await workspace.updateProjectTitle(title);
      } catch {
        /* ignore */
      }
    }
    applyCurrentStyle();
  }

  titleInput.addEventListener('change', () => {
    void commitTitle();
  });
  titleInput.addEventListener('blur', () => {
    void commitTitle();
  });

  root.querySelector('#btn-settings')!.addEventListener('click', () => {
    settingsModal.hidden = false;
    syncFolderUi();
    syncStyleForm();
    void showDiffHint();
  });

  styleShowTitle.addEventListener('change', () => {
    stylePack.showTitle = styleShowTitle.checked;
    applyCurrentStyle();
    scheduleStylePersist();
  });
  styleAuthorText.addEventListener('input', () => {
    stylePack.authorText = styleAuthorText.value;
    applyCurrentStyle();
    scheduleStylePersist();
  });
  styleAuthorText.addEventListener('change', () => {
    stylePack.authorText = styleAuthorText.value;
    applyCurrentStyle();
    scheduleStylePersist();
  });
  for (const [key, input] of Object.entries(colorInputs) as Array<
    [keyof typeof colorInputs, HTMLInputElement]
  >) {
    input.addEventListener('input', () => {
      if (key === 'grid') {
        stylePack.colors.grid = hexToRgbaGrid(input.value, 0.28);
      } else {
        stylePack.colors[key] = input.value;
      }
      applyCurrentStyle();
      scheduleStylePersist();
    });
  }
  styleTopbarImg.addEventListener('change', async () => {
    const file = styleTopbarImg.files?.[0];
    styleTopbarImg.value = '';
    if (!file) return;
    stylePack.topbarImage = await fileToDataUrl(file);
    applyCurrentStyle();
    scheduleStylePersist();
    setStatus('Top bar image set', 'ok');
  });
  root.querySelector('#style-clear-topbar')!.addEventListener('click', () => {
    delete stylePack.topbarImage;
    applyCurrentStyle();
    scheduleStylePersist();
  });
  styleIconGrid.addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    if (!input.matches('input[data-icon-file]')) return;
    const id = input.dataset.iconFile as ToolIconId;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !id) return;
    stylePack.icons[id] = await normalizeIconTo32DataUrl(file);
    applyCurrentStyle();
    syncStyleForm();
    scheduleStylePersist();
  });
  root.querySelector('#style-save-file')!.addEventListener('click', () => {
    const name = (stylePack.name || 'style').replace(/[^\w\-]+/g, '_') || 'style';
    downloadTextFile(`${name}.ppsstyle`, serializeStylePack(stylePack), 'application/json');
    setStatus('Style file downloaded', 'ok');
  });
  styleLoadFile.addEventListener('change', async () => {
    const file = styleLoadFile.files?.[0];
    styleLoadFile.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      stylePack = parseStylePack(JSON.parse(text));
      applyCurrentStyle();
      syncStyleForm();
      await persistStyle();
      setStatus('Style loaded', 'ok');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Invalid style file', 'err');
    }
  });
  root.querySelector('#style-clear')!.addEventListener('click', () => {
    const authorText = stylePack.authorText;
    const showTitle = stylePack.showTitle;
    stylePack = createDefaultStylePack();
    stylePack.authorText = authorText;
    stylePack.showTitle = showTitle;
    applyCurrentStyle();
    syncStyleForm();
    scheduleStylePersist();
    setStatus('Style reset to default', 'ok');
  });
  root.querySelector('#settings-close')!.addEventListener('click', () => {
    void commitTitle();
    settingsModal.hidden = true;
  });
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      void commitTitle();
      settingsModal.hidden = true;
    }
  });

  root.querySelector('#btn-link-folder')!.addEventListener('click', async () => {
    try {
      await workspace.pickAndLinkFolder();
      await refreshSaves();
      if (workspace.currentSaveId) {
        const loaded = await workspace.loadSave(workspace.currentSaveId);
        imageCache.clear();
        clearOutlineCache();
        imageDataByAsset.clear();
        await store.replaceAll(loaded.canvas, loaded.pieces, loaded.extraAssets);
        fit();
      } else if (store.index.size > 0) {
        await workspace.saveVersion(store.canvas, store.index.all(), (id) => store.getAssetBlob(id));
        await refreshSaves();
      }
      syncFolderUi();
      setStatus(`Linked ${workspace.folderName}`, 'ok');
      await showDiffHint();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Link failed', 'err');
    }
  });

  btnUnlink.addEventListener('click', async () => {
    await workspace.unlinkFolder();
    saves = [];
    syncFolderUi();
    diffHint.textContent = '';
    setStatus('Folder unlinked', 'ok');
  });

  btnSaveVersion.addEventListener('click', async () => {
    try {
      const item = await workspace.saveVersion(
        store.canvas,
        store.index.all(),
        (assetId) => store.getAssetBlob(assetId),
      );
      store.dirty = false;
      await refreshSaves();
      await showDiffHint();
      setStatus(`Saved ${item.id}`, 'ok');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Save failed', 'err');
    }
  });

  saveList.addEventListener('click', async (e) => {
    const li = (e.target as HTMLElement).closest('li');
    if (!li?.dataset.save) return;
    const saveId = li.dataset.save;
    try {
      setStatus(`Loading ${saveId}…`);
      const loaded = await workspace.loadSave(saveId);
      imageCache.clear();
      clearOutlineCache();
      imageDataByAsset.clear();
      await store.replaceAll(loaded.canvas, loaded.pieces, loaded.extraAssets);
      fit();
      await refreshSaves();
      await showDiffHint();
      setStatus(`Loaded ${saveId}`, 'ok');
      settingsModal.hidden = true;
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Load failed', 'err');
    }
  });

  async function importPieceFile(file: File, worldX: number, worldY: number): Promise<void> {
    if (isAsepriteFile(file)) {
      setStatus('Parsing Aseprite…');
      const frames = await parseAsepriteFile(file);
      const id = await store.addAnimatedPiece(frames, worldX, worldY);
      if (workspace.linked) {
        for (const aid of store.allAssetIdsFor(store.index.get(id)!)) {
          const blob = store.getAssetBlob(aid);
          if (blob) await workspace.ensureAssetWritten(aid, blob);
        }
      }
      setStatus(`Added aseprite (${frames.length} frames)`, 'ok');
    } else {
      await store.addPieceFromFile(file, worldX, worldY);
      if (workspace.linked) {
        const meta = store.index.get(store.selectedId!);
        const blob = meta ? store.getAssetBlob(meta.assetId) : undefined;
        if (meta && blob) {
          try {
            await workspace.ensureAssetWritten(meta.assetId, blob);
          } catch {
            /* ok */
          }
        }
      }
      setStatus(`Added ${file.name}`, 'ok');
    }
  }

  filePiece.addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const wrap = stage.parentElement!;
    const world = screenToWorld(camera, wrap.clientWidth / 2, wrap.clientHeight / 2);
    try {
      await importPieceFile(file, world.x, world.y);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Import failed', 'err');
    }
  });

  fileReplace.addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const id = ctxPieceId || store.selectedId;
    if (!file || !id) return;
    try {
      const oldKey = store.cacheKey(id);
      const newAssetId = await store.replacePieceAsset(id, file);
      if (oldKey) {
        imageCache.delete(oldKey);
        imageCache.delete(`${oldKey}@lod64`);
        clearOutlineCache(oldKey);
        imageDataByAsset.delete(oldKey);
      }
      if (workspace.linked) {
        const blob = store.getAssetBlob(newAssetId);
        if (blob) await workspace.ensureAssetWritten(newAssetId, blob);
      }
      setStatus('Replaced asset', 'ok');
      syncObjectPanel(id);
      await showDiffHint();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Replace failed', 'err');
    }
  });

  stage.addEventListener('dragover', (e) => e.preventDefault());
  stage.addEventListener('drop', async (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const rect = stage.getBoundingClientRect();
    const world = screenToWorld(camera, e.clientX - rect.left, e.clientY - rect.top);
    try {
      if (store.selectedId && e.shiftKey && file.type.startsWith('image/')) {
        const oldKey = store.cacheKey(store.selectedId);
        const newAssetId = await store.replacePieceAsset(store.selectedId, file);
        if (oldKey) imageCache.delete(oldKey);
        if (workspace.linked) {
          const blob = store.getAssetBlob(newAssetId);
          if (blob) await workspace.ensureAssetWritten(newAssetId, blob);
        }
        setStatus('Replaced (Shift+drop)', 'ok');
        return;
      }
      await importPieceFile(file, world.x, world.y);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Drop failed', 'err');
    }
  });

  async function deletePieceSmart(pieceId: string): Promise<void> {
    const meta = store.index.get(pieceId);
    if (!meta) return;
    const candidates = store.allAssetIdsFor(meta);
    for (const aid of candidates) {
      imageCache.delete(aid);
      imageCache.delete(`${aid}@lod64`);
      clearOutlineCache(aid);
      imageDataByAsset.delete(aid);
    }
    await store.removePiece(pieceId);
    let removedFiles = 0;
    if (workspace.linked) {
      const referenced = await workspace.collectReferencedAssetIds();
      const working = new Set(store.assetIdsInUse());
      for (const aid of candidates) {
        if (referenced.has(aid) || working.has(aid)) continue;
        if (await workspace.deleteAssetFile(aid)) removedFiles++;
      }
    }
    hideObjectPanel();
    setStatus(
      removedFiles > 0
        ? `Deleted + ${removedFiles} unused asset(s)`
        : 'Deleted object',
      'ok',
    );
    await showDiffHint();
  }

  async function downloadPaletteFor(pieceId: string): Promise<void> {
    const meta = store.index.get(pieceId);
    if (!meta) return;
    const assetId = store.activeAssetId(meta, performance.now());
    const data = await ensureAssetImageData(assetId);
    if (!data) {
      setStatus('Could not read pixels', 'err');
      return;
    }
    try {
      setBusy(true, '🎨 Building palette…', 0, 'Scanning pixels');
      const colors = await extractPaletteAsync(data, 128, 16, (done, total, phase) => {
        const pct = total > 0 ? (done / total) * 100 : 0;
        const label =
          phase === 'scan'
            ? `Scanning… ${Math.round(pct)}%`
            : `Sorting colors… ${Math.round(pct)}%`;
        setBusy(true, '🎨 Building palette…', pct, label);
      });
      if (colors.length === 0) {
        setBusy(false);
        setStatus('No opaque colors', 'err');
        return;
      }
      setBusy(true, '🎨 Encoding PNG…', 100, `${colors.length} colors`);
      const blob = await paletteToStripPng(colors, 8);
      downloadBlob(`palette-${meta.id.slice(0, 8)}.png`, blob);
      setBusy(false);
      setStatus(`Palette PNG · ${colors.length} colors (light→dark)`, 'ok');
    } catch (err) {
      setBusy(false);
      setStatus(err instanceof Error ? err.message : 'Palette failed', 'err');
    }
  }

  magnetModeEl.value = magnet.mode;
  magnetStepEl.value = String(magnet.gridSize);
  btnMagnet.addEventListener('click', (e) => {
    e.stopPropagation();
    magnetPop.hidden = !magnetPop.hidden;
  });
  magnetModeEl.addEventListener('change', () => {
    magnet.mode = magnetModeEl.value as MagnetMode;
    setStatus(`Magnet: ${magnet.mode}`, 'ok');
  });
  magnetStepEl.addEventListener('change', () => {
    magnet.gridSize = Math.max(1, Number(magnetStepEl.value) || 1);
    setStatus(`Step ${magnet.gridSize}px`, 'ok');
  });

  btnGrid.addEventListener('click', () => {
    showGrid = !showGrid;
    setToggle(btnGrid, showGrid);
    requestRender();
  });
  btnOutline.addEventListener('click', () => {
    showOutline = !showOutline;
    setToggle(btnOutline, showOutline);
    requestRender();
  });

  function setEyedropMode(on: boolean): void {
    toolMode = on ? 'eyedropper' : 'select';
    setToggle(btnEyedrop, on);
    stage.style.cursor = on ? 'crosshair' : 'grab';
    if (!on) eyeLoupeEl.hidden = true;
    else if (pinnedHex) eyeColorEl.hidden = false;
  }

  btnEyedrop.addEventListener('click', () => {
    setEyedropMode(toolMode !== 'eyedropper');
  });

  function pinEyedropColor(hex: string): void {
    pinnedHex = hex;
    eyeColorEl.hidden = false;
    eyeSwatchEl.style.background = hex;
    eyeHexEl.textContent = hex;
  }

  eyeColorEl.addEventListener('click', async () => {
    if (!pinnedHex) return;
    try {
      await navigator.clipboard.writeText(pinnedHex);
      setStatus(`Copied ${pinnedHex}`, 'ok');
      eyeHexEl.textContent = `${pinnedHex} · ok`;
      setTimeout(() => {
        if (pinnedHex) eyeHexEl.textContent = pinnedHex;
      }, 900);
    } catch {
      setStatus('Clipboard unavailable', 'err');
    }
  });

  function updateEyeLoupe(
    clientX: number,
    clientY: number,
    sample: { r: number; g: number; b: number; lx: number; ly: number; assetId: string } | null,
  ): void {
    if (toolMode !== 'eyedropper') {
      eyeLoupeEl.hidden = true;
      return;
    }
    const wrap = stage.parentElement!;
    const rect = wrap.getBoundingClientRect();
    eyeLoupeEl.hidden = false;
    // Offset away from cursor so it doesn't cover the sample point
    const ox = 28;
    const oy = -88;
    let left = clientX - rect.left + ox;
    let top = clientY - rect.top + oy;
    left = Math.max(8, Math.min(left, rect.width - 88));
    top = Math.max(8, Math.min(top, rect.height - 100));
    eyeLoupeEl.style.left = `${left}px`;
    eyeLoupeEl.style.top = `${top}px`;
    loupeCtx.fillStyle = stylePack.colors.bg1;
    loupeCtx.fillRect(0, 0, 72, 72);
    if (!sample) {
      loupeSwatchEl.style.display = 'none';
      return;
    }
    const img = imageCache.get(sample.assetId);
    if (img) {
      const src = 9;
      const half = (src - 1) / 2;
      loupeCtx.imageSmoothingEnabled = false;
      loupeCtx.drawImage(img, sample.lx - half, sample.ly - half, src, src, 0, 0, 72, 72);
      loupeCtx.strokeStyle = '#e8e2d6';
      loupeCtx.lineWidth = 2;
      loupeCtx.strokeRect(31, 31, 10, 10);
    }
    const hexOk = rgbToHex({ r: sample.r, g: sample.g, b: sample.b });
    loupeSwatchEl.style.display = 'block';
    loupeSwatchEl.style.background = hexOk;
  }

  async function sampleEyedropAt(
    worldX: number,
    worldY: number,
  ): Promise<{ r: number; g: number; b: number; a: number; lx: number; ly: number; assetId: string } | null> {
    const near = store.index.query({ x: worldX - 1, y: worldY - 1, w: 2, h: 2 });
    const ordered = [...near].reverse();
    for (const p of ordered) {
      if (worldX < p.x || worldY < p.y || worldX >= p.x + p.w || worldY >= p.y + p.h) continue;
      const assetId = store.activeAssetId(p, performance.now());
      const data = await ensureAssetImageData(assetId);
      if (!data) continue;
      const c = sampleColor(data, worldX - p.x, worldY - p.y);
      if (!c || c.a < 8) continue;
      return {
        ...c,
        lx: Math.floor(worldX - p.x),
        ly: Math.floor(worldY - p.y),
        assetId,
      };
    }
    return null;
  }

  async function makeHtmlFromVersions(versionIds: string[]): Promise<{ html: string; bytes: number }> {
    const assets: Record<string, string> = {};
    const versions = [];
    if (versionIds.length === 0 || !workspace.linked) {
      versions.push(
        await buildExportVersion(
          'working',
          'Working copy',
          store.canvas,
          store.index.all(),
          (id) => store.getAssetBlob(id),
          (p) => store.allAssetIdsFor(p),
          assets,
        ),
      );
    } else {
      for (const vid of versionIds) {
        const loaded = await workspace.readSaveData(vid);
        const assetMap = new Map<string, Blob>();
        for (const p of loaded.pieces) assetMap.set(p.assetId, p.imageBlob);
        for (const [k, v] of loaded.extraAssets) assetMap.set(k, v);
        versions.push(
          await buildExportVersion(
            vid,
            vid,
            loaded.canvas,
            loaded.pieces,
            (id) => assetMap.get(id),
            (p) => [p.assetId, ...(p.frameAssetIds ?? [])],
            assets,
          ),
        );
      }
    }
    const payload: ExportPayload = {
      title: store.canvas.title,
      assets,
      versions,
      style: toExportViewerStyle(stylePack, store.canvas.title),
    };
    const bytes = estimatePayloadBytes(payload);
    const html = buildSelfContainedHtml(payload);
    return { html, bytes };
  }

  root.querySelector('#btn-download')!.addEventListener('click', () => {
    openDownloadModal(root, workspace, saves, makeHtmlFromVersions, setStatus, store.canvas.title);
  });

  root.querySelector('#btn-publish')!.addEventListener('click', () => {
    openPublishModal(
      root,
      async () => makeHtmlFromVersions(workspace.currentSaveId ? [workspace.currentSaveId] : []),
      setStatus,
    );
  });

  function hideObjectPanel(): void {
    objectPanel.hidden = true;
    ctxPieceId = null;
  }

  function showObjectPanel(pieceId: string, clientX: number, clientY: number): void {
    ctxPieceId = pieceId;
    store.select(pieceId);
    syncObjectPanel(pieceId);
    const wrap = stage.parentElement!;
    const rect = wrap.getBoundingClientRect();
    objectPanel.hidden = false;
    const panelW = 228;
    const panelH = 280;
    const x = Math.min(Math.max(8, clientX - rect.left), rect.width - panelW - 8);
    const y = Math.min(Math.max(8, clientY - rect.top), rect.height - panelH - 8);
    objectPanel.style.left = `${x}px`;
    objectPanel.style.top = `${y}px`;
  }

  root.querySelector('#op-back')!.addEventListener('click', async () => {
    if (ctxPieceId) {
      await store.sendBackward(ctxPieceId);
      syncObjectPanel(ctxPieceId);
    }
  });
  root.querySelector('#op-forward')!.addEventListener('click', async () => {
    if (ctxPieceId) {
      await store.bringForward(ctxPieceId);
      syncObjectPanel(ctxPieceId);
    }
  });
  opSoloBtn.addEventListener('click', () => {
    if (!ctxPieceId) return;
    const meta = store.index.get(ctxPieceId);
    if (!meta) return;
    if (soloLayer === meta.zIndex) setSoloLayer(null);
    else setSoloLayer(meta.zIndex);
  });
  btnSoloLayer.addEventListener('click', () => setSoloLayer(null));
  opZ.addEventListener('change', async () => {
    if (!ctxPieceId) return;
    const z = Number(opZ.value);
    if (!Number.isFinite(z)) return;
    await store.setPieceLayer(ctxPieceId, z);
  });
  opOpacity.addEventListener('input', async () => {
    if (!ctxPieceId) return;
    const pct = Number(opOpacity.value);
    opOpacityVal.textContent = `${pct}%`;
    await store.setOpacity(ctxPieceId, pct / 100);
  });
  opComment.addEventListener('change', async () => {
    if (!ctxPieceId) return;
    await store.setComment(ctxPieceId, opComment.value);
  });
  root.querySelector('#op-replace')!.addEventListener('click', () => fileReplace.click());
  root.querySelector('#op-palette')!.addEventListener('click', async () => {
    if (ctxPieceId) await downloadPaletteFor(ctxPieceId);
  });
  root.querySelector('#op-delete')!.addEventListener('click', async () => {
    if (ctxPieceId) await deletePieceSmart(ctxPieceId);
  });

  stage.addEventListener('mousedown', async (e) => {
    const rect = stage.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = screenToWorld(camera, sx, sy);
    magnetPop.hidden = true;

    if (e.button === 2) {
      e.preventDefault();
      const near = store.index.query({ x: world.x - 1, y: world.y - 1, w: 2, h: 2 });
      const ordered = [...near].reverse();
      let hit: (typeof near)[number] | null = null;
      for (const p of ordered) {
        if (world.x < p.x || world.y < p.y || world.x >= p.x + p.w || world.y >= p.y + p.h) continue;
        const assetId = store.activeAssetId(p, performance.now());
        const data = await ensureAssetImageData(assetId);
        if (data && !sampleAlpha(data, world.x - p.x, world.y - p.y)) continue;
        hit = p;
        break;
      }
      if (hit) showObjectPanel(hit.id, e.clientX, e.clientY);
      else hideObjectPanel();
      return;
    }

    if (toolMode === 'eyedropper') {
      const sample = await sampleEyedropAt(world.x, world.y);
      updateEyeLoupe(e.clientX, e.clientY, sample);
      if (sample) {
        const hex = rgbToHex(sample);
        pinEyedropColor(hex);
        setStatus(hex, 'ok');
      } else {
        eyeHexEl.textContent = 'empty';
        eyeSwatchEl.style.background = 'transparent';
        eyeColorEl.hidden = false;
        pinnedHex = '';
      }
      return;
    }

    if (!objectPanel.contains(e.target as Node)) {
      // keep panel open only if clicking inside it; canvas click closes unless RMB
      if (e.button === 0) hideObjectPanel();
    }

    if (e.button === 1 || spaceDown) {
      e.preventDefault();
      panning = true;
      stage.classList.add('grabbing');
      lastPtr = { x: e.clientX, y: e.clientY };
      return;
    }

    if (e.button !== 0) return;

    const near = store.index.query({ x: world.x - 1, y: world.y - 1, w: 2, h: 2 });
    const ordered = [...near].reverse();
    let hit = null as ReturnType<typeof hitTest>;
    for (const p of ordered) {
      if (world.x < p.x || world.y < p.y || world.x >= p.x + p.w || world.y >= p.y + p.h) continue;
      const assetId = store.activeAssetId(p, performance.now());
      const data = await ensureAssetImageData(assetId);
      if (data && !sampleAlpha(data, world.x - p.x, world.y - p.y)) continue;
      hit = p;
      break;
    }
    if (!hit) hit = hitTest(near, world.x, world.y);

    if (hit) {
      store.select(hit.id);
      draggingPiece = true;
      dragOffset = { x: world.x - hit.x, y: world.y - hit.y };
    } else {
      store.select(null);
      panning = true;
      stage.classList.add('grabbing');
      lastPtr = { x: e.clientX, y: e.clientY };
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (toolMode === 'eyedropper') {
      const rect = stage.getBoundingClientRect();
      if (
        e.clientX < rect.left ||
        e.clientY < rect.top ||
        e.clientX > rect.right ||
        e.clientY > rect.bottom
      ) {
        eyeLoupeEl.hidden = true;
        return;
      }
      const world = screenToWorld(camera, e.clientX - rect.left, e.clientY - rect.top);
      void sampleEyedropAt(world.x, world.y).then((sample) => {
        updateEyeLoupe(e.clientX, e.clientY, sample);
      });
      return;
    }

    if (panning) {
      camera.x += e.clientX - lastPtr.x;
      camera.y += e.clientY - lastPtr.y;
      lastPtr = { x: e.clientX, y: e.clientY };
      requestRender();
      return;
    }
    if (draggingPiece && store.selectedId) {
      const rect = stage.getBoundingClientRect();
      const world = screenToWorld(camera, e.clientX - rect.left, e.clientY - rect.top);
      const meta = store.index.get(store.selectedId);
      if (!meta) return;
      const x = world.x - dragOffset.x;
      const y = world.y - dragOffset.y;
      const neighbors = store.index.neighborsNear(x, y, meta.w, meta.h, 64, meta.id);
      const snapped = snapPosition(
        x,
        y,
        meta.w,
        meta.h,
        neighbors,
        store.canvas.width,
        store.canvas.height,
        magnet,
      );
      void store.updatePieceTransform(meta.id, { x: snapped.x, y: snapped.y });
    }
  });

  window.addEventListener('mouseup', () => {
    panning = false;
    draggingPiece = false;
    stage.classList.remove('grabbing');
  });

  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const rect = stage.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      zoomAt(camera, factor, e.clientX - rect.left, e.clientY - rect.top);
      requestRender();
    },
    { passive: false },
  );

  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('mousedown', (e) => {
    if (!magnetPop.hidden && !btnMagnet.contains(e.target as Node) && !magnetPop.contains(e.target as Node)) {
      magnetPop.hidden = true;
    }
    if (objectPanel.hidden) return;
    if (objectPanel.contains(e.target as Node)) return;
    if (stage.contains(e.target as Node)) return;
    hideObjectPanel();
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') spaceDown = true;
    if (e.key === 'Escape') {
      if (toolMode === 'eyedropper') setEyedropMode(false);
      hideObjectPanel();
      magnetPop.hidden = true;
      settingsModal.hidden = true;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && store.selectedId) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      void deletePieceSmart(store.selectedId);
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') spaceDown = false;
  });

  window.addEventListener('resize', () => requestRender());
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

function openDownloadModal(
  root: HTMLElement,
  workspace: ProjectWorkspace,
  saves: SaveListItem[],
  makeHtml: (ids: string[]) => Promise<{ html: string; bytes: number }>,
  setStatus: (t: string, k?: '' | 'ok' | 'err') => void,
  title: string,
): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const saveRows =
    workspace.linked && saves.length
      ? saves
          .map(
            (s) =>
              `<label class="check-row"><input type="checkbox" data-save="${s.id}" checked /> ${s.id} (${s.pieceCount})</label>`,
          )
          .join('')
      : '<p class="hint">No linked saves — will export current working copy.</p>';

  backdrop.innerHTML = `
    <div class="modal" role="dialog">
      <h2>Download HTML</h2>
      <p class="hint">Choose which save versions to embed.</p>
      <label class="check-row"><input type="checkbox" id="dl-working" /> Also include working copy</label>
      <div class="check-list">${saveRows}</div>
      <div class="actions">
        <button type="button" class="primary" id="dl-go">Build & download</button>
        <button type="button" class="ghost" id="dl-close">Close</button>
      </div>
      <p class="status" id="dl-status"></p>
    </div>
  `;
  root.appendChild(backdrop);
  const status = backdrop.querySelector('#dl-status') as HTMLElement;

  backdrop.querySelector('#dl-close')!.addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove();
  });

  backdrop.querySelector('#dl-go')!.addEventListener('click', async () => {
    try {
      status.textContent = 'Building…';
      status.className = 'status';
      const ids = [...backdrop.querySelectorAll<HTMLInputElement>('input[data-save]:checked')].map(
        (el) => el.dataset.save!,
      );
      const includeWorking = (backdrop.querySelector('#dl-working') as HTMLInputElement).checked;
      let versionIds = ids;
      if (!workspace.linked || (ids.length === 0 && !includeWorking)) {
        versionIds = [];
      }
      const { html, bytes } = await makeHtml(versionIds);
      let finalHtml = html;
      let finalBytes = bytes;
      if (includeWorking && versionIds.length > 0) {
        const working = await makeHtml([]);
        const payloadWorking = JSON.parse(
          working.html.match(/<script id="payload"[^>]*>([\s\S]*?)<\/script>/)![1]!,
        ) as ExportPayload;
        const payloadSaves = JSON.parse(
          html.match(/<script id="payload"[^>]*>([\s\S]*?)<\/script>/)![1]!,
        ) as ExportPayload;
        const merged: ExportPayload = {
          title: payloadSaves.title,
          assets: { ...(payloadSaves.assets ?? {}), ...(payloadWorking.assets ?? {}) },
          versions: [...payloadSaves.versions, ...payloadWorking.versions],
          style: payloadSaves.style ?? payloadWorking.style,
        };
        finalHtml = buildSelfContainedHtml(merged);
        finalBytes = estimatePayloadBytes(merged);
      }
      const mb = finalBytes / (1024 * 1024);
      const name = `${slugify(title) || 'pixel-canvas'}.html`;
      downloadTextFile(name, finalHtml);
      status.textContent = `Downloaded ${name} (~${mb.toFixed(2)} MB)`;
      status.className = 'status ok';
      setStatus(`Downloaded ${name}`, 'ok');
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : 'Download failed';
      status.className = 'status err';
    }
  });
}

function openPublishModal(
  root: HTMLElement,
  makeHtml: () => Promise<{ html: string; bytes: number }>,
  setStatus: (t: string, k?: '' | 'ok' | 'err') => void,
): void {
  const existing = loadPublishSettings();
  const stepsHtml = PUBLISH_INSTRUCTIONS.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<li>${line.replace(/^\d+\.\s*/, '')}</li>`)
    .join('');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal settings-modal" role="dialog" aria-modal="true">
      <h2>Publish</h2>
      <p class="hint">Uploads one self-contained HTML viewer to <strong>your</strong> GitHub Pages. Your project folder stays on this PC.</p>
      <ol class="publish-steps">${stepsHtml}</ol>
      <div class="section-title">Connection</div>
      <label class="field">Personal access token
        <input type="password" id="pub-token" placeholder="ghp_…" autocomplete="off" value="${existing?.token ?? ''}" />
      </label>
      <label class="field">Owner (username or org)
        <input type="text" id="pub-owner" placeholder="your-github-name" value="${existing?.owner ?? ''}" />
      </label>
      <label class="field">Repository
        <input type="text" id="pub-repo" placeholder="my-canvas" value="${existing?.repo ?? ''}" />
      </label>
      <label class="field">Branch
        <input type="text" id="pub-branch" value="${existing?.branch ?? 'gh-pages'}" />
      </label>
      <div class="actions">
        <button type="button" class="primary" id="pub-go">Publish now</button>
        <button type="button" id="pub-save">Save connection</button>
        <button type="button" class="ghost" id="pub-clear">Disconnect</button>
        <button type="button" class="ghost" id="pub-close">Close</button>
      </div>
      <p class="status" id="pub-status"></p>
    </div>
  `;
  root.appendChild(backdrop);

  const pubStatus = backdrop.querySelector('#pub-status') as HTMLElement;

  const readSettings = (): PublishSettings => ({
    token: (backdrop.querySelector('#pub-token') as HTMLInputElement).value.trim(),
    owner: (backdrop.querySelector('#pub-owner') as HTMLInputElement).value.trim(),
    repo: (backdrop.querySelector('#pub-repo') as HTMLInputElement).value.trim(),
    branch: (backdrop.querySelector('#pub-branch') as HTMLInputElement).value.trim() || 'gh-pages',
  });

  backdrop.querySelector('#pub-close')!.addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove();
  });

  backdrop.querySelector('#pub-save')!.addEventListener('click', () => {
    const s = readSettings();
    if (!s.token || !s.owner || !s.repo) {
      pubStatus.textContent = 'Token, owner, and repository are required.';
      pubStatus.className = 'status err';
      return;
    }
    savePublishSettings(s);
    pubStatus.textContent = 'Saved in this browser only (localStorage).';
    pubStatus.className = 'status ok';
  });

  backdrop.querySelector('#pub-clear')!.addEventListener('click', () => {
    clearPublishSettings();
    (backdrop.querySelector('#pub-token') as HTMLInputElement).value = '';
    pubStatus.textContent = 'Disconnected.';
    pubStatus.className = 'status';
  });

  backdrop.querySelector('#pub-go')!.addEventListener('click', async () => {
    const s = readSettings();
    if (!s.token || !s.owner || !s.repo) {
      pubStatus.textContent = 'Fill in token, owner, and repository first.';
      pubStatus.className = 'status err';
      return;
    }
    savePublishSettings(s);
    const goBtn = backdrop.querySelector('#pub-go') as HTMLButtonElement;
    goBtn.disabled = true;
    try {
      pubStatus.textContent = 'Building HTML…';
      pubStatus.className = 'status';
      const { html, bytes } = await makeHtml();
      const mb = bytes / (1024 * 1024);
      if (mb > 50) {
        pubStatus.textContent = `File too large (~${mb.toFixed(1)} MB). Remove pieces or publish fewer versions.`;
        pubStatus.className = 'status err';
        return;
      }
      pubStatus.textContent = `Uploading (~${mb.toFixed(1)} MB) to ${s.owner}/${s.repo}…`;
      const { url } = await publishHtmlFile(s, html);
      let copied = false;
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch {
        /* ignore */
      }
      pubStatus.innerHTML =
        `Published. <a href="${url}" target="_blank" rel="noopener">${url}</a>` +
        (copied ? ' · link copied' : '') +
        '<br><span class="hint">Pages may take 1–2 minutes to update.</span>';
      pubStatus.className = 'status ok';
      setStatus(`Published to ${url}`, 'ok');
    } catch (err) {
      pubStatus.textContent = err instanceof Error ? err.message : 'Publish failed';
      pubStatus.className = 'status err';
    } finally {
      goBtn.disabled = false;
    }
  });
}
