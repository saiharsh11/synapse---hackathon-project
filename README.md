# Synapse

**Finds links between research papers from different fields, and backs every link with quotes from both papers.**

Built by **Team Constellation** for the Meta Global AI Developer Hackathon 2026 (Indie track).

> **Note:** the sponsors provided API access during the hackathon, which has ended. The online version no longer reads papers. To use Synapse, run it on your own computer with your own Meta API key (see below).

A method that settled a question in one field is often the missing piece in another, but few people read both literatures. Synapse reads a set of papers from any fields, proposes how they relate, has a separate model try to break each link, and turns the links that survive into a plan for a new paper.

## What it does

1. **Reads** each paper and pulls out its claims, methods and open questions, each with a quote.
2. **Translates** each paper's jargon into plain terms, so papers from different fields can be compared.
3. **Connects** papers: proposes links between them (shared mechanism, borrowed method, one result that tests another), each backed by a quote from *both* papers.
4. **Challenges** every link. A different model asks whether the quotes really say that, whether the link holds outside the original setting, and what would break it. Links that fail are dropped.
5. **Judges** the strongest link once more with a larger model, which can confirm it, add a caveat, or reject it.
6. **Plans** a new paper from the links that survive: the question, what each source paper contributes, an outline, risks and a first step. On request, it searches published work in top journals and conferences to see whether the idea has already been done.

The website shows each agent's work as it happens: what it read, what it proposed, what the Challenger asked, and why something was kept or dropped. Every quote is checked word for word against the paper's text before it appears.

## Models

| Model | Where | Used for |
|---|---|---|
| Muse Spark 1.3 | Meta Model API | Reading, translating, connecting, planning, content checks |
| Muse Spark Open | Baseten | The Challenger, for public papers |
| Muse Wonder 1.0 | Meta Model API | The final judge, and the Challenger for a person's own PDFs |
| SAM 3.1 | Meta Model API | Outlining the part of a figure a quote points to |

Hosting runs on **Modal** (`deploy/modal_app.py`).

## Privacy and safety

- **Local first:** the server listens on `127.0.0.1` only.
- **No storage at the model provider:** requests ask the provider not to store them.
- **No training models:** models that train on what they're sent are never used.
- **Private PDFs stay private:**
  - a PDF someone adds never goes to the shared Baseten key;
  - it is never used in a web search.
- **A record of everything sent:** `data/sent.jsonl` lists each request that leaves the computer, with where it went, which papers it was about and its size. The text itself is never logged.
- **Checked before any model reads it:** every paper and every answer goes through a content check, and anything that doesn't pass is held back.
- **Trusted sources only:**
  - links must be `https` and come from well-known publishers and preprint servers;
  - web search results are limited to flagship journals and the main tracks of top conferences.
- **Spending caps:** each run stops before $0.50, with a daily limit across all runs and per-visitor limits.
- **Online version:**
  - it doesn't accept PDF uploads;
  - it can be locked behind a password.

## Run it locally

Requires Python 3.13 or newer.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env        # then fill in MODEL_API_KEY (and BASETEN_API_KEY for the Challenger)
.venv/bin/python -m backend.server
```

Open <http://127.0.0.1:8765> and add papers on the map page, as PDFs or links. Synapse reads only what you add. Optional: put public PDFs in `data/papers` and set `SYNAPSE_LIBRARY=1` in `.env` to read them all at once.

## Deploy

```bash
.venv/bin/pip install modal
.venv/bin/python -m deploy.modal_app         # deploy or update
.venv/bin/python -m deploy.modal_app stop    # take it offline
```

The deploy reads the Modal token from `.env` and sends only the code and the website. By default no model keys are sent (`MODEL_KEYS` in `deploy/modal_app.py`), so the online version shows the site but reads no papers.

## Project layout

```
backend/
  agents/     reader, relater, challenger, judge, planner, figures, diagram
  guard/      content checks and source rules
  pipeline/   PDF and web page reading
  run.py      one full run, step by step
  server.py   the website and its API
frontend/     landing page (index.html) and the map app (map.html)
deploy/       Modal deployment
```

## Team

Team Constellation
