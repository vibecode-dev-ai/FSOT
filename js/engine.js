// Exam session state machine. One object drives all four modes; the only
// behavioural switches are `revealPolicy` (immediate vs on_submit) and `timed`.

import { MODES, SECTIONS, SECTION_ORDER } from './config.js';
import {
  loadBank,
  sampleFullExam,
  sampleMixed,
  sampleSection,
  withShuffledChoices,
} from './bank.js';
import { getAttempts, getSettings, saveAttempt } from './storage.js';
import { Countdown } from './timer.js';

let activeSession = null;

export function getSession() {
  return activeSession;
}

export function endSession() {
  activeSession?.timerStop();
  activeSession = null;
}

/**
 * Build the priority function used when sampling. Questions you have missed
 * before rank highest, questions you have never seen rank next, and questions
 * you have already answered correctly rank last.
 */
function buildPriority() {
  const missed = new Map(); // questionId -> times missed
  const seen = new Map();   // questionId -> times seen
  for (const attempt of getAttempts()) {
    for (const r of attempt.responses ?? []) {
      seen.set(r.questionId, (seen.get(r.questionId) ?? 0) + 1);
      if (!r.correct) missed.set(r.questionId, (missed.get(r.questionId) ?? 0) + 1);
    }
  }
  return (q) => {
    const m = missed.get(q.id) ?? 0;
    const s = seen.get(q.id) ?? 0;
    if (m > 0) return 100 + m;      // previously missed — highest value to redo
    if (s === 0) return 50;         // never seen
    return 10 - Math.min(s, 9);     // seen and correct — deprioritize
  };
}

/**
 * Identify the weakest subtopics from history, for drill mode.
 * Returns a Set of "sectionId::subtopicId" keys.
 */
export function weakSubtopics(limit = 4) {
  const agg = new Map();
  for (const attempt of getAttempts()) {
    for (const r of attempt.responses ?? []) {
      const key = `${r.section}::${r.subtopic}`;
      if (!agg.has(key)) agg.set(key, { total: 0, correct: 0 });
      const a = agg.get(key);
      a.total++;
      if (r.correct) a.correct++;
    }
  }
  return [...agg.entries()]
    .filter(([, v]) => v.total >= 3) // need a little evidence before calling it weak
    .map(([key, v]) => ({ key, accuracy: v.correct / v.total, total: v.total }))
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, limit);
}

/**
 * Start a session.
 * @param {object} opts
 * @param {string} opts.mode One of MODES.
 * @param {string} [opts.sectionId] Required for practice_section.
 * @param {number} [opts.count] Question count for untimed modes.
 */
export async function startSession({ mode, sectionId = null, count = null }) {
  const spec = MODES[mode];
  if (!spec) throw new Error(`Unknown mode: ${mode}`);

  await loadBank();
  const settings = getSettings();
  const priority = buildPriority();

  let questions;
  if (mode === 'timed_full') {
    questions = sampleFullExam({ priority });
  } else if (mode === 'practice_all') {
    questions = sampleMixed(count ?? settings.practiceAllCount, { priority });
  } else if (mode === 'practice_section') {
    if (!SECTIONS[sectionId]) throw new Error(`Unknown section: ${sectionId}`);
    questions = sampleSection(sectionId, count ?? settings.practiceSectionCount, { priority });
  } else if (mode === 'drill') {
    questions = sampleDrill(count ?? settings.drillCount, priority);
  } else {
    throw new Error(`Unhandled mode: ${mode}`);
  }

  if (!questions.length) {
    throw new Error('No questions available for that selection. Check the question bank.');
  }

  if (settings.shuffleChoices) {
    questions = questions.map((q) => withShuffledChoices(q));
  }

  activeSession = new Session({ mode, spec, sectionId, questions });
  return activeSession;
}

/** Drill: pull mostly from weak subtopics, falling back to a mixed set. */
function sampleDrill(count, priority) {
  const weak = weakSubtopics(4);
  if (!weak.length) return sampleMixed(count, { priority });

  const wanted = new Set(weak.map((w) => w.key));
  const perSection = new Map();
  for (const { key } of weak) {
    const [sec] = key.split('::');
    perSection.set(sec, (perSection.get(sec) ?? 0) + 1);
  }

  const out = [];
  const share = Math.ceil(count / perSection.size);
  for (const sec of perSection.keys()) {
    // Over-sample the section, then keep only the weak subtopics from it.
    const pool = sampleSection(sec, Math.min(share * 4, SECTIONS[sec].questionCount), { priority });
    const filtered = pool.filter((q) => wanted.has(`${q.section}::${q.subtopic}`));
    out.push(...filtered.slice(0, share));
  }

  if (out.length < count) {
    const fill = sampleMixed(count - out.length, { priority });
    const have = new Set(out.map((q) => q.id));
    out.push(...fill.filter((q) => !have.has(q.id)));
  }
  return out.slice(0, count);
}

class Session {
  constructor({ mode, spec, sectionId, questions }) {
    this.id = `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    this.mode = mode;
    this.spec = spec;
    this.sectionScope = sectionId;
    this.questions = questions;
    this.index = 0;
    this.startedAt = Date.now();
    this.finishedAt = null;
    this.submitted = false;

    /** questionId -> chosen index (or null if cleared) */
    this.answers = new Map();
    /** Set of flagged questionIds */
    this.flags = new Set();
    /** questionIds whose feedback has been revealed (immediate mode) */
    this.revealed = new Set();

    // Section boundaries, in the order the questions appear.
    this.sectionRanges = computeSectionRanges(questions);
    this.sectionIds = this.sectionRanges.map((r) => r.sectionId);
    this.currentSectionIdx = 0;
    /** Sections whose time expired or which were manually completed. */
    this.lockedSections = new Set();

    this.timer = null;
    this._timerHandlers = null;
  }

  get revealPolicy() {
    return this.spec.revealPolicy;
  }

  get timed() {
    return this.spec.timed;
  }

  get total() {
    return this.questions.length;
  }

  get current() {
    return this.questions[this.index] ?? null;
  }

  get currentSection() {
    return this.sectionRanges[this.currentSectionIdx] ?? null;
  }

  /** Index within the current section, 0-based. */
  get indexInSection() {
    const r = this.currentSection;
    return r ? this.index - r.start : this.index;
  }

  /** Questions belonging to the current section. */
  get sectionQuestions() {
    const r = this.currentSection;
    return r ? this.questions.slice(r.start, r.end + 1) : this.questions;
  }

  get answeredCount() {
    let n = 0;
    for (const v of this.answers.values()) if (v !== null && v !== undefined) n++;
    return n;
  }

  answeredInSection() {
    return this.sectionQuestions.filter((q) => this.answers.get(q.id) != null).length;
  }

  /* ---------- answering ---------- */

  answer(choiceIndex) {
    const q = this.current;
    if (!q) return false;
    // In immediate-feedback mode an answered question is locked, like the real thing.
    if (this.revealPolicy === 'immediate' && this.revealed.has(q.id)) return false;
    if (this.timed && this.lockedSections.has(this.currentSection?.sectionId)) return false;

    this.answers.set(q.id, choiceIndex);
    if (this.revealPolicy === 'immediate') this.revealed.add(q.id);
    return true;
  }

  clearAnswer() {
    const q = this.current;
    if (!q) return;
    if (this.revealPolicy === 'immediate' && this.revealed.has(q.id)) return;
    this.answers.delete(q.id);
  }

  isRevealed(questionId = this.current?.id) {
    if (this.revealPolicy === 'on_submit') return this.submitted;
    return this.revealed.has(questionId);
  }

  toggleFlag() {
    const q = this.current;
    if (!q) return;
    if (this.flags.has(q.id)) this.flags.delete(q.id);
    else this.flags.add(q.id);
  }

  /* ---------- navigation ---------- */

  /** Can we move to an absolute question index right now? */
  canGoTo(i) {
    if (i < 0 || i >= this.total) return false;
    if (!this.timed) return true;
    const r = this.sectionRanges[this.currentSectionIdx];
    return i >= r.start && i <= r.end; // timed mode confines you to the active section
  }

  goTo(i) {
    if (!this.canGoTo(i)) return false;
    this.index = i;
    if (!this.timed) this._syncSectionToIndex();
    return true;
  }

  next() {
    if (this.canGoTo(this.index + 1)) return this.goTo(this.index + 1);
    return false;
  }

  prev() {
    if (this.canGoTo(this.index - 1)) return this.goTo(this.index - 1);
    return false;
  }

  /** True when the current question is the last one in the active section. */
  atSectionEnd() {
    const r = this.currentSection;
    return r ? this.index >= r.end : this.index >= this.total - 1;
  }

  isLastSection() {
    return this.currentSectionIdx >= this.sectionRanges.length - 1;
  }

  _syncSectionToIndex() {
    const idx = this.sectionRanges.findIndex((r) => this.index >= r.start && this.index <= r.end);
    if (idx >= 0) this.currentSectionIdx = idx;
  }

  /* ---------- timed section flow ---------- */

  /**
   * Wire up timer callbacks once; the view supplies them.
   * @param {{onTick:(s:number)=>void, onSectionExpire:(sectionId:string)=>void}} handlers
   */
  setTimerHandlers(handlers) {
    this._timerHandlers = handlers;
  }

  startCurrentSectionTimer() {
    if (!this.timed) return null;
    const r = this.currentSection;
    if (!r) return null;
    this.timerStop();

    const seconds = SECTIONS[r.sectionId].timeLimitMinutes * 60;
    this.timer = new Countdown(seconds, {
      onTick: (left) => this._timerHandlers?.onTick?.(left),
      onExpire: () => {
        this.lockedSections.add(r.sectionId);
        this._timerHandlers?.onSectionExpire?.(r.sectionId);
      },
    });
    this.timer.start();
    return this.timer;
  }

  timerStop() {
    this.timer?.stop();
    this.timer = null;
  }

  /**
   * Finish the active section and move to the next one. Returns false when
   * there is no next section (i.e. the exam is over).
   */
  advanceSection() {
    const r = this.currentSection;
    if (r) this.lockedSections.add(r.sectionId);
    this.timerStop();
    if (this.isLastSection()) return false;
    this.currentSectionIdx++;
    this.index = this.currentSection.start;
    return true;
  }

  /* ---------- submission ---------- */

  submit() {
    if (this.submitted) return this.result;
    this.timerStop();
    this.submitted = true;
    this.finishedAt = Date.now();

    const responses = this.questions.map((q) => {
      const chosen = this.answers.has(q.id) ? this.answers.get(q.id) : null;
      return {
        questionId: q.id,
        section: q.section,
        subtopic: q.subtopic,
        chosen,
        answer: q.answer,
        correct: chosen === q.answer,
        flagged: this.flags.has(q.id),
        // `chosen`/`answer` index into the order the user actually saw. Keep the
        // shuffle map so the review screen can rebuild that exact ordering.
        choiceOrder: q._choiceOrder ?? null,
      };
    });

    const sections = {};
    const subtopics = {};
    for (const r of responses) {
      sections[r.section] ??= { total: 0, correct: 0, answered: 0 };
      sections[r.section].total++;
      if (r.chosen !== null) sections[r.section].answered++;
      if (r.correct) sections[r.section].correct++;

      const key = `${r.section}::${r.subtopic}`;
      subtopics[key] ??= { total: 0, correct: 0 };
      subtopics[key].total++;
      if (r.correct) subtopics[key].correct++;
    }

    const attempt = {
      id: this.id,
      mode: this.mode,
      sectionScope: this.sectionScope,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      durationMs: this.finishedAt - this.startedAt,
      total: responses.length,
      correct: responses.filter((r) => r.correct).length,
      sections,
      subtopics,
      responses,
    };

    saveAttempt(attempt);
    this.result = attempt;
    return attempt;
  }
}

/** Walk the question list and record where each section starts and ends. */
function computeSectionRanges(questions) {
  const ranges = [];
  let currentId = null;
  questions.forEach((q, i) => {
    if (q.section !== currentId) {
      if (ranges.length) ranges[ranges.length - 1].end = i - 1;
      ranges.push({ sectionId: q.section, start: i, end: i });
      currentId = q.section;
    }
  });
  if (ranges.length) ranges[ranges.length - 1].end = questions.length - 1;
  return ranges;
}

export { SECTION_ORDER };
