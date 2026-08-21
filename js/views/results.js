// Results: score breakdown plus a full review of every question in the attempt.

import { CHOICE_LETTERS, MODES, SECTIONS, SECTION_ORDER, subtopicName } from '../config.js';
import { getPassage, getQuestion, loadBank } from '../bank.js';
import { endSession } from '../engine.js';
import { getAttempt } from '../storage.js';
import { band, pct } from '../stats.js';
import { formatDuration } from '../timer.js';
import {
  barRow,
  esc,
  formatDateTime,
  on,
  paragraphs,
  resolveChoiceRefs,
  setView,
} from '../ui.js';

export async function renderResults(navigate, attemptId) {
  await loadBank();
  endSession();

  const attempt = getAttempt(attemptId);
  if (!attempt) {
    setView(`<div class="notice error">That attempt could not be found.</div>
      <p class="mt"><a href="#/home">Back to home</a></p>`);
    return;
  }

  const score = pct(attempt.correct, attempt.total);
  const unanswered = attempt.responses.filter((r) => r.chosen === null).length;
  const modeName = MODES[attempt.mode]?.name ?? attempt.mode;

  const sectionRows = SECTION_ORDER.filter((id) => attempt.sections[id])
    .map((id) => {
      const s = attempt.sections[id];
      const a = pct(s.correct, s.total);
      return barRow(SECTIONS[id].name, s.correct, s.total, a, band(a));
    })
    .join('');

  const subtopicBlocks = SECTION_ORDER.filter((id) => attempt.sections[id])
    .map((sectionId) => {
      const rows = Object.keys(SECTIONS[sectionId].subtopics)
        .map((subId) => {
          const v = attempt.subtopics[`${sectionId}::${subId}`];
          if (!v) return '';
          const a = pct(v.correct, v.total);
          return barRow(subtopicName(sectionId, subId), v.correct, v.total, a, band(a));
        })
        .filter(Boolean)
        .join('');
      if (!rows) return '';
      return `<div class="mt"><h3 class="small dim" style="text-transform:uppercase;letter-spacing:.05em">${esc(SECTIONS[sectionId].name)}</h3>${rows}</div>`;
    })
    .join('');

  setView(`
    <div class="card score-hero">
      <div class="score-big">${score}%</div>
      <div class="score-sub">
        ${attempt.correct} of ${attempt.total} correct
        ${unanswered ? ` · ${unanswered} left blank` : ''}
      </div>
      <div class="tiny dim mt">
        ${esc(modeName)} · ${formatDateTime(attempt.finishedAt)} · ${formatDuration(attempt.durationMs)}
      </div>
    </div>

    ${attempt.mode === 'timed_full' ? `
      <div class="notice info mt">
        The FSOT no longer has a published passing score — the Department advances candidates
        by highest score relative to the needs of the Service. Treat this percentage as a
        relative measure of your own progress, not a pass/fail line.
      </div>` : ''}

    <h2 class="mt-lg">By section</h2>
    ${sectionRows || '<p class="dim">No section data.</p>'}

    <h2 class="mt-lg">By subtopic</h2>
    ${subtopicBlocks || '<p class="dim">No subtopic data.</p>'}

    <hr class="divider">

    <div class="spread">
      <h2 class="mb-0">Review</h2>
      <div class="row">
        <button class="btn btn-sm" data-filter="all" aria-pressed="true">All ${attempt.total}</button>
        <button class="btn btn-sm" data-filter="wrong" aria-pressed="false">Missed ${attempt.total - attempt.correct}</button>
        <button class="btn btn-sm" data-filter="flagged" aria-pressed="false">Flagged ${attempt.responses.filter((r) => r.flagged).length}</button>
      </div>
    </div>

    <div id="review-list" class="mt">${reviewHTML(attempt, 'all')}</div>

    <div class="row mt-lg">
      <button class="btn btn-primary" data-act="home">Back to home</button>
      <button class="btn" data-act="progress">View progress</button>
    </div>
  `);

  const view = document.getElementById('view');

  on(view, '[data-filter]', 'click', (e, btn) => {
    view.querySelectorAll('[data-filter]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b === btn))
    );
    document.getElementById('review-list').innerHTML = reviewHTML(attempt, btn.dataset.filter);
  });

  on(view, '[data-act="home"]', 'click', () => navigate('#/home'));
  on(view, '[data-act="progress"]', 'click', () => navigate('#/progress'));
}

function reviewHTML(attempt, filter) {
  let responses = attempt.responses;
  if (filter === 'wrong') responses = responses.filter((r) => !r.correct);
  if (filter === 'flagged') responses = responses.filter((r) => r.flagged);

  if (!responses.length) {
    return `<div class="empty">Nothing to show with that filter.</div>`;
  }

  return responses
    .map((r, i) => {
      const q = getQuestion(r.questionId);
      const originalIndex = attempt.responses.indexOf(r) + 1;

      if (!q) {
        return `<div class="review-item skipped">
          <div class="review-head"><strong>Q${originalIndex}</strong>
          <span class="tag">question no longer in bank</span></div>
        </div>`;
      }

      // r.chosen / r.answer index into the order the user saw, which may have been
      // shuffled. Rebuild that ordering so the letters line up with the recorded indices.
      const displayChoices = r.choiceOrder
        ? r.choiceOrder.map((orig) => q.choices[orig])
        : q.choices;

      // That rebuild reads the CURRENT bank, so an edit that reorders a question's
      // choices leaves the recorded indices pointing at the wrong text and would
      // put the ✓ on the wrong line. The credited slot is the cheap tell: it must
      // still hold the choice the bank credits.
      const stale = displayChoices[r.answer] !== q.choices[q.answer];

      const statusClass = r.chosen === null ? 'skipped' : r.correct ? 'right' : 'wrong';
      const statusTag =
        r.chosen === null
          ? '<span class="tag">Blank</span>'
          : r.correct
          ? '<span class="tag right">Correct</span>'
          : '<span class="tag wrong">Incorrect</span>';

      const passageText = q.passageId ? (q.passageText ?? getPassage(q.passageId)) : null;

      return `<div class="review-item ${statusClass}">
        <div class="review-head">
          <strong>Q${originalIndex}</strong>
          ${statusTag}
          ${r.flagged ? '<span class="tag flag">Flagged</span>' : ''}
          <span class="tag">${esc(SECTIONS[r.section]?.short ?? r.section)}</span>
          <span class="tag">${esc(subtopicName(r.section, r.subtopic))}</span>
        </div>

        ${passageText ? `<details style="margin-bottom:.6rem">
          <summary class="tiny dim" style="cursor:pointer">Show passage</summary>
          <div class="passage" style="margin-top:.5rem">${paragraphs(passageText)}</div>
        </details>` : ''}

        <div style="font-family:var(--font-read);margin-bottom:.6rem">${esc(q.stem).replace(/\n/g, '<br>')}</div>

        <div class="small">
          ${(stale ? q.choices : displayChoices).map((c, ci) => {
            // When stale we can still say which choice is right, but not which one
            // was picked, so show the bank's order and mark only the answer.
            const isAnswer = ci === (stale ? q.answer : r.answer);
            const isChosen = !stale && ci === r.chosen;
            const color = isAnswer ? 'var(--correct)' : isChosen ? 'var(--incorrect)' : 'var(--text-3)';
            const weight = isAnswer || isChosen ? '600' : '400';
            const marker = isAnswer ? '✓' : isChosen ? '✗' : '&nbsp;';
            return `<div style="color:${color};font-weight:${weight};padding:.1rem 0">
              <span style="display:inline-block;width:1.2rem">${marker}</span>
              ${CHOICE_LETTERS[ci]}. ${esc(resolveChoiceRefs(c, stale ? null : r.choiceOrder))}
            </div>`;
          }).join('')}
        </div>

        ${stale ? `<p class="tiny dim" style="margin:.5rem 0 0">
          This question's choices were revised after you answered it, so the choice you
          picked can no longer be identified. Your score is unaffected.
        </p>` : ''}

        ${q.explanation ? `<div class="explanation" style="margin-top:.75rem">${paragraphs(resolveChoiceRefs(q.explanation, stale ? null : r.choiceOrder))}</div>` : ''}
      </div>`;
    })
    .join('');
}
