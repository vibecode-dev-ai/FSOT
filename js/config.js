// FSOT blueprint — Fall 2025 redesign and newer.
//
// The October 2025 redesign removed the Situational Judgment section and the
// personal narrative essays, added Logical Reasoning, narrowed Job Knowledge to
// four domains, and renamed English Expression to English Usage and Comprehension.
//
// Official structure: 155 questions, 150 minutes.

export const APP_VERSION = '1.0.0';

export const SECTIONS = {
  job_knowledge: {
    id: 'job_knowledge',
    name: 'Job Knowledge',
    short: 'JK',
    file: 'data/job-knowledge.json',
    questionCount: 60,
    timeLimitMinutes: 40,
    order: 1,
    blurb:
      'U.S. government, history and society; world history and geography; economics; math and statistics.',
    subtopics: {
      us_government_history_society: { name: 'U.S. Government, History & Society', weight: 40 },
      world_history_geography: { name: 'World History & Geography', weight: 25 },
      economics: { name: 'Economics', weight: 20 },
      math_statistics: { name: 'Math & Statistics', weight: 15 },
    },
  },

  english_usage: {
    id: 'english_usage',
    name: 'English Usage and Comprehension',
    short: 'EUC',
    file: 'data/english-usage.json',
    questionCount: 65,
    timeLimitMinutes: 50,
    order: 2,
    blurb:
      'Grammar, usage and diction, sentence structure, organization and clarity, plus reading comprehension.',
    subtopics: {
      grammar: { name: 'Grammar', weight: 20 },
      usage_diction: { name: 'Usage & Diction', weight: 15 },
      sentence_structure: { name: 'Sentence Structure', weight: 15 },
      organization_clarity: { name: 'Organization & Clarity', weight: 10 },
      reading_comprehension: { name: 'Reading Comprehension', weight: 40 },
    },
  },

  logical_reasoning: {
    id: 'logical_reasoning',
    name: 'Logical Reasoning',
    short: 'LR',
    file: 'data/logical-reasoning.json',
    questionCount: 30,
    timeLimitMinutes: 60,
    order: 3,
    blurb:
      'Making inferences, justifying conclusions, finding logical flaws, and identifying assumptions.',
    subtopics: {
      inference: { name: 'Inference', weight: 25 },
      justify_conclusion: { name: 'Justify the Conclusion', weight: 20 },
      identify_flaw: { name: 'Identify the Flaw', weight: 20 },
      identify_assumption: { name: 'Identify the Assumption', weight: 20 },
      strengthen_weaken: { name: 'Strengthen / Weaken', weight: 15 },
    },
  },
};

/** Sections in official test order. */
export const SECTION_ORDER = Object.values(SECTIONS)
  .sort((a, b) => a.order - b.order)
  .map((s) => s.id);

export const TOTAL_QUESTIONS = SECTION_ORDER.reduce(
  (n, id) => n + SECTIONS[id].questionCount,
  0
);

export const TOTAL_MINUTES = SECTION_ORDER.reduce(
  (n, id) => n + SECTIONS[id].timeLimitMinutes,
  0
);

export const MODES = {
  timed_full: {
    id: 'timed_full',
    name: 'Full Timed Exam',
    revealPolicy: 'on_submit',
    timed: true,
    scope: 'all',
  },
  practice_all: {
    id: 'practice_all',
    name: 'Practice — All Sections',
    revealPolicy: 'immediate',
    timed: false,
    scope: 'all',
  },
  practice_section: {
    id: 'practice_section',
    name: 'Practice — Single Section',
    revealPolicy: 'immediate',
    timed: false,
    scope: 'section',
  },
  drill: {
    id: 'drill',
    name: 'Weak-Area Drill',
    revealPolicy: 'immediate',
    timed: false,
    scope: 'custom',
  },
};

export const CHOICE_LETTERS = ['A', 'B', 'C', 'D'];

/** Timer turns amber below this many seconds remaining. */
export const TIMER_WARNING_SECONDS = 5 * 60;
/** Timer turns red below this many seconds remaining. */
export const TIMER_DANGER_SECONDS = 60;

/** Default number of questions for a practice session when not running full length. */
export const PRACTICE_DEFAULTS = {
  practice_all: 30,
  practice_section: 20,
  drill: 20,
};

export function sectionName(id) {
  return SECTIONS[id]?.name ?? id;
}

export function subtopicName(sectionId, subtopicId) {
  return SECTIONS[sectionId]?.subtopics?.[subtopicId]?.name ?? subtopicId;
}
