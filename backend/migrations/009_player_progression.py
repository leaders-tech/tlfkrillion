"""Persist Elo, achievement unlocks and match settlements. Add later changes in a new migration."""
from yoyo import step

__depends__ = {"008_complete_mars_answers"}
steps = [
    step("""CREATE TABLE player_progression (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        elo INTEGER NOT NULL DEFAULT 1000,
        skin TEXT NOT NULL DEFAULT 'default',
        dives INTEGER NOT NULL DEFAULT 0,
        best_depth INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0,
        draws INTEGER NOT NULL DEFAULT 0,
        streak INTEGER NOT NULL DEFAULT 0
    ) STRICT""", "DROP TABLE player_progression"),
    step("""CREATE TABLE player_unlocks (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        skin TEXT NOT NULL,
        PRIMARY KEY (user_id, skin)
    ) STRICT""", "DROP TABLE player_unlocks"),
    step("""CREATE TABLE match_settlements (
        match_id TEXT PRIMARY KEY,
        results_json TEXT NOT NULL
    ) STRICT""", "DROP TABLE match_settlements"),
    step("INSERT INTO player_progression (user_id) SELECT id FROM users", "DELETE FROM player_progression"),
]
