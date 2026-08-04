// Bootstrap + hash router.

import { migrate } from './storage.js';
import { renderHome } from './views/home.js';
import { renderExam, teardownExam } from './views/exam.js';
import { renderResults } from './views/results.js';
import { renderProgress } from './views/progress.js';
import { renderSettings } from './views/settings.js';
import { getSession, endSession } from './engine.js';
import { esc, setView } from './ui.js';

migrate();

function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function markNav(name) {
  document.querySelectorAll('[data-nav]').forEach((a) => {
    a.classList.toggle('active', a.dataset.nav === name);
  });
}

async function route() {
  const parts = (location.hash.replace(/^#\/?/, '') || 'home').split('/').filter(Boolean);
  const [screen, ...args] = parts;

  // Leaving an in-progress exam by any route other than results discards it.
  if (screen !== 'exam' && getSession()) {
    teardownExam();
    endSession();
  }

  try {
    switch (screen) {
      case 'exam':
        markNav(null);
        await renderExam(navigate, { mode: args[0], sectionId: args[1] ?? null });
        break;

      case 'results':
        markNav(null);
        await renderResults(navigate, args[0]);
        break;

      case 'progress':
        markNav('progress');
        renderProgress(navigate);
        break;

      case 'settings':
        markNav('settings');
        await renderSettings(navigate);
        break;

      case 'home':
      default:
        markNav('home');
        await renderHome(navigate);
        break;
    }
  } catch (err) {
    console.error(err);
    setView(`<h1>Something went wrong</h1>
      <div class="notice error">${esc(err.message)}</div>
      <p class="small muted mt">
        If this is a loading error, make sure you are running the app through a local server
        (<span class="mono">./serve.command</span> or <span class="mono">python3 -m http.server</span>)
        rather than opening <span class="mono">index.html</span> directly — browsers block
        JavaScript modules and local file reads over <span class="mono">file://</span>.
      </p>
      <p class="mt"><a href="#/home">Back to home</a></p>`);
  }
}

window.addEventListener('hashchange', route);

// Warn before a refresh/close drops an in-progress session.
window.addEventListener('beforeunload', (e) => {
  const s = getSession();
  if (s && !s.submitted && s.answeredCount > 0) {
    e.preventDefault();
    e.returnValue = '';
  }
});

route();
