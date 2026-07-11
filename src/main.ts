import { showProjectGate } from './ui/projectGate';
import { mountStudio } from './ui/studioApp';

const app = document.querySelector('#app');
if (!app) throw new Error('#app missing');

void (async () => {
  const mode = await showProjectGate(app as HTMLElement);
  await mountStudio(app as HTMLElement, { mode });
})();
