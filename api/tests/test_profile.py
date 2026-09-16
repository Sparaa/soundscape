from app import profile

A1 = {"key": "F# minor", "bpm": 128, "seconds": 196.0, "sections": ["intro", "verse", "chorus", "verse", "chorus", "bridge", "chorus", "outro"],
      "tags": {"genre": [{"label": "EDM", "p": 0.6}, {"label": "synth-pop", "p": 0.3}], "mood": [{"label": "dark", "p": 0.5}],
               "instruments": [{"label": "analog synth bass", "p": 0.4}, {"label": "808 drums", "p": 0.3}],
               "vocal": [{"label": "female vocals", "p": 0.7}], "voice": [{"label": "autotuned", "p": 0.5}],
               "production": [{"label": "polished modern production", "p": 0.6}]},
      "abc": "X:1\nM:4/4\nL:1/16\nQ:1/4=128\nV: Vocal\nK:F#m\n% verse\nV: Vocal\nA2A2B2c2d2c2B2A2|F2F2G2A2B2A2G2F2|\n% chorus\nV: Vocal\nz4A4G4G4|F2z12z2|\n"}
A2 = {"key": "F minor", "bpm": 146, "seconds": 193.0, "sections": ["intro", "verse", "chorus", "verse", "pre-chorus", "chorus", "bridge", "chorus", "outro"],
      "tags": {"genre": [{"label": "synth-pop", "p": 0.5}, {"label": "k-pop", "p": 0.2}], "mood": [{"label": "playful", "p": 0.4}, {"label": "dark", "p": 0.3}],
               "instruments": [{"label": "808 drums", "p": 0.5}], "vocal": [{"label": "female vocals", "p": 0.6}], "voice": [], "production": []}}


def test_merge_tags_averages_and_ranks():
    tags = profile.merge_tags([A1, A2])
    assert tags["genre"][0] == {"label": "synth-pop", "weight": 0.4}      # (0.3 + 0.5) / 2
    assert [t["label"] for t in tags["genre"]] == ["synth-pop", "EDM", "k-pop"]
    assert tags["mood"][0]["label"] == "dark"                             # 0.4 vs playful 0.2
    assert tags["vocal"] == [{"label": "female vocals", "weight": 0.65}]


def test_bpm_band_sections_keys_style():
    p = profile.build_profile([A1, A2])
    assert p["bpm"] == {"low": 118, "high": 158, "center": 137}
    assert p["sections"] == ["intro", "verse", "chorus", "verse", "pre-chorus", "chorus", "bridge", "chorus", "outro"]  # tie → longest
    assert p["keys"] == ["F minor", "F# minor"] and p["seeds"] == 2 and p["instrumental"] is False
    assert p["style"] == "English, synth-pop with EDM touches, dark, playful, 808 drums, analog synth bass, autotuned female vocals, polished modern production, 137 BPM"
    assert p["phrases"]["verse"] == [8, 8] and p["phrases"]["chorus"] == [4]   # from A1's score (beat-aware phrasing)
    assert p["seconds"] == 194.5


def test_single_seed_and_instrumental():
    p = profile.build_profile([A1])
    assert p["bpm"] == {"low": 118, "high": 138, "center": 128} and p["sections"][0] == "intro"
    inst = {**A2, "tags": {**A2["tags"], "vocal": [{"label": profile.INSTRUMENTAL_LABEL, "p": 0.8}]}}
    q = profile.build_profile([inst])
    assert q["instrumental"] is True and "instrumental" in q["style"] and "vocals" not in q["style"]


def test_empty_sections_fall_back_to_a_song_form():
    assert profile.section_grammar([{"sections": []}])[:3] == ["intro", "verse", "chorus"]
