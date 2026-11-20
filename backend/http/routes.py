"""Handle health checks and admin player-account endpoints.

Edit this file when app endpoints outside the auth and websocket groups change.
Copy the route pattern here when you add another endpoint group backed by backend/db code.
"""

from __future__ import annotations

import re

from aiohttp import web

from backend.app_keys import DB
from backend.auth.access import require_admin
from backend.auth.passwords import hash_password
from backend.db.users import create_user_if_missing, list_users
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


async def admin_user_create(request: web.Request) -> web.Response:
    require_allowed_origin(request)
    require_admin(request)
    payload = await read_json(request)
    username = payload.get("username")
    password = payload.get("password")
    if not isinstance(username, str) or not re.fullmatch(r"[A-Za-z0-9_-]{3,24}", username):
        raise AppError(400, "bad_request", "Username must be 3 to 24 letters, numbers, dashes, or underscores.")
    if not isinstance(password, str) or len(password) < 8:
        raise AppError(400, "bad_request", "Player password must be at least 8 characters.")
    created = await create_user_if_missing(request.app[DB], username, hash_password(password), False)
    if not created:
        raise AppError(409, "already_exists", "That username is already taken.")
    users = await list_users(request.app[DB])
    user = next(user for user in users if user["username"] == username)
    return ok({"user": user}, status=201)


def setup_api_routes(app: web.Application) -> None:
    app.router.add_get("/api/health", health)
    app.router.add_post("/api/admin/users/list", admin_users_list)
    app.router.add_post("/api/admin/users/create", admin_user_create)
    setup_game_routes(app)
    setup_profile_routes(app)
