"""Manage the admin question bank through authenticated JSON endpoints.

Edit this file when question editing rules change; copy its route pattern for another game API group.
"""

from __future__ import annotations

from typing import Any

from aiohttp import web

from backend.app_keys import DB
from backend.auth.access import require_admin
from backend.db.game_questions import delete_question, list_questions, save_question
from backend.db.question_pack import MIN_ANSWERS
from backend.http.json_api import AppError, ok, read_json
from backend.http.middleware import require_allowed_origin

TIERS = {"plankton", "too_clever", "schooler", "rare", "deep_cut", "krillion"}


def validate_question(payload: dict[str, Any]) -> tuple[str, str, list[dict[str, Any]], int | None, bool, str | None]:
    prompt = payload.get("prompt")
    hint = payload.get("hint", "")
    answers = payload.get("answers")
    question_id = payload.get("id")
    use_model = payload.get("use_model", True)
    category = payload.get("category")
    if type(use_model) is not bool:
        raise AppError(400, "bad_request", "Use model must be true or false.")
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 240:
        raise AppError(400, "bad_request", "Question prompt must be between 1 and 240 characters.")
    if not isinstance(hint, str) or len(hint) > 240:
        raise AppError(400, "bad_request", "Hint must be 240 characters or fewer.")
    if "category" in payload and (not isinstance(category, str) or not category.strip() or len(category.strip()) > 60):
        raise AppError(400, "bad_request", "Category must be between 1 and 60 characters.")
    if not isinstance(answers, list) or not MIN_ANSWERS <= len(answers) <= 500:
        raise AppError(400, "bad_request", f"Add between {MIN_ANSWERS} and 500 accepted answers.")
    if question_id is not None and type(question_id) is not int:
        raise AppError(400, "bad_request", "Question id must be an integer.")
    clean_answers = []
    seen: set[str] = set()
    for item in answers:
        if not isinstance(item, dict):
            raise AppError(400, "bad_request", "Each answer must have text and a rarity tier.")
        answer = item.get("answer")
        aliases = item.get("aliases", [])
        tier = item.get("tier")
        if not isinstance(answer, str) or not answer.strip() or len(answer) > 120:
            raise AppError(400, "bad_request", "Accepted answers must be between 1 and 120 characters.")
        if not isinstance(aliases, list) or any(not isinstance(alias, str) or len(alias) > 120 for alias in aliases):
            raise AppError(400, "bad_request", "Answer aliases must be a list of short text values.")
        if not isinstance(tier, str) or tier not in TIERS:
            raise AppError(400, "bad_request", "Choose a valid rarity tier for every answer.")
        for variant in [answer, *aliases]:
            normalized = variant.strip().casefold()
            if not normalized or normalized in seen:
                raise AppError(400, "bad_request", "Accepted answers and aliases must be unique.")
            seen.add(normalized)
        clean_answers.append({"answer": answer.strip(), "aliases": [alias.strip() for alias in aliases if alias.strip()], "tier": tier})
    return prompt.strip(), hint.strip(), clean_answers, question_id, use_model, category.strip() if category is not None else None


async def questions_list(request: web.Request) -> web.Response:
    require_admin(request)
    return ok({"questions": await list_questions(request.app[DB])})


async def questions_save(request: web.Request) -> web.Response:
    require_allowed_origin(request)
    require_admin(request)
    question = await save_question(request.app[DB], *validate_question(await read_json(request)))
    if question is None:
        raise AppError(404, "not_found", "Question does not exist.")
    return ok({"question": question})


async def questions_delete(request: web.Request) -> web.Response:
    require_allowed_origin(request)
    require_admin(request)
    payload = await read_json(request)
    question_id = payload.get("id")
    if type(question_id) is not int:
        raise AppError(400, "bad_request", "Question id must be an integer.")
    if not await delete_question(request.app[DB], question_id):
        raise AppError(404, "not_found", "Question does not exist.")
    return ok({"deleted": True, "id": question_id})


def setup_game_routes(app: web.Application) -> None:
    app.router.add_post("/api/game/questions/list", questions_list)
    app.router.add_post("/api/game/questions/save", questions_save)
    app.router.add_post("/api/game/questions/delete", questions_delete)
