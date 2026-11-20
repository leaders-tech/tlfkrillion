"""Expose the player's profile and ranked history. Edit to add progression endpoints."""
from aiohttp import web

from backend.app_keys import DB, SETTINGS
from backend.auth.access import require_user
from backend.db.progression import equip, player_stats, profile, ranked_history
from backend.game.rewards import ADMIN_RANK, MAX_ELO_K, RANKS, rank_for
from backend.http.json_api import AppError, ok, read_json
from backend.http.middleware import require_allowed_origin


async def read_profile(request):
    user = require_user(request)
    return ok(await profile(request.app[DB], user["id"]))


async def read_ranked(request):
    user = require_user(request)
    db = request.app[DB]
    history = await ranked_history(db, user["id"])
    stats = await player_stats(db, user["id"])
    return ok({
        "elo": stats["elo"],
        "rank": rank_for(stats["elo"], stats["is_admin"]),
        "ranks": [{"minimum": minimum, "name": name, "color": color} for minimum, name, color in RANKS],
        "admin_rank": ADMIN_RANK,
        "history": history,
        "max_swing": MAX_ELO_K,
    })


async def equip_skin(request):
    require_allowed_origin(request)
    user = require_user(request)
    skin = (await read_json(request)).get("skin")
    if not isinstance(skin, str) or not await equip(request.app[SETTINGS].db_path, user["id"], skin):
        raise AppError(403, "skin_locked", "Unlock this skin before equipping it.")
    return ok(await profile(request.app[DB], user["id"]))


def setup_profile_routes(app: web.Application):
    app.router.add_post("/api/game/profile", read_profile)
    app.router.add_post("/api/game/ranked", read_ranked)
    app.router.add_post("/api/game/profile/equip", equip_skin)
