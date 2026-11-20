"""Run short-lived solo and multiplayer rooms and send live game updates.

Edit this file when room, round, or scoring behavior changes; copy its small helpers for another live game mode.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
import string
import time
from pathlib import Path
from sqlite3 import OperationalError
from typing import Any
from uuid import uuid4

import aiosqlite

from backend.db.game_questions import add_verified_answer, get_random_questions, list_playable_categories
from backend.db.progression import player_stats, save_void_result, saved_result, settle
from backend.game.answer_checker import AnswerCheckError, check_answer
from backend.game.answer_match import find_answer
from backend.game.matchmaking import RANKED_OPEN_SECONDS, RECONNECT_SECONDS, Matchmaking
from backend.game.rewards import rank_for, skin_catalog
from backend.ws.hub import WebSocketHub

LOGGER = logging.getLogger(__name__)
ROUND_SECONDS = 25
ROUND_COUNT = 7
ROUND_TRANSITION_SECONDS = 2
TIER_POINTS = {"plankton": 10, "too_clever": 15, "schooler": 30, "rare": 60, "deep_cut": 85, "krillion": 100}


class GameRooms:
    def __init__(self, hub: WebSocketHub, db: aiosqlite.Connection, db_path: Path, openai_api_key: str = "") -> None:
        self.hub = hub
        self.db = db
        self.db_path = db_path
        self.matchmaking = Matchmaking()
        self.online_rooms: dict[int, str] = {}
        self.matchmaker: asyncio.Task | None = None
        self.pending_queue: dict[int, object] = {}
        self.settlements: set[asyncio.Task] = set()
        self.skins = {skin["id"]: skin for skin in skin_catalog()}
        self.openai_api_key = openai_api_key
        self.question_locks: dict[int, asyncio.Lock] = {}
        self.rooms: dict[str, dict[str, Any]] = {}

    async def close(self) -> None:
        """Stop room timers before the database connection closes."""
        if self.matchmaker:
            self.matchmaker.cancel()
            await asyncio.gather(self.matchmaker, return_exceptions=True)
        for room in self.rooms.values():
            for task_name in ("timer", "transition"):
                task = room[task_name]
                if task is not None:
                    task.cancel()
        for task in self.settlements:
            task.cancel()
        await asyncio.gather(*self.settlements, return_exceptions=True)
        self.rooms.clear()

    async def handle(self, user: dict[str, Any], payload: dict[str, Any]) -> None:
        action = payload.get("type")
        if action == "game.online_status":
            await self.resume(user, payload.get("code"))
            return
        if action == "game.queue":
            await self.join_queue(user, payload.get("mode"))
            return
        if action == "game.queue_cancel":
            self.pending_queue.pop(user["id"], None)
            self.matchmaking.cancel(user["id"])
            await self._queue_status(user["id"])
            return
        if action in ("game.create", "game.create_solo", "game.create_endless", "game.join"):
            self.pending_queue.pop(user["id"], None)
            if self._active_online(user["id"]):
                await self.resume(user, None)
                return
            if user["id"] in self.matchmaking.entries:
                self.matchmaking.cancel(user["id"])
                await self._queue_status(user["id"])
        category = payload.get("category", "")
        if action == "game.categories":
            await self.hub.send_to_user(user["id"], {"type": "game.categories", "categories": await list_playable_categories(self.db)})
            return
        if action in {"game.create", "game.create_solo", "game.create_endless"} and (not isinstance(category, str) or len(category) > 60):
            await self._error(user["id"], "bad_category", "Choose a valid category.")
            return
        if action == "game.create":
            await self.create_room(user, category=category)
        elif action == "game.create_solo":
            await self.create_room(user, mode="solo", category=category)
        elif action == "game.create_endless":
            await self.create_room(user, mode="endless", category=category)
        elif action == "game.join":
            await self.join_room(user, payload.get("code"))
        elif action == "game.start":
            await self.start_room(user, payload.get("code"))
        elif action == "game.answer":
            await self.submit_answer(user, payload.get("code"), payload.get("answer"))
        elif action == "game.leave":
            await self.leave_room(user, payload.get("code"))
        elif action == "game.finish":
            room = self._find_room(payload.get("code"))
            if room and room["host_id"] == user["id"] and room["mode"] == "endless" and room["status"] == "playing":
                await self._finish(room)

    def _room_code(self) -> str:
        alphabet = string.ascii_uppercase + "23456789"
        while True:
            code = "".join(secrets.choice(alphabet) for _ in range(6))
            if code not in self.rooms:
                return code

    async def _load_skin(self, player):
        stats = await player_stats(self.db, player["id"])
        skin = self.skins.get(stats["skin"], self.skins["default"])
        player["skin"] = {"id": skin["id"], "name": skin["name"]}
        player["admin_rank"] = rank_for(stats["elo"], True) if stats["is_admin"] else None

    def _new_room(self, users, mode, category="", online=None):
        code = self._room_code()
        room = {
            "code": code,
            "match_id": str(uuid4()),
            "host_id": users[0]["id"],
            "mode": mode,
            "category": category,
            "online": online,
            "players": {user["id"]: self._player(user) for user in users},
            "status": "lobby",
            "questions": [],
            "round": 0,
            "deadline": None,
            "paused": False,
            "remaining_seconds": ROUND_SECONDS,
            "paused_total": 0.0,
            "pause_started": None,
            "timer": None,
            "transition": None,
        }
        self.rooms[code] = room
        return room

    async def create_room(self, user: dict[str, Any], mode: str = "multiplayer", category: str = "") -> None:
        room = self._new_room([user], mode, category)
        await self._load_skin(room["players"][user["id"]])
        if mode != "multiplayer":
            await self.start_room(user, room["code"])
        else:
            await self._broadcast(room)

    def _active_online(self, user_id):
        room = self.rooms.get(self.online_rooms.get(user_id))
        if room and room["status"] in ("lobby", "playing", "settling"):
            return room
        return None

    def connected(self, user_id):
        disconnected_at = self.matchmaking.disconnected.pop(user_id, None)
        if disconnected_at is not None and time.monotonic() - disconnected_at >= RECONNECT_SECONDS:
            self.matchmaking.cancel(user_id)

    def disconnected(self, user_id):
        if self.hub.count_for_user(user_id) == 0:
            self.pending_queue.pop(user_id, None)
            if user_id in self.matchmaking.entries or self._active_online(user_id):
                self.matchmaking.disconnected[user_id] = time.monotonic()

    async def _queue_status(self, user_id):
        entry = self.matchmaking.entries.get(user_id)
        elapsed = max(0, time.monotonic() - entry.joined) if entry else 0
        await self.hub.send_to_user(user_id, {
            "type": "game.queue", "mode": entry.mode if entry else None, "elapsed": int(elapsed),
            "open_after": RANKED_OPEN_SECONDS if entry and entry.mode == "ranked" else None,
        })

    async def resume(self, user, raw_code):
        user_id = user["id"]
        room = self._active_online(user_id)
        if not room and user_id in self.matchmaking.entries:
            await self._queue_status(user_id)
            return
        if not room and isinstance(raw_code, str):
            room = self._find_room(raw_code)
        if not room and raw_code is None:
            room = self.rooms.get(self.online_rooms.get(user_id))
        if room and user_id in room["players"]:
            await self._broadcast(room, user_id)
        elif isinstance(raw_code, str) and (snapshot := await saved_result(self.db, raw_code.strip().upper(), user_id)):
            await self.hub.send_to_user(user_id, snapshot)
        else:
            if raw_code and not self.matchmaking.entries.get(user_id):
                await self._error(user_id, "room_not_found", "That dive is no longer available.")
            await self._queue_status(user_id)

    async def join_queue(self, user, mode):
        user_id = user["id"]
        if mode not in ("casual", "ranked"):
            await self._error(user_id, "bad_queue", "Choose Casual or Ranked.")
            return
        if self._active_online(user_id):
            await self.resume(user, None)
            return
        request = object()
        self.pending_queue[user_id] = request
        stats = await player_stats(self.db, user_id)
        if self.pending_queue.get(user_id) is not request:
            return
        self.pending_queue.pop(user_id, None)
        if self._active_online(user_id) or not self.hub.count_for_user(user_id):
            return
        self.matchmaking.join(user, mode, stats["elo"])
        if not self.matchmaker or self.matchmaker.done():
            self.matchmaker = asyncio.create_task(self._run_matchmaker())
        await self._queue_status(user_id)

    async def _run_matchmaker(self):
        while True:
            await asyncio.sleep(.25)
            now = time.monotonic()
            for user_id, disconnected_at in list(self.matchmaking.disconnected.items()):
                if now - disconnected_at >= RECONNECT_SECONDS and self.matchmaking.disconnected.get(user_id) == disconnected_at:
                    self.matchmaking.disconnected.pop(user_id, None)
                    self.matchmaking.cancel(user_id)
                    room = self._active_online(user_id)
                    if room and room["status"] == "playing":
                        await self._forfeit(room, user_id)
            while match := self.matchmaking.match(time.monotonic()):
                mode, entries = match
                for entry in entries:
                    self.matchmaking.cancel(entry.user["id"])
                if mode == "casual":
                    self.matchmaking.casual_ready = None
                room = self._new_room([entry.user for entry in entries], "multiplayer", online=mode)
                for player in room["players"].values():
                    self.online_rooms[player["id"]] = room["code"]
                try:
                    questions = await get_random_questions(self.db, ROUND_COUNT)
                    for player in room["players"].values():
                        await self._load_skin(player)
                    if len(questions) < ROUND_COUNT:
                        raise ValueError("Online play needs at least seven playable prompts.")
                    for player_id in room["players"]:
                        if not self.hub.count_for_user(player_id):
                            self.matchmaking.disconnected.setdefault(player_id, time.monotonic())
                    await self._start(room, questions)
                except (OperationalError, ValueError):
                    LOGGER.exception("Could not start online match")
                    self.rooms.pop(room["code"], None)
                    for player_id in room["players"]:
                        self.online_rooms.pop(player_id, None)
                        await self._queue_status(player_id)
                        await self._error(player_id, "match_unavailable", "Could not start the online match. Try again.")

    async def join_room(self, user: dict[str, Any], raw_code: Any) -> None:
        code = raw_code.strip().upper() if isinstance(raw_code, str) else ""
        room = self.rooms.get(code)
        if room is None:
            await self._error(user["id"], "room_not_found", "That room code was not found.")
            return
        already_joined = user["id"] in room["players"]
        if (room["mode"] != "multiplayer" or room["online"]) and not already_joined:
            await self._error(user["id"], "room_started", "That dive is for one player.")
            return
        if room["status"] != "lobby" and not already_joined:
            await self._error(user["id"], "room_started", "That game has already started.")
            return
        if not already_joined:
            player = room["players"].setdefault(user["id"], self._player(user))
            await self._load_skin(player)
        await self._broadcast(room)

    async def start_room(self, user: dict[str, Any], raw_code: Any) -> None:
        room = self._find_room(raw_code)
        if room is None:
            await self._error(user["id"], "room_not_found", "That room is no longer available.")
            return
        if room["host_id"] != user["id"]:
            await self._error(user["id"], "not_host", "Only the room host can start the game.")
            return
        if room["online"] or room["status"] != "lobby" or (room["mode"] == "multiplayer" and len(room["players"]) < 2):
            await self._error(user["id"], "room_not_ready", "Invite at least one player before starting.")
            return
        endless = room["mode"] == "endless"
        questions = await get_random_questions(self.db, -1 if endless else ROUND_COUNT, room["category"])
        minimum = 1 if endless else ROUND_COUNT
        if len(questions) < minimum:
            if room["mode"] != "multiplayer":
                self.rooms.pop(room["code"], None)
            await self._error(user["id"], "not_enough_questions", f"This selection needs at least {minimum} playable prompts. Choose another category or ask an admin to add more.")
            return
        if room["status"] == "lobby" and self.rooms.get(room["code"]) is room:
            await self._start(room, questions)

    async def _start(self, room, questions):
        room["questions"] = questions
        room["status"] = "playing"
        room["round"] = 0
        for player in room["players"].values():
            player.update({"score": 0, "answer_time": 0.0, "answered": False, "checking": False, "last_answer": None, "last_tier": None})
        await self._begin_round(room)

    async def submit_answer(self, user: dict[str, Any], raw_code: Any, raw_answer: Any) -> None:
        room = self._find_room(raw_code)
        if room is None or room["status"] != "playing" or user["id"] not in room["players"]:
            await self._error(user["id"], "game_not_active", "There is no active question for that room.")
            return
        player = room["players"][user["id"]]
        if player["answered"] or player["forfeited"]:
            await self._error(user["id"], "already_answered", "You have already answered this question.")
            return
        if player["checking"]:
            await self._error(user["id"], "answer_checking", "Your answer is still being checked.")
            return
        if not isinstance(raw_answer, str) or not raw_answer.strip() or len(raw_answer) > 120:
            await self._error(user["id"], "bad_answer", "Enter an answer up to 120 characters long.")
            return
        question = room["questions"][room["round"]]
        if not room["paused"] and room["deadline"] is not None and time.time() >= room["deadline"]:
            await self._error(user["id"], "round_expired", "Time is up for this question.")
            return
        player["submitted"] = True
        answer_text = raw_answer.strip()
        accepted = find_answer(answer_text, question["answers"])
        if accepted is None and not question.get("use_model", True):
            await self._error(user["id"], "answer_not_accepted", "That answer is not in this question's accepted answers.")
            return
        if accepted is None:
            player["checking"] = True
            self._pause_round(room)
            await self._broadcast(room)
            round_number = room["round"]
            try:
                result = await check_answer(
                    self.openai_api_key,
                    question["prompt"],
                    question["hint"],
                    answer_text,
                )
            except AnswerCheckError as error:
                result = None
                check_error = str(error)
            else:
                check_error = "That answer could not be confirmed. Try another."

            if room["status"] != "playing" or room["round"] != round_number or player["answered"]:
                return
            if result is None:
                player["checking"] = False
                self._resume_round_if_ready(room)
                await self._broadcast(room)
                await self._error(user["id"], "answer_check_failed", check_error)
                return
            if not result["correct"]:
                player["checking"] = False
                self._resume_round_if_ready(room)
                await self._broadcast(room)
                await self._error(user["id"], "answer_not_accepted", "That answer was not confirmed by web search. Try another.")
                return

            question_id = question.get("id")
            if isinstance(question_id, int):
                lock = self.question_locks.setdefault(question_id, asyncio.Lock())
                async with lock:
                    saved_question = await add_verified_answer(
                        self.db,
                        question_id,
                        result["canonical_answer"],
                        answer_text,
                        result["tier"],
                    )
                if saved_question is not None:
                    question["answers"] = saved_question["answers"]
            if room["status"] != "playing" or room["round"] != round_number or player["forfeited"]:
                return
            accepted = next(
                (
                    candidate
                    for candidate in question["answers"]
                    if answer_text.casefold() == candidate["answer"].casefold()
                    or any(answer_text.casefold() == alias.casefold() for alias in candidate.get("aliases", []))
                ),
                {"answer": result["canonical_answer"], "tier": result["tier"]},
            )
            if accepted not in question["answers"]:
                question["answers"].append(accepted)
        player["answered"] = True
        player["checking"] = False
        player["score"] += TIER_POINTS[accepted["tier"]]
        elapsed = time.monotonic() - room["round_started"] - room["paused_total"]
        if room["paused"] and room["pause_started"] is not None:
            elapsed -= time.monotonic() - room["pause_started"]
        player["answer_time"] += max(0.0, elapsed)
        player["scored_answers"].append({
            "prompt": question["prompt"], "answer": accepted["answer"], "tier": accepted["tier"],
            "remaining": max(0, ROUND_SECONDS - elapsed),
        })
        player["last_answer"] = accepted["answer"]
        player["last_tier"] = accepted["tier"]
        round_complete = all(candidate["answered"] for candidate in room["players"].values())
        if round_complete and room["timer"] is not None:
            room["timer"].cancel()
            room["timer"] = None
        if not round_complete:
            self._resume_round_if_ready(room)
        await self._broadcast(room)
        if room["status"] == "playing" and round_complete:
            self._schedule_advance(room)

    async def leave_room(self, user: dict[str, Any], raw_code: Any) -> None:
        room = self._find_room(raw_code)
        if room is None or user["id"] not in room["players"]:
            return
        if room["online"]:
            if room["status"] == "playing":
                await self._forfeit(room, user["id"])
            elif room["status"] == "finished" and self.online_rooms.get(user["id"]) == room["code"]:
                self.online_rooms.pop(user["id"], None)
            return
        if room["mode"] != "multiplayer":
            if room["status"] == "settling":
                return
            self.rooms.pop(room["code"], None)
            for task_name in ("timer", "transition"):
                if room[task_name] is not None:
                    room[task_name].cancel()
            room["status"] = "finished"
            return
        if room["status"] == "lobby":
            room["players"].pop(user["id"], None)
            if not room["players"]:
                self.rooms.pop(room["code"], None)
                return
            if room["host_id"] == user["id"]:
                room["host_id"] = next(iter(room["players"]))
            await self._broadcast(room)

    def _find_room(self, raw_code: Any) -> dict[str, Any] | None:
        return self.rooms.get(raw_code.strip().upper()) if isinstance(raw_code, str) else None

    @staticmethod
    def _player(user: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": user["id"],
            "username": user["username"],
            "score": 0,
            "answer_time": 0.0,
            "answered": False,
            "checking": False,
            "last_answer": None,
            "last_tier": None,
            "scored_answers": [],
            "submitted": False,
            "unsubmitted_rounds": 0,
            "forfeited": False,
            "skin": None,
        }

    async def _begin_round(self, room: dict[str, Any]) -> None:
        room["round_started"] = time.monotonic()
        room["remaining_seconds"] = ROUND_SECONDS
        room["paused_total"] = 0.0
        room["pause_started"] = None
        room["paused"] = False
        room["deadline"] = time.time() + ROUND_SECONDS
        for player in room["players"].values():
            player.update({"answered": player["forfeited"], "checking": False, "submitted": False, "last_answer": None, "last_tier": None})
        room["timer"] = asyncio.create_task(self._round_timeout(room["code"], room["round"], ROUND_SECONDS))
        await self._broadcast(room)

    async def _round_timeout(self, code: str, round_number: int, seconds: float) -> None:
        await asyncio.sleep(seconds)
        room = self.rooms.get(code)
        if room is None or room["status"] != "playing" or room["round"] != round_number:
            return
        room["deadline"] = None
        room["timer"] = None
        if room["mode"] == "endless":
            await self._finish(room, timed_out=True)
            return
        for player in room["players"].values():
            if not player["submitted"] and not player["forfeited"]:
                player["unsubmitted_rounds"] += 1
            player["answered"] = True
            player["checking"] = False
        await self._broadcast(room)
        self._schedule_advance(room)

    def _pause_round(self, room: dict[str, Any]) -> None:
        if room["paused"]:
            return
        room["remaining_seconds"] = max(0.0, room["deadline"] - time.time())
        room["deadline"] = None
        room["paused"] = True
        room["pause_started"] = time.monotonic()
        if room["timer"] is not None:
            room["timer"].cancel()
            room["timer"] = None

    def _resume_round_if_ready(self, room: dict[str, Any]) -> None:
        if not room["paused"] or any(player["checking"] for player in room["players"].values()):
            return
        if all(player["answered"] for player in room["players"].values()):
            return
        if room["pause_started"] is not None:
            room["paused_total"] += time.monotonic() - room["pause_started"]
        room["pause_started"] = None
        room["paused"] = False
        room["deadline"] = time.time() + room["remaining_seconds"]
        room["timer"] = asyncio.create_task(self._round_timeout(room["code"], room["round"], room["remaining_seconds"]))

    def _schedule_advance(self, room: dict[str, Any]) -> None:
        if room["transition"] is None or room["transition"].done():
            room["transition"] = asyncio.create_task(self._advance(room["code"], room["round"]))

    async def _advance(self, code: str, expected_round: int) -> None:
        await asyncio.sleep(ROUND_TRANSITION_SECONDS)
        room = self.rooms.get(code)
        if room is None or room["status"] != "playing" or room["round"] != expected_round:
            return
        if room["timer"] is not None:
            room["timer"].cancel()
        if room["round"] + 1 == len(room["questions"]):
            if room["mode"] != "endless":
                while room["online"] and not any(
                    self.hub.count_for_user(p["id"]) for p in room["players"].values() if not p["forfeited"]
                ):
                    await asyncio.sleep(.25)
                await self._finish(room)
                return
            questions = await get_random_questions(self.db, -1, room["category"])
            if room["status"] != "playing":
                return
            if not questions:
                await self._finish(room)
                return
            if len(questions) > 1 and questions[0]["id"] == room["questions"][-1]["id"]:
                questions[0], questions[1] = questions[1], questions[0]
            room["questions"].extend(questions)
        room["transition"] = None
        room["round"] += 1
        await self._begin_round(room)

    @staticmethod
    def _finish_key(player):
        return (player["forfeited"], -player["score"], round(player["answer_time"], 2))

    async def _forfeit(self, room, user_id):
        player = room["players"][user_id]
        if player["forfeited"]:
            return
        player.update(forfeited=True, answered=True, checking=False)
        contenders = [p for p in room["players"].values() if not p["forfeited"]]
        connected = [p for p in contenders if self.hub.count_for_user(p["id"])]
        if room["online"] == "ranked" or (len(contenders) <= 1 and (connected or not contenders)):
            await self._finish(room, void=not connected)
        else:
            if all(p["answered"] for p in room["players"].values()):
                if room["timer"]:
                    room["timer"].cancel()
                    room["timer"] = None
                self._schedule_advance(room)
            else:
                self._resume_round_if_ready(room)
            await self._broadcast(room)

    async def _finish(self, room: dict[str, Any], timed_out: bool = False, void: bool = False) -> None:
        if room["status"] != "playing":
            return
        room["status"] = "settling"
        room["deadline"] = None
        room["timed_out"] = timed_out
        room["void"] = void
        for task_name in ("timer", "transition"):
            task = room[task_name]
            if task is not None and task is not asyncio.current_task():
                task.cancel()
            room[task_name] = None
        task = asyncio.create_task(self._settle_room(room))
        self.settlements.add(task)
        task.add_done_callback(self.settlements.discard)
        await asyncio.shield(task)

    async def _settle_room(self, room):
        players = sorted(room["players"].values(), key=self._finish_key)
        winners = [p["id"] for p in players if self._finish_key(p) == self._finish_key(players[0])]
        outcomes = {p["id"]: (1 if len(winners) == 1 else .5) if p["id"] in winners else 0 for p in players}
        room["rewards"] = []
        snapshot = self._snapshot(room, finished=True)
        while True:
            try:
                if room["void"]:
                    await save_void_result(self.db_path, room["match_id"], snapshot)
                else:
                    room["rewards"] = await settle(
                        self.db_path, room["match_id"], players, room["mode"], room["online"],
                        outcomes, any(p["forfeited"] for p in players), snapshot,
                    )
                break
            except OperationalError:
                LOGGER.exception("Could not settle dive %s. Retrying.", room["match_id"])
                await asyncio.sleep(2)
        room["status"] = "finished"
        await self._broadcast(room)

    def _snapshot(self, room: dict[str, Any], finished: bool = False) -> dict[str, Any]:
        snapshot: dict[str, Any] = {
            "type": "game.room",
            "code": room["code"],
            "mode": room["mode"],
            "online": room["online"],
            "category": room["category"],
            "status": "finished" if finished else room["status"],
            "host_id": room["host_id"],
            "players": [
                {
                    "id": player["id"],
                    "username": player["username"],
                    "score": player["score"],
                    "answered": player["answered"],
                    "checking": player["checking"],
                    "last_answer": player["last_answer"],
                    "last_tier": player["last_tier"],
                    "skin": player["skin"],
                    "admin_rank": player.get("admin_rank"),
                    "forfeited": player["forfeited"],
                }
                for player in room["players"].values()
            ],
        }
        if room["status"] == "playing":
            question = room["questions"][room["round"]]
            snapshot["question"] = {"prompt": question["prompt"], "hint": question["hint"], "category": question["category"]}
            snapshot["question"]["use_model"] = question.get("use_model", True)
            snapshot["round"] = room["round"] + 1
            snapshot["round_count"] = None if room["mode"] == "endless" else ROUND_COUNT
            snapshot["deadline"] = room["deadline"]
            snapshot["paused"] = room["paused"]
            snapshot["remaining_seconds"] = room["remaining_seconds"]
        if snapshot["status"] == "finished":
            snapshot["timed_out"] = room["timed_out"]
            snapshot["void"] = room["void"]
            snapshot["rewards"] = [
                {**result, "unlocked": [self.skins[key]["name"] for key in result["unlocked"]]}
                for result in room["rewards"]
            ]
            snapshot["review"] = [
                {
                    "prompt": question["prompt"],
                    "category": question["category"],
                    "answers": [
                        {"answer": answer["answer"], "tier": answer["tier"], "points": TIER_POINTS[answer["tier"]]}
                        for answer in sorted(question["answers"], key=lambda entry: -TIER_POINTS[entry["tier"]])
                    ],
                }
                for question in room["questions"][:room["round"] + 1]
            ]
            ranked = sorted(room["players"].values(), key=lambda player: (*self._finish_key(player), player["username"].casefold()))
            snapshot["rankings"] = [
                {
                    "id": player["id"],
                    "username": player["username"],
                    "score": player["score"],
                    "depth": player["score"] * 10,
                    "answer_time": round(player["answer_time"], 2),
                }
                for player in ranked
            ]
        return snapshot

    async def _broadcast(self, room: dict[str, Any], recipient: int | None = None) -> None:
        snapshot = self._snapshot(room)
        for player_id in room["players"] if recipient is None else (recipient,):
            active = self._active_online(player_id)
            if active is room or (active is None and player_id not in self.matchmaking.entries):
                await self.hub.send_to_user(player_id, snapshot)

    async def _error(self, user_id: int, code: str, message: str) -> None:
        await self.hub.send_to_user(user_id, {"type": "game.error", "code": code, "message": message})
