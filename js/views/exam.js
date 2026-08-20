// The question runner. One renderer serves all modes; behaviour differs only by
// `session.revealPolicy` (immediate vs on_submit) and `session.timed`.

import { CHOICE_LETTERS, SECTIONS, TIMER_DANGER_SECONDS, TIMER_WARNING_SECONDS } from '../config.js';
import { getPassage } from '../bank.js';
import { endSession, getSession, startSession } from '../engine.js';
import { formatClock } from '../timer.js';
import { getSettings } from '../storage.js';
import { confirmModal, esc, paragraphs, resolveChoiceRefs, setView } from '../ui.js';

let keyHandler = null;
let navigateFn = null;
/** Aborts the delegated click listener when the session ends. */
let clickAbort = null;

export async function renderExam(navigate, { mode, sectionId = null, resume = false }) {
  navigateFn = navigate;

  let session = getSession();
  if (!resume || !session) {
    try {
      session = await startSession({ mode, sectionId });
    } catch (err) {
      setView(`<div class="notice error">${esc(err.message)}</div>
        <button class="btn mt" onclick="location.hash='#/home'">Back to home</button>`);
      return;
    }
  }

  document.body.classList.add('exam-mode');

  if (session.timed) {
    session.setTimerHandlers({
      onTick: (left) => updateClock(left),
      onSectionExpire: (sid) => handleSectionExpire(session, sid),
    });
    session.startCurrentSectionTimer();
  }

  wire(session);
  paint(session);
  attachKeyboard(session);
}

export function teardownExam() {
  document.body.classList.remove('exam-mode');
  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  keyHandler = null;
  clickAbort?.abort();
  clickAbort = null;
}

/* ---------- painting ---------- */

function paint(session) {
  const q = session.current;
  if (!q) return;

  const sec = SECTIONS[q.section];
  const revealed = session.isRevealed(q.id);
  const chosen = session.answers.get(q.id);
  const hasAnswer = chosen !== undefined && chosen !== null;
  const flagged = session.flags.has(q.id);
  const locked = session.timed && session.lockedSections.has(q.section);

  const passageText = q.passageId ? (q.passageText ?? getPassage(q.passageId)) : null;

  // Progress within the section for timed mode, within the whole set otherwise.
  const progressNow = session.timed ? session.indexInSection + 1 : session.index + 1;
  const progressTotal = session.timed ? session.sectionQuestions.length : session.total;

  setView(`
    <div class="exam-bar">
      <div>
        <div class="section-label">${esc(sec.name)}</div>
        <div class="qcount">Question ${progressNow} of ${progressTotal}${
          session.timed ? '' : ` · ${session.answeredCount} answered`
        }</div>
      </div>
      <div class="row">
        ${session.timed ? `<span class="timer" id="clock">--:--</span>` : ''}
        <button class="btn btn-ghost btn-sm" data-act="quit">Exit</button>
      </div>
      <div class="progress-track" style="flex-basis:100%">
        <div class="progress-fill" style="width:${(progressNow / progressTotal) * 100}%"></div>
      </div>
    </div>

    ${locked ? `<div class="notice mb-0" style="margin-bottom:1rem">Time expired for this section. It is now locked.</div>` : ''}

    ${passageText ? `
      <div class="passage">
        <div class="passage-label">Passage</div>
        ${paragraphs(passageText)}
      </div>` : ''}

    <div class="stem">${esc(q.stem).replace(/\n/g, '<br>').replace(/_{3,}/g, '<span class="blank">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>')}</div>

    <ul class="choices" role="radiogroup">
      ${q.choices.map((choice, i) => {
        const classes = ['choice'];
        if (revealed) {
          if (i === q.answer) classes.push('correct');
          else if (i === chosen) classes.push('incorrect');
        } else if (i === chosen) {
          classes.push('selected');
        }
        const disabled = locked || (revealed && session.revealPolicy === 'immediate');
        return `<li>
          <button class="${classes.join(' ')}" data-choice="${i}" ${disabled ? 'disabled' : ''}
                  role="radio" aria-checked="${i === chosen}">
            <span class="letter">${CHOICE_LETTERS[i]}</span>
            <span>${esc(resolveChoiceRefs(choice, q._choiceOrder))}</span>
          </button>
        </li>`;
      }).join('')}
    </ul>

    ${revealed && session.revealPolicy === 'immediate' ? explanationHTML(q, chosen) : ''}

    <div class="exam-footer">
      <div class="row">
        <button class="btn btn-sm" data-act="prev" ${session.canGoTo(session.index - 1) ? '' : 'disabled'}>← Back</button>
        <button class="btn btn-sm" data-act="flag">${flagged ? '⚑ Flagged' : '⚐ Flag'}</button>
        ${!session.timed && hasAnswer && !revealed ? `<button class="btn btn-sm btn-ghost" data-act="clear">Clear</button>` : ''}
      </div>
      <div class="row">
        ${nextButtonHTML(session)}
      </div>
    </div>

    ${navigatorHTML(session)}
  `);

  if (session.timed) updateClock(session.timer?.remaining ?? 0);
}

function nextButtonHTML(session) {
  const atEnd = session.timed ? session.atSectionEnd() : session.index >= session.total - 1;
  if (!atEnd) return `<button class="btn btn-primary" data-act="next">Next →</button>`;

  if (session.timed && !session.isLastSection()) {
    return `<button class="btn btn-primary" data-act="next-section">Finish section →</button>`;
  }
  return `<button class="btn btn-primary" data-act="submit">Finish &amp; see results</button>`;
}

function explanationHTML(q, chosen) {
  const right = chosen === q.answer;
  return `<div class="explanation">
    <div class="verdict ${right ? 'right' : 'wrong'}">
      ${right ? '✓ Correct' : `✗ Incorrect — the answer is ${CHOICE_LETTERS[q.answer]}`}
    </div>
    ${paragraphs(
      resolveChoiceRefs(
        q.explanation || 'No explanation available for this question.',
        q._choiceOrder
      )
    )}
  </div>`;
}

function navigatorHTML(session) {
  const questions = session.timed ? session.sectionQuestions : session.questions;
  const offset = session.timed ? session.currentSection.start : 0;

  const dots = questions.map((q, i) => {
    const abs = offset + i;
    const classes = ['nav-dot'];
    const chosen = session.answers.get(q.id);
    const answered = chosen !== undefined && chosen !== null;

    if (session.revealPolicy === 'immediate' && session.revealed.has(q.id)) {
      classes.push(chosen === q.answer ? 'right' : 'wrong');
    } else if (answered) {
      classes.push('answered');
    }
    if (session.flags.has(q.id)) classes.push('flagged');
    if (abs === session.index) classes.push('current');

    return `<button class="${classes.join(' ')}" data-goto="${abs}" title="Question ${i + 1}">${i + 1}</button>`;
  }).join('');

  return `<div class="mt-lg">
    <div class="tiny dim" style="margin-bottom:.4rem">
      ${session.timed ? 'Questions in this section' : 'All questions'} —
      ${session.timed ? session.answeredInSection() : session.answeredCount} answered${
        session.flags.size ? ` · ${session.flags.size} flagged` : ''
      }
    </div>
    <div class="navigator">${dots}</div>
  </div>`;
}

function updateClock(secondsLeft) {
  const clock = document.getElementById('clock');
  if (!clock) return;
  clock.textContent = formatClock(secondsLeft);
  clock.classList.toggle('warn', secondsLeft <= TIMER_WARNING_SECONDS && secondsLeft > TIMER_DANGER_SECONDS);
  clock.classList.toggle('danger', secondsLeft <= TIMER_DANGER_SECONDS);
}

/* ---------- interaction ---------- */

/** Attached once per session — #view survives repaints, so re-binding would stack listeners. */
function wire(session) {
  clickAbort?.abort();
  clickAbort = new AbortController();

  document.getElementById('view').addEventListener(
    'click',
    async (e) => {
      const choiceBtn = e.target.closest('[data-choice]');
      if (choiceBtn) {
        if (session.answer(Number(choiceBtn.dataset.choice))) paint(session);
        return;
      }

      const gotoBtn = e.target.closest('[data-goto]');
      if (gotoBtn) {
        if (session.goTo(Number(gotoBtn.dataset.goto))) paint(session);
        return;
      }

      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act) await handleAction(session, act);
    },
    { signal: clickAbort.signal }
  );
}

async function handleAction(session, act) {
  switch (act) {
    case 'next':
      session.next();
      break;
    case 'prev':
      session.prev();
      break;
    case 'flag':
      session.toggleFlag();
      break;
    case 'clear':
      session.clearAnswer();
      break;
    case 'next-section': {
      const unanswered = session.sectionQuestions.filter((q) => session.answers.get(q.id) == null).length;
      const ok = await confirmModal({
        title: 'Finish this section?',
        body: unanswered
          ? `<p>You have <strong>${unanswered}</strong> unanswered question${unanswered === 1 ? '' : 's'} in this section.</p>
             <p>Once you move on you cannot come back, exactly as on the real test.</p>`
          : `<p>You cannot return to this section once you move on, exactly as on the real test.</p>`,
        confirmText: 'Move to next section',
      });
      if (!ok) return;
      session.advanceSection();
      session.startCurrentSectionTimer();
      break;
    }
    case 'submit': {
      const unanswered = session.total - session.answeredCount;
      const ok = await confirmModal({
        title: 'Finish the test?',
        body: unanswered
          ? `<p>You have <strong>${unanswered}</strong> unanswered question${unanswered === 1 ? '' : 's'}. They will be scored as incorrect.</p>`
          : `<p>All questions answered. Ready to see your results?</p>`,
        confirmText: 'Finish',
      });
      if (!ok) return;
      finish(session);
      return;
    }
    case 'quit': {
      const ok = await confirmModal({
        title: 'Exit this session?',
        body: '<p>Your progress in this session will be discarded and nothing will be saved to your history.</p>',
        confirmText: 'Exit without saving',
        danger: true,
      });
      if (!ok) return;
      teardownExam();
      endSession();
      navigateFn('#/home');
      return;
    }
    default:
      return;
  }
  paint(session);
}

function finish(session) {
  const attempt = session.submit();
  teardownExam();
  navigateFn(`#/results/${attempt.id}`);
}

/**
 * Time ran out on a section. Auto-advance, or finish the exam if it was the last.
 */
async function handleSectionExpire(session, sectionId) {
  paint(session); // repaint so the lock state shows immediately

  if (session.isLastSection()) {
    await confirmModal({
      title: 'Time is up',
      body: `<p>Time has expired for <strong>${esc(SECTIONS[sectionId].name)}</strong>, the final section. Your test will now be scored.</p>`,
      confirmText: 'See results',
      cancelText: 'Wait',
    });
    finish(session);
    return;
  }

  const nextId = session.sectionRanges[session.currentSectionIdx + 1].sectionId;
  await confirmModal({
    title: 'Time is up',
    body: `<p>Time has expired for <strong>${esc(SECTIONS[sectionId].name)}</strong>.</p>
           <p>Moving on to <strong>${esc(SECTIONS[nextId].name)}</strong> — ${SECTIONS[nextId].questionCount} questions, ${SECTIONS[nextId].timeLimitMinutes} minutes.</p>`,
    confirmText: 'Begin next section',
    cancelText: 'Wait',
  });
  session.advanceSection();
  session.startCurrentSectionTimer();
  paint(session);
}

/* ---------- keyboard ---------- */

function attachKeyboard(session) {
  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  if (!getSettings().keyboardShortcuts) return;

  keyHandler = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('.modal-backdrop')) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const key = e.key.toLowerCase();

    // 1-4 and a-d select a choice.
    const numIdx = ['1', '2', '3', '4'].indexOf(key);
    const letterIdx = ['a', 'b', 'c', 'd'].indexOf(key);
    const choice = numIdx >= 0 ? numIdx : letterIdx;
    if (choice >= 0) {
      e.preventDefault();
      if (session.answer(choice)) paint(session);
      return;
    }

    if (key === 'arrowright' || key === 'enter') {
      e.preventDefault();
      const atEnd = session.timed ? session.atSectionEnd() : session.index >= session.total - 1;
      if (atEnd) return; // require an explicit click to finish a section or the test
      session.next();
      paint(session);
      return;
    }

    if (key === 'arrowleft') {
      e.preventDefault();
      session.prev();
      paint(session);
      return;
    }

    if (key === 'f') {
      e.preventDefault();
      session.toggleFlag();
      paint(session);
    }
  };

  document.addEventListener('keydown', keyHandler);
}
