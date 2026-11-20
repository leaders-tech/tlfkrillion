"""Read and edit the game question bank.

Edit these queries when question storage changes; copy the CRUD pattern for another table.
"""

from __future__ import annotations

import json
from typing import Any

import aiosqlite

from backend.db.connection import utc_now_text
from backend.db.question_pack import MIN_ANSWERS


def _question(row: aiosqlite.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "prompt": row["prompt"],
        "hint": row["hint"],
        "category": row["category"],
        "use_model": bool(row["use_model"]),
        "answers": json.loads(row["answers_json"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


async def list_questions(db: aiosqlite.Connection) -> list[dict[str, Any]]:
    cursor = await db.execute("SELECT * FROM game_questions ORDER BY id")
    return [_question(row) for row in await cursor.fetchall()]


async def get_random_questions(db: aiosqlite.Connection, amount: int, category: str = "") -> list[dict[str, Any]]:
    cursor = await db.execute(
        """SELECT * FROM game_questions WHERE json_array_length(answers_json) >= ?
           AND (? = '' OR category = ?) ORDER BY RANDOM() LIMIT ?""",
        (MIN_ANSWERS, category, category, amount),
    )
    return [_question(row) for row in await cursor.fetchall()]


async def list_playable_categories(db: aiosqlite.Connection) -> list[dict[str, Any]]:
    cursor = await db.execute(
        """SELECT category, COUNT(*) AS count FROM game_questions
           WHERE json_array_length(answers_json) >= ? GROUP BY category ORDER BY category COLLATE NOCASE""",
        (MIN_ANSWERS,),
    )
    return [{"name": row["category"], "count": row["count"]} for row in await cursor.fetchall()]


async def add_verified_answer(
    db: aiosqlite.Connection,
    question_id: int,
    answer: str,
    alias: str,
    tier: str,
) -> dict[str, Any] | None:
    """Add a verified answer to a question without overwriting its existing answers."""
    cursor = await db.execute("SELECT * FROM game_questions WHERE id = ?", (question_id,))
    row = await cursor.fetchone()
    if row is None:
        return None

    question = _question(row)
    normalized = answer.casefold()
    existing_variants = {variant.casefold() for saved in question["answers"] for variant in [saved["answer"], *saved.get("aliases", [])]}
    if alias.casefold() in existing_variants:
        return question
    for saved in question["answers"]:
        variants = [saved["answer"], *saved.get("aliases", [])]
        if any(normalized == variant.casefold() for variant in variants):
            if alias.casefold() != normalized:
                saved.setdefault("aliases", []).append(alias)
                await db.execute(
                    "UPDATE game_questions SET answers_json = ?, updated_at = ? WHERE id = ?",
                    (json.dumps(question["answers"], ensure_ascii=False), utc_now_text(), question_id),
                )
                await db.commit()
            return question

    aliases = [alias] if alias.casefold() != normalized else []
    question["answers"].append({"answer": answer, "aliases": aliases, "tier": tier})
    await db.execute(
        "UPDATE game_questions SET answers_json = ?, updated_at = ? WHERE id = ?",
        (json.dumps(question["answers"], ensure_ascii=False), utc_now_text(), question_id),
    )
    await db.commit()
    return question


async def save_question(
    db: aiosqlite.Connection,
    prompt: str,
    hint: str,
    answers: list[dict[str, Any]],
    question_id: int | None = None,
    use_model: bool = True,
    category: str | None = None,
) -> dict[str, Any] | None:
    now = utc_now_text()
    encoded_answers = json.dumps(answers, ensure_ascii=False)
    if question_id is None:
        cursor = await db.execute(
            """INSERT INTO game_questions (prompt, hint, answers_json, use_model, category, created_at, updated_at)
               VALUES (?, ?, ?, ?, COALESCE(?, 'General'), ?, ?)""",
            (prompt, hint, encoded_answers, int(use_model), category, now, now),
        )
        await db.commit()
        question_id = cursor.lastrowid
    else:
        cursor = await db.execute(
            """UPDATE game_questions SET prompt = ?, hint = ?, answers_json = ?, use_model = ?,
               category = COALESCE(?, category), updated_at = ? WHERE id = ?""",
            (prompt, hint, encoded_answers, int(use_model), category, now, question_id),
        )
        await db.commit()
        if cursor.rowcount == 0:
            return None
    cursor = await db.execute("SELECT * FROM game_questions WHERE id = ?", (question_id,))
    row = await cursor.fetchone()
    return _question(row) if row else None


async def delete_question(db: aiosqlite.Connection, question_id: int) -> bool:
    cursor = await db.execute("DELETE FROM game_questions WHERE id = ?", (question_id,))
    await db.commit()
    return cursor.rowcount > 0
