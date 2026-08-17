// Bootstrap + hash router.

import { migrate } from './storage.js';
import { initTheme } from './theme.js';
import { renderHome } from './views/home.js';
import { renderExam, teardownExam } from './views/exam.js';
import { renderResults } from './views/results.js';
import { renderProgress } from './views/progress.js';
import { renderSettings } from './views/settings.js';
import { getSession, endSession } from './engine.js';
import { confirmModal, esc, setView } from './ui.js';

migrate();
initTheme();

/** The hash currently rendered, so a cancelled navigation can be undone. */
let currentHash = location.hash;
/** Set while we bounce the hash back, so the restore doesn't re-prompt. */
let restoringHash = false;

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
  // This hashchange is our own undo of a cancelled navigation — the exam view
  // was never torn down, so there is nothing to re-render.
  if (restoringHash) {
    restoringHash = false;
    return;
  }

  const requestedHash = location.hash;
  const parts = (requestedHash.replace(/^#\/?/, '') || 'home').split('/').filter(Boolean);
  const [screen, ...args] = parts;

  const session = getSession();
  const leavingExam = screen !== 'exam' && session;

  // Any route out of an unsubmitted exam discards it — including the brand
  // link and the browser back button, not just the in-view Exit button.
  if (leavingExam && !session.submitted) {
    const confirmed = await confirmModal({
      title: 'Exit this session?',
      body: '<p>Your progress in this session will be discarded and nothing will be saved to your history.</p>',
      confirmText: 'Exit without saving',
      cancelText: 'Keep going',
      danger: true,
    });
    if (!confirmed) {
      // Only arm the guard if the assignment will actually fire a hashchange;
      // otherwise the flag would swallow the next real navigation.
      if (location.hash !== currentHash) {
        restoringHash = true;
        location.hash = currentHash;
      }
      return;
    }
  }

  if (leavingExam) {
    teardownExam();
    endSession();
  }

  currentHash = requestedHash;

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
