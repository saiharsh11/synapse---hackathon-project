"""The Planner: turns the links that held up into papers someone could write, then checks each one
against published work before calling it new.

1. Plan: from the surviving links, propose up to two papers: the question, what each source paper
   gives, an outline, risks, a first step, and the searches that would show if it's been done.
2. Search: Muse Spark searches the web (search() in llm.py) with those queries.
3. Judge: a separate call compares the idea with what the search returned and says plainly whether
   it is new, partly done or already done. It may only point to results the search actually returned,
   in flagship journals or the main track of a top conference; anything else is dropped by code. Reading suggestions follow the same rule.
"""
from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

from backend.config import SPARK
from backend.guard.policy import RULES, as_data, screen_output
from backend.guard.screen import matches
from backend.guard.sources import is_top_venue
from backend.llm import Budget, ask, search

MAX_IDEAS = 1


class Part(BaseModel):
    paper: str = Field(description="Paper id, e.g. P2")
    role: Literal["Method", "Data", "Open question", "Mechanism", "Test case", "Counterpoint"]
    why: str = Field(description="What it gives the new paper, in under 12 words", max_length=100)
    detail: str = Field(description="Two plain sentences: exactly how the new paper uses it", max_length=360)


class Section(BaseModel):
    section: str = Field(max_length=40)
    text: str = Field(description="One or two plain sentences", max_length=360)
    cites: list[str] = Field(description="Paper ids this section draws on", max_length=6)


class NewPaper(BaseModel):
    reasoning: list[str] = Field(description="2 to 4 short plain steps: how you built this idea from the links", min_length=1, max_length=4)
    title: str = Field(max_length=120)
    pitch: str = Field(description="Two or three plain sentences: what the paper would do", max_length=500)
    question: str = Field(description="The research question, in one sentence", max_length=240)
    contribution: str = Field(description="What would be new, before any search: one or two sentences, no claims of novelty", max_length=360)
    parts: list[Part] = Field(min_length=2, max_length=5)
    links: list[str] = Field(description="Ids of the links it builds on", max_length=6)
    outline: list[Section] = Field(min_length=3, max_length=6)
    risks: list[str] = Field(min_length=1, max_length=3)
    next_step: str = Field(description="The first concrete thing to do, in one sentence", max_length=240)
    searches: list[str] = Field(description="3 to 5 short search queries that would find this work if it already exists", min_length=2, max_length=5)


class Plans(BaseModel):
    papers: list[NewPaper] = Field(max_length=MAX_IDEAS)


PLANNER = RULES + f"""
You are the Planner. Below are papers and the links between them that survived checking.
Propose up to {MAX_IDEAS} papers a researcher could write by combining these links: specific, doable,
and useful to both fields. Use only these papers and links. Don't call anything new or novel: a later
step searches published work first. Write plainly for a graduate student."""


def plan(papers: list[dict], links: list[dict], budget: Budget) -> list[dict]:
    """papers: map entries with ids; links: surviving links with ids. Returns plans with valid ids only."""
    listing = "\n".join(f"- {p['id']}: {p['short']} ({p['field']}). {p.get('summary', '')}" for p in papers)
    listing += "\n\nLinks:\n" + "\n".join(f"- {l['id']} between {l['a']['paper']} and {l['b']['paper']} ({l['type']}): {l['headline']}. {l['shared']}" for l in links)
    out: Plans = ask("planner", SPARK, PLANNER, as_data("papers and links", listing), Plans, budget, about=["summaries and links the other agents wrote"], effort="low")
    pids, lids = {p["id"] for p in papers}, {l["id"] for l in links}
    plans = []
    for n in out.papers:
        d = n.model_dump()
        d["parts"] = [x for x in d["parts"] if x["paper"] in pids]
        d["links"] = [x for x in d["links"] if x in lids]
        for s in d["outline"]:
            s["cites"] = [x for x in s["cites"] if x in pids]
        if len(d["parts"]) >= 2 and d["links"]:
            plans.append(d)
    return plans


class Closest(BaseModel):
    url: str = Field(description="Exactly one of the result URLs listed")
    covers: str = Field(description="Which part of the idea this work already covers, in one sentence", max_length=240)


class Reading(BaseModel):
    url: str = Field(description="Exactly one of the result URLs listed")
    why: str = Field(description="Why to read it for this paper, in one sentence", max_length=240)


class Verdict(BaseModel):
    reasoning: list[str] = Field(description="2 to 4 short plain steps: how you compared the idea with the results", min_length=1, max_length=4)
    state: Literal["new", "partly", "known"] = Field(description="new: nothing found does this; partly: parts are published; known: it has been done")
    note: str = Field(description="Two or three plain sentences: what is already published and what isn't", max_length=500)
    contribution: str = Field(description="What would honestly be new, given the search, in one or two sentences", max_length=360)
    closest: list[Closest] = Field(description="Up to 4 results closest to the idea", max_length=4)
    read_next: list[Reading] = Field(description="Up to 3 results most worth reading next", max_length=3)


JUDGE = RULES + """
You compare a proposed paper with what a literature search found. Be strict and honest: if a result
already does part of it, say so. Refer to results only by their exact URL from the list. If the list
is empty or off-topic, say the search found nothing close, which is not proof that it's new."""


def not_searched(idea: dict, why: str) -> dict:
    """The novelty block when no search may run. Never 'new': unchecked."""
    return {"novelty": {"state": "unchecked", "note": why, "searched": [], "closest": [], "checked": "Not searched", "reasoning": [], "results_kept": 0},
            "contribution": idea.get("contribution", ""), "read_next": []}


def check_novelty(idea: dict, budget: Budget) -> dict:
    """Search, then judge. Returns the `novelty` and `read_next` blocks the site shows.
    Callers must not use this for ideas built on someone's own papers: queries leave for the web."""
    found, seen = [], set()
    queries = [q for q in idea["searches"][:3] if not matches(q)]   # a query touching a listed topic is never sent
    results = []
    if queries:
        # one search per idea: each search pulls a lot of web text into the model, so they are costly
        try:
            _, results = search("planner-search", "Find published papers on any of these: " + "; ".join(queries), budget)
        except Exception:
            results = []
    for r in results:
        # flagship journals and top conferences only, and nothing touching a listed topic, before any agent sees it
        if r["url"] not in seen and is_top_venue(r["url"]) and not matches(f"{r['title']} {r['snippet']}"):
            seen.add(r["url"]); found.append(r)
    found = found[:24]
    if found and screen_output("\n".join(f"{r['title']}. {r['snippet']}" for r in found), budget):
        found = []                                     # anything doubtful in the results: use none of them
    listing = "\n".join(f"- {r['url']} | {r['title']} | {r['snippet']}" for r in found[:24]) or "(no results from top journals or conferences)"
    idea_text = f"Title: {idea['title']}\nQuestion: {idea['question']}\nPitch: {idea['pitch']}"
    v: Verdict = ask("planner-judge", SPARK, JUDGE, as_data("proposed paper", idea_text) + "\n\n" + as_data("search results", listing), Verdict, budget, about=["the proposed paper and search results"], effort="low")
    by_url = {r["url"]: r for r in found}
    closest = [{"title": by_url[c.url]["title"] or c.url, "url": c.url, "covers": c.covers} for c in v.closest if c.url in by_url]
    read_next = [{"title": by_url[r.url]["title"] or r.url, "url": r.url, "why": r.why} for r in v.read_next if r.url in by_url]
    state = v.state if found else "unchecked"   # no results means not checked, never "new"
    return {
        "novelty": {"state": state, "note": v.note, "searched": queries, "closest": closest,
                    "checked": f"Searched by Muse Spark on {date.today():%b %-d, %Y}", "reasoning": v.reasoning,
                    "results_kept": len(found)},
        "contribution": v.contribution,
        "read_next": read_next,
    }


# ---------- a person's own idea ----------

class MinePlan(NewPaper):
    pushback: list[Part] = Field(default_factory=list, description="Papers whose findings push back on the idea, if any", max_length=4)
    missing: list[str] = Field(description="What none of these papers gives the idea, in short plain phrases", min_length=1, max_length=4)


MINE = RULES + """
You are the Planner. A researcher describes a paper they want to write. Using only the papers and links
below, show how they could write it: which papers support it and how, which methods they could borrow,
which papers push back, and what is missing. Keep their idea; don't replace it with a different one.
Don't call anything new or novel: a later step searches published work first. Write plainly."""


def plan_mine(text: str, field: str, papers: list[dict], links: list[dict], budget: Budget) -> dict | None:
    listing = "\n".join(f"- {p['id']}: {p['short']} ({p['field']}). {p.get('summary', '')}" for p in papers)
    listing += "\n\nLinks:\n" + ("\n".join(f"- {l['id']} between {l['a']['paper']} and {l['b']['paper']} ({l['type']}): {l['headline']}" for l in links) or "(none)")
    idea = f"Field: {field or 'not given'}\nIdea: {text}"
    m: MinePlan = ask("planner-mine", SPARK, MINE, as_data("the researcher's idea", idea) + "\n\n" + as_data("papers and links", listing), MinePlan, budget,
                      about=["the idea you typed", "summaries and links the other agents wrote"])
    pids, lids = {p["id"] for p in papers}, {l["id"] for l in links}
    d = m.model_dump()
    d["parts"] = [x for x in d["parts"] if x["paper"] in pids]
    d["pushback"] = [x for x in d["pushback"] if x["paper"] in pids]
    d["links"] = [x for x in d["links"] if x in lids]
    for s in d["outline"]:
        s["cites"] = [x for x in s["cites"] if x in pids]
    return d if d["parts"] else None


# ---------- the research blueprint: the study as stages the page draws ----------

class Stage(BaseModel):
    id: str = Field(description="A short id, e.g. d1, m1, t1, r1")
    kind: Literal["data", "method", "test", "result"]
    title: str = Field(max_length=40)
    note: str = Field(description="One short plain sentence", max_length=120)
    papers: list[str] = Field(description="Paper ids this stage draws on", max_length=4)
    new: bool = Field(default=False, description="True for the stage that is the new contribution")


class Flow(BaseModel):
    a: str
    b: str


class Blueprint(BaseModel):
    stages: list[Stage] = Field(min_length=4, max_length=10)
    flows: list[Flow] = Field(max_length=16)
    unique: str = Field(description="In one or two plain sentences: what makes this study the researcher's own, given the search", max_length=280)


BLUEPRINT = RULES + """
Design the study this paper idea leads to, as stages: the data each source gives (data), the methods
(method), the tests (test) and the result (result). Mark the one stage that is new. Flows connect stages
in the order work moves through them. Use only the papers given. Short, plain titles."""


def blueprint(idea: dict, papers: list[dict], budget: Budget) -> dict | None:
    pids = {p["id"] for p in papers}
    text = (f"Title: {idea['title']}\nQuestion: {idea['question']}\nPitch: {idea['pitch']}\nWhat would be new: {idea.get('contribution', '')}\n"
            "Sources:\n" + "\n".join(f"- {x['paper']} ({x['role']}): {x['detail']}" for x in idea.get("parts", [])))
    b: Blueprint = ask("blueprint", SPARK, BLUEPRINT, as_data("paper idea", text), Blueprint, budget, about=["a paper idea the agents wrote"])
    ids = {s.id for s in b.stages}
    stages = [{**s.model_dump(), "papers": [x for x in s.papers if x in pids]} for s in b.stages]
    flows = [[f.a, f.b] for f in b.flows if f.a in ids and f.b in ids and f.a != f.b]
    if not any(s["kind"] == k for s in stages for k in ("data",)) or not flows:
        return None
    return {"made_by": "Muse Spark 1.3", "stages": stages, "flows": flows, "unique": b.unique}
