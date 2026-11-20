"""Index saved dive results for browser reconnects. Make later changes in a new migration."""
from yoyo import step

__depends__ = {"009_player_progression"}
steps = [
    step("ALTER TABLE match_settlements ADD COLUMN room_code TEXT", "ALTER TABLE match_settlements DROP COLUMN room_code"),
    step("CREATE INDEX match_settlements_room_code ON match_settlements(room_code)", "DROP INDEX match_settlements_room_code"),
]
