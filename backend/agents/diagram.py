"""The link diagram: how two papers relate, drawn as parts and connections.

Muse Spark lays out one link as structured parts: the parts of paper A's system, the parts of paper
B's, the shared mechanism in the middle, and a few NEW components a study could add (newer methods or
topics). The page draws it. Parts from the papers come only from the link's checked text; new
components are suggestions and are always drawn and labelled as such. Made on request, then kept.
"""
from typing import Literal

from pydantic import BaseModel, Field

from backend.config import SPARK
from backend.guard.policy import RULES, as_data
from backend.llm import Budget, ask


class Node(BaseModel):
    id: str = Field(description="A short id, e.g. a1, b2, s1, n1")
    side: Literal["a", "b", "shared", "new"]
    label: str = Field(description="2 to 4 plain words", max_length=32)
    note: str = Field(default="", description="One short plain phrase, optional", max_length=90)


class Edge(BaseModel):
    source: str
    target: str
    label: str = Field(default="", description="1 to 3 words, optional", max_length=26)


class Diagram(BaseModel):
    nodes: list[Node] = Field(min_length=5, max_length=12)
    edges: list[Edge] = Field(max_length=16)


SYSTEM = RULES + """
Draw how two papers relate, as a diagram of parts. Give:
- 2 to 4 nodes for paper A's system (side 'a') and 2 to 4 for paper B's (side 'b'), using only the link text below;
- 1 or 2 nodes for the shared mechanism (side 'shared');
- 1 to 3 NEW components a new study could add (side 'new'): a newer method, a test, or a further field
  where the same mechanism could apply. These are suggestions: never present them as existing work.
Edges: how parts feed each other inside each paper, how each side maps onto the shared mechanism, and
how the new components would attach. Plain, short labels."""


def draw(link: dict, short_a: str, short_b: str, field_a: str, field_b: str, budget: Budget) -> dict | None:
    lines = [f"Paper A: {short_a} ({field_a})", f"Paper B: {short_b} ({field_b})", f"Link: {link['headline']}",
             f"In A: {link['in_a']}", f"In B: {link['in_b']}", f"Shared: {link['shared']}",
             "Matching parts (A = B):"] + [f"- {a} = {b}" for a, b in link.get("mapping", [])]
    lines += [f"Why it holds: {link.get('why', '')}", "Ways to use it:"] + [f"- {u}" for u in link.get("use", [])]
    lines += [f"Open question: {link.get('question', '')}"]
    d: Diagram = ask("diagram", SPARK, SYSTEM, as_data("link", "\n".join(lines)), Diagram, budget,
                     about=["a link the agents wrote and checked"], effort="low")
    nodes, seen = [], set()
    for n in d.nodes:
        if n.id not in seen:
            seen.add(n.id); nodes.append(n.model_dump())
    count = {s: sum(1 for n in nodes if n["side"] == s) for s in ("a", "b", "shared", "new")}
    if count["a"] < 1 or count["b"] < 1 or count["shared"] < 1:
        return None
    edges = [{"from": e.source, "to": e.target, "label": e.label} for e in d.edges if e.source in seen and e.target in seen and e.source != e.target]
    return {"made_by": "Muse Spark 1.3", "nodes": nodes, "edges": edges}
