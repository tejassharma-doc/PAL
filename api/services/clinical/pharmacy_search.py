"""
Finding the pharmacy product page for a brand the patient named.

This is the piece that was missing. `pharmacy_label.py` could always turn a
product page into a card; nothing could find the product page. That job used
to belong to a pharmacy-restricted SearXNG search, and SearXNG is not part of
PAL, so the label path was unreachable code.

Both sources were probed live on 2026-09-15 and behave differently:

  PharmEasy   The search page is server-rendered. A plain GET returns HTML
              containing /online-medicine-order/<slug> links. The product page
              carries a __NEXT_DATA__ blob with composition, strength, form,
              manufacturer and the prescription flag as structured fields.

  Tata 1mg    The search page is NOT server-rendered — __INITIAL_STATE__ comes
              back with searchResults:{} and no product links, so scraping the
              search HTML returns nothing. The page's own JSON endpoint is what
              holds the results, and it requires the city as a header rather
              than only as a query parameter. The product page itself IS
              server-rendered, with labelled fields.

PharmEasy is tried first because structured fields beat parsed prose. 1mg is
the fallback and also the broader catalogue.

The brand-match rule is the safety-relevant part, not a nicety. Both engines
return substitutes: searching 1mg for "glycomet" returns Biciphase, searching
PharmEasy returns Glidum MF. Those are different medicines by different
manufacturers. Showing one of them on a card headed with the patient's brand
name is precisely the brand substitution this whole route exists to refuse, so
a candidate whose name does not carry the patient's own first brand token is
discarded rather than ranked lower.

What this module never does: search by condition, indication or symptom. It
takes a name and only a name. `guard_names` has already established that the
name came from the patient's own words.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Awaitable, Callable
from urllib.parse import quote_plus

from .drug_name_guard import normalise_name
from .sources import is_pharmacy_url

logger = logging.getLogger(__name__)

__all__ = [
    "PharmacyHit",
    "Fetch",
    "find_product_url",
    "parse_pharmeasy_search",
    "parse_onemg_search",
    "onemg_search_url",
    "pharmeasy_search_url",
    "brand_matches",
]

#: url, headers -> body text. Injected so every parser below is testable with
#: no network at all, and so a licensed feed can replace the transport.
Fetch = Callable[[str, dict], Awaitable[str]]

ONEMG_ORIGIN = "https://www.1mg.com"
PHARMEASY_ORIGIN = "https://pharmeasy.in"

#: 1mg's search endpoint rejects the request without a city, and reads it from
#: this header rather than from the query string. Serviceability varies by
#: city; this only affects which listings are shown, never the label content.
ONEMG_DEFAULT_CITY = "Gurgaon"

_UA = "PAL-Clinical/1.0 (+patient medicine information lookup)"


@dataclass(frozen=True)
class PharmacyHit:
    brand: str
    url: str
    source_name: str
    #: The product title as the pharmacy lists it. Kept so the card can show
    #: what was actually found rather than echoing what the patient typed.
    listed_name: str = ""


# --- brand matching ---------------------------------------------------------

#: Words that appear in brand queries but carry no identity. Matching on these
#: would let "tablet" match every product on the site. Note what is NOT here:
#: GP, MF, D and the rest are part of the brand — Glycomet and Glycomet GP are
#: different medicines — so they are identity tokens, not noise.
_NOISE = {
    "tablet", "tablets", "tab", "capsule", "capsules", "cap", "syrup", "strip",
    "of", "mg", "mcg", "ml", "gm", "g", "injection", "cream", "drops",
    "suspension", "the", "a", "pack", "bottle", "sachet",
}

#: Release and formulation markers. Present in a listing but not in what the
#: patient typed, each one costs the candidate a point — so "Glycomet 500"
#: prefers the plain listing over the SR one, while still accepting SR if that
#: is all the pharmacy stocks.
_FORM_MODIFIERS = {"sr", "xr", "pr", "er", "cr", "xl", "ds", "plus", "forte", "trio", "od"}

_DIGITS = re.compile(r"\d+")

#: A token that is only a quantity — "500", "500mg", "0.5ml". These carry dose
#: information, not brand identity, and must not be mistaken for a distinct
#: ingredient when comparing names.
_MEASUREMENT = re.compile(r"^\d+(?:\.\d+)?(?:mg|mcg|g|gm|ml|iu|%)?$")


def _tokens(value: str) -> list[str]:
    return [t for t in normalise_name(value).split() if t]


def _identity_words(value: str) -> list[str]:
    """
    Tokens that identify WHICH medicine this is.

    Quantities, pack words and release markers are excluded; everything else
    counts. "GP", "MF", "D", "AV", "Trio" and the like are ingredients in the
    Indian market, not decoration, so they stay in.
    """
    return [
        t for t in _tokens(value)
        if t not in _NOISE and t not in _FORM_MODIFIERS and not _MEASUREMENT.match(t)
    ]


def _numbers(value: str) -> set[str]:
    """
    Every digit run, wherever it sits. A strength reaches the scorer whether
    the source wrote it as "500", "500mg" or "glycomet-500mg-strip-of-10".
    """
    return set(_DIGITS.findall(normalise_name(value)))


def brand_matches(brand: str, candidate: str) -> int:
    """
    Score a candidate product name against the brand the patient typed.

    Zero means REJECT, not "rank last". Getting this wrong shows a patient a
    different medicine under the name they asked about, so the rule is
    symmetric and strict: the candidate must carry every identity token the
    patient typed, and no identity token they did not.

    Why both halves are needed, with the cases that forced each:

      Missing a token.  "Pan D" must not match "Pan 40". Pan D is
      pantoprazole + domperidone; Pan 40 is pantoprazole alone.

      An extra token.   "Glycomet" must not match "Glycomet GP 1", which was
      what this function did before — and it is the worse direction. Glycomet
      is metformin; Glycomet GP adds glimepiride, a sulfonylurea that causes
      hypoglycaemia. A patient reading a card headed "Glycomet" would have
      been reading the label of a drug that can put them in the ambulance.
      The same shape: Ecosprin 75 vs Ecosprin AV 75 (aspirin, vs aspirin +
      atorvastatin).

      A contradicting strength.  "Glycomet 500" must not match "Glycomet GP 1".
      A listing that gives numbers and shares none of the patient's is refused;
      a listing with no numbers at all is not penalised, only outscored.

    Release markers (SR, XR, PR...) are the one thing that is merely
    penalised rather than refused: they are the same medicine in a different
    formulation, so "Glycomet 500" prefers the plain listing but still accepts
    the SR one when that is all the pharmacy stocks.
    """
    wanted = _identity_words(brand)
    if not wanted:
        return 0

    have_all = set(_tokens(candidate))
    have_identity = set(_identity_words(candidate))

    # Every token the patient typed must be there...
    if not set(wanted).issubset(have_all):
        return 0

    # ...and nothing identifying that they did not.
    if have_identity - set(wanted):
        return 0

    wanted_numbers = _numbers(brand)
    shared_numbers = wanted_numbers & _numbers(candidate)
    if wanted_numbers and _numbers(candidate) and not shared_numbers:
        return 0

    score = 10 * len(wanted) + 5 * len(shared_numbers)

    typed = set(_tokens(brand))
    score -= sum(1 for m in _FORM_MODIFIERS if m in have_all and m not in typed)

    # Never let the modifier penalty push a real match down to a rejection.
    return max(score, 1)


def _best(brand: str, candidates: list[tuple[str, str]]) -> tuple[str, str] | None:
    """candidates: (url, listed_name). Returns the highest-scoring match, or None."""
    # Scored against the listed NAME only. Falling back to the URL let
    # "1mg" match every product on 1mg.com, because the host is in the path.
    scored = [
        (brand_matches(brand, name), url, name)
        for url, name in candidates
        if name
    ]
    scored = [s for s in scored if s[0] > 0]
    if not scored:
        return None
    # max() is stable, so an equal score keeps the engine's own ordering —
    # which is its relevance ranking, and a better tiebreak than anything
    # invented here.
    score, url, name = max(scored, key=lambda s: s[0])
    return url, name


# --- PharmEasy --------------------------------------------------------------

_PE_SLUG = re.compile(r"/online-medicine-order/([a-z0-9][a-z0-9\-]{3,120})", re.IGNORECASE)


def pharmeasy_search_url(brand: str) -> str:
    return f"{PHARMEASY_ORIGIN}/search/all?name={quote_plus(brand)}"


def parse_pharmeasy_search(html: str, brand: str) -> tuple[str, str] | None:
    """
    PharmEasy renders product links into the search HTML, so the slug is both
    the link and the product name: `glycomet-500mg-strip-of-10-tablets-49207`.
    Matching on the slug means no separate title extraction to go stale.
    """
    seen: list[tuple[str, str]] = []
    for match in _PE_SLUG.finditer(html):
        slug = match.group(1)
        url = f"{PHARMEASY_ORIGIN}/online-medicine-order/{slug}"
        if url not in {u for u, _ in seen}:
            seen.append((url, slug.replace("-", " ")))
    return _best(brand, seen)


# --- Tata 1mg ---------------------------------------------------------------


def onemg_search_url(brand: str, city: str = ONEMG_DEFAULT_CITY) -> str:
    return (
        f"{ONEMG_ORIGIN}/pwa-dweb-api/api/v4/search/all"
        f"?q={quote_plus(brand)}&city={quote_plus(city)}"
        "&page_number=0&per_page=10&types=sku,allopathy&sort=relevance"
    )


def parse_onemg_search(body: str, brand: str) -> tuple[str, str] | None:
    """
    data.search_results[] entries carry {name, type, url}. Only `type == "drug"`
    is considered: the same endpoint returns lab tests and OTC products, and a
    lab test has no label to show.
    """
    try:
        payload = json.loads(body)
    except (ValueError, TypeError):
        return None

    results = (payload.get("data") or {}).get("search_results")
    if not isinstance(results, list):
        return None

    candidates: list[tuple[str, str]] = []
    for item in results:
        if not isinstance(item, dict) or item.get("type") != "drug":
            continue
        path = item.get("url") or ""
        if not path.startswith("/drugs/"):
            continue
        candidates.append((f"{ONEMG_ORIGIN}{path}", item.get("name") or ""))

    return _best(brand, candidates)


# --- the lookup -------------------------------------------------------------


async def find_product_url(
    brand: str,
    fetch: Fetch,
    *,
    city: str = ONEMG_DEFAULT_CITY,
) -> PharmacyHit | None:
    """
    Never raises. A source that errors, times out or changes shape is skipped;
    if every source is skipped the answer is None and the turn proceeds without
    a card, which is the behaviour that existed before this module.
    """
    attempts = [
        ("PharmEasy", pharmeasy_search_url(brand), {"User-Agent": _UA}, parse_pharmeasy_search),
        (
            "Tata 1mg",
            onemg_search_url(brand, city),
            {"User-Agent": _UA, "X-City": city, "Accept": "application/json"},
            parse_onemg_search,
        ),
    ]

    for source_name, url, headers, parse in attempts:
        try:
            body = await fetch(url, headers)
        except Exception as exc:  # noqa: BLE001
            logger.info("[pharmacy] %s search failed for %r: %s", source_name, brand, exc)
            continue

        if not body:
            continue

        try:
            found = parse(body, brand)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[pharmacy] %s search parse failed: %s", source_name, exc)
            continue

        if not found:
            logger.info("[pharmacy] %s had no brand match for %r", source_name, brand)
            continue

        product_url, listed_name = found

        # Last gate before anything is fetched: the URL must be on the
        # pharmacy allowlist. A redirect or a changed path cannot walk this
        # off the approved hosts.
        if not is_pharmacy_url(product_url):
            logger.warning("[pharmacy] discarded off-allowlist url %s", product_url)
            continue

        return PharmacyHit(
            brand=brand,
            url=product_url,
            source_name=source_name,
            listed_name=listed_name,
        )

    return None
