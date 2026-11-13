"""The one door to the models. Every agent calls ask(); nothing else talks to an API.

- Answers must match a fixed structure (a Pydantic model), checked here; one retry, then an error.
- Each run has a spending cap; a call that could push past it is refused before it is sent.
- Contributor models (Meta trains on what they're sent) are never used.
- Muse Spark Open (served through a sponsor's Baseten key, not ours) only ever gets public papers.
- Models get text and page images only, chosen by our code. They have no tools and no way to reach
  this computer or its files.
- Nothing about this computer is sent: keys come from the project's .env only, and the API library's
  default headers describing the OS, CPU and Python version are removed.
- Nothing sent or received is logged. Usage is kept as counts only (see data/usage.jsonl).
- Responses API calls (web search, SAM) are sent with store=False, so Meta doesn't keep them as stored
  responses (checked: a response sent this way can't be retrieved afterwards).
- The only tools any model gets are web search (the Planner, public papers only) and SAM's image input.
  No model can send messages, fetch pages, open files or run code; nothing a model writes is executed.
"""
import base64
import json
import re
import threading
import time
from dataclasses import dataclass, field

from openai import Omit, OpenAI
from pydantic import BaseModel, ValidationError

from backend.config import (BASETEN_BASE_URL, ENV, LOG_DIR, MAX_OPEN_CALLS, MAX_OPEN_TOKENS, MAX_RUN_USD,
                            META_BASE_URL, PRICES, SAM, SAM_USD, CHECK_OVERFLOW, CHECK_RESERVE, SEARCH_GUESS_USD, SPARK, SPARK_CONTRIBUTOR, SPARK_OPEN, WEB_SEARCH_USD)

# Headers the openai library adds by default; each one describes this machine
_MACHINE_HEADERS = ("X-Stainless-Lang", "X-Stainless-Package-Version", "X-Stainless-OS", "X-Stainless-Arch",
                    "X-Stainless-Runtime", "X-Stainless-Runtime-Version", "X-Stainless-Async")
_HEADERS = {h: Omit() for h in _MACHINE_HEADERS} | {"User-Agent": "Synapse"}

USAGE_LOG = LOG_DIR / "usage.jsonl"
SENT_LOG = LOG_DIR / "sent.jsonl"     # every request that leaves this computer: where, what about, how much
_log_lock = threading.Lock()

_clients: dict[str, OpenAI] = {}


def _client(model: str) -> OpenAI:
    """Baseten serves Muse Spark Open; everything else goes to the Meta Model API."""
    key = "baseten" if model == SPARK_OPEN else "meta"
    if key not in _clients:
        env = "BASETEN_API_KEY" if key == "baseten" else "MODEL_API_KEY"
        token = ENV.get(env)
        if not token or token.startswith("your-"):
            raise RuntimeError(f"{env} is not set in .env")
        _clients[key] = OpenAI(base_url=BASETEN_BASE_URL if key == "baseten" else META_BASE_URL, api_key=token,
                               max_retries=2, timeout=120, default_headers=_HEADERS)
    return _clients[key]


class OverBudget(Exception):
    pass


@dataclass
class Budget:
    """Running cost of one run, from the token counts each answer reports."""
    cap: float = MAX_RUN_USD
    spent: float = 0.0
    open_calls: int = 0
    open_tokens: int = 0
    calls: list = field(default_factory=list)   # (agent, model, usd, tokens): no content, ever
    agent_share: float = 1 - CHECK_RESERVE        # share of the cap agents may use now; a run lowers it for early steps
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)   # agents may run side by side

    def charge(self, agent: str, model: str, usage) -> None:
        inp, cached, out = PRICES.get(model, (0, 0, 0))
        hit = getattr(getattr(usage, "prompt_tokens_details", None), "cached_tokens", 0) or 0
        usd = ((usage.prompt_tokens - hit) * inp + hit * cached + usage.completion_tokens * out) / 1e6
        tokens = usage.prompt_tokens + usage.completion_tokens
        with self.lock:
            self.spent += usd
            if model == SPARK_OPEN:
                self.open_calls += 1
                self.open_tokens += tokens
            self.calls.append((agent, model, round(usd, 5), tokens))
        _log_usage(agent, model, usage.prompt_tokens, usage.completion_tokens, usd)

    def check(self, model: str, guess: float = 0.01, *, checking: bool = False) -> None:
        """Agents may use 80% of the cap; the last 20% is kept for the content checks, so a check
        never fails just because the money ran out (that would hold back everything)."""
        if model == SPARK_OPEN:
            if self.open_calls >= MAX_OPEN_CALLS or self.open_tokens >= MAX_OPEN_TOKENS:
                raise OverBudget("This run has reached its limit for the Challenger model.")
        elif self.spent + guess > (self.cap * (1 + CHECK_OVERFLOW) if checking else self.cap * self.agent_share):
            raise OverBudget(f"This run has reached its ${self.cap:.2f} limit.")


def _log_usage(agent: str, model: str, tokens_in: int, tokens_out: int, usd: float) -> None:
    """One line per call: time, agent, model, token counts. Never any text, file name or key."""
    USAGE_LOG.parent.mkdir(parents=True, exist_ok=True)
    with _log_lock, USAGE_LOG.open("a") as f:
        f.write(json.dumps({"t": int(time.time()), "agent": agent, "model": model,
                            "in": tokens_in, "out": tokens_out, "usd": round(usd, 5)}) + "\n")


def _log_sent(agent: str, model: str, about: list[str] | None, chars: int) -> None:
    """Written before each request leaves: where it goes, which papers its text came from, and its size.
    The text itself is never written down. Open data/sent.jsonl to see everything Synapse has sent."""
    host = "inference.baseten.co" if model == SPARK_OPEN else "api.meta.ai"
    SENT_LOG.parent.mkdir(parents=True, exist_ok=True)
    with _log_lock, SENT_LOG.open("a") as f:
        f.write(json.dumps({"time": time.strftime("%Y-%m-%d %H:%M:%S"), "to": host, "agent": agent, "model": model,
                            "text_from": about or ["Synapse's own instructions and notes"], "characters": chars}) + "\n")


def _size(system: str, user: list | str) -> int:
    if isinstance(user, str):
        return len(system) + len(user)
    return len(system) + sum(len(part.get("text", "")) for part in user if isinstance(part, dict))


def _thinking(message) -> str | None:
    """The model's own working, when the provider returns it alongside the answer."""
    extra = getattr(message, "model_extra", None) or {}
    for name in ("reasoning_content", "reasoning"):
        if isinstance(extra.get(name), str) and extra[name].strip():
            return extra[name].strip()
    return None


def ask(agent: str, model: str, system: str, user: list | str, answer: type[BaseModel], budget: Budget, *,
        public_only: bool = False, thinking: list | None = None, about: list[str] | None = None,
        effort: str | None = None, checking: bool = False) -> BaseModel:
    """One structured call. `user` is text or a list of content parts (text and image_url).

    Pass a list as `thinking` to collect the model's raw working, if the provider sends it.
    `about` names the papers whose text is in the request, for the sent log.
    `effort="low"` asks Muse Spark to think less (tested: about half the output tokens) for simple jobs.
    `checking=True` marks a content check, which may use the budget kept back for checks.
    """
    if model == SPARK_CONTRIBUTOR:
        raise ValueError("Contributor models are not used: Meta trains on what they are sent.")
    if model == SPARK_OPEN and not public_only:
        raise ValueError(f"{model} may only be sent public papers.")
    schema = {"name": answer.__name__, "schema": answer.model_json_schema()}
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    for attempt in range(2):
        budget.check(model, checking=checking)
        client = _client(model)   # raises if the key isn't set, so nothing is logged or sent
        _log_sent(agent, model, about, _size(system, messages[1]["content"]) + sum(len(m["content"]) for m in messages[2:]))
        extra = {"reasoning_effort": effort} if effort and model == SPARK else {}
        resp = client.chat.completions.create(model=model, messages=messages, response_format={"type": "json_schema", "json_schema": schema}, **extra)
        budget.charge(agent, model, resp.usage)
        text = resp.choices[0].message.content or ""
        if thinking is not None and (t := _thinking(resp.choices[0].message)):
            thinking.append(t)
        try:
            return answer.model_validate(json.loads(text))
        except (json.JSONDecodeError, ValidationError) as e:
            if attempt:
                raise RuntimeError(f"{agent}: the model's answer didn't match the required format") from e
            messages += [{"role": "assistant", "content": text}, {"role": "user", "content": "That answer didn't match the required JSON format. Reply again with only valid JSON in that format."}]


def search(agent: str, question: str, budget: Budget) -> tuple[str, list[dict]]:
    """A web search by Muse Spark (Responses API, the only one with search). Returns its short answer
    and the raw results it saw: [{title, url, snippet}]. Only the question is sent, never a paper.

    The results are what later steps may cite: nothing outside this list is ever shown as a source.
    """
    budget.check(SPARK, guess=SEARCH_GUESS_USD)   # never start a search the budget can't cover
    client = _client(SPARK)
    _log_sent(agent, SPARK, ["a web search query written by Synapse (no paper text)"], len(SEARCH_RULES) + len(question))
    resp = client.responses.create(
        model=SPARK, instructions=SEARCH_RULES, input=[{"role": "user", "content": question}],
        tools=[{"type": "web_search", "search_context_size": "low"}], include=["web_search_call.results"], store=False)   # not kept as a stored response
    usage = getattr(resp, "usage", None)
    tin, tout = (getattr(usage, "input_tokens", 0) or 0), (getattr(usage, "output_tokens", 0) or 0)
    inp, _, out = PRICES[SPARK]
    calls = [it for it in resp.output if getattr(it, "type", "") == "web_search_call"]
    usd = (tin * inp + tout * out) / 1e6 + len(calls) * WEB_SEARCH_USD
    with budget.lock:
        budget.spent += usd
        budget.calls.append((agent, SPARK, round(usd, 5), tin + tout))
    _log_usage(agent, SPARK, tin, tout, usd)
    results, text = [], ""
    for it in resp.output:
        if getattr(it, "type", "") == "web_search_call":
            for r in (getattr(it, "results", None) or (it.model_extra or {}).get("results") or []):
                r = r if isinstance(r, dict) else r.model_dump()
                if r.get("url"):
                    results.append({"title": (r.get("title") or "").strip(), "url": r["url"], "snippet": (r.get("snippet") or "").strip()[:400]})
        elif getattr(it, "type", "") == "message":
            for block in it.content:
                if getattr(block, "type", "") == "output_text":
                    text += block.text
                    for ann in getattr(block, "annotations", None) or []:
                        if getattr(ann, "type", "") == "url_citation" and ann.url and all(ann.url != r["url"] for r in results):
                            results.append({"title": (ann.title or "").strip(), "url": ann.url, "snippet": ""})
    return text.strip(), results


SEARCH_RULES = """You search published research for a researcher. Look only for peer-reviewed papers in
flagship journals (Nature and the main Nature journals, Science, PNAS, Cell, Physical Review journals,
Royal Society journals, eLife, Annual Reviews, JMLR) and the main tracks of top conferences (NeurIPS,
ICML, CVPR, ICCV, ECCV, ACL, EMNLP, NAACL). Ignore preprints, workshops, meeting abstracts, talks,
code repositories, blogs, summary sites and everything else. Leave out anything political, partisan,
religious, controversial, sensational or off-topic. Report what you find plainly and neutrally, and
name each paper you mention. Do not discuss anything outside the research question."""


_BOX = re.compile(r"<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)")


def segment(agent: str, png: bytes, concept: str, budget: Budget, *, about: list[str]) -> list[tuple[int, int, int, int]]:
    """SAM 3.1 finds every `concept` (a short noun phrase, e.g. "chart") in one page image.
    Returns boxes (x1, y1, x2, y2) in the image's pixels; an empty list means none found.
    Only the boxes are read from the answer; the masks are not needed to cut a figure out."""
    budget.check(SAM, guess=SAM_USD)
    client = _client(SAM)
    _log_sent(agent, SAM, about, len(concept) + len(png))
    resp = client.responses.create(model=SAM, input=[{"type": "message", "role": "user", "content": [
        {"type": "input_text", "text": concept},
        {"type": "input_image", "image_url": "data:image/png;base64," + base64.b64encode(png).decode()}]}], store=False)
    with budget.lock:
        budget.spent += SAM_USD
        budget.calls.append((agent, SAM, SAM_USD, 0))
    _log_usage(agent, SAM, 0, 0, SAM_USD)
    text = getattr(resp, "output_text", "") or ""
    return [tuple(int(v) for v in m.groups()[:4]) for m in _BOX.finditer(text)]
