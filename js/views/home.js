// Home: mode selection.

import {
  SECTIONS,
  SECTION_ORDER,
  TOTAL_MINUTES,
  TOTAL_QUESTIONS,
} from '../config.js';
import { bankCounts, loadBank } from '../bank.js';
import { getSettings } from '../storage.js';
import { weakSubtopics } from '../engine.js';
import { overallStats } from '../stats.js';
import { esc, on, setView } from '../ui.js';

export async function renderHome(navigate) {
  await loadBank();
  const counts = bankCounts();
  const settings = getSettings();
  const stats = overallStats();
  const weak = weakSubtopics(3);

  const sectionRows = SECTION_ORDER.map((id) => {
    const s = SECTIONS[id];
    const c = counts[id];
    const thin = c.total < c.needed;
    return `<tr>
      <td><strong>${esc(s.name)}</strong><div class="tiny dim">${esc(s.blurb)}</div></td>
      <td class="num nowrap">${s.questionCount} q</td>
      <td class="num nowrap">${s.timeLimitMinutes} min</td>
      <td class="num nowrap ${thin ? 'dim' : ''}">${c.total} in bank</td>
    </tr>`;
  }).join('');

  const shortSections = SECTION_ORDER.filter((id) => counts[id].total < counts[id].needed);

  setView(`
    <h1>Foreign Service Officer Test</h1>
    <p class="lede">
      Practice for the redesigned FSOT (Fall 2025 and newer): three multiple-choice
      sections, ${TOTAL_QUESTIONS} questions, ${TOTAL_MINUTES} minutes. No situational
      judgment section, no essay.
    </p>

    ${stats.attemptCount > 0 ? `
      <div class="row small muted" style="margin-bottom:1.25rem">
        <span><strong>${stats.attemptCount}</strong> session${stats.attemptCount === 1 ? '' : 's'}</span>
        <span class="dim">·</span>
        <span><strong>${stats.questionsAnswered}</strong> questions answered</span>
        <span class="dim">·</span>
        <span><strong>${stats.overallAccuracy}%</strong> overall accuracy</span>
      </div>` : ''}

    <div class="stack">
      <button class="mode-card" data-mode="timed_full">
        <h3>Full Timed Exam</h3>
        <p>All three sections back-to-back under real conditions. Answers stay hidden until you finish the entire test.</p>
        <div class="meta">${TOTAL_QUESTIONS} questions · ${TOTAL_MINUTES} minutes · per-section timers</div>
      </button>

      <button class="mode-card" data-mode="practice_all">
        <h3>Practice — All Sections</h3>
        <p>Mixed questions from all three sections. The correct answer and an explanation appear immediately after each question.</p>
        <div class="meta">${settings.practiceAllCount} questions · untimed · instant feedback</div>
      </button>

      <button class="mode-card" data-mode="practice_section">
        <h3>Practice — Single Section</h3>
        <p>Same instant feedback, focused on one section at a time.</p>
        <div class="meta">${settings.practiceSectionCount} questions · untimed · instant feedback</div>
      </button>

      ${weak.length ? `
      <button class="mode-card" data-mode="drill">
        <h3>Drill My Weak Areas</h3>
        <p>Questions pulled from your lowest-accuracy subtopics and anything you have missed before.</p>
        <div class="meta">${settings.drillCount} questions · untimed · instant feedback</div>
      </button>` : ''}
    </div>

    <div id="section-picker" hidden class="card mt">
      <h3>Which section?</h3>
      <div class="stack" style="gap:.5rem">
        ${SECTION_ORDER.map((id) => `
          <button class="btn" data-section="${id}" style="justify-content:flex-start">
            ${esc(SECTIONS[id].name)}
            <span class="dim tiny">&nbsp;· ${counts[id].total} questions available</span>
          </button>`).join('')}
      </div>
      <button class="btn btn-ghost btn-sm mt" data-cancel-section>Cancel</button>
    </div>

    <hr class="divider">

    <h2>Test structure</h2>
    <table class="history">
      <thead><tr><th>Section</th><th style="text-align:right">Questions</th><th style="text-align:right">Time</th><th style="text-align:right">Bank</th></tr></thead>
      <tbody>${sectionRows}</tbody>
    </table>

    ${shortSections.length ? `
      <div class="notice mt">
        The bundled bank has fewer questions than a full-length section for:
        ${shortSections.map((id) => esc(SECTIONS[id].short)).join(', ')}.
        A full timed exam still runs at the official time limit, but those sections will
        be short rather than repeat questions. Generate more in <a href="#/settings">Settings</a>.
      </div>` : ''}

    <p class="tiny dim mt-lg">
      Keyboard: <span class="kbd">1</span>–<span class="kbd">4</span> or <span class="kbd">A</span>–<span class="kbd">D</span> to answer,
      <span class="kbd">→</span> next, <span class="kbd">←</span> back, <span class="kbd">F</span> flag.
    </p>
  `);

  const view = document.getElementById('view');
  const picker = view.querySelector('#section-picker');

  on(view, '[data-mode]', 'click', (e, btn) => {
    const mode = btn.dataset.mode;
    if (mode === 'practice_section') {
      picker.hidden = false;
      picker.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    navigate(`#/exam/${mode}`);
  });

  on(view, '[data-section]', 'click', (e, btn) => {
    navigate(`#/exam/practice_section/${btn.dataset.section}`);
  });

  on(view, '[data-cancel-section]', 'click', () => {
    picker.hidden = true;
  });
}
