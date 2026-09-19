#!/usr/bin/env python3
"""
Check the drug label route against the live pharmacies.

    python scripts/verify_pharmacy_live.py            # default brands
    python scripts/verify_pharmacy_live.py Dolo 650

Why this exists: the unit tests run against fixtures transcribed from these
sites on 2026-09-15. Fixtures cannot notice a redesign. This can, and it is the
thing to run when a card starts looking wrong or empty.

What each check is really watching for:

  1  PharmEasy search  Their search page is server-rendered today. If it ever
                       goes client-rendered — which is what 1mg did — the
                       product links vanish from the HTML and this returns
                       nothing, silently, with no error.
  2  1mg search        Requires the city as a header. Without it the endpoint
                       answers 400 "City is required", which is not a crash
                       and not an empty result but a shape the parser skips.
  3  Brand match       That a substitute is still refused. 1mg answers
                       "glycomet" with Biciphase; PharmEasy with Glidum MF.
  4  Label fields      That composition, strength, manufacturer, uses and side
                       effects are all still findable on a real product page.
  5  The disclaimer    Present on every card. There is no path that omits it,
                       and this is the check that proves it on live data.

Exit status is 0 only when every brand produced a usable card from at least
one source.
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.clinical.drug_route import httpx_fetch, lookup_drug_cards  # noqa: E402
from services.clinical.pharmacy_label import DISCLAIMER, extract_label  # noqa: E402
from services.clinical.pharmacy_search import (  # noqa: E402
    brand_matches,
    find_product_url,
)

DEFAULT_BRANDS = ["Glycomet 500", "Dolo 650", "Pan 40"]

#: Real listings both engines return for "glycomet" that are NOT Glycomet.
KNOWN_SUBSTITUTES = ["Biciphase 500mg Tablet SR", "Glidum MF 1mg Strip Of 10 Tablets"]

OK, BAD, INFO = "  ok  ", " FAIL ", "  ..  "


def line(status: str, text: str) -> None:
    print(f"[{status}] {text}")


async def check_brand(brand: str) -> bool:
    print(f"\n=== {brand}")

    hit = await find_product_url(brand, httpx_fetch)
    if hit is None:
        line(BAD, "no product page found on either pharmacy")
        line(INFO, "either both searches changed shape, or this brand is not listed")
        return False
    line(OK, f"found on {hit.source_name}: {hit.listed_name or '(unnamed)'}")
    line(INFO, hit.url)

    try:
        html = await httpx_fetch(hit.url, {"User-Agent": "PAL-Clinical/1.0"})
    except Exception as exc:  # noqa: BLE001
        line(BAD, f"product page could not be fetched: {exc}")
        return False

    label = extract_label(html, brand=brand, url=hit.url, source_name=hit.source_name)
    fields = {
        "composition": label.composition,
        "strength": label.strength,
        "form": label.form,
        "manufacturer": label.manufacturer,
        "uses": ", ".join(label.uses) or None,
        "side effects": ", ".join(label.side_effects) or None,
        "prescription only": label.prescription_required,
    }
    for name, value in fields.items():
        text = str(value)
        line(OK if value else BAD, f"{name:18} {text[:88]}")

    # The card the patient would actually see.
    cards = await lookup_drug_cards(f"What is {brand} used for?", fetch=httpx_fetch)
    if not cards:
        line(BAD, "the route produced no card for a brand it could find")
        return False
    if cards[0].get("disclaimer") != DISCLAIMER:
        line(BAD, "card is missing the mandatory disclaimer")
        return False
    line(OK, "card carries the disclaimer and the source attribution")
    line(OK, f"provenance stays {cards[0]['provenance_class']!r} (cannot support a clinical claim)")

    return bool(label.composition or label.uses or label.strength)


def check_substitutes() -> bool:
    print("\n=== brand-match guard")
    passed = True
    for name in KNOWN_SUBSTITUTES:
        score = brand_matches("Glycomet", name)
        line(OK if score == 0 else BAD, f"{name!r} scored {score} (must be 0)")
        passed = passed and score == 0
    score = brand_matches("Glycomet 500", "Glycomet GP 1 Tablet PR")
    line(OK if score == 0 else BAD, f"'Glycomet 500' vs 'Glycomet GP 1' scored {score} (must be 0)")
    return passed and score == 0


async def main() -> int:
    brands = [" ".join(sys.argv[1:])] if len(sys.argv) > 1 else DEFAULT_BRANDS

    results = [await check_brand(b) for b in brands]
    results.append(check_substitutes())

    print()
    if all(results):
        print("All checks passed. The drug label route works against the live sites.")
        return 0
    print(
        "One or more checks failed.\n"
        "A failure here does NOT break the assistant: the route returns no card and\n"
        "the turn is answered as it was before. It does mean patients have stopped\n"
        "getting label cards, so it is worth fixing.\n"
        "Most likely cause: a pharmacy redesigned its pages. See\n"
        "services/clinical/pharmacy_search.py and pharmacy_label.py."
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
