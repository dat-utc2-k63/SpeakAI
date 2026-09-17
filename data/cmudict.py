"""
CMU Pronouncing Dictionary loader with Modern Vocabulary & Number Normalization.

Maps English words to ARPAbet phoneme sequences (same notation as SpeechOcean762).
Used when canonical phoneme sequence is needed for CTC forced alignment.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Dict, List, Optional

# ARPAbet phoneme pattern (e.g. AH0, T, SH)
PHONE_RE = re.compile(r"^[A-Z]{1,2}\d?$")

NUMBER_MAP = {
    0: "zero", 1: "one", 2: "two", 3: "three", 4: "four", 5: "five",
    6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten",
    11: "eleven", 12: "twelve", 13: "thirteen", 14: "fourteen", 15: "fifteen",
    16: "sixteen", 17: "seventeen", 18: "eighteen", 19: "nineteen", 20: "twenty",
    30: "thirty", 40: "forty", 50: "fifty", 60: "sixty", 70: "seventy",
    80: "eighty", 90: "ninety"
}

ORDINALS = {
    1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth",
    6: "sixth", 7: "seventh", 8: "eighth", 9: "ninth", 10: "tenth",
    11: "eleventh", 12: "twelfth", 13: "thirteenth", 14: "fourteenth", 15: "fifteenth",
    16: "sixteenth", 17: "seventeenth", 18: "eighteenth", 19: "nineteenth", 20: "twentieth",
    30: "thirtieth", 40: "fortieth", 50: "fiftieth", 60: "sixtieth", 70: "seventieth",
    80: "eightieth", 90: "ninetieth"
}

CUSTOM_WORDS: Dict[str, List[str]] = {
    "anime": ["AE1", "N", "AH0", "M", "EY2"],
    "wifi": ["W", "AY1", "F", "AY2"],
    "tiktok": ["T", "IH1", "K", "T", "AA2", "K"],
    "youtube": ["Y", "UW1", "T", "UW2", "B"],
    "podcast": ["P", "AA1", "D", "K", "AE2", "S", "T"],
    "vlog": ["V", "L", "AA1", "G"],
    "app": ["AE1", "P"],
    "online": ["AO1", "N", "L", "AY2", "N"],
    "covid": ["K", "OW1", "V", "IH0", "D"],
    "smartphone": ["S", "M", "AA1", "R", "T", "F", "OW2", "N"],
    "laptop": ["L", "AE1", "P", "T", "AA2", "P"],
    "grab": ["G", "R", "AE1", "B"],
    "shopee": ["SH", "AA1", "P", "IY0"],
    "bun": ["B", "AH1", "N"],
    "bo": ["B", "OW1"],
    "pho": ["F", "AH1"],
    "selfie": ["S", "EH1", "L", "F", "IY0"],
    "meme": ["M", "IY1", "M"],
    "emoji": ["IH0", "M", "OW1", "JH", "IY0"],
    "blog": ["B", "L", "AA1", "G"],
    "influencer": ["IH1", "N", "F", "L", "UW0", "AH0", "N", "S", "ER0"],
    "internet": ["IH1", "N", "T", "ER0", "N", "EH2", "T"],
    "email": ["IY1", "M", "EY2", "L"],
    "website": ["W", "EH1", "B", "S", "AY2", "T"],
    "facebook": ["F", "EY1", "S", "B", "UH2", "K"],
    "instagram": ["IH1", "N", "S", "T", "AH0", "G", "R", "AE2", "M"],
    "zalo": ["Z", "AA1", "L", "OW0"],
    "ai": ["EY1", "AY1"],
    "ok": ["OW1", "K", "EY1"],
    "okay": ["OW1", "K", "EY1"],
}


def int_to_en(n: int) -> str:
    """Convert integer to English words."""
    if n < 0:
        return "minus " + int_to_en(-n)
    if n <= 20:
        return NUMBER_MAP.get(n, str(n))
    if n < 100:
        tens, rem = divmod(n, 10)
        return NUMBER_MAP.get(tens * 10, "") + ((" " + NUMBER_MAP[rem]) if rem else "")
    if n < 1000:
        hundreds, rem = divmod(n, 100)
        return NUMBER_MAP.get(hundreds, "") + " hundred" + ((" " + int_to_en(rem)) if rem else "")
    if n < 1000000:
        thousands, rem = divmod(n, 1000)
        return int_to_en(thousands) + " thousand" + ((" " + int_to_en(rem)) if rem else "")
    return str(n)


def normalize_text_for_phonemes(text: str) -> str:
    """Normalize text: convert digits to words, normalize apostrophes, expand abbreviations."""
    if not text:
        return ""
    # Normalize curly apostrophes and quotation marks to ASCII single quote
    text = re.sub(r"[’‘`´]", "'", text)
    # Remove Whisper annotations like [music], (applause)
    text = re.sub(r"\[.*?\]|\(.*?\)", " ", text)
    # Currency ($50 -> fifty dollars)
    text = re.sub(r"\$\s*(\d+)", lambda m: int_to_en(int(m.group(1))) + " dollars ", text)
    # Percentage (50% -> fifty percent)
    text = re.sub(r"(\d+)\s*%", lambda m: int_to_en(int(m.group(1))) + " percent ", text)
    # Time (7:30 -> seven thirty)
    def _repl_time(m):
        h, mn = int(m.group(1)), int(m.group(2))
        h_str = int_to_en(h)
        if mn == 0:
            return h_str + " o'clock "
        if mn < 10:
            return h_str + " oh " + int_to_en(mn) + " "
        return h_str + " " + int_to_en(mn) + " "
    text = re.sub(r"\b(\d{1,2}):(\d{2})\b", _repl_time, text)
    # Ordinals (1st -> first, 2nd -> second)
    text = re.sub(
        r"\b(\d+)(st|nd|rd|th)\b",
        lambda m: ORDINALS.get(int(m.group(1)), int_to_en(int(m.group(1))) + "th"),
        text,
        flags=re.I,
    )
    # Standalone numbers (1, 2, 3... -> one, two, three...)
    text = re.sub(r"\b\d+\b", lambda m: int_to_en(int(m.group(0))), text)
    # Hyphens to spaces (twenty-one -> twenty one, ice-cream -> ice cream)
    text = text.replace("-", " ")
    return text


def fallback_g2p(word: str) -> List[str]:
    """Lightweight rule-based Grapheme-to-Phoneme fallback for OOV words."""
    w = word.lower().strip()
    if not w:
        return ["AH0"]
    i = 0
    phones = []
    while i < len(w):
        pair = w[i:i+2]
        if pair in ("ch", "tch"):
            phones.append("CH"); i += 2; continue
        if pair == "sh":
            phones.append("SH"); i += 2; continue
        if pair == "th":
            phones.append("TH"); i += 2; continue
        if pair == "ph":
            phones.append("F"); i += 2; continue
        if pair == "ng":
            phones.append("NG"); i += 2; continue
        if pair in ("ee", "ea"):
            phones.append("IY1"); i += 2; continue
        if pair in ("oo",):
            phones.append("UW1"); i += 2; continue
        if pair in ("ai", "ay"):
            phones.append("EY1"); i += 2; continue
        if pair in ("oi", "oy"):
            phones.append("OY1"); i += 2; continue
        if pair in ("ou", "ow"):
            phones.append("AW1"); i += 2; continue
        if pair in ("er", "ir", "ur"):
            phones.append("ER1"); i += 2; continue
        if pair == "ar":
            phones.extend(["AA1", "R"]); i += 2; continue
        if pair == "or":
            phones.extend(["AO1", "R"]); i += 2; continue
        if pair == "qu":
            phones.extend(["K", "W"]); i += 2; continue
        if pair == "ck":
            phones.append("K"); i += 2; continue

        c = w[i]
        if c == "a": phones.append("AE1")
        elif c == "e":
            if i == len(w) - 1 and len(phones) > 0:
                pass
            else:
                phones.append("EH1")
        elif c == "i": phones.append("IH1")
        elif c == "o": phones.append("AA1")
        elif c == "u": phones.append("AH1")
        elif c == "b": phones.append("B")
        elif c == "c":
            if i + 1 < len(w) and w[i+1] in "eiy": phones.append("S")
            else: phones.append("K")
        elif c == "d": phones.append("D")
        elif c == "f": phones.append("F")
        elif c == "g":
            if i + 1 < len(w) and w[i+1] in "eiy": phones.append("JH")
            else: phones.append("G")
        elif c == "h": phones.append("HH")
        elif c == "j": phones.append("JH")
        elif c == "k": phones.append("K")
        elif c == "l": phones.append("L")
        elif c == "m": phones.append("M")
        elif c == "n": phones.append("N")
        elif c == "p": phones.append("P")
        elif c == "r": phones.append("R")
        elif c == "s": phones.append("S")
        elif c == "t": phones.append("T")
        elif c == "v": phones.append("V")
        elif c == "w": phones.append("W")
        elif c == "x": phones.extend(["K", "S"])
        elif c == "y":
            if i == 0: phones.append("Y")
            else: phones.append("IY0")
        elif c == "z": phones.append("Z")
        i += 1
    return phones or ["AH0"]


class CMUDict:
    """Load and query CMUdict for word -> phoneme lookup with Custom Words & Fallback G2P."""

    PHONE_RE = re.compile(r"^[A-Z]{1,2}\d?$")

    def __init__(self, dict_path: Optional[str] = None):
        self._lexicon: Dict[str, List[List[str]]] = {}
        if dict_path and Path(dict_path).exists():
            self._load_file(dict_path)
        else:
            self._load_nltk()

    def _load_file(self, path: str) -> None:
        """Parse standard CMUdict format: WORD  PHONE1 PHONE2 ..."""
        with open(path, encoding="latin-1") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith(";;;"):
                    continue
                if "(" in line:
                    word, rest = line.split("(", 1)
                    rest = rest.rstrip(")")
                    phones = rest.split()[1:]
                else:
                    parts = line.split()
                    word, phones = parts[0], parts[1:]
                key = word.lower()
                self._lexicon.setdefault(key, []).append(phones)

    def _load_nltk(self) -> None:
        """Fallback: download CMUdict via NLTK."""
        try:
            import nltk

            try:
                nltk.data.find("corpora/cmudict")
            except LookupError:
                nltk.download("cmudict", quiet=True)
            from nltk.corpus import cmudict

            for word, phones_list in cmudict.dict().items():
                self._lexicon[word.lower()] = [list(p) for p in phones_list]
        except Exception as exc:
            raise RuntimeError(
                "CMUdict not found. Provide data/cmudict/cmudict.dict or install nltk."
            ) from exc

    def lookup(self, word: str) -> Optional[List[str]]:
        """Return first pronunciation for word from CMUDict or CUSTOM_WORDS, or None."""
        w = word.lower().strip()
        variants = self._lexicon.get(w)
        if variants:
            return variants[0]
        if w in CUSTOM_WORDS:
            return CUSTOM_WORDS[w]
        return None

    def lookup_or_fallback(self, word: str) -> List[str]:
        """Return pronunciation from lexicon, custom words, or fallback G2P (never None)."""
        clean = re.sub(r"[^A-Za-z']", "", word).strip()
        if not clean:
            return ["AH0"]
        pron = self.lookup(clean)
        if pron:
            return pron
        return fallback_g2p(clean)

    def text_to_phonemes(self, text: str) -> List[str]:
        """Convert transcript to flat phoneme list, normalizing numbers and contractions."""
        norm_text = normalize_text_for_phonemes(text)
        phones: List[str] = []
        for word in norm_text.split():
            clean = re.sub(r"[^A-Za-z']", "", word).strip()
            if not clean:
                continue
            phones.extend(self.lookup_or_fallback(clean))
        return phones

    def words_to_phoneme_groups(self, text: str) -> List[dict]:
        """
        Return per-word phoneme groups for graph edge construction.
        Guarantees that every recognized word has phonemes (never dropped).
        """
        norm_text = normalize_text_for_phonemes(text)
        groups = []
        for raw_word in norm_text.split():
            clean = re.sub(r"[^A-Za-z']", "", raw_word).strip()
            if not clean:
                continue
            phones = self.lookup_or_fallback(clean)
            groups.append({"word": clean, "phones": phones})
        return groups
