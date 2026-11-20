"""Expand the Mars landing answers on older copies of the original pack.

Create a new migration for future question changes.
"""

from yoyo import step

from backend.db.question_pack import expand_mars_answers

__depends__ = {"007_expand_playable_questions"}

steps = [step(expand_mars_answers)]
