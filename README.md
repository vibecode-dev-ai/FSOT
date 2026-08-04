# FSOT Study App

A local practice app for the **redesigned Foreign Service Officer Test** — the version
first administered October 18–25, 2025, and used since.

Runs entirely in your browser. No accounts, no build step, no data leaves your machine.

## Running it

```bash
./serve.command
```

Or, equivalently:

```bash
python3 -m http.server 8765
```

then open <http://localhost:8765>.

**A local server is required.** Opening `index.html` directly from Finder will not work:
browsers block JavaScript modules and local file reads over `file://`.

## What the test looks like

The Fall 2025 redesign dropped the Situational Judgment section and the personal
narrative essays, added Logical Reasoning, narrowed Job Knowledge to four domains, and
renamed English Expression to English Usage and Comprehension.

| Section | Questions | Time |
|---|---|---|
| Job Knowledge | 60 | 40 min |
| English Usage and Comprehension | 65 | 50 min |
| Logical Reasoning | 30 | 60 min |
| **Total** | **155** | **150 min** |

There is no longer a published passing score. The Department advances candidates by
highest score relative to the needs of the Service, so treat your percentage as a
measure of your own progress rather than a pass/fail line.

## Study modes

**Full Timed Exam** — All three sections back to back at official length and timing.
Correct answers stay hidden until you finish the entire test. Each section has its own
countdown; when a section's time expires it locks and you move on, as on the real exam.

**Practice — All Sections** — A mixed set drawn proportionally from all three sections.
The correct answer and an explanation appear the moment you answer.

**Practice — Single Section** — The same instant feedback, scoped to one section.

**Drill My Weak Areas** — Appears once you have enough history. Pulls from your
lowest-accuracy subtopics and from questions you have missed before.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `1`–`4` or `A`–`D` | Select an answer |
| `→` or `Enter` | Next question |
| `←` | Previous question |
| `F` | Flag for review |

Finishing a section or the whole test always requires an explicit click, so you can't
end a timed section by leaning on the arrow key.

## Progress tracking

Every session is saved to your browser's local storage: score history, accuracy by
section and by subtopic, and a full review of every question with explanations. The
Progress screen identifies your weakest subtopics once you have attempted at least
three questions in each.

Settings has **Export backup** / **Import backup** if you want to move your history to
another browser or machine.

## Generating more questions (optional)

The bundled bank has roughly 250 questions with written explanations, which is enough
for a full-length exam plus considerable practice. To go beyond it, Settings accepts an
[Anthropic API key](https://console.anthropic.com/) and will write new questions in the
same format, matched to each section's blueprint and checked against what you already
have so it doesn't repeat itself.

This is entirely optional — everything else works offline.

**About the key:** it is stored in this browser's local storage on this machine and is
sent only to `api.anthropic.com`. Anyone with access to this browser profile can read
it, so use a key you are willing to rotate. It is never included in backup exports.

## Project layout

```
index.html              Single page; all views render into it
serve.command           Double-clickable launcher
css/styles.css          Design system, light and dark
js/
  config.js             Section blueprint — question counts, time limits, subtopic weights
  app.js                Bootstrap and hash router
  bank.js               Loads and samples the question bank
  engine.js             Exam session state machine
  timer.js              Per-section countdown
  storage.js            localStorage: attempts, settings, generated questions
  stats.js              Scoring and analytics
  generator.js          Optional Anthropic API question generation
  ui.js                 Shared DOM helpers
  views/                home, exam, results, progress, settings
data/
  job-knowledge.json
  english-usage.json
  logical-reasoning.json
```

If official question counts or timings change, edit `SECTIONS` in
[js/config.js](js/config.js) — everything else reads from there.

## A note on the questions

These are practice questions written to match the published structure and the difficulty
of the real exam. They are not actual test items, and no one outside the Department has
those. Use them to build recall, pacing, and the habit of reading answer choices
carefully; don't treat any single score as a prediction.
