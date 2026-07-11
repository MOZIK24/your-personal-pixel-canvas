# Your AsePersonal Canvas

Local-first pixel canvas studio: place PNG / Aseprite pieces on a huge canvas, save versions in a folder on your PC, share a single self-contained HTML.

**Chrome or Edge required** (File System Access API).

## Open Studio (no Node)

**https://MOZIK24.github.io/your-personal-pixel-canvas/**

1. **Create** or **Open** a project folder on your disk.
2. Drop / upload pieces, arrange, save versions.
3. **Download HTML** for a local viewer, or **Publish** to *your own* GitHub Pages (below).

Your project (`assets/`, `saves/`, `project.json`) stays on your computer — not in this repository.

## Publish (your snapshot)

Uploads the same HTML as Download to **your** public repo’s `gh-pages` branch.

1. Create a public GitHub repository for the snapshot.
2. Create a Personal Access Token (classic) with the `repo` scope.
3. In Studio → **Publish** → token, owner, repo → **Publish now**.
4. Open `https://OWNER.github.io/REPO/` (may take 1–2 minutes).

The token stays only in this browser’s `localStorage`. Re-publish updates the same link.

## Develop locally

Need [Node.js LTS](https://nodejs.org/) only to change Studio itself:

```bash
npm install
npm run dev
```

Windows helper: [`start-studio.bat`](start-studio.bat) → http://127.0.0.1:5173/

```bash
npm run build
```

Deploy of this editor: [`.github/workflows/deploy-studio.yml`](.github/workflows/deploy-studio.yml) (push to `main` → GitHub Pages).

## Credit

- [mozik24](https://github.com/mozik24) — idea
- Legacy pipeline: [`legacy/`](legacy/)
