"""Generate data/songs.json from the Taylor Swift lyrics dataset."""

import csv
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CSV_PATH = ROOT / ".source-taylor-swift" / "src" / "taylor-swift-lyrics" / "songs.csv"
OUT_PATH = ROOT / "data" / "songs.json"

ALBUMS = [
    {"id": "taylor_swift", "name": "Taylor Swift", "color": "#dceccb", "text": "#24331c"},
    {"id": "fearless", "name": "Fearless", "color": "#f3e08b", "text": "#4c4212"},
    {"id": "speak_now", "name": "Speak Now", "color": "#cbb6e6", "text": "#32244a"},
    {"id": "red", "name": "Red", "color": "#e14b3d", "text": "#ffffff"},
    {"id": "1989", "name": "1989", "color": "#a9dced", "text": "#173947"},
    {"id": "reputation", "name": "reputation", "color": "#25272b", "text": "#ffffff"},
    {"id": "lover", "name": "Lover", "color": "#f3b9c4", "text": "#5b2431"},
    {"id": "folklore", "name": "folklore", "color": "#4a4a52", "text": "#ffffff"},
    {"id": "evermore", "name": "evermore", "color": "#9a6b45", "text": "#ffffff"},
    {"id": "midnights", "name": "Midnights", "color": "#243b5a", "text": "#ffffff"},
    {"id": "ttpd", "name": "The Tortured Poets Department", "color": "#f7f5f1", "text": "#222222"},
    {"id": "showgirl", "name": "The Life of a Showgirl", "color": "#e78a3f", "text": "#ffffff"},
    {"id": "other", "name": "其他", "color": "#e1ddd6", "text": "#333333"},
]

ALBUM_IDS = {a["id"]: a for a in ALBUMS}
ALBUM_MAP = {
    "Taylor Swift": "taylor_swift",
    "Beautiful Eyes": "other",
    "Fearless (Taylor's Version)": "fearless",
    "Speak Now (Taylor's Version)": "speak_now",
    "Red (Taylor's Version)": "red",
    "1989 (Taylor's Version)": "1989",
    "reputation": "reputation",
    "Lover": "lover",
    "folklore": "folklore",
    "evermore": "evermore",
    "Midnights": "midnights",
    "The Tortured Poets Department": "ttpd",
    "The Life of a Showgirl": "showgirl",
    "The Life of a Showgirl (Track by Track Version)": "showgirl",
    "The Taylor Swift Holiday Collection": "other",
    "The Hunger Games": "other",
    "Cats": "other",
    "How Long Do You Think It's Gonna Last": "other",
    "Where The Crawdads Sing": "other",
    "Christmas Tree Farm": "other",
    "Fifty Shades Darker": "other",
    "Miss Americana": "other",
    "Love Drunk": "other",
    "Women in Music Part III": "other",
    "Two Lanes of Freedom": "other",
    "The Hannah Montana Movie": "other",
}

SUFFIX_RE = re.compile(
    r"\s*\((?:taylor'?s version|10 minute version|from the vault|remix|acoustic|bonus track|demo)\)\s*"
    r"|\s*\[(?:from the vault|bonus track|demo)\]",
    re.IGNORECASE,
)
APOSTROPHE_RE = re.compile(r"[\u2018\u2019']")

KEY_LYRICS = [
    ("salt air", "folklore"),
    ("rust on your door", "folklore"),
    ("burning red", "red"),
    ("fuck the patriarchy", "red"),
    ("fxxk the patriarchy", "red"),
]

RELATED_WORDS = [
    ("Taylor Swift", "taylor_swift"),
    ("TS", "other"),
    ("eras tour", "other"),
    ("eras", "other"),
]

SPECIAL_SONGS = [
    ("the 1", "folklore"),
    ("Welcome to NY", "1989"),
    ("Vigilante Sxxt", "midnights"),
]

EXTRA_SONGS = [
    ("I Knew It, I Knew You", "other"),
    ("The Alcott", "other"),
    ("us.", "other"),
    ("Birch", "other"),
    ("Birth", "other"),
    ("Permanent Marker", "other"),
    ("need", "lover"),
    ("Dark Blue Tennessee", "taylor_swift"),
    ("Drama Queen", "speak_now"),
]

ALBUM_ABBREVIATIONS = [
    ("rep", "reputation"),
    ("folkmore", "folklore"),
    ("mid", "midnights"),
]


def title_case(text):
    """Normalize a song title to conventional Title Case for display."""
    small = {"a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "with"}
    words = text.split()
    out = []
    for i, word in enumerate(words):
        core = re.sub(r"[^A-Za-z]", "", word)
        if core and core.lower() not in small or i == 0 or i == len(words) - 1:
            out.append(word[:1].upper() + word[1:])
        else:
            out.append(word.lower())
    return " ".join(out)


def normalize_title(raw):
    """Strip version suffixes and normalize apostrophes."""
    title = SUFFIX_RE.sub(" ", raw)
    title = APOSTROPHE_RE.sub("'", title)
    title = re.sub(r"\s+", " ", title).strip()
    return title


def clean_for_beads(text):
    """Keep only A-Z letters, uppercased."""
    return re.sub(r"[^A-Za-z]", "", text.replace("$", "S")).upper()


def digit_to_letter(text):
    """Map digit 1 to I for opt-in entries like 'the 1'."""
    return text.replace("1", "I")


def letter_counts(text):
    return dict(sorted(Counter(clean_for_beads(digit_to_letter(text))).items()))


def has_digit(text):
    return any(ch.isdigit() for ch in text)


def word_count(title):
    return len([w for w in title.split() if re.search(r"[A-Za-z]", w)])


def abbreviate(title, you_variant=False):
    """First letters. With you_variant, standalone You becomes U."""
    initials = []
    for word in title.split():
        core = re.sub(r"[^A-Za-z]", "", word)
        if not core:
            continue
        if you_variant and core.lower() == "you":
            initials.append("U")
        else:
            initials.append(core[0].upper())
    if not initials or any(ch.isdigit() for ch in initials):
        return None
    return "".join(initials)


def main():
    entries = []
    seen_song = set()

    def add(display, album_id, source, original=None, convert_ones=False):
        shown = digit_to_letter(display) if convert_ones else display
        cleaned = clean_for_beads(shown)
        if not cleaned or has_digit(cleaned):
            return None
        if source == "song":
            if cleaned in seen_song:
                return None
            seen_song.add(cleaned)
            for i, existing in enumerate(entries):
                if existing["clean"] == cleaned and existing["source"] != "song":
                    entries[i] = None
        elif any(e is not None and e["clean"] == cleaned and e["source"] == source for e in entries):
            return None
        entries[:] = [e for e in entries if e is not None]
        entry = {
            "id": f"{source}:{len(entries)}",
            "display": shown,
            "clean": cleaned,
            "counts": letter_counts(shown),
            "album": album_id,
            "source": source,
        }
        if original:
            entry["original"] = original
        entries.append(entry)
        return entry

    for album in ALBUMS:
        add(album["name"], album["id"], "song_album")

    for album in ALBUMS:
        if word_count(album["name"]) >= 4:
            abbr = abbreviate(album["name"])
            if abbr:
                add(abbr, album["id"], "abbr", album["name"])

    for abbr, album_id in ALBUM_ABBREVIATIONS:
        add(abbr, album_id, "song_album", ALBUM_IDS[album_id]["name"])

    for abbr, display in [("ATW", "All Too Well")]:
        add(abbr, "red", "song_album", display)

    for text, album_id in KEY_LYRICS:
        add(text, album_id, "lyric")

    for text, album_id in RELATED_WORDS:
        add(text, album_id, "related")

    for text, album_id in SPECIAL_SONGS:
        add(text, album_id, "song", convert_ones=True)

    for text, album_id in EXTRA_SONGS:
        add(text, album_id, "song", convert_ones=True)

    with open(CSV_PATH, encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            album_id = ALBUM_MAP.get(row["Album"])
            if album_id is None:
                album_id = "other"
            display = normalize_title(row["Title"])
            if not display:
                continue
            base = re.sub(r"\s*\([^()]*\)", " ", display)
            base = re.sub(r"\s+", " ", base).strip()
            add(display, album_id, "song", convert_ones=True)
            if base and base != display:
                add(base, album_id, "song", convert_ones=True)
            you_variant = re.sub(r"\byou\b(?!['\u2019])", lambda m: "u" if m.group(0).islower() else "U", display, flags=re.IGNORECASE)
            if you_variant != display:
                add(you_variant, album_id, "song", convert_ones=True)
            if word_count(display) >= 4:
                abbr = abbreviate(display)
                if abbr and not has_digit(abbr):
                    add(abbr, album_id, "abbr", display)
                abbr_u = abbreviate(display, you_variant=True)
                if abbr_u and abbr_u != abbr:
                    add(abbr_u, album_id, "abbr", display)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 1,
        "albums": ALBUMS,
        "entries": entries,
    }
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"entries: {len(entries)}")
    by_source = Counter(e["source"] for e in entries)
    print("by source:", dict(by_source))


if __name__ == "__main__":
    main()
