"""Synapse online, on Modal.

Deploy:  .venv/bin/python -m deploy.modal_app
Stop:    .venv/bin/python -m deploy.modal_app stop

What goes to Modal: the backend code and the website.
Nothing else from this computer: no papers, no run history, no cache, no uploads, no logs.
Only the settings in SENT_KEYS are sent (model keys only when MODEL_KEYS, the password only when LOCKED), as an encrypted Modal secret, never in the code.
The Modal login is read from .env for this command only; nothing is saved in the home folder.
"""
import os
import sys

import modal

from backend.config import ENV, ONLINE_KEYS, ROOT

APP = "synapse"
APP_DIR = "/root/app"
LOCKED = False   # True: the site asks for SYNAPSE_PASSWORD from .env before anything loads
MODEL_KEYS = False   # False: no model keys go online; the site shows the finished run and starts no new ones
SENT_KEYS = [k for k in ONLINE_KEYS
             if (k != "SYNAPSE_PASSWORD" or LOCKED) and (k not in ("MODEL_API_KEY", "BASETEN_API_KEY") or MODEL_KEYS)]

image = (
    modal.Image.debian_slim(python_version="3.13")
    .pip_install_from_requirements(str(ROOT / "requirements.txt"))
    .env({"SYNAPSE_ONLINE": "1", "SYNAPSE_LOG_DIR": "/logs", "PYTHONPATH": APP_DIR})
    .add_local_dir(ROOT / "backend", f"{APP_DIR}/backend", ignore=["**/__pycache__", "**/*.pyc", "**/.DS_Store"])
    .add_local_dir(ROOT / "frontend", f"{APP_DIR}/frontend",
                   ignore=["_t.html", "assets/img/sponsors/* logo.png", "assets/fonts/bodoni-*", "assets/fonts/fira-*", "**/.DS_Store"])
)

app = modal.App(APP)
# usage counts and the sent log (no text), kept across restarts so the daily cap holds
logs = modal.Volume.from_name("synapse-logs", create_if_missing=True)
# defined the same way on both sides: Modal matches the server's objects to these by position
keys = [modal.Secret.from_dict({k: ENV[k] for k in SENT_KEYS if k in ENV})]


# one server, so every visitor shares the same limits and running jobs
@app.function(image=image, secrets=keys, volumes={"/logs": logs}, max_containers=1, scaledown_window=900, timeout=900)
@modal.concurrent(max_inputs=40)
@modal.asgi_app(label=APP)
def web():
    sys.path.insert(0, APP_DIR)
    from backend.server import app as site
    return site


def _login() -> None:
    for k in ("MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET"):
        if k not in ENV:
            sys.exit(f"{k} is missing from .env")
        os.environ[k] = ENV[k]


if __name__ == "__main__":
    _login()
    if sys.argv[1:] == ["stop"]:
        import subprocess
        sys.exit(subprocess.call([sys.executable, "-m", "modal", "app", "stop", "--yes", APP]))
    if LOCKED and "SYNAPSE_PASSWORD" not in ENV:
        sys.exit("Add a line SYNAPSE_PASSWORD=... to .env first, or set LOCKED = False.")
    with modal.enable_output():
        app.deploy(name=APP)
