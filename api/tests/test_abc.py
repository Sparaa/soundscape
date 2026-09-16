from app import abc as abclib

RIFF_ABC = ("X:1\nM:4/4\nL:1/32\nQ:1/4=92\nV: Vocal clef=treble name=\"Vocal Melody\" snm=\"Vocal\"\nK:F\n"
            "% verse\nV: Vocal\n\"F\"z8c4c2f2f4e2d4|\"Dm\"A6G4z6z16|\n% chorus\nV: Vocal\n\"F\"g12a2g2g6f6e4|\"Bb\"d8c8B8z8|\n")


def test_ported_helpers_behave_like_vidmakr():
    assert abclib.abc_units(RIFF_ABC) == (8, 32)
    assert abclib.vocal_phrases(RIFF_ABC) == {"verse": [8], "chorus": [9]}
    assert abclib.abc_facts(RIFF_ABC)["key"] == "F major" and abclib.abc_facts(RIFF_ABC)["bpm"] == 92
    assert '"F"' not in abclib.strip_chords(RIFF_ABC).split("K:F")[1]
    assert abclib.promote_sparse_vocals(RIFF_ABC) == (RIFF_ABC, [])
    assert abclib.phrase_hint(abclib.vocal_phrases(RIFF_ABC)).startswith("verse: 1 line of 8 syllables")
    assert abclib.parse_song_json('{"title": "T", "style": "pop", "lyrics": "[Verse]\\nla"}')["title"] == "T"
