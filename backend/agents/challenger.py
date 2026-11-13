"""The Challenger: tries to break a proposed link between two papers before anyone sees it.

It asks the same five questions of every link and writes out its reasoning for each, so the person
can see why a link survived or fell. Only these written steps are shown; the model's raw working is
not kept or shown, since it is unedited and unscreened. Any quote it leans on is checked word for word against the
paper; a quote that isn't there is dropped and counted. One failed question rejects the link.

Runs on Muse Spark Open (Baseten), a different model from the one that proposed the link, so it
isn't marking its own work. That key is a sponsor's, so only public papers are sent; a link that
involves someone's own PDF is challenged by Muse Wonder instead (still not the model that proposed it).
"""
import re
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

from backend.config import SPARK_OPEN, WONDER
from backend.guard.policy import RULES, as_data, screen_output
from backend.llm import Budget, ask
from backend.pipeline.quotes import find_quote
from backend.schemas import IngestedPaper

# The five questions, in the order shown. Wording is what the person reads.
QUESTIONS = {
    "words": "Is it just similar words?",
    "assumptions": "Do the assumptions carry over?",
    "evidence": "Do the quotes say what the link claims?",
    "counter": "Is there a counter-example?",
    "obvious": "Is it too obvious to matter?",
}

EXCERPT_CHARS = 9000   # per paper: title, abstract, introduction; keeps each call small


class Quote(BaseModel):
    paper: Literal["A", "B"]
    text: str = Field(description="Copied word for word from that paper, at least 8 words", max_length=400)


class Attack(BaseModel):
    reasoning: list[Annotated[str, StringConstraints(max_length=320)]] = Field(description="2 to 4 short steps, in plain words, showing how you reached the verdict", min_length=1, max_length=5)
    verdict: Literal["pass", "caveat", "fail"] = Field(description="pass: the link holds up; caveat: it holds with a limit worth knowing; fail: the link doesn't hold")
    answer: str = Field(description="One plain sentence a newcomer can follow", max_length=320)
    quotes: list[Quote] = Field(default_factory=list, description="Quotes your reasoning relies on, if any", max_length=3)


class Challenge(BaseModel):
    # one required field per question, so a valid answer can't skip any
    words: Attack
    assumptions: Attack
    evidence: Attack
    counter: Attack
    obvious: Attack
    summary: str = Field(description="One or two plain sentences for a newcomer: does the link hold, and what is its main limit?", max_length=480)


SYSTEM = RULES + """
You are the Challenger. Another model proposed a link between paper A and paper B. Your job is to
try to break it, honestly. Do not be agreeable: a link that only shares vocabulary must fail.
Judge the link as stated, between these two papers. It does not need to hold in every possible case:
answer 'fail' only if the stated claim is false or unsupported by the papers; use 'caveat' for a real
limit or difference that leaves the claim standing.
The quotes offered as evidence were already checked word for word against the full papers by code,
even if they come from parts of a paper not shown to you. Judge whether they support the claim.
Answer each of these, once, in this order:
""" + "\n".join(f"- {k}: {q}" for k, q in QUESTIONS.items()) + """
For each, write your reasoning as short steps a first-year student could follow, then the verdict.
Use only the two papers' text: do not bring in facts, dates, other papers or people from outside them. If you quote, copy the words exactly; never paraphrase inside a quote.
Reply with one JSON object only, no other text, with exactly these fields:
{"words": ATTACK, "assumptions": ATTACK, "evidence": ATTACK, "counter": ATTACK, "obvious": ATTACK, "summary": "..."}
where each ATTACK is {"reasoning": ["step", ...], "verdict": "pass" | "caveat" | "fail", "answer": "...", "quotes": [{"paper": "A" | "B", "text": "..."}]}"""


def _excerpt(p: IngestedPaper) -> str:
    return "\n".join(pg.text for pg in p.pages)[:EXCERPT_CHARS]


def _link_text(link: dict) -> str:
    lines = [f"Proposed link: {link['headline']}", f"In paper A: {link['in_a']}", f"In paper B: {link['in_b']}",
             f"What they share: {link['shared']}", "Quotes offered as evidence (each found word for word in its paper):"]
    lines += [f'- from paper {e["side"]}, page {e.get("page", "?")}: "{e["text"]}"' for e in link["evidence"]]
    return "\n".join(lines)


def challenge(a: IngestedPaper, b: IngestedPaper, link: dict, budget: Budget, *, public: bool = True) -> dict:
    """Challenge one link. Returns the `challenge` block the site shows, plus a pass/fail status."""
    # a different model from the one that proposed the link; the sponsor's key only ever sees public papers
    model = SPARK_OPEN if public else WONDER
    user = "\n\n".join([as_data("paper A", _excerpt(a)), as_data("paper B", _excerpt(b)), as_data("link", _link_text(link))])
    try:
        c = ask("challenger", model, SYSTEM, user, Challenge, budget, public_only=public, about=[a.source_file, b.source_file])
    except RuntimeError:
        # no usable answer: the link is never passed by default
        return {"status": "unchecked", "challenge": {"passed": 0, "total": len(QUESTIONS), "final_judge": False, "model": model,
                "summary": "The challenger couldn't give a complete answer, so this link hasn't been checked.", "attacks": [], "quotes_dropped": 0}}

    attacks, dropped = [], 0
    for key, question in QUESTIONS.items():
        at: Attack = getattr(c, key)
        quotes = []
        for q in at.quotes:
            page = find_quote(a if q.paper == "A" else b, q.text)
            if page is None:
                dropped += 1
            else:
                quotes.append({"paper": q.paper, "text": q.text, "page": page, "verified": True})
        attacks.append({"verdict": at.verdict, "question": question, "answer": at.answer, "reasoning": [re.sub(r"^\s*step\s*\d+\s*[:.)-]\s*", "", r, flags=re.I) for r in at.reasoning], "quotes": quotes})

    # nothing a model wrote is shown until the content check passes (fails closed)
    written = [c.summary] + [x["answer"] for x in attacks] + [r for x in attacks for r in x["reasoning"]]
    held = screen_output("\n".join(written), budget)
    if held:
        return {"status": "held", "challenge": {"passed": 0, "total": len(QUESTIONS), "final_judge": False, "model": model,
                "summary": held, "attacks": [], "quotes_dropped": 0}}
    return {
        "status": "rejected" if any(x["verdict"] == "fail" for x in attacks) else "survived",
        "challenge": {
            "passed": sum(x["verdict"] == "pass" for x in attacks),
            "total": len(attacks),
            "final_judge": False,
            "model": model,
            "summary": c.summary,
            "attacks": attacks,
            "quotes_dropped": dropped,
        },
    }
