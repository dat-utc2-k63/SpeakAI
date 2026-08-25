"""
CMU Pronouncing Dictionary loader.

Maps English words to ARPAbet phoneme sequences (same notation as SpeechOcean762).
Used when canonical phoneme sequence is needed for CTC forced alignment.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Dict, List, Optional


class CMUDict:
    """Load and query CMUdict for word -> phoneme lookup."""

  # ARPAbet phoneme pattern (e.g. AH0, T, SH)
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
                    # Alternate pronunciation: WORD(2)
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
        """Return first pronunciation for word, or None."""
        variants = self._lexicon.get(word.lower().strip())
        return variants[0] if variants else None

    def text_to_phonemes(self, text: str) -> List[str]:
        """Convert whitespace-separated transcript to flat phoneme list."""
        phones: List[str] = []
        for word in text.upper().split():
            word_clean = re.sub(r"[^A-Z']", "", word)
            if not word_clean:
                continue
            pron = self.lookup(word_clean)
            if pron:
                phones.extend(pron)
        return phones

    def words_to_phoneme_groups(self, text: str) -> List[dict]:
        """
        Return per-word phoneme groups for graph edge construction.

        Each item: {"word": str, "phones": List[str]}
        """
        groups = []
        for word in text.upper().split():
            word_clean = re.sub(r"[^A-Z']", "", word)
            if not word_clean:
                continue
            pron = self.lookup(word_clean)
            if pron:
                groups.append({"word": word_clean, "phones": pron})
        return groups
