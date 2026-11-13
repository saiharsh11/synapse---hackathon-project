"""Point at the proof: show the figure a quote comes from, with the things it talks about outlined.

1. Code finds the figure on the quote's page from the PDF's own layout (its images and drawings,
   placed relative to the "Figure N" caption) and cuts it out. No model involved.
2. Muse Spark names, from the quote and the caption, one real object the figure shows (a car, a
   cell, a colony), or "none" for charts and plots of abstract quantities.
3. SAM 3.1 finds that object in the cut-out; the page draws its boxes over the figure.
SAM finds objects, not charts (tested 2026-10-30), so charts are shown without outlines.

Only where the paper's licence allows showing its figures (CC BY copies, listed below) or the paper
is the person's own upload. Only the cut-out goes to SAM; it's kept next to the paper's other files.
"""
import re

import pymupdf
from pydantic import BaseModel, Field

from backend.config import ADDED_DIR, CACHE_DIR, ENV, FIGURE_DPI, PAPERS_DIR, SPARK
from backend.guard.policy import RULES, as_data
from backend.guard.screen import matches
from backend.llm import Budget, ask, segment
from backend.schemas import IngestedPaper

# public PDFs whose licence lets us show their figures (e.g. CC BY), listed by file name in .env;
# a person's own PDFs are always allowed
FIGURES_ALLOWED = {f.strip() for f in ENV.get("SYNAPSE_FIGURES_ALLOWED", "").split(",") if f.strip()}
MIN_SHARE, MAX_SHARE = .04, .85        # a figure covers a real part of the page, not all of it
_CAPTION = re.compile(r"^\s*(fig\.?|figure)\s*\d+", re.I)


def allowed(paper: IngestedPaper, public: bool) -> bool:
    return paper.source_file in FIGURES_ALLOWED or not public


def _pdf(paper: IngestedPaper):
    pdf = PAPERS_DIR / paper.source_file
    if not pdf.exists():
        pdf = next(ADDED_DIR.glob(f"{paper.id}*.pdf"), None)   # an upload
    return pdf


def _figure_rect(page: pymupdf.Page) -> pymupdf.Rect | None:
    """The main figure on a page: its largest picture, or else the drawings above a caption."""
    area = page.rect.width * page.rect.height
    ok = lambda r: MIN_SHARE <= (r.width * r.height) / area <= MAX_SHARE
    pictures = [pymupdf.Rect(i["bbox"]) for i in page.get_image_info() if ok(pymupdf.Rect(i["bbox"]))]
    if pictures:
        return max(pictures, key=lambda r: r.width * r.height)
    captions = [pymupdf.Rect(b[:4]) for b in page.get_text("blocks") if _CAPTION.match(b[4] or "")]
    shapes = [d["rect"] for d in page.get_drawings() if d["rect"].width > 4 and d["rect"].height > 4 and d["rect"].width < page.rect.width * .98]
    if not captions or not shapes:
        return None
    cap = captions[0]
    above = [r for r in shapes if r.y1 <= cap.y0 + 2]
    if not above:
        return None
    box = pymupdf.Rect(above[0])
    for r in above[1:]:
        box |= r
    box = box & page.rect
    return box if ok(box) else None


class Thing(BaseModel):
    thing: str = Field(description="One real, visible object in singular, 1 to 3 words (e.g. 'car', 'bacterial colony'), or 'none'", max_length=30)


THING = RULES + """
A quote from a paper refers to a figure. From the quote and the figure's caption, name ONE real,
physical object that the figure shows and the quote is about, as a short singular noun phrase
(e.g. 'car', 'cell', 'firefly'). If the figure is a chart, graph, plot, table or diagram of abstract
quantities, answer 'none'."""


def cut_figure(paper: IngestedPaper, page_no: int, quote: str, budget: Budget) -> dict | None:
    """Returns the figure for one quote's page, with SAM's outlines when it shows real objects."""
    if not any(f.page == page_no for f in paper.figures):
        return None                                    # no figure on that page
    pdf = _pdf(paper)
    if not pdf:
        return None
    with pymupdf.open(pdf) as doc:
        page = doc[page_no - 1]
        rect = _figure_rect(page)
        if rect is None:
            return None
        pix = page.get_pixmap(dpi=FIGURE_DPI, clip=rect)
    out = CACHE_DIR / paper.id / f"fig-p{page_no:03d}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    pix.save(out)
    captions = next((f.captions for f in paper.figures if f.page == page_no), [])
    caption = (captions[0] if captions else f"Figure on page {page_no}")[:200]
    fig = {"src": f"/api/figure/{paper.id}/{page_no}", "page": page_no, "caption": caption, "alt": caption,
           "w": pix.width, "h": pix.height, "boxes": [], "thing": None, "by": "pdf"}
    try:
        t: Thing = ask("figures", SPARK, THING, as_data("quote and caption", f"Quote: {quote}\nCaption: {caption}"), Thing, budget,
                       about=[paper.source_file], effort="low")
        thing = t.thing.strip().lower()
        if thing and thing != "none" and not matches(thing):
            boxes = segment("figures", pix.tobytes("png"), thing, budget, about=[paper.source_file])[:40]
            if boxes:
                fig.update(boxes=[list(b) for b in boxes], thing=thing, by="sam-3.1")
    except Exception:
        pass                                           # the figure still shows, without outlines
    return fig
