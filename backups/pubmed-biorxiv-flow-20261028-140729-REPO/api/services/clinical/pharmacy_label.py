"""
Brand label information from Indian pharmacy listings (1mg, PharmEasy).

What this is for: the patient names a medicine they have been given, and wants
to know what it is — the compound, the strength, what it is used for. The
answer is label information, shown the way Google's health panels show it:
attributed to its source, informational, with a standing instruction to ask
their doctor.

The distinction that makes this coherent with the provenance rule, because it
is easy to lose:

    DISPLAYED label information  — a card, attributed to 1mg or PharmEasy,
                                   carrying the disclaimer. Allowed.
    CITED clinical evidence      — a sentence in the prose answer asserting
                                   that something works, at what dose, with
                                   what risk. NOT allowed from here.

A pharmacy page's "uses" section is pharmacology from a commercial source. It
can be shown as what the label says; it cannot be woven into the answer as a
cited clinical claim. `provenance_class` stays `commercial` throughout, so the
citation guard keeps enforcing the second half — this module cannot weaken it
even by accident.

What is never produced here: a recommendation, a comparison, a substitution, a
dose the patient should take. Those are prescriptions however they are phrased,
and they are refused upstream by `detect_prescribing_intent`.

The fetcher is injected so the extraction is testable without a network, and
so a licensed feed can replace the scrape without touching anything else.
"""
from __future__ import annotations

import html as html_module
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Callable, Awaitable

from .provenance import ProvenanceClass

logger = logging.getLogger(__name__)

__all__ = [
    "DISCLAIMER",
    "PharmacyLabel",
    "extract_label",
    "extract_generic",
    "extract_pharmeasy",
    "build_label_card",
    "PharmacyLabelResolver",
]

#: Attached to every card. Not optional, not configurable, not shortened.
DISCLAIMER = (
    "This is information about a medicine, not advice to take it. "
    "It is taken from a pharmacy listing and has not been checked against your "
    "own health records. For anything about your treatment — whether this is "
    "right for you, what dose, or whether to change or stop it — please ask "
    "your doctor."
)

#: Shown in place of the "uses" section when the source gives none, so the card
#: never looks like it is withholding something.
_NO_USES = "The listing does not state what this is used for."


@dataclass
class PharmacyLabel:
    brand: str
    source_url: str
    source_name: str
    composition: str | None = None
    strength: str | None = None
    form: str | None = None
    manufacturer: str | None = None
    uses: list[str] = field(default_factory=list)
    side_effects: list[str] = field(default_factory=list)
    prescription_required: bool | None = None

    def to_chunk(self) -> dict:
        return {
            "brand": self.brand,
            "composition": self.composition,
            "strength": self.strength,
            "form": self.form,
            "manufacturer": self.manufacturer,
            "uses": self.uses,
            "side_effects": self.side_effects,
            "prescription_required": self.prescription_required,
            "url": self.source_url,
            "title": f"{self.brand} — {self.source_name}",
            # Never anything else. This is what keeps the citation guard able
            # to refuse a clinical claim sourced from here.
            "provenance_class": ProvenanceClass.commercial.value,
            "phi": False,
        }


# --- extraction -------------------------------------------------------------
#
# Deliberately conservative: a field that cannot be read confidently is left
# as None rather than guessed. A wrong composition is worse than a missing one,
# because the patient has no way to tell it is wrong.
#
# Both page shapes were read off the live sites on 2026-09-15 and they are not
# alike, so there are two specific extractors and one generic fallback:
#
#   PharmEasy  __NEXT_DATA__ carries productDetails with compositions[],
#              drugStrengthValue/Unit, dosageForm, manufacturer and
#              isRxRequired as real fields. Parsed, not pattern-matched.
#   Tata 1mg   Server-rendered HTML with labelled fields —
#              "Composition : Metformin (500mg)", "Marketer details : USV
#              Private Limited" — and prose sections for uses and side effects.
#   fallback   Patterns only, for a page that is neither.
#
# The flattener turns every tag into "|" rather than a space. That single
# choice does most of the work: it preserves the boundary between a label and
# its value and between one list item and the next, which a space destroys. It
# also stops a value running on into the next field, because the value
# character classes below exclude "|".

_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")
_PIPES = re.compile(r"\s*\|[\s|]*")

_PATTERNS = {
    # The separator is REQUIRED, and the label is word-bounded. Both were
    # optional, and prose walked straight in:
    #   "…to avoid decomposition of the active ingredient in sunlight"
    #       -> composition = "of the active ingredient in sunlight"
    #   "The manufacturer and the marketplace are not liable for any misuse…"
    #       -> manufacturer = "and the marketplace are not liable for…"
    # A missing field is recoverable. A field confidently filled with a
    # sentence from the small print is not.
    "composition": [
        r"\b(?:salt\s+composition|composition|generic\s+name)\b\s*\|?\s*[:\-\u2013]\s*\|?\s*([A-Za-z0-9 ,+()./%-]{3,120})",
    ],
    "manufacturer": [
        r"\b(?:marketer\s+details|manufacturer\s+name|manufacturer|marketed\s+by|mfr)\b\s*\|?\s*[:\-\u2013]\s*\|?\s*([A-Za-z0-9 .,&()-]{3,80})",
    ],
    "strength": [
        r"\b(\d+(?:\.\d+)?\s?(?:mg|mcg|g|ml|iu|%)(?:\s*/\s*\d+(?:\.\d+)?\s?(?:mg|mcg|g|ml))?)\b",
    ],
    "form": [
        r"\b(tablets?|capsules?|syrup|suspension|injection|cream|ointment|drops|inhaler|gel)\b",
    ],
}

_RX_MARKERS = [
    r"prescription\s+required",
    r"\brx\s+required\b",
    r"schedule\s+h1?\b",
    r"prescription\s+drug",
]

#: Headings that end a section. Without these the "uses" list runs on into the
#: benefits, the safety advice and eventually the site footer.
#:
#: Only recognised at a tag boundary — see `_STOP_AT`. Matched anywhere, the
#: phrase "the common side effects of this medicine include..." inside the side
#: effects body reads as the start of the next section and truncates the list
#: to its first word. That is exactly what happened on the live 1mg page.
_STOP_HEADING = re.compile(
    r"(?:side\s+effects?|benefits?\s+of|how\s+(?:it\s+works|to\s+use)|safety\s+advice"
    r"|directions?\s+for\s+use|quick\s+tips?|fact\s+box|drug\s+interaction"
    r"|all\s+substitutes?|expert\s+advice|frequently\s+asked|faqs?\b"
    r"|what\s+if\s+you\s+forget|patient\s+concerns|country\s+of\s+origin"
    r"|manufacturer\s+details|references?\s*:|disclaimer)",
    re.IGNORECASE,
)

#: A stop heading that is genuinely its own element: preceded by a tag boundary.
_STOP_AT = re.compile(r"\|(?=\s*(?:" + _STOP_HEADING.pattern + r"))", re.IGNORECASE)


def _stop_index(chunk: str) -> int | None:
    match = _STOP_AT.search(chunk)
    return match.start() if match else None


def _strip_element(text: str, tag: str) -> str:
    """
    Remove every <tag>...</tag>, by scanning rather than by regex.

    The regex version — `<(script|style)\b[^>]*>.*?</\1>` — rescans to the end
    of the document from every unclosed opening tag. On a page with 8,000 stray
    `<script`s that is 11 seconds of synchronous CPU, and 26 seconds at 16,000:
    not backtracking, just O(n·m), and just as bad. It runs on the event loop,
    so `asyncio.wait_for` cannot interrupt it and every other request in the
    process waits. A 4 MB page never finished.

    This is a single left-to-right pass. An unclosed tag swallows the rest of
    the document, which is both what a browser does and the safe direction —
    script contents must not reach the card.
    """
    lower = text.lower()
    open_tag, close_tag = f"<{tag}", f"</{tag}"
    out: list[str] = []
    i = 0
    while True:
        start = lower.find(open_tag, i)
        if start == -1:
            out.append(text[i:])
            return "".join(out)
        # Only a real tag: <script> or <script src=...>, not <scriptfoo>
        after = lower[start + len(open_tag): start + len(open_tag) + 1]
        if after not in ("", ">", " ", "\t", "\n", "\r", "/"):
            out.append(text[i: start + len(open_tag)])
            i = start + len(open_tag)
            continue
        out.append(text[i:start])
        end = lower.find(close_tag, start)
        if end == -1:
            return "".join(out)          # unclosed: drop the remainder
        gt = lower.find(">", end)
        i = len(text) if gt == -1 else gt + 1


def _text_of(html: str) -> str:
    """
    Flatten to pipe-delimited text.

    Scripts and styles come out first. That is not tidiness: before they did,
    the manufacturer pattern matched a CSS rule on the live 1mg page and put
    "Manufacturer-module__separator___P-NBE{width:100%..." on the card.
    """
    text = _strip_element(html, "script")
    text = _strip_element(text, "style")
    text = _TAG.sub("|", text)
    # html.unescape handles the full entity set and does it in one pass. The
    # hand-rolled sequence replaced &amp; first, so it decoded recursively:
    # "&amp;lt;b&amp;gt;" came out as "<b>", re-introducing markup AFTER the
    # tags had been stripped.
    text = html_module.unescape(text)
    text = _WS.sub(" ", text)
    return _PIPES.sub("|", text).strip(" |")


def _first(text: str, patterns: list[str]) -> str | None:
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            value = match.group(1).strip(" .,-\u2013|")
            if value:
                return value
    return None


def _clean_items(parts: list[str], limit: int) -> list[str]:
    items: list[str] = []
    for part in parts:
        item = _WS.sub(" ", part).strip(" .,-\u2013|")
        if not (3 <= len(item) <= 90):
            continue
        if _STOP_HEADING.search(item) or re.match(r"^\s*uses?\s+of\b", item, re.IGNORECASE):
            continue
        if item.lower() in {i.lower() for i in items}:
            continue
        items.append(item)
        if len(items) >= limit:
            break
    return items


def _section_after(text: str, heading: str, span: int = 500) -> str:
    """
    The body of a section, bounded by the next heading.

    Tries the pipe-anchored form first — heading, then a tag boundary, then the
    content — because on a real listing page the heading is its own element and
    that anchor is exact. Falls back to a plain offset for a page with no
    useful markup left.
    """
    # The loose branch now REQUIRES a separator. Without one it matched
    # "the misuses of this medicine include recreational sedation, euphoria
    # and dep|endence" and put "ependence" on the card as a use — a mid-word
    # fragment, from a sentence that was not a uses section at all.
    for pattern, strict in (
        (heading + r"[^|]{0,60}\|", True),
        (heading + r"[^.|]{0,60}?\s*[:\-\u2013]\s*", False),
    ):
        match = re.search(pattern, text, re.IGNORECASE)
        if not match:
            continue
        chunk = text[match.end(): match.end() + span]
        stop = _stop_index(chunk)
        if stop is not None:
            chunk = chunk[:stop]
        chunk = chunk.strip(" |")
        if strict and len(chunk) < 8:
            continue  # heading matched an index link, not the section itself
        if chunk:
            return chunk
    return ""


def _listed_after(text: str, heading: str, limit: int = 6) -> list[str]:
    """
    Items following a heading, however the page happens to express them.

    Three shapes, all seen live: pipe-separated list items, semicolon-separated
    prose, and "... include a, b, c and d." — the last is how 1mg writes side
    effects, and splitting it naively on commas puts "this medicine include
    diarrhea" on the card as if it were a side effect.
    """
    chunk = _section_after(text, heading)
    if not chunk:
        return []

    inclusive = re.search(r"\binclude(?:s|d)?\b\s*:?\s*(.{10,300}?)(?:\.|\||$)", chunk, re.IGNORECASE)
    if inclusive:
        tail = re.sub(r"\band\b", ",", inclusive.group(1), flags=re.IGNORECASE)
        items = _clean_items(tail.split(","), limit)
        if len(items) >= 2:
            return items

    return _clean_items(re.split(r"[|;\u2022\u00b7]|\.(?=\s|$)", chunk), limit)


def _strip_zero(value: str) -> str:
    return re.sub(r"(\d+)\.0\b", r"\1", value).strip()


def extract_pharmeasy(html: str, *, brand: str, url: str, source_name: str) -> PharmacyLabel | None:
    """
    PharmEasy ships productDetails as JSON inside __NEXT_DATA__. Reading the
    fields the site itself uses beats pattern-matching its rendered prose:
    there is nothing to mis-split, and a redesign that moves the text around
    does not change the data.
    """
    match = re.search(
        r'<script[^>]+id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.DOTALL
    )
    if not match:
        return None
    try:
        details = json.loads(match.group(1))["props"]["pageProps"]["productDetails"]
    except (ValueError, KeyError, TypeError):
        return None
    if not isinstance(details, dict):
        return None

    # Everything below is site-controlled. `"; ".join(...)` on a non-string
    # and `.isupper()` on an int both raised straight out of the resolver,
    # which breaks the patient's turn over a JSON shape change at PharmEasy.
    # Coerce, never assume.
    compositions = [
        str(c.get("name")) for c in (details.get("compositions") or [])
        if isinstance(c, dict) and c.get("name")
    ]

    strength = None
    value, unit = details.get("drugStrengthValue"), details.get("drugStrengthUnit")
    if value and unit:
        strength = _strip_zero(f"{value}") + str(unit).lower()

    form = details.get("dosageForm") or details.get("packform")

    rx = details.get("isRxRequired")

    listed_brand = str(details.get("consumerBrandName") or details.get("name") or brand)
    # A brand or a composition with no letters in it is not a brand or a
    # composition, whatever the JSON says. Fall back rather than print "123".
    if not re.search(r"[A-Za-z]", listed_brand):
        listed_brand = brand
    if listed_brand.isupper():
        listed_brand = listed_brand.title()

    text = _text_of(html)
    return PharmacyLabel(
        brand=listed_brand,
        source_url=url,
        source_name=source_name,
        composition=(
            _strip_zero("; ".join(compositions))
            if any(re.search(r"[A-Za-z]", c) for c in compositions) else None
        ) or None,
        strength=strength,
        form=str(form).lower().capitalize() if form else None,
        manufacturer=str(details["manufacturer"]) if details.get("manufacturer") else None,
        uses=_listed_after(text, r"\buses?\s+of"),
        side_effects=_listed_after(text, r"\bside\s+effects?\s+of"),
        prescription_required=bool(rx) if rx is not None else None,
    )


def _strength_of(composition: str | None, text: str, brand: str) -> str | None:
    """
    The strength of THIS product.

    A page-wide search for the first number-plus-unit is wrong in a way that
    is hard to see and easy to believe. Real examples from live pages:

        "Extra 15% off"                      -> strength "15%"
        "Free gift: 100 g sanitiser"         -> strength "100 g"
        a "similar products" link to
        Metformin 500mg, on the page for
        Glycomet 850                         -> strength "500mg"

    The last one is the dangerous one: the card then states a strength that
    contradicts its own composition line, and the patient has no way to see
    which is right.

    So: read it out of the composition, which is the field that is actually
    about this product. Only if there is no composition at all does it fall
    back to the page, and then only within sight of the brand name.
    """
    if composition:
        found = _first(composition, _PATTERNS["strength"])
        if found:
            return found

    return _first(_near(text, brand), _PATTERNS["strength"])


def _near(text: str, needle: str, span: int = 260) -> str:
    """The window around the first mention of the brand, or the empty string."""
    if not needle:
        return ""
    index = text.lower().find(needle.lower().split()[0])
    if index == -1:
        return ""
    return text[max(0, index - span // 4): index + span]


def extract_generic(html: str, *, brand: str, url: str, source_name: str) -> PharmacyLabel:
    text = _text_of(html)
    composition = _first(text, _PATTERNS["composition"])

    return PharmacyLabel(
        brand=brand,
        source_url=url,
        source_name=source_name,
        composition=composition,
        strength=_strength_of(composition, text, brand),
        # Same reasoning as strength: taken page-wide, a "Tablets" breadcrumb
        # put "Tablet" on the card for a syrup. None beats wrong.
        form=_first(_near(text, brand), _PATTERNS["form"]),
        manufacturer=_first(text, _PATTERNS["manufacturer"]),
        uses=_listed_after(text, r"\buses?\s+of"),
        side_effects=_listed_after(text, r"\bside\s+effects?\s+of"),
        prescription_required=(
            True if any(re.search(m, text, re.IGNORECASE) for m in _RX_MARKERS) else None
        ),
    )


def extract_label(html: str, *, brand: str, url: str, source_name: str) -> PharmacyLabel:
    """
    Dispatch on what the page actually provides, not on its host: a page that
    carries structured product data gets read structurally wherever it came
    from, and anything else falls back to patterns.

    Never raises. A page is untrusted input, and a parse failure must cost the
    card, not the turn.
    """
    try:
        structured = extract_pharmeasy(html, brand=brand, url=url, source_name=source_name)
        if structured and (structured.composition or structured.strength):
            return structured
    except Exception as exc:  # noqa: BLE001
        logger.warning("[pharmacy] structured parse failed for %s: %s", url, exc)

    try:
        return extract_generic(html, brand=brand, url=url, source_name=source_name)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[pharmacy] extraction failed for %s: %s", url, exc)
        return PharmacyLabel(brand=brand, source_url=url, source_name=source_name)


def build_label_card(label: PharmacyLabel) -> dict:
    """
    The renderable card. The disclaimer is attached here rather than left to
    the caller, so there is no path that produces a card without one.
    """
    card = label.to_chunk()
    card["card_type"] = "drug_label"
    card["disclaimer"] = DISCLAIMER
    card["attribution"] = f"Source: {label.source_name} — {label.source_url}"
    if not label.uses:
        card["uses_note"] = _NO_USES
    if label.prescription_required:
        card["badge"] = "Prescription only"
    # Belt and braces for any renderer that forgets: the fields a UI must show.
    card["required_display_fields"] = ["disclaimer", "attribution"]
    return card


class PharmacyLabelResolver:
    """
    Fetch-and-extract, with the network injected.

    `fetch` takes a URL and returns HTML. In production that is an httpx call
    against a URL the pharmacy-restricted SearXNG search already found; in
    tests it is a dict lookup. A licensed feed replaces this class entirely
    and everything above it keeps working.
    """

    name = "pharmacy-label"

    def __init__(self, fetch: Callable[[str], Awaitable[str]]):
        self._fetch = fetch

    async def resolve(
        self, brand: str, url: str, source_name: str
    ) -> PharmacyLabel | None:
        try:
            html = await self._fetch(url)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[pharmacy] fetch failed for %s: %s", url, exc)
            return None

        if not html or len(html) < 200:
            return None

        label = extract_label(html, brand=brand, url=url, source_name=source_name)

        # A card with a brand and nothing else tells the patient nothing and
        # looks broken. Better to say the lookup found nothing.
        if not (label.composition or label.uses or label.strength):
            logger.info("[pharmacy] no usable fields extracted for %s", brand)
            return None

        return label
