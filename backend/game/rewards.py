"""Define ranks, cosmetics and achievement rules. Edit to add a reward or change progression."""
from collections import Counter
from math import floor

ADMIN_STARTING_ELO = 50_000
ADMIN_SKIN_ID = "admin_aurora"
ADMIN_RANK = {"name": "Abyss Architect", "color": "#e7c9ff", "minimum": ADMIN_STARTING_ELO}

RANKS = (
    (0, "Drift Shell", "#b4c3d8"), (900, "Reef Runner", "#63eadc"),
    (1050, "Kelp Knight", "#7ee698"), (1200, "Lantern Fang", "#ffcb70"),
    (1350, "Midnight Ray", "#aab5ff"), (1500, "Abyssal Crown", "#dc9fff"),
    (1650, "Trench Sovereign", "#ff829f"), (1800, "Leviathan Star", "#ffe682"),
)


def rank_for(elo, is_admin=False):
    if is_admin:
        return ADMIN_RANK.copy()
    minimum, name, color = next(rank for rank in reversed(RANKS) if elo >= rank[0])
    return {"name": name, "color": color, "minimum": minimum}


def elo_change(first, second, outcome):
    """Return the first player's change for a win (1), draw (.5), or loss (0)."""
    expected = 1 / (1 + 10 ** (max(-6400, min(6400, second - first)) / 400))
    raw = 32 * (outcome - expected)
    delta = floor(abs(raw) + .5) * (1 if raw >= 0 else -1)
    return max(-first, min(second, delta))


DIVE_MILESTONE = 25
WIN_STREAK_MILESTONE = 5
CROWNLIGHT_ELO = 1650
ANSWER_RARITIES = frozenset(("plankton", "too_clever", "schooler", "rare", "deep_cut", "krillion"))
ENDLESS_DEPTH_SKINS = (
    ("blackwater", "Blackwater Beacon", 12_000),
    ("trench_engine", "Trench Engine", 20_000),
    ("fossil_nautilus", "Fossil Nautilus", 35_000),
    ("event_horizon", "Event Horizon", 50_000),
)


# ID (also the sprite filename), skin name, and unlock requirement.
SKINS = (
    ("default", "Original Krill", "Available from the start"),
    (ADMIN_SKIN_ID, "Aurora Regent", "Available to administrators"),
    ("first", "Sunbleached", "Complete a dive with at least one scored answer"),
    ("ten", "Kelp Stripes", f"Complete {DIVE_MILESTONE} dives"),
    ("depth25", "Lantern Bloom", "Reach 3,500 m in one dive"),
    ("depth50", "Trenchglass", "Reach 6,000 m in one dive"),
    ("perfect", "Afterburn", "Score in all seven classic rounds, with at least three Rare or better"),
    ("endless15", "Long Current", "Score 25 answers in one Endless dive"),
    *((key, name, f"Reach {depth:,} m in one Endless dive") for key, name, depth in ENDLESS_DEPTH_SKINS),
    ("plankton7", "Blue Static", "Score seven Plankton answers in one classic dive"),
    ("clever3", "Sideways Logic", "Score seven Too Clever answers in one classic dive"),
    ("schooler5", "School Flash", "Score seven Schooler answers in one classic dive"),
    ("rare3", "Red Wake", "Score seven Rare answers in one classic dive"),
    ("deep2", "Violet Bloom", "Score seven Deep Cuts in one classic dive"),
    ("gold1", "Gold Frill", "Score three One in a Krillion answers in one dive"),
    ("prism", "Sevenfold Prism", "In one classic dive, score each of the six rarities once and let one round expire without submitting"),
    ("arakelov", "Arithmetic Ghost", "Score Arakelov theory on the mathematical theories prompt"),
    ("napoleon", "Imperial Triad", "Score Napoleon’s theorem on the triangle theorem prompt"),
    ("aubel", "Square Whisper", "Score Van Aubel’s triangle theorem on the triangle theorem prompt"),
    ("nyckelharpa", "Fiddleback", "Score Nyckelharpa on the stringed instrument prompt"),
    ("culurgiones", "Folded Reef", "Score Culurgiones on the pasta prompt"),
    ("carme", "Carme Comet", "Score Carme on the Jupiter moons prompt"),
    ("casual4", "Four-Way Flash", "Win a full four-player Casual match"),
    ("ranked1", "Ranked Ember", "Win a Ranked match"),
    ("streak3", "Hot Streak", f"Win {WIN_STREAK_MILESTONE} Ranked matches in a row"),
    ("draw", "Dead Heat", "Draw a Ranked match"),
    ("lastsecond", "Last Lantern", "Score with under half a second left in a Ranked round"),
    ("crown", "Crownlight", "Reach Trench Sovereign in Ranked"),
)

NICHE = {
    ("Name a mathematical theory, field, or framework.", "arakelov theory"): "arakelov",
    ("Name a theorem or named result about triangles in Euclidean geometry.", "napoleon's theorem"): "napoleon",
    ("Name a theorem or named result about triangles in Euclidean geometry.", "van aubel's triangle theorem"): "aubel",
    ("Name a musical instrument with strings.", "nyckelharpa"): "nyckelharpa",
    ("Name a type of pasta.", "culurgiones"): "culurgiones",
    ("Name a moon of Jupiter.", "carme"): "carme",
}


def skin_catalog():
    return [
        {"id": key, "name": name, "requirement": requirement}
        for key, name, requirement in SKINS
    ]


SECRET_SKINS = frozenset(NICHE.values())


def profile_skins(unlocked, stats):
    progress_by_skin = {
        "ten": {"label": "Completed dives", "value": stats["dives"], "target": DIVE_MILESTONE},
        "streak3": {"label": "Ranked win streak", "value": stats["streak"], "target": WIN_STREAK_MILESTONE},
        "crown": {"label": "Elo toward Trench Sovereign", "value": stats["elo"], "target": CROWNLIGHT_ELO},
    }
    result = []
    for skin in skin_catalog():
        key = skin["id"]
        if key == ADMIN_SKIN_ID and not stats.get("is_admin"):
            continue
        owned = key in unlocked
        if key in SECRET_SKINS and not owned:
            result.append({
                **skin, "requirement": "Answer ??? for ???",
                "unlocked": False, "secret": True,
            })
            continue
        card = {**skin, "unlocked": owned, "secret": False}
        if not owned and key in progress_by_skin:
            card["progress"] = progress_by_skin[key]
        result.append(card)
    return result


def earned_skins(player, stats, mode, online, outcome, count, forfeit):
    if forfeit:
        return []
    answers = player["scored_answers"]
    tiers = Counter(answer["tier"] for answer in answers)
    classic = mode != "endless"
    top_tiers = tiers["rare"] + tiers["deep_cut"] + tiers["krillion"]
    checks = {
        "first": bool(answers), "ten": stats["dives"] >= DIVE_MILESTONE,
        "depth25": player["score"] >= 350, "depth50": player["score"] >= 600,
        "perfect": classic and len(answers) == 7 and top_tiers >= 3,
        "endless15": mode == "endless" and len(answers) >= 25,
        "plankton7": classic and tiers["plankton"] >= 7, "clever3": classic and tiers["too_clever"] >= 7,
        "schooler5": classic and tiers["schooler"] >= 7, "rare3": classic and tiers["rare"] >= 7,
        "deep2": classic and tiers["deep_cut"] >= 7, "gold1": tiers["krillion"] >= 3,
        "prism": classic and len(answers) == 6 and tiers.keys() == ANSWER_RARITIES and player.get("unsubmitted_rounds") == 1,
        "casual4": online == "casual" and count == 4 and outcome == 1,
        "ranked1": online == "ranked" and outcome == 1,
        "streak3": online == "ranked" and stats["streak"] >= WIN_STREAK_MILESTONE,
        "draw": online == "ranked" and outcome == .5,
        "lastsecond": online == "ranked" and any(answer["remaining"] < .5 for answer in answers),
        "crown": online == "ranked" and not stats.get("is_admin") and stats["elo"] >= CROWNLIGHT_ELO,
    }
    if mode == "endless":
        depth = player["score"] * 10
        checks.update({key: depth >= target for key, _, target in ENDLESS_DEPTH_SKINS})
    for answer in answers:
        key = NICHE.get((answer["prompt"], answer["answer"].casefold().replace("’", "'")))
        if key:
            checks[key] = True
    return [key for key, earned in checks.items() if earned]
