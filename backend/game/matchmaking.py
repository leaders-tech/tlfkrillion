"""Find opponents and track reconnect grace. Edit to change online queue rules."""
import time
from dataclasses import dataclass

CASUAL_FILL_SECONDS = 15
RECONNECT_SECONDS = 30
RANKED_OPEN_SECONDS = 60


@dataclass
class Entry:
    user: dict
    mode: str
    elo: int
    joined: float
    any_elo: bool = False

    def radius(self, now):
        wait = max(0, now - self.joined)
        if self.any_elo or wait >= RANKED_OPEN_SECONDS:
            return float("inf")
        return 100 * (1 + int(wait // 15))


class Matchmaking:
    def __init__(self):
        self.entries: dict[int, Entry] = {}
        self.casual_ready: float | None = None
        self.disconnected: dict[int, float] = {}

    def cancel(self, user_id):
        self.entries.pop(user_id, None)
        if sum(entry.mode == "casual" for entry in self.entries.values()) < 2:
            self.casual_ready = None

    def join(self, user, mode, elo, *, any_elo=False):
        user_id = user["id"]
        existing = self.entries.get(user_id)
        if existing and existing.mode == mode:
            existing.any_elo = existing.any_elo or any_elo
            return existing
        self.cancel(user_id)
        entry = Entry(user, mode, elo, time.monotonic(), any_elo)
        self.entries[user_id] = entry
        return entry

    def match(self, now):
        connected = [entry for user_id, entry in self.entries.items() if user_id not in self.disconnected]
        casual = [entry for entry in connected if entry.mode == "casual"]
        if len(casual) >= 2:
            if self.casual_ready is None:
                self.casual_ready = now
            if len(casual) >= 4 or now - self.casual_ready >= CASUAL_FILL_SECONDS:
                return "casual", casual[:4]

        else:
            self.casual_ready = None

        ranked = [entry for entry in connected if entry.mode == "ranked"]
        for index, entry in enumerate(ranked):
            radius = entry.radius(now)
            eligible = [
                other for other in ranked[index + 1:]
                if abs(other.elo - entry.elo) <= max(radius, other.radius(now))
            ]
            if eligible:
                return "ranked", [entry, min(eligible, key=lambda other: abs(other.elo - entry.elo))]
        return None
