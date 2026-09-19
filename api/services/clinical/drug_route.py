"""
The drug route, end to end: patient's words in, label card out.

This is the only module that joins the three pieces that already existed
separately — the name guard, the product-page finder and the label extractor —
and it is the only one the orchestrator calls.

The route, and the reason each step is where it is:

  1. `looks_like_a_medicine_question`  Cheap, local, no network. Without it
     every turn would fire two HTTP requests on the off-chance a word was a
     brand name.
  2. `extract_brand_candidates`        Names are read out of the patient's own
     sentence. There is no step that proposes a name, which is why the route
     cannot run from a condition to a brand.
  3. `guard_names`                     Belt and braces. Step 2 makes this
     redundant today; it is here so that a future caller that sources names
     some other way still cannot get a name past it.
  4. `find_product_url` + label        Network. Everything here is best-effort.
  5. `build_label_card`                Attaches the disclaimer. There is no
     path to a card without one.

Prescription requests never arrive: `detect_prescribing_intent` short-circuits
the turn in the orchestrator before this module is reached, so "which is
better, Glycomet or Glucophage" goes to the doctor-referral exit rather than
returning two cards side by side, which would be a comparison in all but name.

Failure is always silence. Every entry point returns an empty list rather than
raising, because a pharmacy being slow is not a reason for a patient to get an
error instead of an answer.
"""
from __future__ import annotations

import asyncio
import logging
import re

from .drug_name_guard import guard_names, normalise_name
from .pharmacy_label import build_label_card, extract_label
from .pharmacy_search import Fetch, find_product_url, ONEMG_DEFAULT_CITY
from .sources import is_pharmacy_url

logger = logging.getLogger(__name__)

__all__ = [
    "looks_like_a_medicine_question",
    "extract_brand_candidates",
    "lookup_drug_cards",
    "httpx_fetch",
    "MAX_PAGE_BYTES",
    "MAX_QUERY_CHARS",
]

#: The turn must look like a question ABOUT a named medicine. Deliberately
#: narrow: a false positive costs two HTTP requests and, worse, risks putting a
#: medicine card on a turn that was never about a medicine.
_MEDICINE_QUESTION = re.compile(
    r"\b(?:"
    r"what\s+is\s+\w|what's\s+\w|what\s+are\s+\w"
    r"|uses?\s+of\b|used\s+for\b|what\s+does\s+\w+\s+do\b"
    r"|side\s*[- ]?effects?\b|composition\b|contains?\b|salt\b"
    r"|tell\s+me\s+about\b|information\s+(?:on|about)\b"
    r"|tablets?\b|capsules?\b|syrup\b|injection\b|\bmedicine\b|\bmedication\b|\bdrug\b"
    r"|prescribed\b|\bi\s+(?:take|am\s+taking|was\s+given|have\s+been\s+given)\b"
    r")"
    # Hindi/Marathi and Gujarati cues, so a question asked in the patient's own
    # language about a Latin-script brand — which is how brand names are
    # printed on an Indian strip — reaches the route. A brand name written in
    # Devanagari or Gujarati still will not resolve, because the pharmacy
    # catalogues are in English; that returns no card rather than a wrong one.
    r"|दवाई?|गोली|टैबलेट|क्या\s*है|असर|साइड|बारे\s*में"
    r"|દવા|ગોળી|ટેબ્લેટ|શું\s*છે",
    re.IGNORECASE,
)

#: Words that show up in these questions and are never brand names. A short
#: list beats a dictionary: anything not on it still has to survive being
#: looked up on a pharmacy and matching the product name that comes back.
_NOT_A_BRAND = {
    "what", "whats", "what's", "is", "are", "the", "this", "that", "these", "those",
    "a", "an", "of", "for", "to", "in", "on", "and", "or", "my", "me", "i", "it",
    "do", "does", "did", "can", "could", "should", "would", "will", "am", "was",
    "been", "have", "has", "had", "used", "use", "uses", "using", "take", "taking",
    "taken", "given", "give", "prescribed", "prescribe", "doctor", "side", "effects",
    "effect", "tell", "about", "information", "please", "help", "know", "good", "bad",
    "safe", "when", "how", "why", "which", "who", "with", "without", "from", "any",
    "medicine", "medicines", "medication", "medications", "drug", "drugs", "tablet",
    "tablets", "capsule", "capsules", "syrup", "injection", "dose", "dosage", "mg",
    "ml", "day", "daily", "morning", "night", "food", "water", "sugar", "blood",
    "pressure", "diabetes", "fever", "pain", "cold", "cough", "infection",
    "composition", "salt", "contains", "contain", "strip", "bottle", "pack",
    # Openers and politeness. Without these, "Hello sir, tell me about
    # Glycomet 500" spent both candidate slots on "Hello" and "sir" and the
    # medicine was never looked up at all — a silent miss, and a likely one
    # in the target cohort.
    "hello", "hallo", "hi", "hey", "namaste", "namaskar", "sir", "madam", "maam",
    "ji", "sahib", "kindly", "thanks", "thank", "please", "greetings", "dear",
    "good", "morning", "evening", "afternoon", "hope", "well", "sorry", "excuse",
    # Everyday nouns that are not medicines. The pharmacy name-match would
    # reject them anyway, but each one costs two HTTP requests and puts a word
    # from the patient's turn into a third party's URL.
    "surgery", "operation", "appointment", "appointments", "risks", "risk",
    "test", "tests", "result", "results", "report", "reports", "scan", "scans",
    "diet", "exercise", "insurance", "hospital", "clinic", "nurse", "cost",
    "price", "prices", "delivery", "treatment", "treatments", "therapy",
    "symptom", "symptoms", "condition", "disease", "problem", "problems",
    "times", "time", "week", "weeks", "month", "months", "year", "years",
    "today", "tomorrow", "yesterday", "next", "last", "first", "second",
    "gave", "gives", "giving", "said", "says", "told", "tells", "asked", "asks",
    "wrote", "written", "started", "start", "stopped", "stop", "changed", "change",
    "feel", "feeling", "felt", "think", "thought", "want", "wants", "need", "needs",
    "than", "then", "also", "very", "much", "more", "less", "some", "all", "not",
    "you", "your", "his", "her", "him", "its", "our", "they", "them", "new", "old",
    "may", "get", "got", "one", "two", "per", "off", "out", "now", "but", "if",
    "there", "here", "just", "still", "after", "before", "during", "every", "each",
    # Hindi/Gujarati function words, so a question in the patient's own language
    # does not offer its grammar to the pharmacy as a brand name.
    "\u092e\u0941\u091d\u0947", "\u092e\u0947\u0930\u0947", "\u092e\u0947\u0930\u0940", "\u0915\u0947", "\u0915\u093e", "\u0915\u0940", "\u0915\u094d\u092f\u093e", "\u0939\u0948", "\u0939\u0948\u0902", "\u092c\u093e\u0930\u0947", "\u092e\u0947\u0902",
    "\u092c\u0924\u093e\u0907\u090f", "\u092c\u0924\u093e\u0913", "\u0926\u0935\u093e", "\u0926\u0935\u093e\u0908", "\u0917\u094b\u0932\u0940", "\u0905\u0938\u0930", "\u0915\u0930\u0924\u093e", "\u0915\u0930\u0924\u0940", "\u0932\u093f\u090f",
    "\u0AAE\u0ABE\u0AB0\u0AC7", "\u0AB6\u0AC1\u0A82", "\u0A9B\u0AC7", "\u0AA6\u0AB5\u0ABE", "\u0A97\u0ACB\u0AB3\u0AC0", "\u0AB5\u0ABF\u0AB6\u0AC7", "\u0A95\u0AB9\u0ACB",
}

#: Three characters and up: Indian brands really are that short — Pan 40, Zen,
#: Met — and a four-character floor would silently exclude some of the most
#: commonly dispensed medicines in the country. The looser bound costs more
#: candidates, which the stop list and the pharmacy name-match absorb.
_CANDIDATE = re.compile(r"[A-Za-zऀ-ॿ઀-૿][A-Za-z0-9ऀ-ॿ઀-૿\-]{2,23}")

#: A word introduced like this is what the medicine is *for*. Looking it up
#: would turn the route around: condition in, brand out.
_INDICATION_LEAD = re.compile(
    r"\b(?:for|against|treat|treats|treating|treatment\s+of|cure|cures|curing"
    r"|used\s+in|relief\s+from|relieve|relieves|manage|managing|control|controlling)"
    r"\s+(?:the\s+|my\s+|a\s+|an\s+)?$",
    re.IGNORECASE,
)

#: How far back to look for that lead-in. "for the treatment of " is 21
#: characters, so the old 14-character window could not see it — which is how
#: "what is the medicine for the treatment of hypertension" ended up sending
#: `hypertension` to pharmeasy.in in a URL.
_INDICATION_LOOKBACK = 34

#: Phrases that introduce a medicine name. Used for ranking, not filtering —
#: a name with no cue is still a candidate, just a lower-priority one.
_NAME_CUE = re.compile(
    r"\b(?:what\s+is|what's|whats|what\s+are|about|of|tab|tablet|capsule|syrup"
    r"|taking|take|took|given|give|prescribed|started|using|use"
    r"|\u0926\u0935\u093e|\u0926\u0935\u093e\u0908|\u0917\u094b\u0932\u0940)"
    r"\s+(?:the\s+|a\s+|an\s+|my\s+)?$",
    re.IGNORECASE,
)
_CUE_LOOKBACK = 22

#: Two per turn. A patient naming three medicines at once is asking for a
#: comparison, and a comparison is refused upstream.
MAX_CANDIDATES = 2


def looks_like_a_medicine_question(query: str) -> bool:
    return bool(_MEDICINE_QUESTION.search((query or "")[:MAX_QUERY_CHARS]))


def extract_brand_candidates(query: str, limit: int = MAX_CANDIDATES) -> list[str]:
    """
    Candidate brand names, taken only from what the patient wrote.

    A candidate is a guess, not a finding. It becomes a card only if a pharmacy
    returns a product whose own name carries it — that lookup, not this
    function, is what decides whether a word was a medicine.
    """
    if not query:
        return []
    query = query[:MAX_QUERY_CHARS]

    cued: list[str] = []
    uncued: list[str] = []
    seen: set[str] = set()

    for match in _CANDIDATE.finditer(query):
        word = match.group(0).strip("-")
        key = normalise_name(word)
        if not key or key in seen or key in _NOT_A_BRAND:
            continue
        # "something for hypertension" names a condition, not a brand. The
        # pharmacy name-match would reject it anyway; refusing it here means
        # the condition is never sent to a pharmacy in the first place, which
        # is the property the one-way rule is actually about.
        if _INDICATION_LEAD.search(query[max(0, match.start() - _INDICATION_LOOKBACK): match.start()]):
            continue
        seen.add(key)

        # Carry an immediately following strength, so "Glycomet 500" is looked
        # up as the patient wrote it and prefers the 500 listing.
        tail = query[match.end(): match.end() + 24]
        strength = re.match(
            # Either the number carries a unit, or it is not immediately
            # followed by a frequency word. "Augmentin 3 times a day" is a
            # dose schedule, and looking up "Augmentin 3" finds nothing —
            # a correctly named medicine that silently produced no card.
            r"\s*(\d{1,4})\s?(?:mg|mcg|ml|gm)\b"
            # "tablet"/"capsule" are deliberately NOT here: in "Pan 40 tablet"
            # the 40 is the strength and "tablet" is the form.
            r"|\s*(\d{1,4})\b(?!\s*(?:times?|x|daily|a\s+day|per|hourly|days?|weeks?|months?|hours?)\b)",
            tail, re.IGNORECASE,
        )
        if strength:
            word = f"{word} {strength.group(1) or strength.group(2)}"

        # A word the sentence points at — "what is X", "taking X", "about X" —
        # outranks a word that merely appears in it. The limit is applied
        # after this ordering, not to whatever came first in the string.
        lead = query[max(0, match.start() - _CUE_LOOKBACK): match.start()]
        (cued if _NAME_CUE.search(lead) else uncued).append(word)

        if len(cued) >= limit:
            break

    return (cued + uncued)[:limit]


#: A pharmacy product page is a few hundred KB. Anything an order of magnitude
#: past that is not a product page, and reading it into memory on every turn is
#: a denial-of-service the pharmacy could inflict on PAL by accident.
MAX_PAGE_BYTES = 4 * 1024 * 1024

#: Redirects are followed, but only within the allowlist. Three is plenty for
#: http→https and www→apex.
MAX_REDIRECTS = 3

#: Only this much of a turn is scanned for medicine names. The patterns are all
#: linear, so this is not about complexity — it is about not walking a megabyte
#: of pasted text on every single turn.
MAX_QUERY_CHARS = 2000


async def httpx_fetch(url: str, headers: dict | None = None, *, timeout: float = 8.0) -> str:
    """
    The production transport, with redirects followed by hand.

    `follow_redirects=True` was not enough and read as though it were. It
    validates nothing: httpx walks the whole chain internally, so checking the
    final URL afterwards means every intermediate hop has ALREADY been
    requested. An open redirect on a pharmacy host — and the starting URL
    comes from a pharmacy's own search results — was enough to make PAL issue
    a GET against any address reachable from our network, including
    169.254.169.254, and return normally with the final hop's body. Blind, but
    real, and nothing logged it.

    So: no automatic redirects. Every hop is checked against the allowlist
    BEFORE it is requested.

    The body is read in chunks and abandoned once it passes the cap, rather
    than buffered and measured afterwards — measuring `response.content` means
    the 42 MB is already in memory when you decide it was too big.
    """
    import httpx

    if not is_pharmacy_url(url):
        raise ValueError("refusing to fetch a URL outside the pharmacy allowlist")

    async with httpx.AsyncClient(
        timeout=timeout, follow_redirects=False, headers=headers or {}
    ) as client:
        current = url

        for _ in range(MAX_REDIRECTS + 1):
            request = client.build_request("GET", current)
            response = await client.send(request, stream=True)
            try:
                if response.is_redirect:
                    location = response.headers.get("location", "")
                    if not location:
                        raise ValueError("redirect with no destination")
                    nxt = str(response.next_request.url) if response.next_request else location
                    if not is_pharmacy_url(nxt):
                        raise ValueError(f"redirect off the allowlist: {_host(nxt)}")
                    current = nxt
                    continue

                response.raise_for_status()

                declared = response.headers.get("content-length")
                if declared and int(declared) > MAX_PAGE_BYTES:
                    raise ValueError(f"page declares {declared} bytes, cap is {MAX_PAGE_BYTES}")

                chunks: list[bytes] = []
                total = 0
                async for chunk in response.aiter_bytes():
                    total += len(chunk)
                    if total > MAX_PAGE_BYTES:
                        raise ValueError(f"page exceeds {MAX_PAGE_BYTES} bytes")
                    chunks.append(chunk)

                encoding = response.encoding or "utf-8"
                return b"".join(chunks).decode(encoding, errors="replace")
            finally:
                await response.aclose()

        raise ValueError(f"too many redirects (limit {MAX_REDIRECTS})")


def _host(url: str) -> str:
    from urllib.parse import urlparse

    return urlparse(url).netloc or "(unparseable)"


def _page_fetcher(fetch: Fetch):
    """`PharmacyLabelResolver`-shaped fetch (url only) over a two-argument one."""

    async def _fetch(url: str) -> str:
        return await fetch(url, {"User-Agent": "PAL-Clinical/1.0"})

    return _fetch


async def lookup_drug_cards(
    query: str,
    *,
    fetch: Fetch | None = None,
    city: str = ONEMG_DEFAULT_CITY,
    limit: int = MAX_CANDIDATES,
    budget_seconds: float = 12.0,
) -> list[dict]:
    """
    Returns renderable label cards for the medicines the patient named.

    Empty is the normal, safe answer: nothing looked like a medicine question,
    no name survived the guard, no pharmacy had a matching product, or the
    network was slow. In every one of those cases the turn carries on exactly
    as it did before this route existed.
    """
    if not looks_like_a_medicine_question(query):
        return []

    candidates = extract_brand_candidates(query, limit=limit)
    if not candidates:
        return []

    # The name-provenance guard. Redundant given where `candidates` came from,
    # and kept precisely so it stays true when that changes.
    allowed, rejected = guard_names(candidates, query)
    if rejected:
        logger.warning(
            "[drug-route] refused %d name(s) absent from the patient's words", len(rejected)
        )
    if not allowed:
        return []

    if fetch is None:
        fetch = httpx_fetch

    # Cards accumulate HERE, not inside the coroutine, so a timeout or a
    # failure on the second medicine cannot throw away a card that was already
    # built for the first. `wait_for` cancels the coroutine; anything the
    # coroutine had returned would have gone with it.
    cards: list[dict] = []
    try:
        await asyncio.wait_for(
            _resolve_all(allowed, fetch, city, cards), timeout=budget_seconds
        )
    except asyncio.TimeoutError:
        logger.info(
            "[drug-route] lookup exceeded %.1fs budget; returning %d card(s) already built",
            budget_seconds, len(cards),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[drug-route] lookup failed after %d card(s): %s", len(cards), exc)
    return cards


async def _resolve_all(
    brands: list[str], fetch: Fetch, city: str, cards: list[dict]
) -> None:
    """Appends to `cards` as it goes, so partial results survive a later failure."""
    page = _page_fetcher(fetch)

    for brand in brands:
        try:
            hit = await find_product_url(brand, fetch, city=city)
        except Exception as exc:  # noqa: BLE001
            logger.info("[drug-route] search failed for %r: %s", brand, exc)
            continue
        if hit is None:
            continue

        try:
            html = await page(hit.url)
        except Exception as exc:  # noqa: BLE001
            logger.info("[drug-route] could not fetch %s: %s", hit.url, exc)
            continue

        if not html or len(html) < 200:
            continue

        # Headed by the listing, not by what the patient typed. The generic
        # extractor kept the typed string, so a card could read "Glycomet"
        # over the composition of whatever listing was actually fetched. The
        # brand-match rule now makes that mismatch unreachable, and this makes
        # it visible if it ever becomes reachable again.
        label = extract_label(
            html, brand=hit.listed_name or brand, url=hit.url,
            source_name=hit.source_name,
        )

        # A card showing only the name tells the patient nothing they did not
        # already know, and looks like a malfunction. Say nothing instead.
        if not (label.composition or label.uses or label.strength):
            logger.info("[drug-route] no usable fields for %r", brand)
            continue

        card = build_label_card(label)
        card["searched_as"] = brand
        card["listed_as"] = hit.listed_name
        cards.append(card)
