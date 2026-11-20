"""Handle health checks and admin player-account endpoints.

Edit this file when app endpoints outside the auth and websocket groups change.
Copy the route pattern here when you add another endpoint group backed by backend/db code.
"""

from __future__ import annotations

from aiohttp import web

from backend.app_keys import DB
from backend.auth.access import require_admin
from backend.auth.accounts import create_player
from backend.db.progression import profile
from backend.db.users import get_user_by_id, list_users, row_to_user
from backend.game.profile_routes import setup_profile_routes
from backend.game.routes import setup_game_routes
from backend.http.json_api import AppError, ok, read_json
from backend.http.middleware import require_allowed_origin


async def health(request: web.Request) -> web.Response:
    return ok({"status": "ok"})


async def admin_users_list(request: web.Request) -> web.Response:
    require_admin(request)
    users = await list_users(request.app[DB])
    return ok({"users": users})


async def admin_user_profile(request: web.Request) -> web.Response:
    require_admin(request)
    user_id = (await read_json(request)).get("id")
    if type(user_id) is not int or not 0 < user_id < 2**63:
        raise AppError(400, "bad_request", "Choose a player account.")
    db = request.app[DB]
    if await get_user_by_id(db, user_id) is None:
        raise AppError(404, "user_not_found", "That player account was not found.")
    return ok(await profile(db, user_id))


async def admin_user_create(request: web.Request) -> web.Response:
    require_allowed_origin(request)
    require_admin(request)
    payload = await read_json(request)
    user = await create_player(request.app[DB], payload.get("username"), payload.get("password"))
    return ok({"user": row_to_user(user)}, status=201)


def setup_api_routes(app: web.Application) -> None:
    app.router.add_get("/api/health", health)
    app.router.add_post("/api/admin/users/list", admin_users_list)
    app.router.add_post("/api/admin/users/profile", admin_user_profile)
    app.router.add_post("/api/admin/users/create", admin_user_create)
    setup_game_routes(app)
    setup_profile_routes(app)
