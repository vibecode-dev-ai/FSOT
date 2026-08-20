// Optional question generation via the Anthropic Messages API.
//
// Called directly from the browser using the raw HTTP API — there is no build
// step in this app, so there is no npm SDK. The
// `anthropic-dangerous-direct-browser-access` header is what makes a browser
// origin acceptable to the API.

import { SECTIONS } from './config.js';
import { getApiKey, getSettings } from './storage.js';
import { sectionPool } from './bank.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

/** Models worth offering here. Opus 5 writes the best distractors. */
export const GENERATOR_MODELS = [
  { id: 'claude-opus-5', label: 'Claude Opus 5 — best question quality' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — faster and cheaper' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — fastest, lowest cost' },
];

/**
 * Questions are requested a few at a time. Each batch is one non-streaming
 * request, which keeps every call comfortably under the HTTP timeout.
 */
const BATCH_SIZE = 8;

const QUESTION_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          subtopic: { type: 'string' },
          difficulty: { type: 'integer', enum: [1, 2, 3] },
          passage: { type: 'string' },
          stem: { type: 'string' },
          choices: { type: 'array', items: { type: 'string' } },
          answer: { type: 'integer', enum: [0, 1, 2, 3] },
          explanation: { type: 'string' },
        },
        required: ['subtopic', 'difficulty', 'passage', 'stem', 'choices', 'answer', 'explanation'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
};

const SECTION_GUIDANCE = {
  job_knowledge: `Write Job Knowledge questions for the redesigned Foreign Service Officer Test.

The Fall 2025 redesign narrowed this section to exactly four domains:
- us_government_history_society: the Constitution, separation of powers, landmark
  Supreme Court cases, the federal budget process, U.S. political history,
  demographics, and major social movements.
- world_history_geography: major world civilizations, decolonization, the Cold War,
  regional geography, capitals, rivers, straits, and chokepoints of strategic importance.
- economics: supply and demand, comparative advantage, fiscal and monetary policy,
  exchange rates, trade agreements, international financial institutions.
- math_statistics: percentages, ratios, rates of change, reading tables and charts,
  mean/median/mode, standard deviation, correlation, and basic probability.

Style: single-sentence or short-paragraph stems, four answer choices, exactly one
defensible correct answer. Aim for the difficulty of a well-read generalist with a
strong liberal-arts background — not trivia, not graduate-level specialization.
Leave "passage" as an empty string for this section.`,

  english_usage: `Write English Usage and Comprehension questions for the redesigned
Foreign Service Officer Test. The Fall 2025 redesign renamed this section from
"English Expression" and added reading comprehension.

Subtopics:
- grammar: subject-verb agreement, pronoun case and reference, verb tense and mood,
  modifier placement.
- usage_diction: commonly confused words, idiom, register, precision of word choice.
- sentence_structure: run-ons, comma splices, fragments, parallelism, coordination
  and subordination.
- organization_clarity: transitions, logical paragraph order, conciseness, redundancy.
- reading_comprehension: main idea, author's purpose, tone, inference, and the meaning
  of a word in context.

For grammar/usage/structure/organization items, write a sentence with an underlined
or clearly indicated portion and ask for the best replacement; leave "passage" empty.
For reading_comprehension items, supply a 150-250 word passage in the "passage" field
written in the register of a State Department cable, a policy journal, or serious
journalism, then ask one question about it. Each generated reading-comprehension
question should carry its own passage.`,

  logical_reasoning: `Write Logical Reasoning questions for the redesigned Foreign
Service Officer Test. This section is new as of the Fall 2025 redesign and assesses
making inferences, justifying conclusions, finding logical flaws, and identifying
assumptions.

Subtopics:
- inference: what must be true given the stimulus.
- justify_conclusion: which principle or premise would make the argument valid.
- identify_flaw: what is wrong with the reasoning.
- identify_assumption: what the argument takes for granted.
- strengthen_weaken: which fact most strengthens or most undermines the argument.

Format each item like an LSAT logical-reasoning question: a 40-100 word argument in
the "passage" field, a question stem, and four answer choices. Draw the subject
matter from diplomacy, public policy, economics, development, and international
affairs — the world an FSO works in. Distractors should be genuinely tempting:
true-but-irrelevant statements, reversals of the logical relationship, and claims
that go one step too far.`,
};

function buildPrompt(sectionId, count, existingStems) {
  const spec = SECTIONS[sectionId];
  const subtopics = Object.entries(spec.subtopics)
    .map(([id, s]) => `  - ${id} (about ${s.weight}% of the section: ${s.name})`)
    .join('\n');

  return `${SECTION_GUIDANCE[sectionId]}

Write exactly ${count} questions. Distribute them across these subtopic ids, roughly
in proportion to their weight in the real exam:

${subtopics}

Requirements for every question:
- "subtopic" must be exactly one of the ids listed above.
- "choices" must contain exactly 4 options.
- "answer" is the 0-based index of the correct choice. Vary which index is correct.
- "difficulty" is 1 (straightforward), 2 (typical), or 3 (hard).
- "explanation" must say why the correct answer is right AND why the most tempting
  wrong answer is wrong. Never restate the answer as its own explanation.
- Refer to a choice by its CONTENT, never by its position or letter. Choices are
  shuffled before display, so "the first option" and "option B" point at the wrong
  choice once shuffled. Write "the claim that sanctions always succeed" instead.
  For the same reason, never write a choice like "Both A and B" or "All of the above".
- "passage" is an empty string when the question needs no passage.

Do not reproduce or closely paraphrase any of these existing questions:
${existingStems.map((s) => `- ${s}`).join('\n') || '- (none yet)'}`;
}

/**
 * Generate `count` new questions for a section.
 * @returns {Promise<object[]>} Normalized question records ready for the bank.
 */
export async function generateQuestions({ sectionId, count, onProgress }) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('No API key saved. Add one in Settings first.');
  if (!SECTIONS[sectionId]) throw new Error(`Unknown section: ${sectionId}`);

  const model = getSettings().generatorModel || 'claude-opus-5';

  // Give the model a sample of what already exists so it writes something new.
  const pool = sectionPool(sectionId);
  const seen = new Set(pool.map((q) => q.stem.trim().toLowerCase()));
  const sample = pool.slice(-40).map((q) => q.stem.slice(0, 110));

  const collected = [];
  let batchIndex = 0;

  while (collected.length < count) {
    const remaining = count - collected.length;
    const batchCount = Math.min(BATCH_SIZE, remaining);
    onProgress?.({ done: collected.length, total: count });

    const raw = await requestBatch({
      apiKey,
      model,
      prompt: buildPrompt(sectionId, batchCount, sample),
    });

    for (const q of raw) {
      const norm = normalizeGenerated(q, sectionId, batchIndex, collected.length);
      if (!norm) continue;
      const key = norm.stem.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(norm);
      sample.push(norm.stem.slice(0, 110));
    }

    batchIndex++;
    // Guard against a model that keeps returning near-duplicates.
    if (batchIndex > Math.ceil(count / BATCH_SIZE) + 2) break;
  }

  onProgress?.({ done: collected.length, total: count });
  return collected.slice(0, count);
}

async function requestBatch({ apiKey, model, prompt }) {
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
        // Required for the API to accept a request from a browser origin.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        output_config: {
          effort: 'medium',
          format: { type: 'json_schema', schema: QUESTION_SCHEMA },
        },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch (err) {
    throw new Error(
      'Could not reach api.anthropic.com. Check your internet connection.'
    );
  }

  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(describeApiError(res.status, detail));
  }

  const data = await res.json();

  if (data.stop_reason === 'refusal') {
    throw new Error('The model declined to answer that request. Try again.');
  }
  if (data.stop_reason === 'max_tokens') {
    throw new Error(
      'The response was cut off before it finished. Try generating fewer questions at a time.'
    );
  }

  const text = (data.content ?? []).find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('The model returned no usable content.');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('The model returned malformed JSON.');
  }
  return Array.isArray(parsed.questions) ? parsed.questions : [];
}

function describeApiError(status, detail) {
  const message = detail?.error?.message;
  switch (status) {
    case 401:
      return 'That API key was rejected. Check it in Settings.';
    case 403:
      return 'That API key does not have access to the selected model.';
    case 404:
      return 'The selected model was not found. Pick a different one in Settings.';
    case 429:
      return 'Rate limited by the API. Wait a moment and try again.';
    case 529:
      return 'The API is temporarily overloaded. Try again shortly.';
    default:
      if (status >= 500) return `The API returned a server error (${status}). Try again.`;
      return message ? `API error (${status}): ${message}` : `API error (${status}).`;
  }
}

/** Validate one generated record and convert it to bank shape. */
function normalizeGenerated(q, sectionId, batchIndex, ordinal) {
  if (!q || typeof q !== 'object') return null;
  if (typeof q.stem !== 'string' || !q.stem.trim()) return null;
  if (!Array.isArray(q.choices) || q.choices.length !== 4) return null;
  if (q.choices.some((c) => typeof c !== 'string' || !c.trim())) return null;
  if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) return null;
  if (typeof q.explanation !== 'string' || !q.explanation.trim()) return null;

  const subtopics = SECTIONS[sectionId].subtopics;
  const subtopic = subtopics[q.subtopic] ? q.subtopic : Object.keys(subtopics)[0];

  const passage = typeof q.passage === 'string' && q.passage.trim() ? q.passage.trim() : null;
  const uid = `${Date.now().toString(36)}${batchIndex}${ordinal}${Math.random()
    .toString(36)
    .slice(2, 6)}`;

  return {
    id: `gen-${sectionId}-${uid}`,
    section: sectionId,
    subtopic,
    difficulty: [1, 2, 3].includes(q.difficulty) ? q.difficulty : 2,
    stem: q.stem.trim(),
    // Generated passages are single-question, so the passage travels with the item.
    passageId: passage ? `genp-${uid}` : null,
    passageText: passage,
    choices: q.choices.map((c) => c.trim()),
    answer: q.answer,
    explanation: q.explanation.trim(),
    source: 'generated',
  };
}
