"""Add a per-question model check setting and fix one known rarity mistake.

Edit this migration only before it has been applied; create a later migration for schema changes.
Do not copy it because migrations must describe one specific database change.
"""

from yoyo import step

steps = [
    step(
        "ALTER TABLE game_questions ADD COLUMN use_model INTEGER NOT NULL DEFAULT 1 CHECK (use_model IN (0, 1))",
        "ALTER TABLE game_questions DROP COLUMN use_model",
    ),
    step(
        """
        UPDATE game_questions
        SET answers_json = (
            SELECT json_group_array(json(
                CASE
                    WHEN lower(json_extract(answer.value, '$.answer')) = 'sitar'
                         AND json_extract(answer.value, '$.tier') IN ('plankton', 'too_clever')
                    THEN json_set(answer.value, '$.tier', 'schooler')
                    ELSE answer.value
                END
            ))
            FROM json_each(game_questions.answers_json) AS answer
        ), updated_at = datetime('now')
        WHERE lower(prompt) LIKE '%stringed instrument%'
          AND EXISTS (
              SELECT 1 FROM json_each(game_questions.answers_json) AS answer
              WHERE lower(json_extract(answer.value, '$.answer')) = 'sitar'
                AND json_extract(answer.value, '$.tier') IN ('plankton', 'too_clever')
          )
        """,
        "SELECT 1",
    ),
]
