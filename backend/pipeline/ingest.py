"""Stage 1: PDF -> page text + figure page renders. Local only, no API calls.

Usage: .venv/bin/python -m backend.pipeline.ingest data/papers/<file>.pdf
"""
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

import pymupdf

from backend.config import CACHE_DIR, FIGURE_DPI, MAX_FIGURE_PAGES, MIN_IMAGE_SIDE, ROOT
from backend.guard.sources import paper_path
from backend.schemas import Figure, IngestedPaper, Page

_COVER_RE = re.compile(r"institutional (knowledge archive|repository)|downloaded from .*repository", re.IGNORECASE)
CAPTION_RE = re.compile(r"^\s*(fig\.?|figure)\s*\d+", re.IGNORECASE)


def paper_id(pdf_path: Path) -> str:
    return hashlib.sha256(pdf_path.read_bytes()).hexdigest()[:12]


def _guess_title(doc: pymupdf.Document) -> str:
    """Use PDF metadata if sane, else the largest-font line on page 1."""
    meta = (doc.metadata or {}).get("title", "").strip()
    letters = sum(ch.isalpha() for ch in meta)
    if len(meta) > 10 and letters > len(meta) / 2:   # publishers sometimes store a production code here
        return meta
    # library repositories add their own cover page in front of the paper: read the next page instead
    first = 1 if doc.page_count > 1 and _COVER_RE.search(doc[0].get_text()) else 0
    lines = []   # (text, font size), in reading order
    for block in doc[first].get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            if line.get("dir", (1, 0)) != (1, 0):   # skip rotated text (arXiv margin stamp)
                continue
            text = "".join(s["text"] for s in line["spans"]).strip()
            if not text or text.lower().startswith("arxiv:"):
                continue
            lines.append((text, max((s["size"] for s in line["spans"]), default=0)))
    big = max((size for text, size in lines if len(text) > 10), default=0)
    # a title often wraps: take the first run of consecutive lines set in the largest size
    run, started = [], False
    for text, size in lines:
        if abs(size - big) < 0.5:
            run.append(text)
            started = True
        elif started:
            break
    title = re.sub(r"\s+", " ", " ".join(run)).strip()
    return title or "Untitled"


def _visible_text(page: pymupdf.Page) -> tuple[str, int]:
    """Page text as a reader sees it. Text a person can't see is dropped, because it is the usual
    way to slip instructions to an AI: invisible or fully transparent text, white or near-white
    text, text too small to read, and text placed off the page. Returns (text, characters dropped)."""
    area, lines, dropped = page.rect, [], 0
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            kept = []
            for span in line["spans"]:
                c = span.get("color", 0)
                r, g, b = (c >> 16) & 255, (c >> 8) & 255, c & 255
                hidden = (span.get("alpha", 255) == 0 or min(r, g, b) >= 240 or span.get("size", 10) < 4
                          or not area.intersects(pymupdf.Rect(span["bbox"])))
                if hidden:
                    dropped += len(span["text"].strip())
                else:
                    kept.append(span["text"])
            if kept:
                lines.append("".join(kept))
    return "\n".join(lines), dropped


def _page_has_figure(page: pymupdf.Page, captions: list[str]) -> bool:
    if captions:
        return True
    for img in page.get_images(full=True):
        width, height = img[2], img[3]
        if min(width, height) >= MIN_IMAGE_SIDE:
            return True
    return False


def ingest(pdf_path: Path) -> IngestedPaper:
    pid = paper_id(pdf_path)
    out_dir = CACHE_DIR / pid
    cached = out_dir / "ingest.json"
    if cached.exists():
        return IngestedPaper.model_validate_json(cached.read_text())

    out_dir.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open(pdf_path)
    pages, figures, hidden = [], [], 0

    for i, page in enumerate(doc, start=1):
        text, dropped = _visible_text(page)
        hidden += dropped
        pages.append(Page(number=i, text=text))

        captions = [ln.strip() for ln in text.splitlines() if CAPTION_RE.match(ln)]
        if len(figures) < MAX_FIGURE_PAGES and _page_has_figure(page, captions):
            img_path = out_dir / f"page-{i:03d}.png"
            page.get_pixmap(dpi=FIGURE_DPI).save(img_path)
            figures.append(Figure(id=f"fig-p{i}", page=i, image_path=str(img_path.relative_to(ROOT)), captions=captions))

    paper = IngestedPaper(
        id=pid,
        title=unicodedata.normalize("NFKC", _guess_title(doc)),   # turns print ligatures like ﬀ into ff
        source_file=pdf_path.name,
        page_count=doc.page_count,
        pages=pages,
        figures=figures,
        hidden_chars=hidden,
    )
    cached.write_text(paper.model_dump_json(indent=2))
    return paper


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        p = ingest(paper_path(arg))   # only files inside data/papers
        chars = sum(len(pg.text) for pg in p.pages)
        print(json.dumps({
            "id": p.id, "title": p.title, "pages": p.page_count,
            "chars": chars, "figure_pages": [f.page for f in p.figures],
            "captions": sum(len(f.captions) for f in p.figures), "hidden_chars": p.hidden_chars,
        }))
