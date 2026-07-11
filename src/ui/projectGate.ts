import { ProjectWorkspace, peekProjectTitle } from '../project/workspace';
import * as db from '../db/indexedDb';

export type ProjectBootMode = 'create' | 'open';

/**
 * First-run screen: create / open / recent project folder, then hand off to studio.
 */
export async function showProjectGate(root: HTMLElement): Promise<ProjectBootMode> {
  root.classList.add('project-gate');
  root.innerHTML = `
    <div class="gate">
      <div class="gate-brand">Your <span class="ase">Ase</span>Personal Canvas</div>
      <p class="gate-by">By MOZIK~REPLICA</p>
      <p class="gate-lead">Choose a project. Assets and versions stay in a folder on your disk.</p>
      <div class="gate-recent" id="gate-recent" hidden>
        <p class="hint">Recent project</p>
        <button type="button" class="primary" id="gate-recent-btn"></button>
      </div>
      <div class="gate-actions">
        <button type="button" class="primary" id="gate-create">Create project</button>
        <button type="button" id="gate-open">Open project</button>
      </div>
      <p class="status" id="gate-status"></p>
      <p class="hint">Chrome or Edge required (File System Access API).</p>
    </div>
  `;

  const status = root.querySelector('#gate-status') as HTMLElement;
  const recentWrap = root.querySelector('#gate-recent') as HTMLElement;
  const recentBtn = root.querySelector('#gate-recent-btn') as HTMLButtonElement;

  const setStatus = (t: string, kind: '' | 'ok' | 'err' = '') => {
    status.textContent = t;
    status.className = `status${kind ? ` ${kind}` : ''}`;
  };

  const existing = await db.loadDirectoryHandle();
  if (existing) {
    recentWrap.hidden = false;
    const authorTitle = await peekProjectTitle(existing);
    recentBtn.textContent = `Recent: ${authorTitle || existing.name}`;
  }

  const workspace = new ProjectWorkspace();

  return new Promise((resolve) => {
    const finish = (mode: ProjectBootMode) => {
      root.classList.remove('project-gate');
      root.innerHTML = '';
      resolve(mode);
    };

    root.querySelector('#gate-create')!.addEventListener('click', async () => {
      try {
        setStatus('Pick a folder for the new project…');
        await workspace.pickAndLinkFolder();
        const project = await workspace.readProjectFile();
        if (project.currentSaveId) {
          setStatus('Folder already has saves — opening as existing project', 'ok');
          finish('open');
          return;
        }
        finish('create');
      } catch (err) {
        setStatus(err instanceof Error ? err.message : 'Could not create project', 'err');
      }
    });

    root.querySelector('#gate-open')!.addEventListener('click', async () => {
      try {
        setStatus('Pick a project folder…');
        await workspace.pickAndLinkFolder();
        finish('open');
      } catch (err) {
        setStatus(err instanceof Error ? err.message : 'Could not open project', 'err');
      }
    });

    recentBtn.addEventListener('click', async () => {
      try {
        setStatus('Requesting folder access…');
        const ok = await workspace.restoreSavedHandle();
        if (!ok) {
          setStatus('No access to the recent folder — use Open and pick it again', 'err');
          return;
        }
        finish('open');
      } catch (err) {
        setStatus(err instanceof Error ? err.message : 'Could not open recent project', 'err');
      }
    });
  });
}
