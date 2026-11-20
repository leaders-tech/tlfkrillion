"""Set existing administrators' starting Elo and default admin cosmetic."""
from yoyo import step

__depends__ = {"010_match_result_recovery"}
steps = [
    step("""
        INSERT INTO player_progression (user_id, elo, skin)
        SELECT id, 50000, 'admin_aurora' FROM users WHERE is_admin = 1
        ON CONFLICT(user_id) DO UPDATE SET elo=excluded.elo,
          skin=CASE WHEN player_progression.skin='default' THEN excluded.skin ELSE player_progression.skin END
    """),
]
