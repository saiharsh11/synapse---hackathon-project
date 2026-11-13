"""Central configuration: paths, model names, limits. Secrets come from .env only (online: from the host's secret store)."""
import os
from pathlib import Path

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent.parent
# Read settings from the project's .env only, never from this computer's environment variables
ENV = {k: v for k, v in dotenv_values(ROOT / ".env").items() if v}

# The online version (deploy/modal_app.py) has no .env: Modal passes in only these settings, nothing else
ONLINE = os.environ.get("SYNAPSE_ONLINE") == "1"
ONLINE_KEYS = ("MODEL_API_KEY", "BASETEN_API_KEY", "SYNAPSE_PASSWORD", "SYNAPSE_MAX_RUN_USD", "SYNAPSE_MAX_DAY_USD")
if ONLINE:
    ENV = {k: v for k in ONLINE_KEYS if (v := os.environ.get(k))}

# Without model keys (SYNAPSE_NO_KEYS=1): the site works, and nothing calls a model
NO_KEYS = os.environ.get("SYNAPSE_NO_KEYS") == "1"
if NO_KEYS:
    ENV = {k: v for k, v in ENV.items() if k not in ("MODEL_API_KEY", "BASETEN_API_KEY")}

DATA_DIR = ROOT / "data"
LOG_DIR = Path(os.environ.get("SYNAPSE_LOG_DIR") or DATA_DIR) if ONLINE else DATA_DIR   # online: kept across restarts
PAPERS_DIR = DATA_DIR / "papers"     # the only folder the backend reads papers from
# Off by default: Synapse reads only the papers a person adds. SYNAPSE_LIBRARY=1 in .env also loads data/papers
LIBRARY = not ONLINE and ENV.get("SYNAPSE_LIBRARY") == "1"
CACHE_DIR = DATA_DIR / "cache"
ADDED_DIR = DATA_DIR / "added"       # PDFs a person uploads, named by their contents

# Ingest
FIGURE_DPI = 110            # page renders sent to vision models; keep small to save tokens
MIN_IMAGE_SIDE = 120        # ignore embedded images smaller than this (logos, icons)
MAX_FIGURE_PAGES = 8        # Baseten Muse Spark Open accepts at most 8 images per request
MAX_PDF_MB = 20
MAX_AUDIO_MB = 50

# Models (IDs checked against dev.meta.ai/docs/models on 2026-10-28/29)
META_BASE_URL = "https://api.meta.ai/v1"
BASETEN_BASE_URL = "https://inference.baseten.co/v1"
SPARK = "muse-spark-1.3"
SPARK_CONTRIBUTOR = "muse-spark-1.3-contributor"   # Meta trains on what it is sent: never used (llm.ask refuses it)
WONDER = "muse-wonder-1.0"
SPARK_OPEN = "meta-models/muse-spark-open-1026"     # on Baseten
SAM = "sam-3.1"                                      # figures: Responses API, billed per image

# USD per million tokens: (input, cached input, output), from dev.meta.ai/docs/pricing-rate-limits
PRICES = {
    SPARK: (1.25, 0.15, 4.25),
    SPARK_CONTRIBUTOR: (0.10, 0.002, 0.20),
    WONDER: (4.00, 0.20, 20.00),
}
WEB_SEARCH_USD = 2.50 / 1000
SAM_USD = 2.50 / 1000   # per image (dev.meta.ai/docs/pricing-rate-limits)

# Spending caps: a run stops before it can spend more than this
MAX_RUN_USD = float(ENV.get("SYNAPSE_MAX_RUN_USD", "0.5"))   # per run; the user set $0.50 on 2026-10-30
CHECK_RESERVE = 0.2                # share of each run kept for the content checks
CHECK_OVERFLOW = 0.25              # content checks may go this far past the cap: a check must never fail for money
SEARCH_GUESS_USD = 0.35            # one web search pulls ~190k tokens of web text in: only start it if this much is left
MAX_DAY_USD = float(ENV.get("SYNAPSE_MAX_DAY_USD", "10"))     # all runs together, per day: no one can drain the credits
RUNS_PER_VISITOR_PER_DAY = 3
CHECKS_PER_VISITOR_PER_MIN = 20
MAX_PAGES = 80                     # longer PDFs are refused
MAX_ADDED_FILES = 60               # uploads kept at once, across everyone
# Muse Spark Open runs on a sponsor's Baseten key: we can't see its bill and have no published
# price for it, so it is capped by calls and tokens instead of dollars
MAX_OPEN_CALLS = 12
MAX_OPEN_TOKENS = 200_000

# Fetching links
FETCH_TIMEOUT_S = 15
FETCH_MAX_BYTES = MAX_PDF_MB * 1024 * 1024
FETCH_MAX_REDIRECTS = 4
