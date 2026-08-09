// Question bank: loads the bundled JSON files, merges in any AI-generated
// questions from localStorage, and samples exam-shaped question sets.

import { SECTIONS, SECTION_ORDER } from './config.js';
import { getGenerated } from './storage.js';

/** @type {{questions: Map<string, object>, bySection: Map<string, object[]>, passages: Map<string,string>}|null} */
let cache = null;

/**
 * Load every section's JSON file once and index it.
 * Bundled files have shape { passages: {id: text}, questions: [...] }.
 */
export async function loadBank({ force = false } = {}) {
  if (cache && !force) return cache;

  const passages = new Map();
  const questions = new Map();
  const bySection = new Map();

  const files = await Promise.all(
    SECTION_ORDER.map(async (id) => {
      const res = await fetch(SECTIONS[id].file, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`Could not load ${SECTIONS[id].file} (HTTP ${res.status})`);
      return [id, await res.json()];
    })
  );

  for (const [sectionId, data] of files) {
    for (const [pid, text] of Object.entries(data.passages ?? {})) passages.set(pid, text);
    const list = [];
    for (const q of data.questions ?? []) {
      const norm = normalize(q, sectionId, 'bundled');
      if (!norm) continue;
      questions.set(norm.id, norm);
      list.push(norm);
    }
    bySection.set(sectionId, list);
  }

  // Merge generated questions on top of the bundled bank.
  for (const raw of getGenerated()) {
    const norm = normalize(raw, raw.section, 'generated');
    if (!norm || questions.has(norm.id)) continue;
    if (norm.passageId && norm.passageText) passages.set(norm.passageId, norm.passageText);
    questions.set(norm.id, norm);
    bySection.get(norm.section)?.push(norm);
  }

  cache = { questions, bySection, passages };
  return cache;
}

export function invalidate() {
  cache = null;
}

/** Validate and normalize one raw question record. Returns null if unusable. */
function normalize(q, sectionId, source) {
  if (!q || typeof q !== 'object') return null;
  const section = q.section ?? sectionId;
  if (!SECTIONS[section]) return null;
  if (!q.id || typeof q.stem !== 'string' || !q.stem.trim()) return null;
  if (!Array.isArray(q.choices) || q.choices.length !== 4) return null;
  if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) return null;

  const subtopics = SECTIONS[section].subtopics;
  const subtopic = subtopics[q.subtopic] ? q.subtopic : Object.keys(subtopics)[0];

  return {
    id: String(q.id),
    section,
    subtopic,
    difficulty: Number.isFinite(q.difficulty) ? q.difficulty : 2,
    stem: q.stem,
    passageId: q.passageId ?? null,
    passageText: q.passageText ?? null,
    choices: q.choices.map(String),
    answer: q.answer,
    explanation: q.explanation ?? '',
    source: q.source ?? source,
  };
}

export function getPassage(passageId) {
  return cache?.passages.get(passageId) ?? null;
}

export function getQuestion(id) {
  return cache?.questions.get(id) ?? null;
}

export function sectionPool(sectionId) {
  return cache?.bySection.get(sectionId) ?? [];
}

export function bankCounts() {
  const out = {};
  for (const id of SECTION_ORDER) {
    const pool = sectionPool(id);
    out[id] = {
      total: pool.length,
      bundled: pool.filter((q) => q.source === 'bundled').length,
      generated: pool.filter((q) => q.source === 'generated').length,
      needed: SECTIONS[id].questionCount,
    };
  }
  return out;
}

/* ---------- sampling ---------- */

function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Choose a single question per stimulus, preferring higher-priority items so
 * that unseen and previously-missed questions still surface first.
 */
function oneQuestionPerPassage(pool, priority) {
  const byPassage = new Map();
  const standalone = [];
  for (const q of pool) {
    if (!q.passageId) {
      standalone.push(q);
      continue;
    }
    if (!byPassage.has(q.passageId)) byPassage.set(q.passageId, []);
    byPassage.get(q.passageId).push(q);
  }
  const picked = [...standalone];
  for (const candidates of byPassage.values()) {
    const shuffled = shuffle(candidates);
    let best = shuffled[0];
    for (const q of shuffled) if (priority(q) > priority(best)) best = q;
    picked.push(best);
  }
  return picked;
}

/**
 * Group questions so that passage-based sets stay together — a passage should
 * never appear with only one of its questions, and never twice in one session.
 * In 'exclusive' mode the pool has already been reduced to one question per
 * stimulus, so every question is its own group.
 */
function groupQuestions(pool, passageMode = 'shared') {
  const groups = [];
  const byPassage = new Map();
  for (const q of pool) {
    if (!q.passageId || passageMode === 'exclusive') {
      groups.push({ key: q.id, questions: [q], subtopic: q.subtopic });
      continue;
    }
    if (!byPassage.has(q.passageId)) {
      const g = { key: q.passageId, questions: [], subtopic: q.subtopic };
      byPassage.set(q.passageId, g);
      groups.push(g);
    }
    byPassage.get(q.passageId).questions.push(q);
  }
  return groups;
}

/**
 * Sample `count` questions from one section, respecting the subtopic weights in
 * the blueprint and keeping passage sets intact.
 *
 * @param {string} sectionId
 * @param {number} count
 * @param {object} opts
 * @param {(q:object)=>number} [opts.priority] Higher = more likely to be picked first.
 */
export function sampleSection(sectionId, count, opts = {}) {
  const spec = SECTIONS[sectionId];
  let pool = sectionPool(sectionId);
  if (!pool.length) return [];

  const priority = opts.priority ?? (() => 0);

  // In 'exclusive' mode questions that share a stimulus are alternatives rather
  // than a set, so keep only one per stimulus before grouping. Without this the
  // shared-passage grouping would pull in whatever subtopics happen to hang off
  // the same stimulus and pull the section away from its blueprint.
  if (spec.passageMode === 'exclusive') pool = oneQuestionPerPassage(pool, priority);

  const groups = groupQuestions(pool, spec.passageMode);

  // Bucket groups by subtopic, ordered by priority then randomly.
  const buckets = new Map();
  for (const g of groups) {
    if (!buckets.has(g.subtopic)) buckets.set(g.subtopic, []);
    buckets.get(g.subtopic).push(g);
  }
  for (const [key, list] of buckets) {
    const scored = shuffle(list).map((g) => ({
      g,
      score: Math.max(...g.questions.map(priority)),
    }));
    scored.sort((a, b) => b.score - a.score);
    buckets.set(key, scored.map((s) => s.g));
  }

  // Target question count per subtopic from the blueprint weights.
  const targets = {};
  let assigned = 0;
  const subIds = Object.keys(spec.subtopics);
  for (const sid of subIds) {
    const t = Math.round((spec.subtopics[sid].weight / 100) * count);
    targets[sid] = t;
    assigned += t;
  }
  // Fix rounding drift against the largest-weight subtopic.
  if (assigned !== count && subIds.length) {
    const biggest = subIds.reduce((a, b) =>
      spec.subtopics[a].weight >= spec.subtopics[b].weight ? a : b
    );
    targets[biggest] += count - assigned;
  }

  const picked = [];
  const usedGroups = new Set();

  // Pass 1 — fill each subtopic to its target.
  for (const sid of subIds) {
    let need = targets[sid];
    const list = buckets.get(sid) ?? [];
    for (const g of list) {
      if (need <= 0) break;
      if (usedGroups.has(g.key)) continue;
      usedGroups.add(g.key);
      picked.push(...g.questions);
      need -= g.questions.length;
    }
  }

  // Pass 2 — the blueprint may not be satisfiable (thin subtopic, or a passage
  // set that overshot). Top up from whatever remains.
  if (picked.length < count) {
    const leftovers = shuffle(groups.filter((g) => !usedGroups.has(g.key)));
    for (const g of leftovers) {
      if (picked.length >= count) break;
      usedGroups.add(g.key);
      picked.push(...g.questions);
    }
  }

  // Pass 3 — trimming drops whole passage sets, which can undershoot the target.
  // Backfill the gap with standalone questions so the count comes out exact.
  let final = trimKeepingGroups(picked, count);
  if (final.length < count) {
    const have = new Set(final.map((q) => q.id));
    const singles = shuffle(
      groups.filter((g) => g.questions.length === 1 && !have.has(g.questions[0].id))
    );
    for (const g of singles) {
      if (final.length >= count) break;
      final.push(g.questions[0]);
    }
  }

  return orderForDisplay(final);
}

/**
 * Trim to `count` without orphaning a passage: drop whole passage groups
 * from the end before dropping standalone questions.
 */
function trimKeepingGroups(questions, count) {
  if (questions.length <= count) return questions;
  const out = questions.slice();
  while (out.length > count) {
    const last = out[out.length - 1];
    if (!last.passageId) {
      out.pop();
      continue;
    }
    // Remove the entire trailing passage set.
    const pid = last.passageId;
    while (out.length && out[out.length - 1].passageId === pid) out.pop();
  }
  return out;
}

/** Keep passage sets contiguous but randomize the order things appear in. */
function orderForDisplay(questions) {
  const groups = groupQuestions(questions);
  return shuffle(groups).flatMap((g) => g.questions);
}

/**
 * Sample a full-length exam: every section at its official question count,
 * in official order.
 */
export function sampleFullExam(opts = {}) {
  return SECTION_ORDER.flatMap((id) =>
    sampleSection(id, SECTIONS[id].questionCount, opts)
  );
}

/** Sample a mixed set across all three sections, proportional to the blueprint. */
export function sampleMixed(count, opts = {}) {
  const totalOfficial = SECTION_ORDER.reduce((n, id) => n + SECTIONS[id].questionCount, 0);
  const out = [];
  let assigned = 0;
  SECTION_ORDER.forEach((id, i) => {
    const isLast = i === SECTION_ORDER.length - 1;
    const n = isLast
      ? count - assigned
      : Math.round((SECTIONS[id].questionCount / totalOfficial) * count);
    assigned += n;
    if (n > 0) out.push(...sampleSection(id, n, opts));
  });
  return out;
}

/**
 * Shuffle a question's choices, returning a new question object plus the
 * mapping so the original answer index can still be recovered.
 */
export function withShuffledChoices(q, rng = Math.random) {
  const order = shuffle([0, 1, 2, 3], rng);
  return {
    ...q,
    choices: order.map((i) => q.choices[i]),
    answer: order.indexOf(q.answer),
    _choiceOrder: order,
  };
}
