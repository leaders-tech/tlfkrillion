"""Install broader prompts and the mathematics question pack.

Create a new migration for later question packs.
"""

from yoyo import step

from backend.db.question_pack import install_pack_v2

__depends__ = {"006_categorize_and_expand_questions"}

steps = [step(install_pack_v2)]
