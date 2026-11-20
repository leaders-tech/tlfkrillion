"""Find opponents and track reconnect grace. Edit to change online queue rules."""
import time
from dataclasses import dataclass

CASUAL_FILL_SECONDS = 15
RECONNECT_SECONDS = 30


@dataclass
class Entry:
    user: dict
    mode: str
    elo: int
    joined: float


class Matchmaking:
    def __init__(self):
        self.entries: dict[int, Entry] = {}
        self.casual_ready: float | None = None
        self.disconnected: dict[int, float] = {}

    def cancel(self, user_id):
        self.entries.pop(user_id, None)
        if sum(entry.mode == "casual" for entry in self.entries.values()) < 2:
            self.casual_ready = None

    def join(self, user, mode, elo):
        user_id = user["id"]
        existing = self.entries.get(user_id)
        if existing and existing.mode == mode:
            return existing
        self.cancel(user_id)
        entry = Entry(user, mode, elo, time.monotonic())
        self.entries[user_id] = entry
        return entry

    def match(self, now):
        casual = [entry for entry in self.entries.values() if entry.mode == "casual"]
        if len(casual) >= 2:
            if self.casual_ready is None:
                self.casual_ready = now
            if len(casual) >= 4 or now - self.casual_ready >= CASUAL_FILL_SECONDS:
                return "casual", casual[:4]

        ranked = [entry for entry in self.entries.values() if entry.mode == "ranked"]
        for index, entry in enumerate(ranked):
            wait = now - entry.joined
            radius = float("inf") if wait >= 60 else 100 * (1 + int(max(0, wait) // 15))
            eligible = [other for other in ranked[index + 1:] if abs(other.elo - entry.elo) <= radius]
            if eligible:
                return "ranked", [entry, min(eligible, key=lambda other: abs(other.elo - entry.elo))]
        return None
