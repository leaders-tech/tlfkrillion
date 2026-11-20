"""Test the admin question editor and authenticated game room setup.

Edit these tests when question rules or room setup behavior changes; copy the cases for another game API.
"""

from __future__ import annotations

import asyncio
import json
import shutil
import sqlite3
from unittest.mock import AsyncMock

import pytest
from aiohttp import WSServerHandshakeError

from backend.app_keys import GAME_ROOMS
from backend.db.game_questions import get_random_questions, list_questions
from backend.db.migrations import run_migrations
from backend.db.question_pack import MIN_ANSWERS, PACK_V1, PACK_V2, read_pack
from backend.game.answer_match import find_answer
from backend.game.routes import validate_question
from backend.tests.conftest import login

QUESTION = {
    "prompt": "Name a moon of Jupiter.",
    "hint": "Think beyond the largest moons.",
    "category": "Space",
    "answers": [
        {"answer": "Io", "aliases": ["Io moon"], "tier": "plankton"},
        {"answer": "Carme", "aliases": [], "tier": "deep_cut"},
        *[
            {"answer": name, "aliases": [], "tier": "schooler"}
            for name in [
                "Europa", "Ganymede", "Callisto", "Amalthea", "Himalia", "Thebe", "Elara",
                "Metis", "Adrastea", "Pasiphae", "Sinope", "Lysithea", "Ananke",
            ]
        ],
    ],
}


@pytest.mark.parametrize(("typed", "expected"), [
    ("ganyemede", "Ganymede"),
    ("calilsto", "Callisto"),
    ("  io-moon  ", "Io"),
    ("Iu", None),
    ("Saturn", None),
    ("Carme", "Carme"),
    ("Carem", None),  # A transposition of Carme and one substitution away from Carès.
    ("cares", "Carnegie"),
])
def test_answer_matching_accepts_only_clear_typos(typed, expected):
    answers = [*QUESTION["answers"], {"answer": "Carnegie", "aliases": ["Carès"], "tier": "rare"}]
    match = find_answer(typed.strip(), answers)
    assert (match["answer"] if match else None) == expected


@pytest.mark.asyncio
async def test_typos_score_with_ai_disabled(client, create_user, auth_headers, monkeypatch):
    bank = {**QUESTION, "use_model": False}
    monkeypatch.setattr("backend.game.rooms.get_random_questions", AsyncMock(return_value=[bank] * 7))
    checker = AsyncMock()
    monkeypatch.setattr("backend.game.rooms.check_answer", checker)
    await create_user("diver", "password")
    await login(client, "diver", "password", auth_headers)
    async with client.ws_connect("/ws") as ws:
        await ws.receive_json()
        await ws.send_json({"type": "game.create_solo"})
        game = await ws.receive_json()
        await ws.send_json({"type": "game.answer", "code": game["code"], "answer": "calilsto"})
        result = await ws.receive_json()
    assert result["players"][0]["last_answer"] == "Callisto"
    assert result["players"][0]["score"] == 30
    checker.assert_not_called()


def test_built_in_bank_has_valid_prompts_across_categories() -> None:
    bank = {question["prompt"]: question for question in read_pack(PACK_V1)}
    for question in read_pack(PACK_V2):
        if question.get("replaces"):
            del bank[question["replaces"]]
        bank[question["prompt"]] = question
    assert len(bank) >= 137
    assert len({question["category"] for question in bank.values()}) >= 11
    for question in bank.values():
        _, _, answers, _, _, _ = validate_question(question)
        assert len({answer["tier"] for answer in answers}) >= 2
    assert len(bank["Name a chemical element."]["answers"]) == 118
    strings = bank["Name a musical instrument with strings."]["answers"]
    assert next(answer["tier"] for answer in strings if answer["answer"] == "Sitar") == "schooler"
    math = bank["Name a mathematical theory, field, or framework."]["answers"]
    assert next(answer["tier"] for answer in math if answer["answer"] == "Arakelov theory") == "krillion"


def test_question_pack_upgrade_keeps_saved_questions_and_aliases(tmp_path) -> None:
    migrations = PACK_V1.parents[2] / "migrations"
    old_migrations = tmp_path / "old_migrations"
    old_migrations.mkdir()
    for migration in migrations.glob("00[1-5]_*.py"):
        shutil.copyfile(migration, old_migrations / migration.name)
    path = tmp_path / "upgrade.sqlite3"
    run_migrations(path, old_migrations)
    saved_answers = [
        {"answer": "Denmark", "aliases": ["denamrk"], "tier": "deep_cut"},
        {"answer": "Netherlands", "aliases": ["Nederland"], "tier": "rare"},
    ]
    with sqlite3.connect(path) as db:
        db.execute(
            """INSERT INTO game_questions (id, prompt, hint, answers_json, use_model, created_at, updated_at)
               VALUES (1, ?, 'A custom hint', ?, 0, '2026-01-01', '2026-01-01')""",
            ("Name a country that borders Germany.", json.dumps(saved_answers)),
        )
        db.execute(
            """INSERT INTO game_questions (prompt, answers_json, created_at, updated_at)
               VALUES ('A custom prompt', '[]', '2026-01-01', '2026-01-01')"""
        )
    run_migrations(path, migrations)
    run_migrations(path, migrations)
    with sqlite3.connect(path) as db:
        prompt, category, hint, use_model, answers_json = db.execute(
            "SELECT prompt, category, hint, use_model, answers_json FROM game_questions WHERE id = 1"
        ).fetchone()
        assert (prompt, category, hint, use_model) == ("Name a current member country of the European Union.", "Geography", "", 0)
        answers = {answer["answer"]: answer for answer in json.loads(answers_json)}
        assert len(answers) == 27
        assert answers["Denmark"]["tier"] == "schooler"
        assert "denamrk" in answers["Denmark"]["aliases"]
        assert "Nederland" in answers["Netherlands"]["aliases"]
        assert db.execute("SELECT category FROM game_questions WHERE id = 2").fetchone() == ("General",)
        assert db.execute("SELECT COUNT(*) FROM game_questions").fetchone() == (138,)


@pytest.mark.asyncio
async def test_questions_with_too_few_answers_are_excluded_from_play(client, db) -> None:
    await db.execute(
        """INSERT INTO game_questions (prompt, answers_json, created_at, updated_at)
           VALUES ('An existing short prompt', '[]', '2026-01-01', '2026-01-01')"""
    )
    assert any(question["prompt"] == "An existing short prompt" for question in await list_questions(db))
    assert all(len(question["answers"]) >= MIN_ANSWERS for question in await get_random_questions(db, -1))
    math = await get_random_questions(db, -1, "Mathematics")
    assert len(math) >= 7
    assert all(question["category"] == "Mathematics" for question in math)
    assert await get_random_questions(db, 7, "Missing category") == []


@pytest.mark.asyncio
async def test_admin_can_create_edit_list_and_delete_questions(client, create_user, auth_headers) -> None:
    await create_user("admin", "admin", True)
    await login(client, "admin", "admin", auth_headers)

    response = await client.post("/api/game/questions/save", json=QUESTION, headers=auth_headers)
    assert response.status == 200
    question = (await response.json())["data"]["question"]
    assert question["prompt"] == QUESTION["prompt"]
    assert question["category"] == "Space"
    assert question["answers"] == QUESTION["answers"]

    edited = {**QUESTION, "id": question["id"], "category": "Astronomy", "prompt": "Name a different moon."}
    update_response = await client.post("/api/game/questions/save", json=edited, headers=auth_headers)
    assert (await update_response.json())["data"]["question"]["prompt"] == "Name a different moon."

    list_response = await client.post("/api/game/questions/list", json={})
    listed = (await list_response.json())["data"]["questions"]
    updated = next(item for item in listed if item["id"] == question["id"])
    assert updated["prompt"] == "Name a different moon."
    assert updated["category"] == "Astronomy"

    delete_response = await client.post("/api/game/questions/delete", json={"id": question["id"]}, headers=auth_headers)
    assert delete_response.status == 200
    assert (await client.post("/api/game/questions/list", json={})).status == 200


@pytest.mark.asyncio
async def test_regular_user_cannot_view_or_change_questions(client, create_user, auth_headers) -> None:
    await create_user("player", "player")
    await login(client, "player", "player", auth_headers)
    assert (await client.post("/api/game/questions/list", json={})).status == 403
    assert (await client.post("/api/game/questions/save", json=QUESTION, headers=auth_headers)).status == 403


@pytest.mark.asyncio
async def test_admin_can_create_player_account_and_duplicate_name_is_rejected(client, create_user, auth_headers) -> None:
    await create_user("admin", "admin", True)
    await login(client, "admin", "admin", auth_headers)
    response = await client.post("/api/admin/users/create", json={"username": "oceanfriend", "password": "deep-ocean-pass"}, headers=auth_headers)
    assert response.status == 201
    assert (await response.json())["data"]["user"]["username"] == "oceanfriend"
    duplicate = await client.post("/api/admin/users/create", json={"username": "oceanfriend", "password": "deep-ocean-pass"}, headers=auth_headers)
    assert duplicate.status == 409
    assert (await client.post("/api/auth/login", json={"username": "oceanfriend", "password": "deep-ocean-pass"}, headers=auth_headers)).status == 200


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload",
    [
        {**QUESTION, "prompt": " "},
        {**QUESTION, "category": " "},
        {**QUESTION, "answers": []},
        {**QUESTION, "answers": QUESTION["answers"][:-1]},
        {**QUESTION, "answers": [{"answer": "Io", "tier": "impossible"}, *QUESTION["answers"][1:]]},
        {**QUESTION, "answers": [{"answer": "Io", "aliases": ["io"], "tier": "rare"}, *QUESTION["answers"][1:]]},
    ],
)
async def test_question_editor_rejects_invalid_content(client, create_user, auth_headers, payload) -> None:
    await create_user("admin", "admin", True)
    await login(client, "admin", "admin", auth_headers)
    response = await client.post("/api/game/questions/save", json=payload, headers=auth_headers)
    assert response.status == 400


@pytest.mark.asyncio
async def test_room_codes_require_a_signed_in_player(client) -> None:
    with pytest.raises(WSServerHandshakeError) as error:
        await client.ws_connect("/ws")
    assert error.value.status == 401


@pytest.mark.asyncio
async def test_solo_dive_resumes_and_scores_all_seven_rounds(client, create_user, auth_headers, db, monkeypatch) -> None:
    monkeypatch.setattr("backend.game.rooms.ROUND_TRANSITION_SECONDS", 0)
    await create_user("diver", "diver")
    await create_user("other", "other")
    await login(client, "diver", "diver", auth_headers)
    ws = await client.ws_connect("/ws")
    await ws.receive_json()
    await ws.send_json({"type": "game.create_solo"})
    current = await ws.receive_json()
    code = current["code"]
    assert current["mode"] == "solo"
    assert current["status"] == "playing"
    assert len(current["players"]) == 1

    await login(client, "other", "other", auth_headers)
    other = await client.ws_connect("/ws")
    await other.receive_json()
    await other.send_json({"type": "game.join", "code": code})
    assert (await other.receive_json())["code"] == "room_started"
    await other.close()

    await ws.close()
    await login(client, "diver", "diver", auth_headers)
    ws = await client.ws_connect("/ws")
    await ws.receive_json()
    await ws.send_json({"type": "game.join", "code": code})
    current = await ws.receive_json()
    bank = await list_questions(db)
    for round_number in range(1, 8):
        assert current["round"] == round_number
        question = next(q for q in bank if q["prompt"] == current["question"]["prompt"])
        answer = next(a for a in question["answers"] if a["tier"] == "plankton")
        await ws.send_json({"type": "game.answer", "code": code, "answer": answer["answer"]})
        score = await ws.receive_json()
        assert score["players"][0]["score"] == round_number * 10
        current = await ws.receive_json()
    assert current["status"] == "finished"
    assert current["rankings"][0]["depth"] == 700
    assert len(current["review"]) == 7
    assert all(len(question["answers"]) >= MIN_ANSWERS for question in current["review"])
    await ws.close()


@pytest.mark.asyncio
async def test_endless_repeats_the_bank_and_stops_on_timeout(client, create_user, auth_headers, db, monkeypatch) -> None:
    questions = (await list_questions(db))[:2]
    mock_bank = AsyncMock(side_effect=lambda *_: questions.copy())
    monkeypatch.setattr("backend.game.rooms.get_random_questions", mock_bank)
    monkeypatch.setattr("backend.game.rooms.ROUND_TRANSITION_SECONDS", 0)
    await create_user("diver", "diver")
    await login(client, "diver", "diver", auth_headers)
    ws = await client.ws_connect("/ws")
    await ws.receive_json()
    await ws.send_json({"type": "game.create_endless"})
    current = await ws.receive_json()
    code = current["code"]
    assert current["mode"] == "endless"
    for round_number in range(1, 9):
        assert current["round"] == round_number
        assert current["round_count"] is None
        assert "review" not in current
        question = next(q for q in questions if q["prompt"] == current["question"]["prompt"])
        await ws.send_json({"type": "game.answer", "code": code, "answer": question["answers"][0]["answer"]})
        await ws.receive_json()
        previous = current["question"]["prompt"]
        current = await ws.receive_json()
        assert current["question"]["prompt"] != previous
    assert mock_bank.await_count > 1
    rooms = client.app[GAME_ROOMS]
    rooms.rooms[code]["timer"].cancel()
    await asyncio.wait_for(rooms._round_timeout(code, 8, 0), timeout=1)
    results = await ws.receive_json()
    assert results["status"] == "finished"
    assert results["timed_out"]
    assert len(results["review"]) == 9
    await ws.close()


@pytest.mark.asyncio
async def test_room_host_and_guest_play_all_seven_prompts(client, create_user, auth_headers, db, monkeypatch) -> None:
    monkeypatch.setattr("backend.game.rooms.ROUND_TRANSITION_SECONDS", 0)

    async def model_questions(connection, amount, category=""):
        questions = await list_questions(connection)
        return [
            question for question in questions
            if question["use_model"] and any(answer["tier"] == "deep_cut" for answer in question["answers"])
        ][:amount]

    async def check_answer(_api_key, _prompt, _hint, answer):
        if answer == "not accepted":
            return {"correct": False}
        return {"correct": True, "canonical_answer": "AI-verified answer", "tier": "deep_cut"}

    monkeypatch.setattr("backend.game.rooms.check_answer", check_answer)
    monkeypatch.setattr("backend.game.rooms.get_random_questions", model_questions)
    await create_user("host", "host")
    await create_user("guest", "guest")
    await login(client, "host", "host", auth_headers)
    host_ws = await client.ws_connect("/ws")
    await login(client, "guest", "guest", auth_headers)
    guest_ws = await client.ws_connect("/ws")
    await host_ws.receive_json()
    await guest_ws.receive_json()

    await host_ws.send_json({"type": "game.create"})
    lobby = await host_ws.receive_json()
    code = lobby["code"]
    assert lobby["status"] == "lobby"

    await guest_ws.send_json({"type": "game.join", "code": code})
    await host_ws.receive_json()
    guest_lobby = await guest_ws.receive_json()
    assert len(guest_lobby["players"]) == 2

    await host_ws.send_json({"type": "game.start", "code": code})
    host_round = await host_ws.receive_json()
    guest_round = await guest_ws.receive_json()
    assert host_round["type"] == "game.room"
    assert host_round["round"] == 1
    assert host_round["question"] == guest_round["question"]
    assert host_round["deadline"] == guest_round["deadline"]

    question = next(question for question in await list_questions(db) if question["prompt"] == host_round["question"]["prompt"])
    question_id = question["id"]
    common = next(answer for answer in question["answers"] if answer["tier"] == "plankton")
    await guest_ws.send_json({"type": "game.answer", "code": code, "answer": "not accepted"})
    guest_check = await guest_ws.receive_json()
    host_check = await host_ws.receive_json()
    assert guest_check["type"] == host_check["type"] == "game.room"
    assert next(player for player in guest_check["players"] if player["username"] == "guest")["checking"] is True
    guest_check = await guest_ws.receive_json()
    host_check = await host_ws.receive_json()
    assert next(player for player in guest_check["players"] if player["username"] == "guest")["checking"] is False
    rejected = await guest_ws.receive_json()
    assert rejected["type"] == "game.error"
    assert rejected["code"] == "answer_not_accepted"

    await guest_ws.send_json({"type": "game.answer", "code": code, "answer": "new accepted answer"})
    guest_check = await guest_ws.receive_json()
    host_check = await host_ws.receive_json()
    assert next(player for player in guest_check["players"] if player["username"] == "guest")["checking"] is True
    assert next(player for player in host_check["players"] if player["username"] == "guest")["checking"] is True
    guest_score = await guest_ws.receive_json()
    host_score = await host_ws.receive_json()
    assert next(player for player in guest_score["players"] if player["username"] == "guest")["score"] == 85
    updated_question = next(item for item in await list_questions(db) if item["id"] == question_id)
    verified = next(answer for answer in updated_question["answers"] if answer["answer"] == "AI-verified answer")
    assert verified["aliases"] == ["new accepted answer"]

    await host_ws.send_json({"type": "game.answer", "code": code, "answer": common["answer"]})
    host_score = await host_ws.receive_json()
    guest_score = await guest_ws.receive_json()
    assert next(player for player in host_score["players"] if player["username"] == "host")["score"] == 10
    assert next(player for player in guest_score["players"] if player["username"] == "host")["score"] == 10

    bank = await list_questions(db)
    for round_number in range(2, 8):
        host_round = await host_ws.receive_json()
        guest_round = await guest_ws.receive_json()
        assert host_round["round"] == round_number
        assert host_round["question"] == guest_round["question"]
        question = next(question for question in bank if question["prompt"] == host_round["question"]["prompt"])
        common = next(answer for answer in question["answers"] if answer["tier"] == "plankton")
        rare = next(answer for answer in question["answers"] if answer["tier"] == "deep_cut")
        await host_ws.send_json({"type": "game.answer", "code": code, "answer": common["answer"]})
        await host_ws.receive_json()
        await guest_ws.receive_json()
        await guest_ws.send_json({"type": "game.answer", "code": code, "answer": rare["answer"]})
        await host_ws.receive_json()
        await guest_ws.receive_json()

    host_results = await host_ws.receive_json()
    guest_results = await guest_ws.receive_json()
    assert host_results["status"] == "finished"
    assert host_results["rankings"] == guest_results["rankings"]
    assert host_results["rankings"][0]["username"] == "guest"
    assert host_results["rankings"][0]["depth"] == 5950
    assert host_results["rankings"][1]["depth"] == 700

    await host_ws.close()
    await guest_ws.close()
