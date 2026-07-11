import type { PublishSettings } from '../types';

const STORAGE_KEY = 'pps-publish-settings';

export function loadPublishSettings(): PublishSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PublishSettings;
    if (!parsed.token || !parsed.owner || !parsed.repo) return null;
    return {
      token: parsed.token,
      owner: parsed.owner,
      repo: parsed.repo,
      branch: parsed.branch || 'gh-pages',
    };
  } catch {
    return null;
  }
}

export function savePublishSettings(settings: PublishSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function clearPublishSettings(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function isPublishConnected(): boolean {
  return loadPublishSettings() !== null;
}

async function gh(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/vnd.github+json');
  headers.set('X-GitHub-Api-Version', '2022-11-28');
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(`https://api.github.com${path}`, { ...init, headers });
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

async function readGhError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const data = JSON.parse(text) as { message?: string; errors?: Array<{ message?: string }> };
    const extra = data.errors?.map((e) => e.message).filter(Boolean).join('; ');
    const msg = [data.message, extra].filter(Boolean).join(' — ');
    if (msg) return msg;
  } catch {
    /* use raw */
  }
  if (res.status === 401) return 'Invalid or expired token.';
  if (res.status === 403) return 'Token lacks permission (need repo access), or rate limited.';
  if (res.status === 404) return 'Repository not found. Check owner/repo and token access.';
  if (res.status === 422) return 'GitHub rejected the request (branch or file conflict).';
  return text.slice(0, 200) || `HTTP ${res.status}`;
}

async function ensureBranch(settings: PublishSettings, fromBranch = 'main'): Promise<void> {
  const { owner, repo, branch, token } = settings;
  const refRes = await gh(`/repos/${owner}/${repo}/git/ref/heads/${branch}`, token);
  if (refRes.ok) return;

  let baseSha: string | null = null;
  for (const candidate of [fromBranch, 'master']) {
    const baseRef = await gh(`/repos/${owner}/${repo}/git/ref/heads/${candidate}`, token);
    if (baseRef.ok) {
      const data = (await baseRef.json()) as { object: { sha: string } };
      baseSha = data.object.sha;
      break;
    }
  }
  if (!baseSha) {
    const repoRes = await gh(`/repos/${owner}/${repo}`, token);
    if (!repoRes.ok) throw new Error(await readGhError(repoRes));
    const repoData = (await repoRes.json()) as { default_branch: string };
    const def = await gh(`/repos/${owner}/${repo}/git/ref/heads/${repoData.default_branch}`, token);
    if (!def.ok) throw new Error('Cannot resolve default branch. Push at least one commit to the repo first.');
    baseSha = ((await def.json()) as { object: { sha: string } }).object.sha;
  }

  const create = await gh(`/repos/${owner}/${repo}/git/refs`, token, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
  });
  if (!create.ok && create.status !== 422) {
    throw new Error(`Failed to create branch ${branch}: ${await readGhError(create)}`);
  }
}

/** Best-effort: turn on GitHub Pages from the publish branch. */
async function ensureGitHubPages(settings: PublishSettings): Promise<void> {
  const { owner, repo, branch, token } = settings;
  const body = {
    build_type: 'legacy',
    source: { branch, path: '/' },
  };

  const existing = await gh(`/repos/${owner}/${repo}/pages`, token);
  if (existing.ok) {
    const update = await gh(`/repos/${owner}/${repo}/pages`, token, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    if (!update.ok && update.status !== 409) {
      // Non-fatal: file is uploaded; user can enable Pages manually
      console.warn('Pages update:', await readGhError(update));
    }
    return;
  }

  const create = await gh(`/repos/${owner}/${repo}/pages`, token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!create.ok && create.status !== 409) {
    console.warn('Pages create:', await readGhError(create));
  }
}

export async function publishHtmlFile(
  settings: PublishSettings,
  html: string,
): Promise<{ url: string }> {
  await ensureBranch(settings);

  const { owner, repo, branch, token } = settings;
  const path = 'index.html';
  const content = toBase64(html);

  let sha: string | undefined;
  const existing = await gh(
    `/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    token,
  );
  if (existing.ok) {
    const data = (await existing.json()) as { sha: string };
    sha = data.sha;
  }

  const put = await gh(`/repos/${owner}/${repo}/contents/${path}`, token, {
    method: 'PUT',
    body: JSON.stringify({
      message: 'Publish pixel canvas snapshot',
      content,
      branch,
      ...(sha ? { sha } : {}),
    }),
  });

  if (!put.ok) {
    throw new Error(`Upload failed: ${await readGhError(put)}`);
  }

  await ensureGitHubPages(settings);

  return { url: `https://${owner}.github.io/${repo}/` };
}

/** Short steps shown in the Publish modal. */
export const PUBLISH_INSTRUCTIONS = `
1. Create a public GitHub repo (or use an existing one).
2. Create a Personal Access Token (classic) with the repo scope:
   GitHub → Settings → Developer settings → Personal access tokens.
3. Paste token, owner, and repo name below → Publish now.
4. Studio uploads one self-contained index.html to the gh-pages branch and tries to enable Pages.
5. After 1–2 minutes open https://OWNER.github.io/REPO/

Your project folder stays on your PC. Publish only shares a viewer snapshot.
Re-publish updates the same link.
`.trim();
