"""Read cosmetic ownership and atomically settle dives. Edit for profile and settlement storage changes."""
import json
from contextlib import asynccontextmanager

from backend.db.connection import open_db
from backend.game.rewards import ADMIN_SKIN_ID, ADMIN_STARTING_ELO, earned_skins, elo_change, profile_skins, rank_for, skin_catalog

DEFAULT_STATS = {"elo": 1000, "skin": "default", "dives": 0, "best_depth": 0, "wins": 0, "losses": 0, "draws": 0, "streak": 0}


@asynccontextmanager
async def _write(path):
    # A separate connection keeps unrelated auth/admin commits outside this transaction.
    db = await open_db(path)
    try:
        await db.execute("BEGIN IMMEDIATE")
        yield db
        await db.commit()
    finally:
        await db.close()


async def player_stats(db, user_id):
    async with db.execute(
        """SELECT users.is_admin, player_progression.* FROM users
           LEFT JOIN player_progression ON player_progression.user_id = users.id
           WHERE users.id = ?""", (user_id,),
    ) as cursor:
        row = await cursor.fetchone()
    stats = {key: row[key] for key in DEFAULT_STATS} if row and row["user_id"] is not None else DEFAULT_STATS.copy()
    stats["is_admin"] = bool(row and row["is_admin"])
    if stats["is_admin"] and row["user_id"] is None:
        stats.update(elo=ADMIN_STARTING_ELO, skin=ADMIN_SKIN_ID)
    elif not stats["is_admin"] and stats["skin"] == ADMIN_SKIN_ID:
        stats["skin"] = "default"
    return stats


async def initialize_promoted_admin(db, user_id):
    await db.execute(
        """INSERT INTO player_progression (user_id, elo, skin) VALUES (?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET elo=excluded.elo,
               skin=CASE WHEN player_progression.skin='default' THEN excluded.skin ELSE player_progression.skin END""",
        (user_id, ADMIN_STARTING_ELO, ADMIN_SKIN_ID),
    )
    await db.commit()


async def profile(db, user_id):
    stats = await player_stats(db, user_id)
    async with db.execute("SELECT skin FROM player_unlocks WHERE user_id = ?", (user_id,)) as cursor:
        unlocked = {row["skin"] for row in await cursor.fetchall()}
    unlocked.add("default")
    if stats["is_admin"]:
        unlocked.add(ADMIN_SKIN_ID)
    return {
        **stats, "rank": rank_for(stats["elo"], stats["is_admin"]),
        "skins": profile_skins(unlocked, stats),
    }


async def equip(path, user_id, skin):
    async with _write(path) as db:
        stats = await player_stats(db, user_id)
        async with db.execute("SELECT 1 FROM player_unlocks WHERE user_id = ? AND skin = ?", (user_id, skin)) as cursor:
            owned = await cursor.fetchone()
        if skin == ADMIN_SKIN_ID and not stats["is_admin"]:
            return False
        if skin not in ("default", ADMIN_SKIN_ID) and (not owned or skin not in {item["id"] for item in skin_catalog()}):
            return False
        await db.execute(
            """INSERT INTO player_progression (user_id, elo, skin) VALUES (?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE SET skin = excluded.skin""", (user_id, stats["elo"], skin),
        )
    return True


async def saved_result(db, code, user_id):
    async with db.execute(
        """SELECT results_json FROM match_settlements WHERE room_code = ?
           AND EXISTS (SELECT 1 FROM json_each(results_json, '$.snapshot.players') AS player
                       WHERE json_extract(player.value, '$.id') = ?)
           ORDER BY rowid DESC LIMIT 1""", (code, user_id),
    ) as cursor:
        row = await cursor.fetchone()
    if not row:
        return None
    snapshot = json.loads(row["results_json"])["snapshot"]
    # Older archived snapshots included the profile description with equipped art.
    for player in snapshot["players"]:
        if player.get("skin"):
            player["skin"].pop("requirement", None)
    return snapshot


async def save_void_result(path, match_id, snapshot):
    """Keep the result available without changing any player's progression."""
    async with _write(path) as db:
        await db.execute(
            "INSERT OR IGNORE INTO match_settlements (match_id, room_code, results_json) VALUES (?, ?, ?)",
            (match_id, snapshot["code"], json.dumps({"snapshot": snapshot, "rewards": []})),
        )


async def settle(path, match_id, players, mode, online, outcomes, forfeit, snapshot=None):
    async with _write(path) as db:
        async with db.execute("SELECT results_json FROM match_settlements WHERE match_id = ?", (match_id,)) as cursor:
            prior = await cursor.fetchone()
        if prior:
            saved = json.loads(prior["results_json"])
            return saved if isinstance(saved, list) else saved["rewards"]

        stats_by_id = {p["id"]: await player_stats(db, p["id"]) for p in players}
        deltas = {}
        if online == "ranked":
            first, second = [p["id"] for p in players]
            change = elo_change(stats_by_id[first]["elo"], stats_by_id[second]["elo"], outcomes[first])
            deltas = {first: change, second: -change}

        results = []
        for player in players:
            user_id = player["id"]
            stats = stats_by_id[user_id]
            change = deltas.get(user_id, 0)
            before = stats["elo"]
            stats["elo"] += change
            outcome = outcomes.get(user_id)
            if not forfeit:
                stats["dives"] += 1
                stats["best_depth"] = max(stats["best_depth"], player["score"] * 10)
            if online == "ranked":
                stats[{1: "wins", 0: "losses", .5: "draws"}[outcome]] += 1
                if outcome != 1:
                    stats["streak"] = 0
                elif not forfeit:
                    stats["streak"] += 1
            await db.execute(
                """INSERT INTO player_progression (user_id, elo, skin, dives, best_depth, wins, losses, draws, streak)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(user_id) DO UPDATE SET elo=excluded.elo, dives=excluded.dives, best_depth=excluded.best_depth,
                   wins=excluded.wins, losses=excluded.losses, draws=excluded.draws, streak=excluded.streak""",
                (user_id, *(stats[key] for key in ("elo", "skin", "dives", "best_depth", "wins", "losses", "draws", "streak"))),
            )
            unlocked = []
            for skin in earned_skins(player, stats, mode, online, outcome, len(players), forfeit):
                cursor = await db.execute("INSERT OR IGNORE INTO player_unlocks VALUES (?, ?)", (user_id, skin))
                if cursor.rowcount:
                    unlocked.append(skin)
            results.append({
                "id": user_id, "before": before, "elo": stats["elo"], "change": change,
                "rank": rank_for(stats["elo"], stats["is_admin"]), "unlocked": unlocked, "outcome": outcome,
            })
        if snapshot:
            names = {skin["id"]: skin["name"] for skin in skin_catalog()}
            snapshot["rewards"] = [
                {**result, "unlocked": [names[key] for key in result["unlocked"]]} for result in results
            ]
        await db.execute(
            "INSERT INTO match_settlements (match_id, room_code, results_json) VALUES (?, ?, ?)",
            (match_id, snapshot["code"] if snapshot else None, json.dumps({"snapshot": snapshot, "rewards": results})),
        )
    return results
