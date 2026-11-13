"""The Reader and the Translator.

Reader: reads one paper and writes down what it is (title, authors, year, field) and its key ideas,
each with a quote. Every quote is checked word for word against the paper; an idea whose quote
isn't there is dropped.

Translator: rewrites every idea in plain words with the field's jargon taken out, so an idea from
ecology and one from economics can be compared on what they actually describe.
"""
from pydantic import BaseModel, Field

from backend.config import SPARK
from backend.guard.policy import RULES, as_data
from backend.llm import Budget, ask
from backend.pipeline.quotes import find_quote
from backend.schemas import IngestedPaper

READ_CHARS = 22_000    # about 6k tokens: abstract, introduction, methods and main results; keeps a run under $0.50


class Idea(BaseModel):
    label: str = Field(description="The idea in 2 to 5 plain words, lower case", max_length=60)
    says: str = Field(description="One plain sentence: what the paper says about this idea", max_length=300)
    quote: str = Field(description="A sentence copied word for word from the paper that states this idea, at least 8 words", max_length=400)


class Reading(BaseModel):
    title: str = Field(description="The paper's real title, as printed on it", max_length=300)
    authors: str = Field(description="First author's surname, plus 'et al.' if there are more", max_length=80)
    year: int | None = Field(description="Year of publication, if the paper states it")
    field: str = Field(description="The research field in one to three plain words, e.g. Ecology, Economics, Physics", max_length=40)
    category: str = Field(description="The closest arXiv category code, e.g. q-bio.PE, or 'unknown'", max_length=20)
    short: str = Field(description="A short everyday name for the paper's subject, 2 to 5 words, e.g. 'Bird flocking'", max_length=50)
    summary: str = Field(description="Two plain sentences: what the paper does and what it finds", max_length=500)
    ideas: list[Idea] = Field(description="The paper's 3 to 5 most important ideas: mechanisms, methods, findings or open questions", min_length=1, max_length=6)


READER = RULES + """
You are the Reader. Read the paper and record what it is and its most important ideas.
Choose ideas another field could recognise or use: a mechanism, a method, a finding or an open question.
For each idea, copy one sentence from the paper word for word that states it. Never paraphrase inside a quote.
Write for a newcomer: plain words, no jargon unless you explain it."""


def read(paper: IngestedPaper, budget: Budget) -> dict:
    """Read one paper. Returns its entry for the map, with only the ideas whose quotes were found."""
    text = "\n\n".join(f"[page {pg.number}]\n{pg.text}" for pg in paper.pages)[:READ_CHARS]
    r: Reading = ask("reader", SPARK, READER, as_data("paper", text), Reading, budget, about=[paper.source_file], effort="low")
    ideas, dropped = [], 0
    for idea in r.ideas:
        page = find_quote(paper, idea.quote)
        if page is None:
            dropped += 1
            continue
        ideas.append({"label": idea.label, "says": idea.says, "quote": {"text": idea.quote, "page": page}})
    return {"title": r.title, "authors": r.authors, "year": r.year, "field": r.field, "category": r.category,
            "short": r.short, "summary": r.summary, "ideas": ideas, "quotes_dropped": dropped}


class Plain(BaseModel):
    id: str
    plain: str = Field(description="The idea in one plain sentence with every field-specific word replaced by a general one", max_length=300)
    pattern: str = Field(description="The general pattern in 2 to 4 words, e.g. 'feedback loops', 'spontaneous synchronisation'", max_length=50)


class Translation(BaseModel):
    ideas: list[Plain]


TRANSLATOR = RULES + """
You are the Translator. Each idea below comes from a different field's paper. Rewrite each one so a
reader from any field would recognise what it describes: replace field-specific nouns with general
ones (a predator and a retailer both become 'something that reacts to a supply'). Keep the meaning
exact; don't make ideas sound more alike than they are. Answer for every id, once."""


def translate(ideas: list[dict], budget: Budget) -> dict[str, dict]:
    """ideas: [{id, field, label, says}]. Returns {id: {plain, pattern}} for every id the model answered."""
    listing = "\n".join(f"- {i['id']} ({i['field']}): {i['label']}. {i['says']}" for i in ideas)
    t: Translation = ask("translator", SPARK, TRANSLATOR, as_data("ideas", listing), Translation, budget, about=["key ideas the Reader wrote"], effort="low")
    known = {i["id"] for i in ideas}
    return {p.id: {"plain": p.plain, "pattern": p.pattern} for p in t.ideas if p.id in known}
