"""The code screen: a fixed check that needs no model, run on everything coming in and going out.

It looks for a short list of topics Synapse never works with. The list is kept as fingerprints
(salted SHA-256, first 16 hex digits), so the repository itself contains none of the words.
It is deliberately strict and simple:
- On sources, a few matches send the text to the screening model; many matches set it aside at once.
- On anything a model wrote, a single match holds the text back. It is never shown.
The screening model (policy.py) runs as well; this layer can't be talked out of its answer.
"""
import hashlib
import re
import unicodedata

_SALT = "synapse:"
_FINGERPRINTS = frozenset({
    "01fa279dc97decc4", "0373241980a42d69", "0eca3456abde3553", "101e4b0840ea6a5d",
    "1b8c500e1a75604a", "1e4d06502542d253", "1f074e674fecc2ca", "2627758ae6d80aae",
    "2bc9d826bdd34654", "2c7767f195b53adb", "2cff16ff12eb2321", "2f3fcc8a0a82bcb8",
    "308023e94b85edd4", "33d2eb522b42a690", "349fdf16ff225ab1", "364f04c25e72c261",
    "395cf8dc72778db5", "398e9742d161c39b", "39b831802ec6b604", "3dc407190461d96a",
    "49473a43ba7cd33c", "4ed1be7456cbaaf0", "516113c0f18dec20", "51cad0fe7d67e82f",
    "51ed9d646feec282", "53007b5055802ac0", "54bdcf1ccee1ecfc", "5f77864871f2b2fc",
    "5fdf5c3bad161468", "6044779744a1d48a", "65b89338cfb4d586", "6b3878422b289610",
    "6e598515abd89051", "6e5fa501836bdc9f", "6f5a90bc9309415a", "70a8075ea7567430",
    "774f82a4c5571c04", "7cda827981f620dd", "7f1bbed671da7d1d", "879614070923f8ed",
    "904b6a18994420cf", "944e01295ea583dd", "97b79d2b3b8ac118", "983d953a5efc64fb",
    "9b4a51e1a0be428e", "a12034b08c2b572b", "a291973d222cc368", "a52479a167ca600a",
    "b7059c902ec9e11b", "ba7473f7786c3d07", "bbd73d6826e9a50e", "c4f59c5b0245bc84",
    "c52d2c0a13565639", "cac29301ba7b1547", "cd851b5dd85ad407", "d0fa0daf30e1a940",
    "d9b56b46cfcf1e86", "da7b4f8901471ea7", "daafbf5be1ffe5ee", "dac4cade74e3cc6e",
    "de1a235df68ce966", "e1a9b387c0d9be2f", "e2959e0bbfdd763d", "e2e7d0cd7eeb6f7b",
    "e5ad9932ff1fa79c", "e678f1711bd3e346", "ed6e67a492189f07", "ed882fc65aadbf59",
    "ee80ac60d028cd8b", "f0944058b302e38f", "f54e6be72df5d1e6",
})
_WORD = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
SET_ASIDE_AT = 3   # distinct matches in one source


def _fingerprint(phrase: str) -> str:
    return hashlib.sha256((_SALT + phrase).encode()).hexdigest()[:16]


def matches(text: str) -> int:
    """How many distinct listed topics appear in the text (as words or short phrases)."""
    words = _WORD.findall(unicodedata.normalize("NFKC", text).lower())
    found = set()
    for n in (1, 2, 3):
        for i in range(len(words) - n + 1):
            phrase = " ".join(words[i:i + n])
            if _fingerprint(phrase) in _FINGERPRINTS:
                found.add(phrase)
    return len(found)
