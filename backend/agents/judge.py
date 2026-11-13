"""The final judge: Muse Wonder takes a last, careful look at the strongest links.

After the Challenger, the top few links go to Muse Wonder with both papers, the link and every
verdict the Challenger gave. Wonder confirms the link, keeps it with a caveat, or rejects it. Its
answer is the last word: a rejected link is thrown out even if the Challenger let it through.
If Wonder can't give a usable answer, the link keeps its Challenger result and is not marked as
final-checked, so nothing claims a check that didn't happen.
"""
from typing import Literal

from pydantic import BaseModel, Field

from backend.config import WONDER
from backend.guard.policy import RULES, as_data
from backend.llm import Budget, ask
from backend.schemas import IngestedPaper

TOP = 1                  # links that get a final check per run (Muse Wonder costs more)
EXCERPT_CHARS = 12_000   # of each paper


class Ruling(BaseModel):
    verdict: Literal["confirm", "caveat", "reject"] = Field(
        description="confirm: the link holds as stated; caveat: it holds, with a limit the reader must know; reject: it does not hold")
    reasoning: list[str] = Field(description="2 to 4 short plain steps showing how you decided", min_length=1, max_length=4)
    word: str = Field(description="The final word for the reader, in one plain sentence", max_length=280)


SYSTEM = RULES + """
You are the final judge. A link between two papers was proposed by one model and attacked by another.
Read both papers, the link and the challenger's verdicts, and give the last word. Be strict and fair:
reject only if the stated link is false or unsupported; use caveat for a real limit that leaves it
standing. The quotes were already checked word for word by code. Use only the two papers."""


def judge(a: IngestedPaper, b: IngestedPaper, link: dict, budget: Budget) -> dict | None:
    """Returns {verdict, reasoning, word} or None if no usable answer came back."""
    text = lambda p: "\n\n".join(f"[page {pg.number}]\n{pg.text}" for pg in p.pages)[:EXCERPT_CHARS]
    ch = link.get("challenge") or {}
    lines = [f"Link: {link['headline']}", f"In paper A: {link['in_a']}", f"In paper B: {link['in_b']}", f"What they share: {link['shared']}",
             "Quotes (each found word for word):"] + [f'- p.{e["page"]}: "{e["text"]}"' for e in link.get("evidence", [])]
    lines += ["Challenger's verdicts:"] + [f"- {x['question']} {x['verdict']}: {x['answer']}" for x in ch.get("attacks", [])]
    user = "\n\n".join([as_data("paper A", text(a)), as_data("paper B", text(b)), as_data("link and challenge", "\n".join(lines))])
    try:
        r: Ruling = ask("judge", WONDER, SYSTEM, user, Ruling, budget, about=[a.source_file, b.source_file])
    except Exception:
        return None
    return {"verdict": r.verdict, "reasoning": r.reasoning, "word": r.word}
