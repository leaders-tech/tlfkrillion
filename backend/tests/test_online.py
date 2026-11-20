"""Exercise matchmaking, transactional Elo and cosmetic ownership."""
import asyncio

import pytest

from backend.app_keys import GAME_ROOMS
from backend.db.game_questions import list_questions
from backend.db.progression import profile, saved_result, settle
from backend.game.matchmaking import Matchmaking
from backend.game.rewards import ENDLESS_DEPTH_SKINS, earned_skins, elo_change, rank_for
from backend.tests.conftest import login


def test_casual_fill_and_ranked_search_window():
    queue = Matchmaking()
    for user_id in (1, 2, 3):
        queue.join({"id": user_id}, "casual", 1000)
    now = queue.entries[3].joined
    assert queue.match(now) is None
    assert len(queue.match(now + 15)[1]) == 3
    queue.join({"id": 4}, "casual", 1000)
    assert len(queue.match(now)[1]) == 4
    for user_id in (1, 2, 3, 4):
        queue.cancel(user_id)
    first = queue.join({"id": 1}, "ranked", 1000)
    queue.join({"id": 2}, "ranked", 1200)
    queue.join({"id": 3}, "ranked", 1190)
    assert queue.match(first.joined + 14)[1][0].user["id"] == 2
    assert [entry.user["id"] for entry in queue.match(first.joined + 15)[1]] == [1, 3]
    assert queue.join({"id": 1}, "ranked", 1000) is first
    queue.cancel(3)
    queue.join({"id": 2}, "casual", 2000)
    queue.join({"id": 2}, "ranked", 2000)
    assert queue.match(first.joined + 59) is None
    assert queue.match(first.joined + 60)[0] == "ranked"
    queue.disconnected[1] = first.joined + 59
    assert queue.match(first.joined + 60) is None


@pytest.mark.parametrize("opted_in", [1, 2])
def test_any_elo_matches_immediately_from_either_queue_position(opted_in):
    queue = Matchmaking()
    first = queue.join({"id": 1}, "ranked", 1000)
    second = queue.join({"id": 2}, "ranked", 50_000)
    assert queue.match(second.joined) is None
    widened = queue.join({"id": opted_in}, "ranked", queue.entries[opted_in].elo, any_elo=True)
    assert widened is (first if opted_in == 1 else second)
    assert queue.match(second.joined) == ("ranked", [first, second])


def test_elo_and_rank_boundaries():
    assert elo_change(1000, 1000, 1) == 16
    assert elo_change(1000, 1000, .5) == 0
    assert elo_change(1000, 1400, 1) == 29
    assert elo_change(1400, 1000, .5) == -13
    assert elo_change(1000, 50_000, 1) == 256
    assert elo_change(50_000, 1000, 0) == -256
    assert elo_change(50_000, 1000, 1) == 0
    assert elo_change(0, 50_000, 0) == 0
    assert rank_for(1000)["name"] == "Reef Runner"
    assert rank_for(1800)["name"] == "Leviathan Star"
    assert rank_for(50_000)["name"] == "Leviathan Star"
    assert rank_for(50_000, True)["name"] == "Abyss Architect"


@pytest.mark.asyncio
async def test_admin_elo_and_skin_are_reserved_for_admin_accounts(client, create_user, auth_headers):
    await create_user("staff", "password", is_admin=True)
    await create_user("diver", "password")
    await login(client, "staff", "password", auth_headers)
    endpoint = "/api/game/profile"
    response = await client.post(endpoint, json={}, headers=auth_headers)
    staff = (await response.json())["data"]
    assert staff["elo"] == 50_000
    assert staff["rank"]["name"] == "Abyss Architect"
    assert staff["skin"] == "admin_aurora"
    assert any(skin["id"] == "admin_aurora" and skin["unlocked"] for skin in staff["skins"])
    await client.post(endpoint + "/equip", json={"skin": "default"}, headers=auth_headers)
    response = await client.post(endpoint + "/equip", json={"skin": "admin_aurora"}, headers=auth_headers)
    assert (await response.json())["data"]["elo"] == 50_000

    await login(client, "diver", "password", auth_headers)
    response = await client.post(endpoint, json={}, headers=auth_headers)
    diver = (await response.json())["data"]
    assert diver["elo"] == 1000
    assert all(skin["id"] != "admin_aurora" for skin in diver["skins"])
    rejected = await client.post(endpoint + "/equip", json={"skin": "admin_aurora"}, headers=auth_headers)
    assert rejected.status == 403


@pytest.mark.parametrize(("skin", "_name", "depth"), ENDLESS_DEPTH_SKINS)
def test_depth_skins_require_an_endless_dive(skin, _name, depth):
    player = {"scored_answers": [], "score": depth // 10 - 1}
    stats = {"dives": 1}
    assert skin not in earned_skins(player, stats, "endless", None, None, 1, False)
    player["score"] += 1
    assert skin in earned_skins(player, stats, "endless", None, None, 1, False)
    assert skin not in earned_skins(player, stats, "solo", None, None, 1, False)


@pytest.mark.parametrize(("tier", "skin_id", "required"), [
    ("plankton", "plankton7", 7),
    ("too_clever", "clever3", 7),
    ("schooler", "schooler5", 7),
    ("rare", "rare3", 7),
    ("deep_cut", "deep2", 7),
    ("krillion", "gold1", 3),
])
def test_rarity_unlocks_require_the_new_threshold(tier, skin_id, required):
    answers = [{"tier": tier, "prompt": "", "answer": ""}] * (required - 1)
    player = {"score": 0, "scored_answers": answers}
    stats = {"dives": 1}
    assert skin_id not in earned_skins(player, stats, "solo", None, None, 1, False)
    answers.append(answers[0])
    assert skin_id in earned_skins(player, stats, "solo", None, None, 1, False)
    endless_unlocks = earned_skins(player, stats, "endless", None, None, 1, False)
    assert (skin_id in endless_unlocks) == (tier == "krillion")


@pytest.mark.asyncio
@pytest.mark.parametrize("submit_rejected_answer", [False, True])
async def test_sevenfold_prism_requires_a_round_with_no_submission(
    client, create_user, auth_headers, db, monkeypatch, submit_rejected_answer,
):
    tiers = ("plankton", "too_clever", "schooler", "rare", "deep_cut", "krillion")
    questions = [{
        "prompt": f"Test prompt {index}", "category": "Test", "hint": "", "use_model": False,
        "answers": [{"answer": "Accepted answer", "tier": tier}],
    } for index, tier in enumerate((*tiers, "plankton"))]

    async def question_bank(_db, _count, _category):
        return questions

    monkeypatch.setattr("backend.game.rooms.get_random_questions", question_bank)
    monkeypatch.setattr("backend.game.rooms.ROUND_SECONDS", .8)
    monkeypatch.setattr("backend.game.rooms.ROUND_TRANSITION_SECONDS", 0)
    await create_user("prismdiver", "password")
    ws, user_id = await connect(client, "prismdiver", auth_headers)
    await ws.send_json({"type": "game.create_solo"})
    for round_number in range(1, 8):
        playing = await receive(ws, lambda message, expected=round_number: message.get("round") == expected)
        if round_number < 7 or submit_rejected_answer:
            answer = "Accepted answer" if round_number < 7 else "Rejected answer"
            await ws.send_json({"type": "game.answer", "code": playing["code"], "answer": answer})
    result = await receive(ws, lambda message: message.get("status") == "finished")
    assert ("Sevenfold Prism" in result["rewards"][0]["unlocked"]) == (not submit_rejected_answer)
    player_profile = await profile(db, user_id)
    prism = next(skin for skin in player_profile["skins"] if skin["id"] == "prism")
    assert prism["unlocked"] == (not submit_rejected_answer)


async def receive(ws, predicate):
    while True:
        message = await ws.receive_json(timeout=5)
        if predicate(message):
            return message


async def connect(client, username, headers):
    await login(client, username, "password", headers)
    ws = await client.ws_connect("/ws")
    ready = await ws.receive_json(timeout=5)
    assert ready["type"] == "ws.ready"
    return ws, ready["user_id"]


async def pair(client, create_user, headers):
    for username in ("diver1", "diver2"):
        await create_user(username, "password")
    first, first_id = await connect(client, "diver1", headers)
    second, second_id = await connect(client, "diver2", headers)
    await first.send_json({"type": "game.queue", "mode": "ranked"})
    await second.send_json({"type": "game.queue", "mode": "ranked"})
    room = await receive(first, lambda message: message.get("status") == "playing")
    await receive(second, lambda message: message.get("status") == "playing")
    return first, second, first_id, second_id, room["code"]


@pytest.mark.asyncio
async def test_ranked_queue_resumes_after_disconnect_and_ignores_old_room(client, create_user, auth_headers):
    await create_user("diver1", "password")
    await create_user("diver2", "password")
    first, first_id = await connect(client, "diver1", auth_headers)
    await first.send_json({"type": "game.create"})
    old_code = (await receive(first, lambda message: message.get("status") == "lobby"))["code"]
    await first.send_json({"type": "game.queue", "mode": "ranked"})
    queued = await receive(first, lambda message: message.get("mode") == "ranked")
    assert queued["open_after"] == 60
    matchmaker = client.app[GAME_ROOMS].matchmaking
    entry = matchmaker.entries[first_id]
    await first.close()
    async with asyncio.timeout(2):
        while first_id not in matchmaker.disconnected:
            await asyncio.sleep(.01)

    second, _ = await connect(client, "diver2", auth_headers)
    await second.send_json({"type": "game.queue", "mode": "ranked"})
    await receive(second, lambda message: message.get("mode") == "ranked")
    assert matchmaker.match(entry.joined + 60) is None

    resumed, _ = await connect(client, "diver1", auth_headers)
    await resumed.send_json({"type": "game.online_status", "code": old_code})
    state = await resumed.receive_json(timeout=5)
    assert state.get("mode") == "ranked" or state.get("online") == "ranked"
    assert state.get("code") != old_code
    if state.get("status") != "playing":
        state = await receive(resumed, lambda message: message.get("status") == "playing")
    assert state["code"] == (await receive(second, lambda message: message.get("status") == "playing"))["code"]
    assert len(state["players"]) == 2


@pytest.mark.asyncio
async def test_admin_can_view_each_account_profile(client, create_user, auth_headers):
    await create_user("staff", "password", is_admin=True)
    await create_user("diver", "password")
    await login(client, "staff", "password", auth_headers)
    accounts = await client.post("/api/admin/users/list", json={})
    account_ids = {user["username"]: user["id"] for user in (await accounts.json())["data"]["users"]}
    endpoint = "/api/admin/users/profile"
    for name, elo in (("staff", 50_000), ("diver", 1000)):
        result = await client.post(endpoint, json={"id": account_ids[name]})
        data = (await result.json())["data"]
        assert result.status == 200 and data["elo"] == elo and data["dives"] == 0 and data["skins"]
        assert "password_hash" not in data
    assert (await client.post(endpoint, json={"id": True})).status == 400
    assert (await client.post(endpoint, json={"id": max(account_ids.values()) + 1})).status == 404
    await login(client, "diver", "password", auth_headers)
    assert (await client.post(endpoint, json={"id": account_ids["staff"]})).status == 403


@pytest.mark.asyncio
async def test_ranked_reconnect_and_forfeit(client, create_user, auth_headers, db):
    first, second, first_id, second_id, code = await pair(client, create_user, auth_headers)
    await first.close()
    resumed, _ = await connect(client, "diver1", auth_headers)
    await resumed.send_json({"type": "game.online_status"})
    assert (await receive(resumed, lambda message: message.get("status") == "playing"))["code"] == code
    await resumed.send_json({"type": "game.leave", "code": code})
    finished = await receive(second, lambda message: message.get("status") == "finished")
    assert finished["rankings"][0]["id"] == second_id
    assert (await profile(db, first_id))["elo"] == 984
    winner = await profile(db, second_id)
    assert winner["elo"] == 1016
    assert winner["wins"] == 1
    assert winner["streak"] == 0
    assert len([skin for skin in winner["skins"] if skin["unlocked"]]) == 1
    saved = await saved_result(db, code, second_id)
    assert saved == finished
    assert await saved_result(db, code, -1) is None
    client.app[GAME_ROOMS].rooms.pop(code)
    await second.send_json({"type": "game.online_status", "code": code})
    assert await receive(second, lambda message: message.get("status") == "finished") == finished


@pytest.mark.asyncio
async def test_any_elo_queue_settles_upset_and_records_ranked_history(client, create_user, auth_headers):
    await create_user("diver", "password")
    await create_user("staff", "password", is_admin=True)
    diver, diver_id = await connect(client, "diver", auth_headers)
    staff, staff_id = await connect(client, "staff", auth_headers)
    await staff.send_json({"type": "game.queue", "mode": "ranked"})
    await receive(staff, lambda message: message.get("open_after") == 60)
    await diver.send_json({"type": "game.queue", "mode": "ranked", "any_elo": True})
    assert (await receive(diver, lambda message: message.get("mode") == "ranked"))["open_after"] == 0
    playing = await receive(diver, lambda message: message.get("status") == "playing")
    await staff.send_json({"type": "game.leave", "code": playing["code"]})
    finished = await receive(diver, lambda message: message.get("status") == "finished")
    changes = {entry["id"]: entry["change"] for entry in finished["rewards"]}
    assert changes == {diver_id: 256, staff_id: -256}

    endpoint = "/api/game/ranked"
    staff_overview = (await (await client.post(endpoint, json={})).json())["data"]
    assert staff_overview["history"] == [{"before": 50_000, "elo": 49_744, "outcome": 0}]
    await login(client, "diver", "password", auth_headers)
    diver_overview = (await (await client.post(endpoint, json={})).json())["data"]
    assert diver_overview["history"] == [{"before": 1000, "elo": 1256, "outcome": 1}]
    assert diver_overview["elo"] == 1256
    assert diver_overview["rank"]["name"] == "Lantern Fang"
    assert diver_overview["ranks"][-1]["minimum"] == 1800
    assert diver_overview["admin_rank"]["minimum"] == 50_000
    await diver.close()
    await staff.close()


@pytest.mark.asyncio
async def test_all_disconnected_ranked_match_is_void(client, create_user, auth_headers, db, monkeypatch):
    monkeypatch.setattr("backend.game.rooms.RECONNECT_SECONDS", .05)
    first, second, first_id, second_id, code = await pair(client, create_user, auth_headers)
    await first.close()
    await second.close()
    room = client.app[GAME_ROOMS].rooms[code]
    async with asyncio.timeout(5):
        while room["status"] != "finished":
            await asyncio.sleep(.05)
    assert room["void"]
    for user_id in (first_id, second_id):
        stats = await profile(db, user_id)
        assert stats["elo"] == 1000 and stats["losses"] == 0
        assert (await saved_result(db, code, user_id))["void"]


@pytest.mark.asyncio
async def test_two_player_casual_queue_counts_accounts_not_tabs(client, create_user, auth_headers, db, monkeypatch):
    monkeypatch.setattr("backend.game.matchmaking.CASUAL_FILL_SECONDS", .05)
    await create_user("diver1", "password")
    await create_user("diver2", "password")
    first, first_id = await connect(client, "diver1", auth_headers)
    duplicate = await client.ws_connect("/ws")
    assert (await duplicate.receive_json(timeout=5))["user_id"] == first_id
    second, second_id = await connect(client, "diver2", auth_headers)
    for ws in (first, duplicate):
        await ws.send_json({"type": "game.queue", "mode": "casual"})
        await receive(ws, lambda message: message.get("mode") == "casual")
    await second.send_json({"type": "game.queue", "mode": "casual"})
    playing = await receive(second, lambda message: message.get("status") == "playing")
    assert {p["id"] for p in playing["players"]} == {first_id, second_id}
    await first.send_json({"type": "game.leave", "code": playing["code"]})
    await receive(second, lambda message: message.get("status") == "finished")
    for user_id in (first_id, second_id):
        stats = await profile(db, user_id)
        assert stats["elo"] == 1000 and stats["wins"] == 0


@pytest.mark.asyncio
async def test_ranked_draw_awards_the_draw_skin(client, create_user, auth_headers, db, monkeypatch):
    monkeypatch.setattr("backend.game.rooms.ROUND_COUNT", 1)
    monkeypatch.setattr("backend.game.rooms.ROUND_SECONDS", .05)
    monkeypatch.setattr("backend.game.rooms.ROUND_TRANSITION_SECONDS", 0)
    first, second, first_id, second_id, _ = await pair(client, create_user, auth_headers)
    for ws in (first, second):
        finished = await receive(ws, lambda message: message.get("status") == "finished")
        assert all(reward["outcome"] == .5 for reward in finished["rewards"])
    for user_id in (first_id, second_id):
        stats = await profile(db, user_id)
        assert stats["elo"] == 1000 and stats["draws"] == 1
        assert any(skin["id"] == "draw" and skin["unlocked"] for skin in stats["skins"])


@pytest.mark.asyncio
async def test_settlement_is_idempotent_and_skins_require_ownership(client, create_user, auth_headers, db, test_settings):
    await create_user("diver", "password")
    ws, user_id = await connect(client, "diver", auth_headers)
    endpoint = "/api/game/profile/equip"
    assert (await client.post(endpoint, json={"skin": "arakelov"}, headers=auth_headers)).status == 403
    response = await client.post("/api/game/profile", json={}, headers=auth_headers)
    collection = (await response.json())["data"]["skins"]
    secrets = [skin for skin in collection if skin["secret"]]
    assert len(secrets) == 6
    assert all(skin["requirement"] == "Answer ??? for ???" and not skin["unlocked"] for skin in secrets)
    assert any(skin["id"] == "arakelov" and skin["name"] == "Arithmetic Ghost" for skin in secrets)
    assert "Arakelov" not in str(collection)
    player = {
        "id": user_id, "score": 100,
        "scored_answers": [{
            "prompt": "Name a mathematical theory, field, or framework.",
            "answer": "Arakelov theory", "tier": "krillion", "remaining": 5,
        }],
    }
    args = (test_settings.db_path, "unique-test-match", [player], "solo", None, {user_id: 1}, False)
    results = await settle(*args)
    assert await settle(*args) == results
    assert {"arakelov", "first"} <= set(results[0]["unlocked"])
    assert "gold1" not in results[0]["unlocked"]
    response = await client.post(endpoint, json={"skin": "arakelov"}, headers=auth_headers)
    assert response.status == 200
    stats = await profile(db, user_id)
    assert stats["skin"] == "arakelov" and stats["dives"] == 1 and stats["elo"] == 1000
    revealed = next(skin for skin in stats["skins"] if skin["id"] == "arakelov")
    assert revealed["unlocked"] and not revealed["secret"]
    assert "Arakelov theory" in revealed["requirement"]
    await ws.close()


@pytest.mark.asyncio
async def test_ranked_normal_finish_checks_alias_and_pauses_both_clocks(client, create_user, auth_headers, db, monkeypatch):
    checked = asyncio.Event()
    release = asyncio.Event()
    bank = await list_questions(db)
    math = next(question for question in bank if question["prompt"] == "Name a mathematical theory, field, or framework.")
    questions = [math, *bank[:6]]

    async def fixed_questions(_db, _amount):
        return questions

    async def verify(_key, _prompt, _hint, answer):
        assert answer == "Arakelov arithmetic"
        checked.set()
        await release.wait()
        return {"correct": True, "tier": "krillion", "canonical_answer": "Arakelov theory"}

    monkeypatch.setattr("backend.game.rooms.get_random_questions", fixed_questions)
    monkeypatch.setattr("backend.game.rooms.check_answer", verify)
    monkeypatch.setattr("backend.game.rooms.ROUND_TRANSITION_SECONDS", 0)
    first, second, first_id, second_id, code = await pair(client, create_user, auth_headers)
    await first.send_json({"type": "game.answer", "code": code, "answer": "Arakelov arithmetic"})
    async with asyncio.timeout(5):
        await checked.wait()
    for ws in (first, second):
        paused = await receive(ws, lambda message: message.get("paused"))
        assert paused["deadline"] is None
    release.set()
    for ws in (first, second):
        resumed = await receive(ws, lambda message: message.get("status") == "playing" and not message["paused"])
        assert resumed["deadline"] is not None
    await second.send_json({"type": "game.answer", "code": code, "answer": "Geometry"})
    for round_number, question in enumerate(questions[1:], 2):
        for ws in (first, second):
            await receive(ws, lambda message, expected=round_number: message.get("round") == expected)
            await ws.send_json({"type": "game.answer", "code": code, "answer": question["answers"][0]["answer"]})
    finished = await receive(first, lambda message: message.get("status") == "finished")
    assert finished["rankings"][0]["id"] == first_id
    assert (await profile(db, first_id))["elo"] == 1016
    assert (await profile(db, second_id))["elo"] == 984
    reward = next(result for result in finished["rewards"] if result["id"] == first_id)
    assert {"Arithmetic Ghost", "Ranked Ember"} <= set(reward["unlocked"])
    assert {"id": "arakelov", "name": "Arithmetic Ghost"} in reward["unlocked_skins"]
    assert all(set(skin) == {"id", "name"} for skin in reward["unlocked_skins"])
    assert await saved_result(db, code, first_id) == finished
