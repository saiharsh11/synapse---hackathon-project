"""Word-for-word quote check. A quote counts only if its exact words appear in the paper.

PDF text differs from what a model copies in layout only: line breaks, words split by a hyphen at
the end of a line, ligatures (ﬁ), curly quotes and dashes. Those are normalised on both sides;
the words themselves must match exactly, in order. Nothing is paraphrased or fuzzy-matched.
"""
import re
import unicodedata

from backend.schemas import IngestedPaper

_SAME = str.maketrans({"‘": "'", "’": "'", "‚": "'", "“": '"', "”": '"', "„": '"', "–": "-", "—": "-", "−": "-", " ": " "})


def normalise(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).translate(_SAME)   # NFKC turns ﬁ into fi
    text = re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", text)            # re-join words split across lines
    return re.sub(r"\s+", " ", text).strip().lower()


def find_quote(paper: IngestedPaper, quote: str, min_words: int = 6) -> int | None:
    """The page number where the quote appears word for word, or None.

    Quotes shorter than min_words are refused: a few common words prove nothing.
    A quote may run across a page break, so each page is checked joined to the next.
    """
    q = normalise(quote).strip(" .\"'")
    if len(q.split()) < min_words:
        return None
    pages = [normalise(p.text) for p in paper.pages]
    for i, text in enumerate(pages):
        if q in text or (i + 1 < len(pages) and q in text + " " + pages[i + 1]):
            return paper.pages[i].number
    return None
