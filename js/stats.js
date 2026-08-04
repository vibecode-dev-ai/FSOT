// Scoring and analytics over the saved attempt history.

import { SECTIONS, SECTION_ORDER, subtopicName } from './config.js';
import { getAttempts } from './storage.js';

export function pct(correct, total) {
  if (!total) return 0;
  return Math.round((correct / total) * 100);
}

/** Color band used by the accuracy bars: good >= 80, mid >= 60, weak below. */
export function band(percent) {
  if (percent >= 80) return 'good';
  if (percent >= 60) return 'mid';
  return 'weak';
}

/** Headline numbers for the progress dashboard. */
export function overallStats() {
  const attempts = getAttempts();
  const totals = attempts.reduce(
    (acc, a) => {
      acc.questions += a.total;
      acc.correct += a.correct;
      return acc;
    },
    { questions: 0, correct: 0 }
  );

  const fullExams = attempts.filter((a) => a.mode === 'timed_full');
  const best = attempts.reduce(
    (b, a) => (pct(a.correct, a.total) > pct(b?.correct ?? 0, b?.total ?? 1) ? a : b),
    null
  );

  return {
    attemptCount: attempts.length,
    fullExamCount: fullExams.length,
    questionsAnswered: totals.questions,
    overallAccuracy: pct(totals.correct, totals.questions),
    bestScore: best ? pct(best.correct, best.total) : 0,
    lastAttempt: attempts.length ? attempts[attempts.length - 1] : null,
  };
}

/** Per-section accuracy aggregated across all attempts. */
export function sectionStats() {
  const agg = {};
  for (const id of SECTION_ORDER) agg[id] = { total: 0, correct: 0 };

  for (const a of getAttempts()) {
    for (const [sid, s] of Object.entries(a.sections ?? {})) {
      if (!agg[sid]) continue;
      agg[sid].total += s.total;
      agg[sid].correct += s.correct;
    }
  }

  return SECTION_ORDER.map((id) => ({
    id,
    name: SECTIONS[id].name,
    total: agg[id].total,
    correct: agg[id].correct,
    accuracy: pct(agg[id].correct, agg[id].total),
  }));
}

/** Per-subtopic accuracy across all attempts, grouped by section. */
export function subtopicStats() {
  const agg = new Map();
  for (const a of getAttempts()) {
    for (const [key, s] of Object.entries(a.subtopics ?? {})) {
      if (!agg.has(key)) agg.set(key, { total: 0, correct: 0 });
      const cur = agg.get(key);
      cur.total += s.total;
      cur.correct += s.correct;
    }
  }

  return SECTION_ORDER.map((sectionId) => ({
    sectionId,
    sectionName: SECTIONS[sectionId].name,
    rows: Object.keys(SECTIONS[sectionId].subtopics).map((subId) => {
      const v = agg.get(`${sectionId}::${subId}`) ?? { total: 0, correct: 0 };
      return {
        id: subId,
        name: subtopicName(sectionId, subId),
        total: v.total,
        correct: v.correct,
        accuracy: pct(v.correct, v.total),
      };
    }),
  }));
}

/** Chronological score history, for the trend chart. */
export function scoreHistory({ mode = null, limit = 30 } = {}) {
  return getAttempts()
    .filter((a) => (mode ? a.mode === mode : true))
    .slice(-limit)
    .map((a) => ({
      id: a.id,
      at: a.finishedAt,
      score: pct(a.correct, a.total),
      total: a.total,
      correct: a.correct,
      mode: a.mode,
    }));
}

/** Every question you have ever missed, most recently missed first. */
export function missedQuestionIds() {
  const missed = new Map();
  for (const a of getAttempts()) {
    for (const r of a.responses ?? []) {
      if (r.correct) {
        missed.delete(r.questionId); // got it right since — no longer outstanding
      } else {
        missed.set(r.questionId, a.finishedAt);
      }
    }
  }
  return [...missed.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/** Render an inline SVG line chart of score history. Returns an SVG string. */
export function sparklineSVG(points, { width = 640, height = 120 } = {}) {
  if (points.length === 0) return '';
  const padL = 30, padR = 8, padT = 10, padB = 20;
  const w = width - padL - padR;
  const h = height - padT - padB;

  const x = (i) =>
    padL + (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
  const y = (score) => padT + h - (score / 100) * h;

  const gridLines = [0, 25, 50, 75, 100]
    .map(
      (v) =>
        `<line class="grid" x1="${padL}" y1="${y(v)}" x2="${width - padR}" y2="${y(v)}"/>` +
        `<text class="lbl" x="${padL - 5}" y="${y(v) + 3}" text-anchor="end">${v}</text>`
    )
    .join('');

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ');
  const dots = points
    .map((p, i) => `<circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(p.score).toFixed(1)}" r="3"><title>${p.score}% — ${p.correct}/${p.total}</title></circle>`)
    .join('');

  return `<svg class="spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Score history">
    ${gridLines}
    <path class="line" d="${path}"/>
    ${dots}
  </svg>`;
}
