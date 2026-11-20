"""Load and install the built-in prompts during a database migration.

Edit the pack data to review its content. Copy the migration pattern for future packs.
"""

from __future__ import annotations

import json
import sqlite3
import unicodedata
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from backend.db.connection import utc_now_text

PACK_V1 = Path(__file__).with_name("data") / "question_bank_v1.txt"
PACK_V2 = PACK_V1.with_name("question_bank_v2.txt")
MIN_ANSWERS = 15
TIERS = ("plankton", "too_clever", "schooler", "rare", "deep_cut", "krillion")


def read_pack(path: Path) -> Iterator[dict[str, Any]]:
    """Read each prompt and its six ordered rarity groups."""
    lines = iter(line.strip() for line in path.read_text(encoding="utf-8").splitlines())
    category = ""
    replaces = None
    for line in lines:
        if not line or line.startswith("#"):
            continue
        if line.startswith("[") and line.endswith("]"):
            category = line[1:-1]
            continue
        if line.startswith("> "):
            replaces = line[2:]
            continue
        if not category:
            raise ValueError(f"Missing category for {line!r}")
        groups = next(lines, "").split("|")
        if len(groups) != len(TIERS):
            raise ValueError(f"Expected six rarity groups for {line!r}")
        answers = []
        seen: set[str] = set()
        for tier, group in zip(TIERS, groups, strict=True):
            for entry in group.split(","):
                if not entry.strip():
                    continue
                answer, *aliases = (variant.strip() for variant in entry.split("="))
                # Accept unaccented spellings and ASCII apostrophes for typed answers.
                for variant in (answer, *aliases):
                    alternate = "".join(
                        char for char in unicodedata.normalize("NFD", variant.replace("’", "'"))
                        if not unicodedata.combining(char)
                    )
                    if alternate.casefold() not in {v.casefold() for v in (answer, *aliases)}:
                        aliases.append(alternate)
                for variant in (answer, *aliases):
                    if not variant or variant.casefold() in seen:
                        raise ValueError(f"Duplicate or empty answer {variant!r} for {line!r}")
                    seen.add(variant.casefold())
                answers.append({"answer": answer, "aliases": aliases, "tier": tier})
        question = {
            "prompt": line.removeprefix("!"),
            "category": category,
            "use_model": not line.startswith("!"),
            "answers": answers,
        }
        if replaces is not None:
            question["replaces"] = replaces
            replaces = None
        yield question


def _merge_answers(curated: list[dict[str, Any]], saved: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Use curated tiers for known answers and retain saved variants and other answers."""
    by_variant = {
        variant.casefold(): entry
        for entry in curated
        for variant in (entry["answer"], *entry["aliases"])
    }
    for entry in saved:
        variants = [entry["answer"], *entry.get("aliases", [])]
        existing = next((by_variant[v.casefold()] for v in variants if v.casefold() in by_variant), None)
        if existing is None:
            existing = {"answer": entry["answer"], "aliases": [], "tier": entry["tier"]}
            curated.append(existing)
            by_variant[entry["answer"].casefold()] = existing
        for variant in variants:
            if variant.casefold() not in by_variant:
                existing["aliases"].append(variant)
                by_variant[variant.casefold()] = existing
    return curated


def install_pack_v1(db: sqlite3.Connection) -> None:
    """Expand existing prompts in place and insert new ones once."""
    _install_pack(db, PACK_V1)


def install_pack_v2(db: sqlite3.Connection) -> None:
    """Broaden short prompts and add more geography and mathematics."""
    _install_pack(db, PACK_V2)


def expand_mars_answers(db: sqlite3.Connection) -> None:
    """Bring older copies of the Mars prompt up to the 15-answer minimum."""
    prompt = "Name a spacecraft that landed on Mars."
    question = next(question for question in read_pack(PACK_V1) if question["prompt"] == prompt)
    _install_questions(db, iter([question]))


def _install_pack(db: sqlite3.Connection, path: Path) -> None:
    _install_questions(db, read_pack(path))


def _install_questions(db: sqlite3.Connection, questions: Iterator[dict[str, Any]]) -> None:
    saved = {}
    for question_id, prompt, answers_json in db.execute("SELECT id, prompt, answers_json FROM game_questions ORDER BY id"):
        saved.setdefault(prompt.strip().casefold(), []).append((question_id, answers_json))
    now = utc_now_text()
    for question in questions:
        previous = question.get("replaces")
        matches = saved.get((previous or question["prompt"]).casefold(), [])
        if matches:
            for question_id, answers_json in matches:
                curated = [{**entry, "aliases": entry["aliases"].copy()} for entry in question["answers"]]
                saved_answers = json.loads(answers_json)
                if previous:
                    valid_variants = {
                        variant.casefold()
                        for answer in curated
                        for variant in (answer["answer"], *answer["aliases"])
                    }
                    saved_answers = [entry for entry in saved_answers if entry["answer"].casefold() in valid_variants]
                answers = _merge_answers(curated, saved_answers)
                db.execute(
                    """UPDATE game_questions SET prompt = ?, category = ?, answers_json = ?, updated_at = ?,
                       hint = CASE WHEN ? THEN '' ELSE hint END WHERE id = ?""",
                    (question["prompt"], question["category"], json.dumps(answers, ensure_ascii=False), now, bool(previous), question_id),
                )
        else:
            db.execute(
                """INSERT INTO game_questions (prompt, category, answers_json, use_model, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (question["prompt"], question["category"], json.dumps(question["answers"], ensure_ascii=False),
                 int(question["use_model"]), now, now),
            )
