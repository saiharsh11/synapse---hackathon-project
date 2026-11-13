"""Rules every source passes before any model sees it. Plain code, so no model can talk its way past them.

- Files are read only from data/papers (or bytes uploaded through the page), never from elsewhere on disk.
- Links must be public web addresses: every address the name points to, and every redirect, is checked.
- Video sites are refused (their terms don't allow downloading).
- Added links, and every redirect they lead to, must be on REPUTABLE: no predatory journals or random sites.
- What Synapse recommends to read must come from a scholarly site.
"""
import ipaddress
import re
import socket
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from backend.config import FETCH_MAX_BYTES, FETCH_MAX_REDIRECTS, FETCH_TIMEOUT_S, PAPERS_DIR


class Refused(Exception):
    """A source failed a rule. The message is shown to the person, so it stays plain."""


# ---------- files on disk ----------

def paper_path(name: str) -> Path:
    """Resolve a file name inside data/papers; anything that points elsewhere is refused."""
    root = PAPERS_DIR.resolve()
    p = (root / name).resolve()
    if p.parent != root or not p.is_file():
        raise Refused("That file isn't one of the papers added to Synapse.")
    return p


def looks_like_pdf(data: bytes) -> bool:
    return data[:5] == b"%PDF-"


# ---------- links ----------

VIDEO_SITES = ("youtube.com", "youtu.be", "vimeo.com", "tiktok.com", "dailymotion.com", "twitch.tv", "instagram.com", "facebook.com")

# Reading suggestions may only point here (the host or any subdomain of it)
SCHOLARLY = (
    "arxiv.org", "biorxiv.org", "medrxiv.org", "chemrxiv.org", "ssrn.com", "osf.io", "zenodo.org",
    "doi.org", "ncbi.nlm.nih.gov", "europepmc.org", "semanticscholar.org", "openalex.org",
    "nature.com", "science.org", "pnas.org", "springer.com", "link.springer.com", "wiley.com",
    "sciencedirect.com", "tandfonline.com", "sagepub.com", "iop.org", "iopscience.iop.org",
    "aps.org", "acm.org", "ieee.org", "plos.org", "elifesciences.org", "frontiersin.org",
    "mdpi.com", "jstor.org", "cambridge.org", "academic.oup.com", "royalsocietypublishing.org",
    "openreview.net", "aclanthology.org", "proceedings.mlr.press", "neurips.cc",
)


def _host_matches(host: str, domains) -> bool:
    host = host.lower().rstrip(".")
    return any(host == d or host.endswith("." + d) for d in domains)


def is_scholarly(url: str) -> bool:
    try:
        u = urllib.parse.urlsplit(url)
    except ValueError:
        return False
    host = u.hostname or ""
    return u.scheme == "https" and (_host_matches(host, SCHOLARLY) or host.endswith(".edu") or ".ac." in host)


# What Synapse may RECOMMEND (closest published work, what to read next): established journals and
# publishers, top conference proceedings, and arXiv. Stricter than SCHOLARLY: no general indexes, no
# personal or university pages, no publishers with mixed review standards.
REPUTABLE = (
    # journals and publishers
    "nature.com", "science.org", "pnas.org", "cell.com", "sciencedirect.com", "link.springer.com", "springer.com",
    "onlinelibrary.wiley.com", "tandfonline.com", "journals.sagepub.com", "iopscience.iop.org", "journals.aps.org",
    "pubs.aip.org", "pubs.acs.org", "pubs.rsc.org", "royalsocietypublishing.org", "academic.oup.com", "cambridge.org",
    "annualreviews.org", "journals.plos.org", "elifesciences.org", "jstor.org", "jmlr.org", "pmc.ncbi.nlm.nih.gov",
    # conference proceedings and peer review
    "dl.acm.org", "ieeexplore.ieee.org", "proceedings.neurips.cc", "papers.nips.cc", "proceedings.mlr.press",
    "openreview.net", "aclanthology.org", "openaccess.thecvf.com", "ojs.aaai.org", "ijcai.org", "usenix.org",
    # the standard preprint server in physics, maths and computer science
    "arxiv.org",
)


def is_reputable(url: str) -> bool:
    try:
        u = urllib.parse.urlsplit(url)
    except ValueError:
        return False
    return u.scheme == "https" and _host_matches(u.hostname or "", REPUTABLE)


# What Synapse may RECOMMEND: flagship journals and the main tracks of top conferences only.
# A publisher's domain isn't enough (they also host weaker journals and workshops), so where the
# address shows the journal or track, that is checked too. Preprints, workshops, meeting abstracts,
# talks and review platforms are never recommended.
TOP_DOMAINS = (
    "science.org", "pnas.org", "cell.com", "journals.aps.org", "royalsocietypublishing.org",
    "elifesciences.org", "annualreviews.org", "jmlr.org", "proceedings.neurips.cc", "papers.nips.cc",
    "proceedings.mlr.press",
)
# Nature journals by article code (nature.com/articles/<code>...)
NATURE_TOP = ("s41586", "s41567", "s41467", "s42256", "s41592", "s41593", "s41559", "s41562", "s41566", "s41563", "s41565",
              "s41587", "s41588", "s41591", "s42254", "s41570", "s41557", "s41558", "s41561")
_ACL_MAIN = re.compile(r"^/\d{4}\.(acl|emnlp|naacl)-(long|main)\.|^/[\w.-]*tacl")


def is_top_venue(url: str) -> bool:
    """True only for a flagship journal or a top conference's main track, over https."""
    try:
        u = urllib.parse.urlsplit(url)
    except ValueError:
        return False
    host, path = (u.hostname or "").lower(), u.path
    if u.scheme != "https":
        return False
    if _host_matches(host, TOP_DOMAINS):
        return True
    if _host_matches(host, ("nature.com",)):
        m = re.match(r"^/articles/(s\d{5})", path)
        return bool(m and m.group(1) in NATURE_TOP)
    if _host_matches(host, ("aclanthology.org",)):
        return bool(_ACL_MAIN.search(path))
    if _host_matches(host, ("openaccess.thecvf.com",)):
        low = path.lower()
        return "/papers/" in low and "workshop" not in low and not re.search(r"/content/\w*w\d*/", low)
    return False


def _public_address(host: str) -> None:
    """Every address the name resolves to must be on the public internet."""
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        raise Refused("That web address couldn't be found.")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global or ip.is_multicast:
            raise Refused("Only public web pages can be added.")


def check_link(url: str) -> str:
    """The checks before fetching: scheme, public address, not a video site. Returns the cleaned URL."""
    try:
        u = urllib.parse.urlsplit(url.strip())
    except ValueError:
        raise Refused("That doesn't look like a web address.")
    if u.scheme != "https" or not u.hostname:
        raise Refused("Only secure web links (https://) can be added.")
    if u.username or u.password:
        raise Refused("Links with a login in them can't be added.")
    if _host_matches(u.hostname, VIDEO_SITES):
        raise Refused("Video sites can't be used: their terms don't allow downloading.")
    if u.port not in (None, 80, 443):
        raise Refused("Only normal web pages can be added.")
    # only established journals, top conference proceedings and arXiv: checked again on every redirect
    if not _host_matches(u.hostname, REPUTABLE):
        raise Refused("Links can only come from established journals, major conference proceedings or arXiv. For anything else, upload the PDF.")
    _public_address(u.hostname)
    return urllib.parse.urlunsplit(u)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None   # we follow redirects ourselves, checking each one


def fetch(url: str) -> tuple[bytes, str, str]:
    """Download a public page or PDF within the size and time limits. Returns (bytes, content type, final URL)."""
    opener = urllib.request.build_opener(_NoRedirect)
    for _ in range(FETCH_MAX_REDIRECTS + 1):
        url = check_link(url)
        req = urllib.request.Request(url, headers={"User-Agent": "Synapse research reader (hackathon project)"})
        try:
            resp = opener.open(req, timeout=FETCH_TIMEOUT_S)
        except urllib.error.HTTPError as e:
            if e.code in (301, 302, 303, 307, 308) and e.headers.get("Location"):
                url = urllib.parse.urljoin(url, e.headers["Location"])
                continue
            raise Refused(f"The page couldn't be opened (error {e.code}).")
        except (urllib.error.URLError, TimeoutError):
            raise Refused("The page didn't respond in time.")
        with resp:
            kind = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            if kind not in ("text/html", "application/xhtml+xml", "application/pdf", "text/plain"):
                raise Refused("Only web pages and PDFs can be read.")
            data = resp.read(FETCH_MAX_BYTES + 1)
            if len(data) > FETCH_MAX_BYTES:
                raise Refused("That page is too large to read.")
            return data, kind, url
    raise Refused("That link redirects too many times.")
