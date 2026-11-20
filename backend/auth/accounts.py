"""Create ordinary player accounts for signup and admin provisioning.

Edit this file when player credential rules change. Reuse it for new account entry points.
"""

from __future__ import annotations

import re

import aiosqlite

from backend.auth.passwords import hash_password
from backend.db.users import create_user_if_missing, get_user_by_username
from backend.http.json_api import AppError


async def create_player(db: aiosqlite.Connection, username: object, password: object) -> aiosqlite.Row:
    if not isinstance(username, str) or not re.fullmatch(r"[A-Za-z0-9_-]{3,24}", username):
        raise AppError(400, "bad_request", "Username must be 3 to 24 letters, numbers, dashes, or underscores.")
    if not isinstance(password, str) or len(password) < 8:
        raise AppError(400, "bad_request", "Player password must be at least 8 characters.")
    if not await create_user_if_missing(db, username, hash_password(password), False):
        raise AppError(409, "already_exists", "That username is already taken.")
    user = await get_user_by_username(db, username)
    assert user is not None
    return user
