"""Add categories and install the expanded question pack once.

Create a new migration for later schema or pack releases.
"""

from yoyo import step

from backend.db.question_pack import install_pack_v1

__depends__ = {"005_add_model_check_option"}

steps = [
    step(
        "ALTER TABLE game_questions ADD COLUMN category TEXT NOT NULL DEFAULT 'General'",
        "ALTER TABLE game_questions DROP COLUMN category",
    ),
    step(install_pack_v1),
]
