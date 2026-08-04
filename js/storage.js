// localStorage wrapper. Everything the app persists lives under the `fsot.` prefix.

const PREFIX = 'fsot.';
const SCHEMA_VERSION = 1;

const KEYS = {
  version: PREFIX + 'schemaVersion',
  attempts: PREFIX + 'attempts',
  settings: PREFIX + 'settings',
  generated: PREFIX + 'generated',
  apiKey: PREFIX + 'apiKey',
};

const DEFAULT_SETTINGS = {
  practiceAllCount: 30,
  practiceSectionCount: 20,
  drillCount: 20,
  shuffleChoices: true,
  keyboardShortcuts: true,
  generatorModel: 'claude-opus-5',
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn('[storage] write failed for', key, err);
    return false;
  }
}

/** Run once at boot. Sets the schema version and applies migrations if needed. */
export function migrate() {
  const current = read(KEYS.version, 0);
  if (current === SCHEMA_VERSION) return;
  // No migrations yet — v0 (fresh install) simply becomes v1.
  write(KEYS.version, SCHEMA_VERSION);
}

/* ---------- settings ---------- */

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) };
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  write(KEYS.settings, next);
  return next;
}

/* ---------- attempts ---------- */

/**
 * An attempt record:
 * { id, mode, sectionScope, startedAt, finishedAt, durationMs,
 *   total, correct, sections: { [sectionId]: {total, correct} },
 *   subtopics: { "sectionId::subtopicId": {total, correct} },
 *   responses: [{ questionId, section, subtopic, chosen, answer, correct, flagged }] }
 */
export function getAttempts() {
  const list = read(KEYS.attempts, []);
  return Array.isArray(list) ? list : [];
}

export function saveAttempt(attempt) {
  const list = getAttempts();
  list.push(attempt);
  // Keep history bounded so localStorage never fills up.
  while (list.length > 200) list.shift();
  write(KEYS.attempts, list);
  return attempt;
}

export function clearAttempts() {
  write(KEYS.attempts, []);
}

export function getAttempt(id) {
  return getAttempts().find((a) => a.id === id) ?? null;
}

/* ---------- generated questions ---------- */

export function getGenerated() {
  const list = read(KEYS.generated, []);
  return Array.isArray(list) ? list : [];
}

export function addGenerated(questions) {
  const list = getGenerated();
  const seen = new Set(list.map((q) => q.id));
  const added = [];
  for (const q of questions) {
    if (seen.has(q.id)) continue;
    seen.add(q.id);
    list.push(q);
    added.push(q);
  }
  write(KEYS.generated, list);
  return added;
}

export function clearGenerated() {
  write(KEYS.generated, []);
}

/* ---------- API key ---------- */

export function getApiKey() {
  return read(KEYS.apiKey, '') || '';
}

export function saveApiKey(key) {
  write(KEYS.apiKey, key || '');
}

export function clearApiKey() {
  localStorage.removeItem(KEYS.apiKey);
}

/* ---------- export / import ---------- */

export function exportAll() {
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    attempts: getAttempts(),
    settings: getSettings(),
    generated: getGenerated(),
    // The API key is deliberately excluded from exports.
  };
}

export function importAll(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid backup file.');
  if (Array.isArray(payload.attempts)) write(KEYS.attempts, payload.attempts);
  if (payload.settings && typeof payload.settings === 'object') write(KEYS.settings, payload.settings);
  if (Array.isArray(payload.generated)) write(KEYS.generated, payload.generated);
}
