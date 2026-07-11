import type { ExportViewerStyle, StudioStylePack, StyleColors, ToolIconId } from '../types';

export const TOOL_ICON_IDS: ToolIconId[] = [
  'upload',
  'fit',
  'magnet',
  'grid',
  'outline',
  'eyedrop',
  'solo',
  'save',
  'html',
  'publish',
  'settings',
];

export const DEFAULT_TOOL_EMOJI: Record<ToolIconId, string> = {
  upload: '➕',
  fit: '🖼️',
  magnet: '🧲',
  grid: '🔲',
  outline: '🟧',
  eyedrop: '💉',
  solo: '👁️',
  save: '💾',
  html: '📄',
  publish: '🚀',
  settings: '⚙️',
};

/** Minimal purple–green default (matches gate). */
export const DEFAULT_STYLE_COLORS: StyleColors = {
  bg1: '#16121f',
  bg2: '#1e1a28',
  title: '#e8e6f0',
  grid: 'rgba(109,207,155,0.28)',
  accent: '#6dcf9b',
  topbar: '#2a2438',
  button: '#3d2a5c',
  author: '#9b8fc0',
};

export function createDefaultStylePack(): StudioStylePack {
  return {
    version: 1,
    name: 'Default',
    showTitle: true,
    colors: { ...DEFAULT_STYLE_COLORS },
    authorText: '',
    icons: {},
  };
}

export function cloneStylePack(pack: StudioStylePack): StudioStylePack {
  return {
    version: 1,
    name: pack.name,
    showTitle: pack.showTitle,
    colors: { ...pack.colors },
    authorText: pack.authorText,
    icons: { ...pack.icons },
    topbarImage: pack.topbarImage,
  };
}

export function toExportViewerStyle(pack: StudioStylePack, title: string): ExportViewerStyle {
  return {
    showTitle: pack.showTitle,
    title,
    colors: { ...pack.colors },
    authorText: pack.authorText,
    topbarImage: pack.topbarImage,
  };
}

function isHexOrCssColor(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0 && s.length < 80;
}

/** Parse JSON from style.json / .ppsstyle; returns default on failure. */
export function parseStylePack(raw: unknown): StudioStylePack {
  const base = createDefaultStylePack();
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Record<string, unknown>;
  if (typeof o.name === 'string') base.name = o.name.slice(0, 64);
  if (typeof o.showTitle === 'boolean') base.showTitle = o.showTitle;
  if (typeof o.authorText === 'string') base.authorText = o.authorText.slice(0, 500);
  if (typeof o.topbarImage === 'string' && o.topbarImage.startsWith('data:image/')) {
    base.topbarImage = o.topbarImage;
  }
  const colors = o.colors;
  if (colors && typeof colors === 'object') {
    const c = colors as Record<string, unknown>;
    for (const key of Object.keys(DEFAULT_STYLE_COLORS) as (keyof StyleColors)[]) {
      if (isHexOrCssColor(c[key])) base.colors[key] = c[key];
    }
    // Legacy single `bg` → bg1; infer bg2 if missing
    if (!isHexOrCssColor(c.bg1) && isHexOrCssColor(c.bg)) {
      base.colors.bg1 = c.bg;
    }
    if (!isHexOrCssColor(c.bg2) && isHexOrCssColor(c.panel)) {
      base.colors.bg2 = c.panel;
    } else if (!isHexOrCssColor(c.bg2) && isHexOrCssColor(c.bg)) {
      base.colors.bg2 = c.bg;
    }
  }
  const icons = o.icons;
  if (icons && typeof icons === 'object') {
    for (const id of TOOL_ICON_IDS) {
      const v = (icons as Record<string, unknown>)[id];
      if (typeof v === 'string' && v.startsWith('data:image/')) base.icons[id] = v;
    }
  }
  return base;
}

export function serializeStylePack(pack: StudioStylePack): string {
  return JSON.stringify(pack, null, 2);
}

/** Apply CSS variables and topbar chrome to #app / .topbar. */
export function applyStyleToDom(root: HTMLElement, pack: StudioStylePack, projectTitle: string): void {
  const c = pack.colors;
  root.style.setProperty('--bg', c.bg1);
  root.style.setProperty('--bg1', c.bg1);
  root.style.setProperty('--bg2', c.bg2);
  root.style.setProperty('--ink', c.title);
  root.style.setProperty('--title', c.title);
  root.style.setProperty('--grid-color', c.grid);
  root.style.setProperty('--accent', c.accent);
  root.style.setProperty('--topbar-bg', c.topbar);
  root.style.setProperty('--button-bg', c.button);
  root.style.setProperty('--author', c.author);
  root.style.setProperty('--panel', c.bg2);
  root.style.setProperty('--muted', c.author);

  const brand = root.querySelector('.brand') as HTMLElement | null;
  if (brand) {
    brand.hidden = !pack.showTitle;
    brand.textContent = projectTitle || 'Untitled';
    brand.style.color = c.title;
  }

  const authorEl = root.querySelector('#brand-author') as HTMLElement | null;
  if (authorEl) {
    const text = pack.authorText.trim();
    authorEl.hidden = !text;
    authorEl.innerHTML = linkifyAuthor(text);
    authorEl.style.color = c.author;
  }

  const topbar = root.querySelector('.topbar') as HTMLElement | null;
  if (topbar) {
    if (pack.topbarImage) {
      topbar.style.backgroundImage = `url("${pack.topbarImage}")`;
      topbar.style.backgroundSize = 'cover';
      topbar.style.backgroundPosition = 'center';
      topbar.style.backgroundColor = c.topbar;
    } else {
      topbar.style.backgroundImage = 'none';
      topbar.style.backgroundColor = c.topbar;
      topbar.style.background = c.topbar;
    }
  }

  applyToolIcons(root, pack);
}

const ICON_BUTTONS: Array<[ToolIconId, string]> = [
  ['upload', '#btn-upload'],
  ['fit', '#btn-fit'],
  ['magnet', '#btn-magnet'],
  ['grid', '#btn-grid'],
  ['outline', '#btn-outline'],
  ['eyedrop', '#btn-eyedrop'],
  ['solo', '#btn-solo-layer'],
  ['save', '#btn-save-version'],
  ['html', '#btn-download'],
  ['publish', '#btn-publish'],
  ['settings', '#btn-settings'],
];

function applyToolIcons(root: HTMLElement, pack: StudioStylePack): void {
  for (const [id, sel] of ICON_BUTTONS) {
    const btn = root.querySelector(sel) as HTMLButtonElement | null;
    if (!btn) continue;
    const custom = pack.icons[id];
    const emoji = DEFAULT_TOOL_EMOJI[id];
    btn.replaceChildren();
    if (custom) {
      const img = document.createElement('img');
      img.className = 'tool-icon';
      img.width = 32;
      img.height = 32;
      img.alt = id;
      img.src = custom;
      btn.appendChild(img);
    } else {
      btn.textContent = emoji;
    }
  }
}

/** Turn bare URLs into links; preserve line breaks; escape HTML otherwise. */
export function linkifyAuthor(text: string): string {
  if (!text) return '';
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, '<br>');
  return escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>',
  );
}

export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Ensure PNG/WebP/JPEG is roughly icon-sized; resize to 32×32 nearest-neighbor. */
export async function normalizeIconTo32DataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return fileToDataUrl(file);
  }
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, 32, 32);
  ctx.drawImage(bitmap, 0, 0, 32, 32);
  bitmap.close();
  return canvas.toDataURL('image/png');
}

export function cssColorToHex(css: string): string {
  const t = css.trim();
  if (/^#[0-9a-fA-F]{6}/.test(t)) return t.slice(0, 7).toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(t)) {
    const r = t[1]!;
    const g = t[2]!;
    const b = t[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const m = t.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) {
    return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
  }
  return '#c8c2b4';
}

export function hexToRgbaGrid(hex: string, alpha = 0.28): string {
  const h = cssColorToHex(hex);
  const r = Number.parseInt(h.slice(1, 3), 16);
  const g = Number.parseInt(h.slice(3, 5), 16);
  const b = Number.parseInt(h.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
