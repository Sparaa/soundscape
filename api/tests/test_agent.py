import random
from collections import Counter

from app import agent

SEED_A = {"id": "a", "title": "Death Dealer", "analysis": {"abc": "X:1\nM:4/4\nL:1/16\nQ:1/4=128\nK:F#m\n% verse\nV: Vocal\n\"F#m\"A2A2B2c2d2c2B2A2|\n% chorus\nV: Vocal\n\"F#m\"z4A4z8|\nV: Ins\nz2f2f2f2f2d2d2F2|\n",
                                                          "key": "F# minor", "bpm": 128, "seconds": 196, "sections": ["verse", "chorus"]}}
SEED_B = {"id": "b", "title": "Call Her", "analysis": {"abc": "X:1\nK:Fm\n% verse\nV: Vocal\nc2c2|\n", "key": "F minor", "bpm": 146, "seconds": 193, "sections": ["verse"]}}
STATION = {"name": "Night", "profile": {"bpm": {"low": 118, "high": 158, "center": 137}, "keys": ["F minor", "F# minor"], "seconds": 194,
                                        "tags": {"mood": [{"label": "dark", "weight": 0.5}, {"label": "playful", "weight": 0.2}]},
                                        "style": "English, synth-pop, dark, 808 drums, female vocals, 137 BPM"},
           "settings": {"themes": ["t1", "t2", "t3"]}}


def test_rotation_follows_the_weights_and_rules():
    rng = random.Random(1)
    modes = Counter()
    history = []
    for i in range(400):
        p = agent.plan_track(station=STATION, seeds=[SEED_A, SEED_B], history=history, rng=rng, now=1000.0 + i)
        modes[p.mode] += 1
        history.append(p.to_dict())
        history = history[-40:]
    assert modes["inspired"] > modes["faithful"] > 0 and modes["reinterpret"] > 0 and modes["hook"] > 0
    # hook only ever uses the seed that has a chorus; a faithful cover of the same seed never repeats within the hour
    hooks = [h for h in history if h["mode"] == "hook"]
    assert all(h["seed_id"] == "a" for h in hooks)
    faith = [(h["seed_id"], h["created"]) for h in history if h["mode"] == "faithful"]
    for (s1, t1), (s2, t2) in zip(faith, faith[1:]):
        assert s1 != s2 or t2 - t1 >= agent.COVER_COOLDOWN_S


def test_no_scores_means_inspired_only_and_themes_rotate():
    plain = [{"id": "x", "title": "X", "analysis": {"bpm": 100}}]
    hist = []
    for _ in range(6):
        p = agent.plan_track(station=STATION, seeds=plain, history=hist, rng=random.Random(3))
        hist.append(p.to_dict())
    assert {h["mode"] for h in hist} == {"inspired"}
    assert [h["theme"] for h in hist] == ["t1", "t2", "t3", "t1", "t2", "t3"]
    assert all(118 <= h["bpm"] <= 158 for h in hist) and all(h["key"] in ("F minor", "F# minor") for h in hist)


def test_covers_slider_zero_disables_covers():
    st = {**STATION, "settings": {"covers": 0}}
    modes = {agent.plan_track(station=st, seeds=[SEED_A], history=[], rng=random.Random(i)).mode for i in range(50)}
    assert modes == {"inspired"}


def test_requests_per_mode():
    plan = agent.plan_track(station=STATION, seeds=[SEED_A], history=[], rng=random.Random(0))
    plan.mode, plan.seed_id, plan.cot = "faithful", "a", "full"
    req = agent.song_request(style="English, synth-pop, dark, 128 BPM", lyrics="[Verse]\nla la", plan=plan, seed_analysis=SEED_A["analysis"], seed=5)
    assert req["cot"] == "full" and req["abc"].startswith("X:1") and req["vocal_promoted"] == ["chorus"] and req["seed"] == 5 and req["cover_mode"] == "faithful"
    plan.mode, plan.cot = "reinterpret", "melody"
    req = agent.song_request(style="s, 128 BPM", lyrics="[Verse]\nla", plan=plan, seed_analysis=SEED_A["analysis"])
    assert req["cot"] == "melody" and '"F#m"' not in req["abc"].split("K:F#m")[1]
    plan.mode, plan.cot = "hook", "full"
    req = agent.song_request(style="s", lyrics="[Chorus]\nla", plan=plan, seed_analysis=SEED_A["analysis"])
    assert req["hook_sections"] == ["chorus"] and "hook_abc" in req and "abc" not in req and "F# minor" in req["style"]
    plan.mode, plan.seed_id, plan.key = "inspired", None, "F minor"
    req = agent.song_request(style="s", lyrics="[Verse]\nla", plan=plan, seed_analysis=None)
    assert "abc" not in req and req["style"] == "s, in the key of F minor"
    assert agent.styled("English, synth-pop, dark, 808 drums, 137 BPM", plan).endswith(f"{plan.bpm} BPM")
