"""Web page -> visible text. Local only, no API calls, nothing on the page is run.

Only what a reader would see is kept: scripts, styles, forms and anything marked hidden are dropped,
so text that is invisible on the page can't carry instructions to the models.
"""
import hashlib
import re
from html.parser import HTMLParser

from backend.schemas import IngestedPaper, Page

_SKIP = {"script", "style", "noscript", "template", "svg", "canvas", "iframe", "object", "head", "form", "button", "select", "nav", "footer"}
_VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
_BLOCK = {"p", "div", "section", "article", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "br", "blockquote", "pre", "figcaption", "dd", "dt"}
_HIDDEN_STYLE = re.compile(r"display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(\.0+)?\s*(;|$)|font-size\s*:\s*0|left\s*:\s*-\d{3,}", re.I)
PAGE_CHARS = 4000   # split long pages into "pages" so quotes can point somewhere


def _hidden(attrs: dict) -> bool:
    return ("hidden" in attrs or attrs.get("aria-hidden") == "true"
            or bool(_HIDDEN_STYLE.search(attrs.get("style") or "")))


class _Visible(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack: list[int] = []     # per open element: 0 shown, 1 not page text (script, nav...), 2 hidden
        self.out: list[str] = []
        self.title = ""
        self._in_title = False
        self.dropped = 0

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self._in_title = True
        if tag in _VOID:
            if tag == "br":
                self.out.append("\n")
            return
        self.stack.append(2 if _hidden(dict(attrs)) else 1 if tag in _SKIP else 0)
        if tag in _BLOCK:
            self.out.append("\n")

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        if tag in _VOID:
            return
        if self.stack:
            self.stack.pop()
        if tag in _BLOCK:
            self.out.append("\n")

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        if 2 in self.stack:
            self.dropped += len(data.strip())   # text a reader can't see: counted, never read
        elif not any(self.stack):
            self.out.append(data)


def read_page(html: bytes, url: str) -> IngestedPaper:
    p = _Visible()
    p.feed(html.decode("utf-8", errors="replace"))
    text = re.sub(r"[ \t\r\f\v]+", " ", "".join(p.out))
    text = re.sub(r"\n\s*\n+", "\n\n", text).strip()
    chunks = [text[i:i + PAGE_CHARS] for i in range(0, len(text), PAGE_CHARS)] or [""]
    return IngestedPaper(
        id=hashlib.sha256(html).hexdigest()[:12],
        title=re.sub(r"\s+", " ", p.title).strip() or url,
        source_file=url,
        page_count=len(chunks),
        pages=[Page(number=i + 1, text=c) for i, c in enumerate(chunks)],
        figures=[],
        hidden_chars=p.dropped,
    )
