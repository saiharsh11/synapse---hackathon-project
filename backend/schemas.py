"""Pydantic data models shared across the pipeline."""
from pydantic import BaseModel


class Page(BaseModel):
    number: int             # 1-based
    text: str


class Figure(BaseModel):
    id: str                 # e.g. "fig-p4"
    page: int
    image_path: str         # PNG render of the page that holds the figure
    captions: list[str]     # "Figure 3: ..." lines found on that page


class IngestedPaper(BaseModel):
    id: str                 # short content hash of the PDF
    title: str
    source_file: str
    page_count: int
    pages: list[Page]
    figures: list[Figure]
    hidden_chars: int = 0   # characters dropped because a reader couldn't see them
