// Progress dashboard: history, trends, subtopic heatmap, weak-area drill.

import { MODES, SECTIONS } from '../config.js';
import { clearAttempts, getAttempts } from '../storage.js';
import { weakSubtopics } from '../engine.js';
import {
  band,
  overallStats,
  pct,
  scoreHistory,
  sectionStats,
  sparklineSVG,
  subtopicStats,
} from '../stats.js';
import { formatDuration } from '../timer.js';
import { barRow, confirmModal, esc, formatDateTime, on, setView } from '../ui.js';

export function renderProgress(navigate) {
  const attempts = getAttempts();

  if (!attempts.length) {
    setView(`
      <h1>Progress</h1>
      <div class="empty">
        <p>No sessions yet.</p>
        <p><a href="#/home">Take a practice test</a> and your scores, trends, and weak areas will appear here.</p>
      </div>`);
    return;
  }

  const stats = overallStats();
  const history = scoreHistory({ limit: 30 });
  const sections = sectionStats();
  const subtopics = subtopicStats();
  const weak = weakSubtopics(5);

  const sectionRows = sections
    .map((s) => barRow(s.name, s.correct, s.total, s.accuracy, band(s.accuracy)))
    .join('');

  const subtopicBlocks = subtopics
    .map((group) => {
      const rows = group.rows
        .map((r) => barRow(r.name, r.correct, r.total, r.accuracy, r.total ? band(r.accuracy) : ''))
        .join('');
      return `<div class="mt">
        <h3 class="small dim" style="text-transform:uppercase;letter-spacing:.05em">${esc(group.sectionName)}</h3>
        ${rows}
      </div>`;
    })
    .join('');

  const historyRows = attempts
    .slice()
    .reverse()
    .slice(0, 25)
    .map((a) => {
      const score = pct(a.correct, a.total);
      const scope = a.sectionScope ? SECTIONS[a.sectionScope]?.short : null;
      return `<tr>
        <td>${formatDateTime(a.finishedAt)}</td>
        <td>${esc(MODES[a.mode]?.name ?? a.mode)}${scope ? ` <span class="dim">(${esc(scope)})</span>` : ''}</td>
        <td class="num">${a.correct}/${a.total}</td>
        <td class="num"><strong>${score}%</strong></td>
        <td class="num dim">${formatDuration(a.durationMs)}</td>
        <td class="num"><a href="#/results/${esc(a.id)}">Review</a></td>
      </tr>`;
    })
    .join('');

  setView(`
    <div class="spread">
      <h1 class="mb-0">Progress</h1>
      <button class="btn btn-sm btn-danger" data-act="reset">Clear history</button>
    </div>

    <div class="stat-grid mt">
      <div class="stat"><div class="val">${stats.overallAccuracy}%</div><div class="lbl">Overall accuracy</div></div>
      <div class="stat"><div class="val">${stats.bestScore}%</div><div class="lbl">Best score</div></div>
      <div class="stat"><div class="val">${stats.questionsAnswered}</div><div class="lbl">Questions answered</div></div>
      <div class="stat"><div class="val">${stats.fullExamCount}</div><div class="lbl">Full exams</div></div>
    </div>

    ${history.length > 1 ? `
      <div class="card mt-lg">
        <h3>Score trend</h3>
        <p class="tiny dim">Last ${history.length} sessions, oldest to newest.</p>
        ${sparklineSVG(history)}
      </div>` : ''}

    ${weak.length ? `
      <div class="card mt-lg">
        <h3>Weakest areas</h3>
        <p class="tiny dim">Subtopics where your accuracy is lowest, with at least 3 questions attempted.</p>
        <ul class="small" style="margin:.5rem 0 1rem;padding-left:1.2rem">
          ${weak.map((w) => {
            const [sectionId, subId] = w.key.split('::');
            const name = SECTIONS[sectionId]?.subtopics?.[subId]?.name ?? subId;
            return `<li><strong>${esc(name)}</strong>
              <span class="dim">— ${Math.round(w.accuracy * 100)}% over ${w.total} question${w.total === 1 ? '' : 's'}
              (${esc(SECTIONS[sectionId]?.short ?? sectionId)})</span></li>`;
          }).join('')}
        </ul>
        <button class="btn btn-primary" data-act="drill">Drill these areas</button>
      </div>` : `
      <div class="notice info mt-lg">
        Answer at least 3 questions in a subtopic and it becomes eligible for weak-area analysis.
      </div>`}

    <h2 class="mt-lg">Accuracy by section</h2>
    ${sectionRows}

    <h2 class="mt-lg">Accuracy by subtopic</h2>
    ${subtopicBlocks}

    <h2 class="mt-lg">Session history</h2>
    <table class="history">
      <thead><tr>
        <th>When</th><th>Mode</th>
        <th style="text-align:right">Raw</th>
        <th style="text-align:right">Score</th>
        <th style="text-align:right">Time</th>
        <th style="text-align:right"></th>
      </tr></thead>
      <tbody>${historyRows}</tbody>
    </table>
  `);

  const view = document.getElementById('view');

  on(view, '[data-act="drill"]', 'click', () => navigate('#/exam/drill'));

  on(view, '[data-act="reset"]', 'click', async () => {
    const ok = await confirmModal({
      title: 'Clear all history?',
      body: `<p>This permanently deletes all ${attempts.length} saved sessions, your score trend, and your weak-area analysis.</p>
             <p>Your question bank and any generated questions are not affected.</p>`,
      confirmText: 'Delete history',
      danger: true,
    });
    if (!ok) return;
    clearAttempts();
    renderProgress(navigate);
  });
}
