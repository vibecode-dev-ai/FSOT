#!/usr/bin/env python3
"""Validate the FSOT question bank.

Run from the project root:  python3 tools/validate_bank.py

Checks structure, blueprint coverage, and near-duplicate content. Exits
non-zero on any error so it can be used as a pre-commit gate.
"""
import collections
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Mirrors SECTIONS in js/config.js — keep the two in sync.
BLUEPRINT = {
    "job_knowledge": {
        "file": "data/job-knowledge.json",
        "needed": 60,
        "subtopics": {
            "us_government_history_society": 40,
            "world_history_geography": 25,
            "economics": 20,
            "math_statistics": 15,
        },
    },
    "english_usage": {
        "file": "data/english-usage.json",
        "needed": 65,
        "subtopics": {
            "grammar": 20,
            "usage_diction": 15,
            "sentence_structure": 15,
            "organization_clarity": 10,
            "reading_comprehension": 40,
        },
    },
    "logical_reasoning": {
        "file": "data/logical-reasoning.json",
        "needed": 30,
        "subtopics": {
            "inference": 25,
            "justify_conclusion": 20,
            "identify_flaw": 20,
            "identify_assumption": 20,
            "strengthen_weaken": 15,
        },
    },
}

errors, warnings = [], []
all_ids = set()
grand_total = 0

for section, spec in BLUEPRINT.items():
    path = ROOT / spec["file"]
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        errors.append(f"{spec['file']}: invalid JSON — {exc}")
        continue

    passages = data.get("passages", {})
    questions = data.get("questions", [])
    grand_total += len(questions)
    counts = collections.Counter()

    # A generic stem like "Which of the following must be true?" is fine as long
    # as it hangs off a different passage, so key duplicates on the pair.
    seen_content = collections.Counter()

    for q in questions:
        qid = q.get("id", "<no id>")
        if qid in all_ids:
            errors.append(f"{qid}: duplicate id")
        all_ids.add(qid)

        seen_content[(q.get("passageId"), q.get("stem", "").strip().lower())] += 1

        choices = q.get("choices")
        if not isinstance(choices, list) or len(choices) != 4:
            errors.append(f"{qid}: expected 4 choices")
        elif any(not isinstance(c, str) or not c.strip() for c in choices):
            errors.append(f"{qid}: blank choice text")
        elif len(set(choices)) != 4:
            errors.append(f"{qid}: duplicate choice text")

        if not isinstance(q.get("answer"), int) or not 0 <= q["answer"] <= 3:
            errors.append(f"{qid}: answer out of range")

        if len(q.get("explanation", "")) < 40:
            errors.append(f"{qid}: missing or trivially short explanation")

        if not q.get("stem", "").strip():
            errors.append(f"{qid}: empty stem")

        subtopic = q.get("subtopic")
        if subtopic not in spec["subtopics"]:
            errors.append(f"{qid}: unknown subtopic {subtopic!r}")
        else:
            counts[subtopic] += 1

        if q.get("difficulty", 2) not in (1, 2, 3):
            errors.append(f"{qid}: difficulty must be 1-3")

        pid = q.get("passageId")
        if pid and pid not in passages:
            errors.append(f"{qid}: passageId {pid!r} not found")

    # passageId is None for standalone questions, so sort on a string key.
    for (pid, stem), n in sorted(seen_content.items(), key=lambda kv: (kv[0][0] or "", kv[0][1])):
        if n > 1:
            where = f"passage {pid}" if pid else "no passage"
            errors.append(f"{section}: {n} identical stems ({where}): {stem[:60]}")

    used = {q.get("passageId") for q in questions if q.get("passageId")}
    for pid in passages:
        if pid not in used:
            warnings.append(f"{section}: passage {pid!r} is never referenced")

    print(f"\n{section}: {len(questions)} questions  (full section = {spec['needed']})")
    for sub, weight in spec["subtopics"].items():
        target = round(weight / 100 * spec["needed"])
        have = counts[sub]
        note = "  <- short for a full-length section" if have < target else ""
        print(f"    {sub:<32}{have:>4}   (full exam needs ~{target}){note}")
        if have < target:
            warnings.append(f"{section}/{sub}: {have} available, needs ~{target}")

print(f"\nTOTAL: {grand_total} questions")

if warnings:
    print("\nWARNINGS:")
    for w in warnings:
        print(f"  ! {w}")

if errors:
    print("\nERRORS:")
    for e in errors:
        print(f"  X {e}")
    sys.exit(1)

print("\nAll checks passed.")
