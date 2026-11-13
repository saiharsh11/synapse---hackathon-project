"""The Filter and the Relater.

Filter: looks at every idea, in plain words, from every paper and picks the pairs across papers most
likely to be really related, with a reason. Pairs within one paper are never considered.

Relater: reads both papers for one shortlisted pair and writes the full relationship: what kind it is,
how each paper says it, how the parts map onto each other, its limits, how a researcher could use it,
and quotes from both papers. Every quote is checked word for word; a link needs at least one found
quote from each paper, or it is dropped.
"""
from typing import Literal

from pydantic import BaseModel, Field

from backend.config import SPARK
from backend.guard.policy import RULES, as_data
from backend.llm import Budget, ask
from backend.pipeline.quotes import find_quote
from backend.schemas import IngestedPaper

MAX_PAIRS = 5             # links the Relater writes up per run
PAPER_CHARS = 15_000      # of each paper, for the Relater


class Pair(BaseModel):
    a: str = Field(description="Idea id from one paper")
    b: str = Field(description="Idea id from a different paper")
    why: str = Field(description="One plain sentence: what they might share", max_length=240)


class Shortlist(BaseModel):
    approach: list[str] = Field(description="2 to 4 short plain steps: how you compared the ideas and chose", min_length=1, max_length=4)
    pairs: list[Pair] = Field(max_length=MAX_PAIRS + 4)


FILTER = RULES + f"""
You are the Filter. Below is every key idea from several papers, each rewritten in plain words.
Pick up to {MAX_PAIRS} pairs of ideas from DIFFERENT papers that are most likely to be really related:
the same mechanism, a method one could borrow from the other, one answering the other's open question,
or a real disagreement. Ignore pairs that only share a word. Pick at most one pair for any two papers.
Strongly prefer pairs from papers in different fields: those are the links Synapse exists to find.
If nothing is worth checking, return an empty list."""


def shortlist(ideas: list[dict], budget: Budget) -> tuple[list[dict], list[str]]:
    """ideas: [{id, paper, field, plain, pattern}]. Returns valid cross-paper pairs, best first, and how it chose."""
    listing = "\n".join(f"- {i['id']} [{i['field']}] {i['plain']} (pattern: {i['pattern']})" for i in ideas)
    s: Shortlist = ask("filter", SPARK, FILTER, as_data("ideas", listing), Shortlist, budget, about=["key ideas the Reader wrote"], effort="low")
    paper_of = {i["id"]: i["paper"] for i in ideas}
    field_of = {i["paper"]: i["field"].strip().lower() for i in ideas}
    seen, out = set(), []
    for p in s.pairs:
        if p.a in paper_of and p.b in paper_of and paper_of[p.a] != paper_of[p.b]:
            key = frozenset((paper_of[p.a], paper_of[p.b]))   # one link per pair of papers
            if key not in seen:
                seen.add(key)
                out.append({"a": p.a, "b": p.b, "why": p.why})
    # pairs across different fields first, keeping the model's order otherwise
    out.sort(key=lambda c: field_of[paper_of[c["a"]]] == field_of[paper_of[c["b"]]])
    return out[:MAX_PAIRS], s.approach


class Match(BaseModel):
    in_a: str = Field(max_length=120)
    in_b: str = Field(max_length=120)


class Quote(BaseModel):
    text: str = Field(description="Copied word for word from that paper, at least 8 words", max_length=400)


class Link(BaseModel):
    type: Literal["same_mechanism", "borrow_method", "answers_gap", "disagree", "builds_on", "none"] = Field(
        description="same_mechanism: both describe the same mechanism; borrow_method: one's method can be used on the other's problem; "
                    "answers_gap: one has what the other says is missing; disagree: they make conflicting claims; "
                    "builds_on: one extends the other; none: not really related")
    headline: str = Field(description="One short, plain, specific sentence a newcomer would understand", max_length=110)
    pattern: str = Field(description="The shared pattern in 2 to 4 words", max_length=50)
    relation: str = Field(description="The relationship in under 10 words", max_length=80)
    in_a: str = Field(description="How paper A shows it, in one plain sentence", max_length=300)
    in_b: str = Field(description="How paper B shows it, in one plain sentence", max_length=300)
    shared: str = Field(description="What they share, in one or two plain sentences", max_length=400)
    mapping: list[Match] = Field(description="2 to 5 pairs: a part in paper A and the part in paper B that plays the same role", max_length=6)
    why: str = Field(description="A short paragraph explaining why the link holds", max_length=900)
    limits: list[str] = Field(description="1 to 3 honest limits of the comparison", max_length=4)
    use: list[str] = Field(description="2 or 3 concrete ways a researcher could use this link", max_length=4)
    for_you: str = Field(description="One sentence: the single most useful thing a researcher can do with this", max_length=240)
    cite_as: str = Field(description="One sentence for a related-work section, citing the papers as [A] and [B]", max_length=360)
    question: str = Field(description="One research question this link raises", max_length=240)
    quotes_a: list[Quote] = Field(description="1 to 3 quotes from paper A that support the link", max_length=3)
    quotes_b: list[Quote] = Field(description="1 to 3 quotes from paper B that support the link", max_length=3)
    strength: float = Field(description="0 to 1: how strong and specific the link is", ge=0, le=1)


RELATER = RULES + """
You are the Relater. Two papers from possibly different fields are below, with an idea from each that
another step thought might be related. Read both and decide honestly. If they only share vocabulary,
answer type 'none'. Otherwise explain the relationship for a researcher who knows neither field.
Use only the two papers. Quotes must be copied word for word, each at least 8 words; never paraphrase
inside a quote."""


def relate(a: IngestedPaper, b: IngestedPaper, idea_a: dict, idea_b: dict, short_a: str, short_b: str, budget: Budget) -> tuple[dict | None, str]:
    """Write up one candidate link. Returns (link, why), or (None, why not) if it isn't real or its quotes can't be found."""
    text = lambda p: "\n\n".join(f"[page {pg.number}]\n{pg.text}" for pg in p.pages)[:PAPER_CHARS]
    focus = f"Idea in paper A ({short_a}): {idea_a['label']}. {idea_a['says']}\nIdea in paper B ({short_b}): {idea_b['label']}. {idea_b['says']}"
    user = "\n\n".join([as_data("paper A", text(a)), as_data("paper B", text(b)), as_data("ideas to compare", focus)])
    l: Link = ask("relater", SPARK, RELATER, user, Link, budget, about=[a.source_file, b.source_file], effort="low")
    if l.type == "none":
        return None, l.why
    evidence = []
    for side, paper, quotes in (("a", a, l.quotes_a), ("b", b, l.quotes_b)):
        for q in quotes:
            page = find_quote(paper, q.text)
            if page is not None:
                evidence.append({"side": side, "text": q.text, "page": page, "verified": True})
    if not any(e["side"] == "a" for e in evidence) or not any(e["side"] == "b" for e in evidence):
        return None, "Its quotes couldn't all be found word for word in the papers, so it was dropped."
    out = l.model_dump(exclude={"quotes_a", "quotes_b", "mapping"})
    out["mapping"] = [[m.in_a, m.in_b] for m in l.mapping]
    out["cite_as"] = l.cite_as.replace("[A]", f"[{short_a}]").replace("[B]", f"[{short_b}]")
    out["evidence"] = evidence
    return out, l.why
