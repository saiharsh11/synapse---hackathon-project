"""One reading run: from a set of papers to the map the site shows.

Screen -> Reader -> Translator -> Filter -> Relater -> Challenger -> content check -> final judge -> Planner.
Each step reports progress through `say(agent, state, text)`, so the site can show the agents at work.
The result has the same shape as frontend/data/run.json. Nothing from a paper reaches the
result unless it passed the checks: quotes found word for word, the Challenger, and the content check.
"""
import time
from concurrent.futures import ThreadPoolExecutor

from backend.agents.challenger import challenge
from backend.agents.figures import allowed as figure_allowed, cut_figure
from backend.agents.judge import TOP as JUDGE_TOP, judge
from backend.agents.planner import MAX_IDEAS, check_novelty, not_searched, plan
from backend.agents.reader import read, translate
from backend.agents.relater import relate, shortlist
from backend.guard.policy import check_source, screen_output
from backend.config import SPARK, WONDER
from backend.llm import Budget, OverBudget
from backend.schemas import IngestedPaper

WORKERS = 4   # agent calls running side by side


class RunError(RuntimeError):
    """A problem the person should see, in plain words."""


def _texts(*parts) -> str:
    out = []
    for p in parts:
        if isinstance(p, str):
            out.append(p)
        elif isinstance(p, list):
            out += [_texts(x) for x in p]
        elif isinstance(p, dict):
            out += [_texts(v) for k, v in p.items() if k not in ("id", "url", "paper", "a", "b", "type", "page", "verified", "side")]
    return "\n".join(x for x in out if x)


def run(sources: list[tuple[IngestedPaper, bool]], say, budget: Budget | None = None) -> dict:
    """sources: (paper, public). Returns the run, or raises OverBudget/RuntimeError with a plain message."""
    budget = budget or Budget()
    budget.agent_share = .6      # reading and linking may use 60%: the Planner gets up to 80%, checks the rest
    t0 = time.time()
    pool = ThreadPoolExecutor(WORKERS)
    work = {}   # what each agent looked at, decided and why: shown in the app under "See its work"

    # 1. screen every source before any other agent reads it
    say("Checker", "run", f"Checking {len(sources)} sources")
    def screen(item):
        paper, public = item
        return check_source("\n".join(pg.text for pg in paper.pages), budget, about=paper.source_file)
    verdicts = list(pool.map(screen, sources))
    reasons = [r for _, r in verdicts]
    work["Checker"] = {"model": SPARK, "items": [
        {"paper": paper.title, "research": v.research, "suitable": v.suitable, "instructions_for_ai": v.injection,
         "kind": v.kind, "field": v.field, "result": "passed" if r is None else r}
        for (paper, _), (v, r) in zip(sources, verdicts)]}
    kept = [s for s, r in zip(sources, reasons) if r is None]
    say("Checker", "done", f"{len(kept)} of {len(sources)} passed" + (f"; {len(sources) - len(kept)} set aside" if len(kept) < len(sources) else ""))
    if len(kept) < 2:
        raise RunError("Synapse needs at least two papers that pass the checks to find links.")

    # 2. Reader: one paper each, side by side
    say("Reader", "run", f"Reading {len(kept)} papers")
    readings = list(pool.map(lambda s: read(s[0], budget), kept))
    papers, ingested, public = [], {}, {}
    for n, ((paper, pub), r) in enumerate(zip(kept, readings), start=1):
        pid = f"P{n}"
        ideas = [{**i, "id": f"{pid}.{k}"} for k, i in enumerate(r["ideas"], start=1)]
        papers.append({"id": pid, "title": r["title"], "authors": r["authors"], "year": r["year"], "field": r["field"],
                       "category": r["category"], "short": r["short"], "summary": r["summary"], "real": True,
                       "ideas": ideas, "public": pub})
        ingested[pid], public[pid] = paper, pub
    n_ideas = sum(len(p["ideas"]) for p in papers)
    work["Reader"] = {"model": SPARK, "items": [
        {"paper": p["id"], "title": p["title"], "field": p["field"], "summary": p["summary"], "quotes_dropped": r["quotes_dropped"],
         "ideas": [{"label": i["label"], "says": i["says"], "quote": i["quote"]["text"], "page": i["quote"]["page"]} for i in p["ideas"]]}
        for p, r in zip(papers, readings)]}
    say("Reader", "done", f"Read {len(papers)} papers and found {n_ideas} key ideas, each with a quote checked word for word")

    # 3. Translator
    say("Translator", "run", f"Rewriting {n_ideas} ideas in plain words")
    flat = [{"id": i["id"], "paper": p["id"], "field": p["field"], "label": i["label"], "says": i["says"]} for p in papers for i in p["ideas"]]
    plain = translate(flat, budget)
    for i in flat:
        i.update(plain.get(i["id"], {"plain": f"{i['label']}. {i['says']}", "pattern": i["label"]}))
    work["Translator"] = {"model": SPARK, "items": [{"id": i["id"], "label": i["label"], "plain": i["plain"], "pattern": i["pattern"]} for i in flat]}
    say("Translator", "done", f"Rewrote {len(plain)} ideas in plain words")

    # 4. Filter
    pairs_possible = sum(len(a["ideas"]) * len(b["ideas"]) for k, a in enumerate(papers) for b in papers[k + 1:])
    say("Filter", "run", f"Comparing {pairs_possible} possible pairings")
    cands, approach = shortlist(flat, budget)
    work["Filter"] = {"model": SPARK, "approach": approach, "considered": pairs_possible, "items": cands}
    say("Filter", "done", f"Kept {len(cands)} of {pairs_possible} possible pairings")

    # 5. Relater
    say("Connector", "run", f"Writing up {len(cands)} possible links")
    idea_of = {i["id"]: i for p in papers for i in p["ideas"]}
    paper_of = {i["id"]: i["paper"] for i in flat}
    short = {p["id"]: p["short"] for p in papers}
    def write_up(c):
        pa, pb = paper_of[c["a"]], paper_of[c["b"]]
        try:
            l, why = relate(ingested[pa], ingested[pb], idea_of[c["a"]], idea_of[c["b"]], short[pa], short[pb], budget)
        except (RuntimeError, OverBudget):
            return None, {"a": c["a"], "b": c["b"], "outcome": "error", "why": "The model's answer couldn't be used, so this pair was skipped."}
        note = {"a": c["a"], "b": c["b"], "outcome": "link" if l else "none", "why": why}
        if l:
            l["a"], l["b"] = {"paper": pa, "idea": c["a"]}, {"paper": pb, "idea": c["b"]}
            for e in l["evidence"]:
                e["paper"] = pa if e.pop("side") == "a" else pb
            note["headline"] = l["headline"]
        return l, note
    written = list(pool.map(write_up, cands))
    links = [l for l, _ in written if l]
    work["Connector"] = {"model": SPARK, "items": [n for _, n in written]}
    for n, l in enumerate(links, start=1):
        l["id"] = f"C{n}"
    say("Connector", "done", f"Found {len(links)} relationships, each with quotes from both papers")

    # 6. Challenger, then the content check on everything that will be shown
    say("Challenger", "run", f"Trying to break {len(links)} links")
    def attack(l):
        pa, pb = l["a"]["paper"], l["b"]["paper"]
        ev = [{**e, "side": "A" if e["paper"] == pa else "B"} for e in l["evidence"]]
        res = challenge(ingested[pa], ingested[pb], {**l, "evidence": ev}, budget, public=public[pa] and public[pb])
        return l, res
    final = []
    attacked = [(l, res) for l, res in pool.map(attack, links) if res["status"] in ("survived", "rejected")]   # unchecked: not shown
    # the content check reads every link at once; only if it objects is each one checked on its own
    if attacked and screen_output("\n\n".join(_texts({**l, "challenge": res["challenge"]}) for l, res in attacked), budget):
        attacked = [(l, res) for l, res in attacked if not screen_output(_texts({**l, "challenge": res["challenge"]}), budget)]
    for l, res in attacked:
        l["challenge"] = res["challenge"]
        if res["status"] == "survived":
            l["status"] = "verified"
        else:
            l["status"], l["type"] = "rejected", "discarded"
            l["for_you"] = "Nothing to use here: the challenger showed the link doesn't hold."
        l.update(hypothesis=None, experiment=None, figure=None, verdict=None)
        final.append(l)
    kept_links = [l for l in final if l["status"] == "verified"]
    thrown = len(final) - len(kept_links)
    work["Challenger"] = {"model": "Muse Spark Open, or Muse Wonder for your own PDFs", "items": [
        {"link": l["id"], "headline": l["headline"], "status": l["status"], "passed": l["challenge"]["passed"],
         "total": l["challenge"]["total"], "summary": l["challenge"].get("summary", "")} for l in final]}
    say("Challenger", "done" if kept_links else "no", f"{len(kept_links)} held up" + (f", {thrown} thrown out" if thrown else ""))

    # 6b. Final judge: Muse Wonder gives the strongest links the last word
    budget.agent_share = .7
    top = sorted(kept_links, key=lambda l: -l["strength"])[:JUDGE_TOP]
    if top:
        say("Judge", "run", f"Muse Wonder is taking a final look at the {len(top)} strongest links")
        rulings = list(pool.map(lambda l: judge(ingested[l["a"]["paper"]], ingested[l["b"]["paper"]], l, budget), top))
        confirmed = overturned = 0
        for l, r in zip(top, rulings):
            if r is None or screen_output(_texts(r), budget):
                continue                      # no usable ruling: the link keeps its Challenger result only
            l["challenge"]["final_judge"] = True
            l["challenge"]["final"] = r
            if r["verdict"] == "reject":
                l["status"], l["type"] = "rejected", "discarded"
                l["for_you"] = "Nothing to use here: the final check showed the link doesn't hold."
                overturned += 1
            else:
                if r["verdict"] == "caveat":
                    l["limits"] = [r["word"]] + l.get("limits", [])
                confirmed += 1
        kept_links = [l for l in final if l["status"] == "verified"]
        work["Judge"] = {"model": WONDER, "items": [
            {"link": l["id"], "headline": l["headline"], **l["challenge"]["final"]} for l in top if l["challenge"].get("final")]}
        say("Judge", "done", f"Confirmed {confirmed}" + (f", overturned {overturned}" if overturned else ""))

    # 6c. Point at the proof: the figure behind a quote, outlined by SAM 3.1, where the licence allows
    jobs = []
    for l in kept_links:
        for e in l["evidence"]:
            pp = ingested[e["paper"]]
            if figure_allowed(pp, public[e["paper"]]) and any(f.page == e["page"] for f in pp.figures):
                jobs.append((l, e)); break
    jobs = jobs[:3]
    if jobs:
        say("Figures", "run", f"Finding the figures behind {len(jobs)} quote{'s' if len(jobs) > 1 else ''}")
        figs = list(pool.map(lambda le: cut_figure(ingested[le[1]["paper"]], le[1]["page"], le[1]["text"], budget), jobs))
        for (l, e), fig in zip(jobs, figs):
            if fig:
                e["figure"] = fig
        shown = [(l, f) for (l, _), f in zip(jobs, figs) if f]
        outlined = sum(1 for _, f in shown if f["boxes"])
        work["Figures"] = {"model": "PDF layout · Muse Spark 1.3 · SAM 3.1", "items": [
            {"link": l["id"], "headline": l["headline"], "page": f["page"], "caption": f["caption"], "thing": f["thing"], "outlines": len(f["boxes"])} for l, f in shown]}
        say("Figures", "done", f"Showed {len(shown)} figure{'s' if len(shown) != 1 else ''}" + (f", {outlined} outlined by SAM 3.1" if outlined else ""))

    # 7. Planner: papers to write, each checked against published work
    next_papers = []
    if kept_links:
        say("Planner", "run", "Planning a paper you could write from the links that held up")
        budget.agent_share = .8
        note = None
        try:
            plans = plan(papers, kept_links, budget)[:MAX_IDEAS]
            if not plans:
                note = "The Planner couldn't build a paper idea from these links this time."
        except OverBudget:
            plans, note = [], "Stopped at this run's spending limit. Everything before it is kept."
        except RuntimeError:
            plans, note = [], "The Planner's answer couldn't be used this time."
        if note:
            say("Planner", "no", note)
        for n, p in enumerate(plans, start=1):
            p["id"] = f"N{n}"
            # the web search is costly, so it runs when the person asks (POST /api/novelty), and never for
            # an idea that draws on someone's own (private) paper, since queries leave for the web
            private = not all(public.get(x["paper"], False) for x in p["parts"])
            p.update(not_searched(p, "Not searched, to keep your own papers private: search queries would leave for the web." if private
                                  else "Not searched yet. Press “Check if it's been done” to search flagship journals and top conferences."))
            p["searchable"] = not private
            if screen_output(_texts(p), budget):
                continue
            next_papers.append(p)                      # its search queries stay, for the search on request
        held_ideas = len(plans) - len(next_papers)
        work["Planner"] = {"model": SPARK + " with web search", "note": note or (f"{held_ideas} idea{'s were' if held_ideas > 1 else ' was'} held back by the content check." if held_ideas else ""), "items": [
            {"idea": n["id"], "title": n["title"], "reasoning": n.get("reasoning", []), "searched": n["novelty"]["searched"],
             "results_kept": n["novelty"].get("results_kept", 0), "judging": n["novelty"].get("reasoning", []), "state": n["novelty"]["state"]}
            for n in next_papers]}
        if plans:
            say("Planner", "done", f"Suggested {len(next_papers)} idea{'s' if len(next_papers) != 1 else ''} for a paper you could write")

    else:
        work["Planner"] = {"model": SPARK, "note": "No links held up, so there was nothing to plan a paper from.", "items": []}
    pool.shutdown()
    # the agents' written work is model output too: it passes the content check before it can be shown
    for agent in ("Reader", "Translator", "Filter", "Connector"):
        if agent in work and (why := screen_output(_texts(work[agent]), budget)):
            work[agent] = {"model": work[agent]["model"], "held": True, "why": why}   # which check held it, never the text
    for p in papers:
        p["ideas"] = [{"id": i["id"], "label": i["label"]} for i in p["ideas"]]
    return {
        "schema": 1,
        "run": {"title": f"{len(papers)} papers, {len({p['field'] for p in papers})} fields", "illustrative": False,
                "cost_usd": round(budget.spent, 2), "seconds": int(time.time() - t0),
                "funnel": {"papers": len(papers), "ideas": n_ideas, "pairs": pairs_possible, "shortlisted": len(cands),
                           "proposed": len(links), "survived": len(kept_links), "tested": 0}},
        "papers": papers,
        "connections": final,
        "candidates": [{"a": c["a"], "b": c["b"]} for c in cands],
        "next_papers": next_papers,
        "work": work,
    }
