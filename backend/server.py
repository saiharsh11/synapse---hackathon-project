"""Synapse's local server: the website plus its API, on this computer only.

Run: .venv/bin/python -m backend.server   ->   http://127.0.0.1:8765/

- Listens on 127.0.0.1, so nothing else on the network can reach it.
- Only answers requests addressed to 127.0.0.1/localhost (blocks DNS-rebinding tricks) and refuses
  changes sent from any other website open in the same browser.
- Reads papers only from data/papers (public), and keeps what the person adds under data/added.
  Added PDFs are private: they never go to the sponsor's Baseten key.
- Online (deploy/modal_app.py): asks for a password first if one is set, answers only on its own
  modal.run address, and doesn't take PDF uploads, so no one's own files are kept on a server.
"""
import base64
import hashlib
import hmac
import json
import threading
import time
import uuid
from pathlib import Path

import pymupdf
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.middleware.trustedhost import TrustedHostMiddleware

from backend.agents.challenger import challenge
from backend.config import (ADDED_DIR, CACHE_DIR, CHECKS_PER_VISITOR_PER_MIN, DATA_DIR, ENV, LOG_DIR, MAX_ADDED_FILES, MAX_DAY_USD, ONLINE,
                            LIBRARY, MAX_PAGES, MAX_PDF_MB, MAX_RUN_USD, PAPERS_DIR, ROOT, RUNS_PER_VISITOR_PER_DAY)
from backend.agents.diagram import draw as draw_diagram
from backend.agents.planner import blueprint, check_novelty, not_searched, plan_mine
from backend.guard.policy import REASON, check_request, check_source, screen_output
from backend.guard.screen import SET_ASIDE_AT, matches
from backend.guard.sources import Refused, check_link, fetch, looks_like_pdf
from backend.llm import Budget, OverBudget
from backend.run import RunError, _texts, run as run_pipeline
from backend.pipeline.ingest import ingest
from backend.pipeline.webpage import read_page
from backend.schemas import IngestedPaper

HOST, PORT = "127.0.0.1", 8765
ORIGINS = {f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}"}

app = FastAPI(title="Synapse", docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"] + (["*.modal.run"] if ONLINE else []))


# What the browser may do on these pages: only this site's own scripts, styles, images and requests.
# No other site may frame it, no plugins, no camera, microphone or location.
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
       "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
MAX_BODY = MAX_PDF_MB * 1024 * 1024 + 64 * 1024


def _password_ok(request: Request) -> bool:
    """Online only: the browser's own sign-in box, when the deploy sets a password."""
    want = ENV.get("SYNAPSE_PASSWORD", "")
    if not want:
        return True
    kind, _, given = request.headers.get("authorization", "").partition(" ")
    try:
        _, _, pw = base64.b64decode(given).decode().partition(":")
    except Exception:
        return False
    return kind.lower() == "basic" and hmac.compare_digest(pw.encode(), want.encode())


def _same_site(request: Request) -> bool:
    origin = request.headers.get("origin")
    return origin in ORIGINS or (ONLINE and origin == f"https://{request.headers.get('host', '')}")


@app.middleware("http")
async def guard(request: Request, call_next):
    if ONLINE and not _password_ok(request):
        if request.headers.get("authorization") and not _allow(request, "login", 10, 600):
            return JSONResponse({"error": "Too many wrong passwords. Try again in 10 minutes."}, status_code=429)
        return JSONResponse({"error": "Enter the password to use Synapse."}, status_code=401,
                            headers={"WWW-Authenticate": 'Basic realm="Synapse", charset="UTF-8"', "Cache-Control": "no-store"})
    # A page on another site can make the browser send requests here; refuse anything that changes state
    if request.method != "GET" and not _same_site(request):
        return JSONResponse({"error": "Requests are only accepted from Synapse itself."}, status_code=403)
    try:
        if int(request.headers.get("content-length") or 0) > MAX_BODY:
            return JSONResponse({"error": "That's too large to send."}, status_code=413)
    except ValueError:
        return JSONResponse({"error": "Bad request."}, status_code=400)
    if request.url.path.startswith("/api/check/") and not _allow(request, "check", CHECKS_PER_VISITOR_PER_MIN, 60):
        return JSONResponse({"detail": "Too many checks at once. Wait a minute and try again."}, status_code=429)
    resp = await call_next(request)
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["Content-Security-Policy"] = CSP
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    resp.headers["Cross-Origin-Resource-Policy"] = "same-origin"
    resp.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
    return resp


# ---------- limits per visitor, and a daily ceiling on spending ----------
_hits: dict[tuple[str, str], list[float]] = {}
_hits_lock = threading.Lock()


def _allow(request: Request, kind: str, limit: int, window_s: int) -> bool:
    """A simple sliding window per visitor address. Only the address is kept, in memory, for the window."""
    who = request.client.host if request.client else "?"
    now = time.time()
    with _hits_lock:
        times = [t for t in _hits.get((kind, who), []) if now - t < window_s]
        if len(times) >= limit:
            _hits[(kind, who)] = times
            return False
        times.append(now)
        _hits[(kind, who)] = times
        return True


def _spent_today() -> float:
    """Dollars spent today across every run, from the usage log (counts only)."""
    log = LOG_DIR / "usage.jsonl"
    if not log.exists():
        return 0.0
    start = time.mktime(time.localtime()[:3] + (0, 0, 0, 0, 0, -1))
    total = 0.0
    for line in log.read_text().splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if row.get("t", 0) >= start:
            total += row.get("usd", 0)
    return total


def _key_set(name: str) -> bool:
    v = ENV.get(name, "")
    return bool(v) and not v.startswith("your-")


# ---------- the papers Synapse knows about ----------
# id -> (paper, public). Public: the open-access papers in data/papers and pages from public links.

_papers: dict[str, tuple[IngestedPaper, bool]] = {}
_cleared: set[str] = set()   # added sources that passed every check: the only added ones a run may read


def _load_library() -> None:
    for pdf in sorted(PAPERS_DIR.glob("*.pdf")):
        p = ingest(pdf)
        _papers[p.id] = (p, True)
    for pdf in sorted(ADDED_DIR.glob("*.pdf")):
        p = ingest(pdf)
        _papers[p.id] = (p, False)


def _summary(p: IngestedPaper, public: bool) -> dict:
    return {"id": p.id, "title": p.title, "pages": p.page_count, "figures": len(p.figures),
            "public": public, "source": p.source_file}


# ---------- checks ----------
# Each check is {k, state: ok | no | wait, note}. Keys match the site's checklist.

def _ai_checks(p: IngestedPaper, kinds: list[str]) -> list[dict]:
    """research / safe / inject / source, run by the screening model. Waits if the Meta key isn't set."""
    text = "\n".join(pg.text for pg in p.pages)
    if matches(text) >= SET_ASIDE_AT:   # the code screen needs no key and can't be argued with
        return [{"k": k, "state": "no" if k == "safe" else "wait", "note": REASON["suitable"] if k == "safe" else "Not reached."} for k in kinds]
    if not _key_set("MODEL_API_KEY"):
        return [{"k": k, "state": "wait", "note": "Waiting for the Meta model key."} for k in kinds]
    verdict, reason = check_source(text, Budget(), about=p.source_file)
    states = {
        "research": (verdict.research, "Research material." if verdict.research else "This doesn't look like research material."),
        "safe": (verdict.suitable, "Suitable for academic use." if verdict.suitable else "Outside what Synapse works with."),
        "inject": (not verdict.injection, "No instructions aimed at the AI." if not verdict.injection else "Parts of it were aimed at the AI."),
        "source": (True, f"Labelled as {verdict.kind}, field: {verdict.field}."),
    }
    out = [{"k": k, "state": "ok" if states[k][0] else "no", "note": states[k][1]} for k in kinds]
    if reason:
        out.append({"k": "reason", "state": "no", "note": reason})
    return out


def _hidden_check(p: IngestedPaper) -> dict:
    n = p.hidden_chars
    return {"k": "hidden", "state": "ok", "note": f"{n} characters of hidden text removed." if n else "No hidden text found."}


class LinkIn(BaseModel):
    url: str


@app.post("/api/check/link")
def check_link_route(body: LinkIn):
    checks = []
    try:
        url = check_link(body.url)
        checks.append({"k": "addr", "state": "ok", "note": "A public web address."})
        data, kind, final = fetch(url)
    except Refused as e:
        k = "open" if checks else "addr"
        return {"ok": False, "checks": checks + [{"k": k, "state": "no", "note": str(e)}]}
    checks.append({"k": "open", "state": "ok", "note": "Opened as a PDF." if kind == "application/pdf" else "Opened as a web page."})

    if kind == "application/pdf":
        if not looks_like_pdf(data):
            return {"ok": False, "checks": checks + [{"k": "open", "state": "no", "note": "It said PDF but isn't one."}]}
        path = _save_pdf(data)
        paper = ingest(path)
    else:
        paper = read_page(data, final)
    if not any(pg.text.strip() for pg in paper.pages):
        return {"ok": False, "checks": checks + [{"k": "open", "state": "no", "note": "No readable text on that page."}]}
    _papers[paper.id] = (paper, True)   # a public link
    checks.append(_hidden_check(paper))
    checks += _ai_checks(paper, ["research", "safe", "inject", "source"])
    _clear_if_ok(paper.id, checks)
    return {"ok": all(c["state"] == "ok" for c in checks), "waiting": any(c["state"] == "wait" for c in checks), "paper": _summary(paper, True), "checks": checks}


def _clear_if_ok(pid: str, checks: list[dict]) -> None:
    if all(c["state"] == "ok" for c in checks):
        _cleared.add(pid)
    else:
        _cleared.discard(pid)


def _save_pdf(data: bytes) -> Path:
    ADDED_DIR.mkdir(parents=True, exist_ok=True)
    path = ADDED_DIR / f"{hashlib.sha256(data).hexdigest()[:16]}.pdf"   # named by content, never by the person's file name
    if not path.exists():
        path.write_bytes(data)
    return path


@app.post("/api/check/pdf")
async def check_pdf(file: UploadFile = File(...)):
    if ONLINE:
        return {"ok": False, "checks": [{"k": "file", "state": "no", "note": "Uploading PDFs only works when Synapse runs on your own computer. Paste a link instead."}]}
    data = await file.read(MAX_PDF_MB * 1024 * 1024 + 1)
    if len(data) > MAX_PDF_MB * 1024 * 1024:
        return {"ok": False, "checks": [{"k": "file", "state": "no", "note": f"The limit is {MAX_PDF_MB} MB."}]}
    if not looks_like_pdf(data):
        return {"ok": False, "checks": [{"k": "file", "state": "no", "note": "This file is not really a PDF."}]}
    # open it in memory first: refuse locked or very long files before anything is kept
    try:
        with pymupdf.open(stream=data, filetype="pdf") as doc:
            locked, pages = doc.needs_pass or doc.is_encrypted, doc.page_count
    except Exception:
        return {"ok": False, "checks": [{"k": "file", "state": "no", "note": "This PDF couldn't be opened."}]}
    if locked:
        return {"ok": False, "checks": [{"k": "file", "state": "no", "note": "This PDF is password-protected, so it can't be read."}]}
    if pages > MAX_PAGES:
        return {"ok": False, "checks": [{"k": "file", "state": "no", "note": f"This PDF has {pages} pages. The limit is {MAX_PAGES}."}]}
    if len(list(ADDED_DIR.glob("*.pdf"))) >= MAX_ADDED_FILES:
        return {"ok": False, "checks": [{"k": "file", "state": "no", "note": "Synapse is holding as many files as it can right now. Remove some and try again."}]}
    known = _papers.get(hashlib.sha256(data).hexdigest()[:12])
    if known and known[1]:
        # the same file as a public paper already in the library: use that, keep no extra copy
        paper = known[0]
        checks = [{"k": "file", "state": "ok", "note": f"A real PDF, {paper.page_count} pages. It's already in the library."}, _hidden_check(paper)]
        checks += _ai_checks(paper, ["research", "safe", "inject"])
        return {"ok": all(c["state"] == "ok" for c in checks), "waiting": any(c["state"] == "wait" for c in checks), "paper": _summary(paper, True), "checks": checks}
    try:
        paper = ingest(_save_pdf(data))
    except Exception:
        return {"ok": False, "checks": [{"k": "file", "state": "no", "note": "This PDF couldn't be opened."}]}
    _papers[paper.id] = (paper, False)   # the person's own file: private
    checks = [{"k": "file", "state": "ok", "note": f"A real PDF, {paper.page_count} pages."}, _hidden_check(paper)]
    checks += _ai_checks(paper, ["research", "safe", "inject"])
    _clear_if_ok(paper.id, checks)
    return {"ok": all(c["state"] == "ok" for c in checks), "waiting": any(c["state"] == "wait" for c in checks), "paper": _summary(paper, False), "checks": checks}


# ---------- status and papers ----------

@app.get("/api/status")
def status():
    """Which parts are ready. Says only whether each key is set, never anything about the key."""
    return {"meta": _key_set("MODEL_API_KEY"), "baseten": _key_set("BASETEN_API_KEY"),
            "papers": len(list(PAPERS_DIR.glob("*.pdf"))) if LIBRARY else 0,
            "cap_usd": MAX_RUN_USD, "uploads": not ONLINE}


@app.delete("/api/added/{pid}")
def forget(pid: str):
    """The person removed something they added: delete Synapse's copy and what was read from it."""
    if not pid.isalnum() or len(pid) != 12:
        raise HTTPException(404, "Not found.")
    entry = _papers.get(pid)
    if entry and (entry[1] is False or entry[0].source_file.startswith("http")):   # never the built-in library
        del _papers[pid]
        _cleared.discard(pid)
        for f in ADDED_DIR.glob(f"{pid}*.pdf"):
            f.unlink()
        cache = CACHE_DIR / pid
        if cache.is_dir():
            for f in cache.iterdir():
                f.unlink()
            cache.rmdir()
    return {"ok": True}


@app.get("/api/papers")
def papers():
    return [_summary(p, pub) for p, pub in _papers.values()]


# ---------- agents ----------

class ChallengeIn(BaseModel):
    a: str
    b: str
    link: dict


@app.post("/api/challenge")
def challenge_route(body: ChallengeIn):
    if not _key_set("BASETEN_API_KEY"):
        raise HTTPException(503, "The Challenger's key isn't set yet.")
    try:
        (a, a_pub), (b, b_pub) = _papers[body.a], _papers[body.b]
    except KeyError:
        raise HTTPException(404, "One of those papers isn't on the map.")
    if not (a_pub and b_pub):
        # the Challenger runs on a sponsor's key: the person's own PDFs never go there
        raise HTTPException(400, "The Challenger only reads public papers. Your own PDFs are checked by Muse Wonder instead, once the Meta key is set.")
    need = {"headline", "in_a", "in_b", "shared", "evidence"}
    if not need <= body.link.keys():
        raise HTTPException(422, "The link is missing parts.")
    try:
        return challenge(a, b, body.link, Budget())
    except OverBudget as e:
        raise HTTPException(429, str(e))


# One run at a time: it runs in the background and the page polls for progress.
RUNS_DIR = (LOG_DIR if ONLINE else DATA_DIR) / "runs"   # online: nothing from this computer
_job: dict = {}
_job_lock = threading.Lock()


class RunIn(BaseModel):
    papers: list[str] = []      # ids of checked sources the person added
    library: bool = False       # also read the open-access papers in data/papers


@app.post("/api/run")
def start_run(body: RunIn, request: Request):
    if not _key_set("MODEL_API_KEY"):
        raise HTTPException(503, "Reading papers needs the Meta model key, which isn't set yet.")
    lib = {p.id for p, pub in _papers.values() if pub and not p.source_file.startswith("http") and (PAPERS_DIR / p.source_file).exists()}
    ids = list(dict.fromkeys([i for i in body.papers if i in _cleared or i in lib] + (sorted(lib) if body.library else [])))
    sources = [_papers[i] for i in ids if i in _papers]
    if _spent_today() >= MAX_DAY_USD:
        raise HTTPException(429, "Synapse has reached today's reading limit. Try again tomorrow.")
    if len(sources) < 2:
        raise HTTPException(400, "Add at least two papers that passed their checks.")
    if len(sources) > 15:
        raise HTTPException(400, "A run reads up to 15 papers at a time.")
    with _job_lock:
        if _job.get("state") == "running":
            raise HTTPException(409, "A run is already going. Wait for it to finish.")
        if not _allow(request, "run", RUNS_PER_VISITOR_PER_DAY, 86400):
            raise HTTPException(429, f"You can start {RUNS_PER_VISITOR_PER_DAY} runs a day.")
        _job.clear(); _job.update(id=uuid.uuid4().hex[:10], state="running", steps=[], error=None, started=time.time())
    job = _job

    def say(agent, state, text):
        steps = job["steps"]
        for s in steps:
            if s["agent"] == agent:
                s.update(state=state, text=text); return
        steps.append({"agent": agent, "state": state, "text": text})

    def work():
        try:
            result = run_pipeline(sources, say)
            RUNS_DIR.mkdir(parents=True, exist_ok=True)
            (RUNS_DIR / "latest.json").write_text(json.dumps(result))
            job["state"] = "done"
        except (OverBudget, RunError) as e:
            job.update(state="failed", error=str(e))
        except Exception:   # details stay out of the page
            job.update(state="failed", error="Something went wrong while reading. Nothing was saved; try again.")

    threading.Thread(target=work, daemon=True).start()
    return {"id": job["id"]}


@app.get("/api/run/{rid}")
def run_status(rid: str):
    if _job.get("id") != rid:
        raise HTTPException(404, "That run isn't known.")
    return {k: _job[k] for k in ("id", "state", "steps", "error")}


# ---------- your own idea, and the blueprint ----------

class IdeaIn(BaseModel):
    text: str
    field: str = ""
    search: bool = False   # only when the person ticks "Whether it's already been done"


def _latest() -> dict:
    f = RUNS_DIR / "latest.json"
    if not f.exists():
        raise HTTPException(409, "Read some papers first: your idea is mapped onto the papers in your latest run.")
    return json.loads(f.read_text())


def _paid_action(request: Request, kind: str, per_day: int) -> None:
    if not _key_set("MODEL_API_KEY"):
        raise HTTPException(503, "This needs the Meta model key, which isn't set yet.")
    if _spent_today() >= MAX_DAY_USD:
        raise HTTPException(429, "Synapse has reached today's limit. Try again tomorrow.")
    if not _allow(request, kind, per_day, 86400):
        raise HTTPException(429, f"You can do this {per_day} times a day.")


_mine: dict[str, dict] = {}   # the last mapped idea per visitor, in memory only, so its blueprint can be made


@app.post("/api/idea")
def map_idea(body: IdeaIn, request: Request):
    _paid_action(request, "idea", 10)
    latest, budget = _latest(), Budget(cap=0.5)
    held = check_request(body.text, budget)            # code screen, then the screening model; fails closed
    if held:
        raise HTTPException(400, held)
    field = body.field.strip()[:80]
    if field and check_request(field + " research", budget):
        field = ""
    links = [c for c in latest["connections"] if c.get("status") == "verified"]
    try:
        d = plan_mine(body.text.strip(), field, latest["papers"], links, budget)
    except (OverBudget, RuntimeError):
        d = None
    if not d:
        raise HTTPException(422, "Synapse couldn't connect that idea to the papers on your map. Try describing it differently.")
    private = {p["id"] for p in latest["papers"] if not p.get("public", True)}
    if not body.search:
        d.update(not_searched(d, "Not searched: you didn't ask Synapse to check whether it's been done."))
    elif any(x["paper"] in private for x in d["parts"]):
        d.update(not_searched(d, "Not searched, to keep your own papers private: search queries would leave for the web."))
    else:
        d.update(check_novelty(d, budget))
    d.pop("searches", None)
    d["id"] = "M1"
    if screen_output(_texts(d), budget):
        raise HTTPException(422, "Synapse's content check held this back, so it isn't shown.")
    _mine[request.client.host if request.client else "?"] = d
    return d


class BlueprintIn(BaseModel):
    idea: str


@app.post("/api/blueprint")
def make_blueprint(body: BlueprintIn, request: Request):
    _paid_action(request, "blueprint", 6)
    latest = _latest()
    who = request.client.host if request.client else "?"
    idea = _mine.get(who) if body.idea == "M1" else next((n for n in latest.get("next_papers", []) if n["id"] == body.idea), None)
    if not idea:
        raise HTTPException(404, "That idea isn't on your map.")
    if idea.get("blueprint"):
        return idea["blueprint"]                       # made once, then kept
    budget = Budget(cap=0.3)
    try:
        bp = blueprint(idea, latest["papers"], budget)
    except (OverBudget, RuntimeError):
        bp = None
    if not bp or screen_output(_texts(bp), budget):
        raise HTTPException(422, "The blueprint couldn't be made this time. Try again.")
    idea["blueprint"] = bp
    if body.idea != "M1":                              # keep it with the run
        (RUNS_DIR / "latest.json").write_text(json.dumps(latest))
    return bp


class NoveltyIn(BaseModel):
    idea: str


@app.post("/api/novelty")
def search_novelty(body: NoveltyIn, request: Request):
    """'Has this been done?': a web search of flagship journals and top conferences, when the person asks."""
    latest = _latest()
    who = request.client.host if request.client else "?"
    idea = _mine.get(who) if body.idea == "M1" else next((n for n in latest.get("next_papers", []) if n["id"] == body.idea), None)
    if not idea:
        raise HTTPException(404, "That idea isn't on your map.")
    if not idea.get("searchable", True) or not idea.get("searches"):
        raise HTTPException(400, "This idea draws on your own papers, so it isn't searched: search queries would leave for the web.")
    if idea["novelty"].get("state") not in ("unchecked", None) or idea["novelty"].get("searched"):
        return idea                                    # searched once already
    _paid_action(request, "novelty", 4)
    budget = Budget(cap=0.5)
    budget.agent_share = 1.0
    try:
        found = check_novelty(idea, budget)
    except (OverBudget, RuntimeError):
        raise HTTPException(503, "The search couldn't run this time. Try again later.")
    if screen_output(_texts(found), budget):
        raise HTTPException(422, "Synapse's content check held the results back, so they aren't shown.")
    idea.update(found)
    if body.idea != "M1":
        (RUNS_DIR / "latest.json").write_text(json.dumps(latest))
    return idea


class DiagramIn(BaseModel):
    link: str


@app.post("/api/diagram")
def make_diagram(body: DiagramIn, request: Request):
    """Draw how one link's papers relate. Made once per link, then kept with the run."""
    latest = _latest()
    link = next((c for c in latest["connections"] if c["id"] == body.link and c.get("status") == "verified"), None)
    if not link:
        raise HTTPException(404, "That link isn't on your map.")
    if link.get("diagram"):
        return link["diagram"]
    _paid_action(request, "diagram", 12)
    pa = next(p for p in latest["papers"] if p["id"] == link["a"]["paper"])
    pb = next(p for p in latest["papers"] if p["id"] == link["b"]["paper"])
    budget = Budget(cap=0.1)
    try:
        d = draw_diagram(link, pa["short"], pb["short"], pa["field"], pb["field"], budget)
    except (OverBudget, RuntimeError):
        d = None
    if not d or screen_output(_texts(d), budget):
        raise HTTPException(422, "The diagram couldn't be drawn this time. Try again.")
    link["diagram"] = d
    (RUNS_DIR / "latest.json").write_text(json.dumps(latest))
    return d


@app.get("/api/figure/{pid}/{page}")
def figure(pid: str, page: int):
    """A figure cut out of a paper whose licence allows it (or the person's own upload)."""
    if not (len(pid) == 12 and all(ch in "0123456789abcdef" for ch in pid)) or not 0 < page < 1000:
        raise HTTPException(404, "Not found.")
    f = CACHE_DIR / pid / f"fig-p{page:03d}.png"
    if not f.is_file():
        raise HTTPException(404, "Not found.")
    return FileResponse(f, media_type="image/png")


@app.get("/api/runs/latest")
def latest_run():
    f = RUNS_DIR / "latest.json"
    if not f.exists():
        raise HTTPException(404, "No run yet.")
    return JSONResponse(json.loads(f.read_text()))


# ---------- the website ----------
# Mounted last so /api/* is matched first. Only the frontend folder is served.
app.mount("/", StaticFiles(directory=ROOT / "frontend", html=True), name="site")


if __name__ == "__main__":
    import uvicorn
    if LIBRARY:
        _load_library()
    print(f"Synapse: http://{HOST}:{PORT}/  ({len(_papers)} papers ready, Ctrl+C to stop)")
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning", server_header=False, date_header=False)
