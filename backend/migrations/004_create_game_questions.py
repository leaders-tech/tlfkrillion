"""Create the question bank used by the Krillion-style game.

Edit this migration only before it has been applied; create a later migration for schema changes.
Do not copy it because migrations must describe one specific database change.
"""

from yoyo import step

steps = [
    step(
        """
        CREATE TABLE game_questions (
            id INTEGER PRIMARY KEY,
            prompt TEXT NOT NULL,
            hint TEXT NOT NULL DEFAULT '',
            answers_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        ) STRICT
        """,
        "DROP TABLE game_questions",
    )
]
