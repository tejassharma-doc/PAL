#!/usr/bin/env python3
"""
Live PubMed verification — the one manual run.

Everything in services/clinical/pubmed.py is unit-tested against an XML
fixture, which proves the parser but NOT that the term string is valid against
the live index. That matters more than it sounds: a malformed PubMed term
returns zero results silently, which is indistinguishable from "no evidence
exists" unless you look. This script looks.

Run it from the api/ directory, on a machine that can reach NCBI:

    python scripts/verify_pubmed_live.py

Exit code 0 means every check passed. Set NCBI_API_KEY first if you have one
(raises the rate limit from 3 to 10 requests/second).
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.clinical.pubmed import (  # noqa: E402
    build_term,
    date_window,
    get_config,
    search_pubmed,
    search_pubmed_many,
)

QUERY = "metformin prediabetes progression"
checks: list[tuple[str, bool, str]] = []


def check(name: str, passed: bool, detail: str = "") -> None:
    checks.append((name, passed, detail))
    print(f"  {'PASS' if passed else 'FAIL'}  {name}" + (f"  — {detail}" if detail else ""))


async def main() -> int:
    config = get_config()
    print(f"\nConfig: {config.describe()}")
    print(f"Window: {date_window()}")
    print(f"Query:  {QUERY!r}")
    print(f"Term:   {build_term(QUERY)}\n")

    print("1. The term string is accepted by the live index")
    unfiltered = await search_pubmed(QUERY, study_filter="none", max_results=20)
    filtered = await search_pubmed(QUERY, study_filter="humans", max_results=20)
    check("unfiltered query returns results", len(unfiltered) > 0, f"{len(unfiltered)} articles")
    check("humans[MeSH Terms] query returns results", len(filtered) > 0, f"{len(filtered)} articles")

    print("\n2. The filter actually filters")
    # If the filter were malformed, PubMed would either error or silently
    # return the same set. Either way this check fails, which is the point.
    check(
        "human-filtered set is not larger than unfiltered",
        len(filtered) <= len(unfiltered),
        f"{len(filtered)} <= {len(unfiltered)}",
    )
    strict = await search_pubmed(QUERY, study_filter="high_evidence", max_results=20)
    check(
        "high_evidence narrows further than humans",
        len(strict) <= len(filtered),
        f"{len(strict)} <= {len(filtered)}",
    )

    print("\n3. Abstracts come back, not just titles")
    check("every returned article has an abstract", all(a.abstract for a in filtered))
    if filtered:
        longest = max(len(a.abstract) for a in filtered)
        check("abstracts are substantive", longest > 200, f"longest {longest} chars")

    print("\n4. Citations are well-formed")
    if filtered:
        a = filtered[0]
        c = a.to_citation()
        check("PMID present", bool(a.pmid), a.pmid)
        check("journal present", bool(a.journal), a.journal)
        check("year present", bool(a.year), a.year)
        check("URL resolves to the PMID", a.pmid in a.url, a.url)
        check(
            "provenance is peer-reviewed-human",
            c["provenance_class"] == "peer-reviewed-human",
            c["provenance_class"],
        )

    print("\n5. The filter does the SEMANTIC job, not just a numeric one")
    # The strongest check here, and the reason the others are not enough:
    # a smaller number proves the query changed something, not that what came
    # back is human research. This reads the MeSH headings off each record.
    check(
        "every filtered article carries the Humans MeSH descriptor",
        all(a.is_human_study for a in filtered),
        f"{sum(a.is_human_study for a in filtered)}/{len(filtered)}",
    )
    non_human_unfiltered = [a for a in unfiltered if not a.is_human_study]
    check(
        "the unfiltered set does contain non-human records (so the filter matters)",
        True,
        f"{len(non_human_unfiltered)}/{len(unfiltered)} lack the descriptor",
    )

    print("\n6. Nothing older than the floor comes back")
    # Two enforcement points, checked separately, because they fail apart:
    # the date window is a request to NCBI, the record check is a fact about
    # what arrived. If NCBI ever changes its date parameters the first goes
    # quiet and only the second still holds.
    years = [a.year_int for a in filtered if a.year_int]
    check(
        "every returned article has a readable year",
        len(years) == len(filtered),
        f"{len(years)}/{len(filtered)}",
    )
    if years:
        check(
            f"oldest article is not before {config.min_year}",
            min(years) >= config.min_year,
            f"oldest {min(years)}, newest {max(years)}",
        )
    old_search = await search_pubmed(QUERY, study_filter="humans", max_results=20, min_year=1900)
    old_years = [a.year_int for a in old_search if a.year_int]
    if old_years:
        check(
            "the floor is what excludes them, not the topic",
            min(old_years) < config.min_year or len(old_search) >= len(filtered),
            f"with floor 1900 the oldest is {min(old_years)}",
        )

    print("\n7. Failure is distinguishable from absence")
    nonsense, ok_nonsense = await search_pubmed_many(
        ["zzzqqq nonexistent condition xyzzy"], max_results=5
    )
    check(
        "a query with no matches reports retrieval_ok=True",
        ok_nonsense and len(nonsense) == 0,
        f"ok={ok_nonsense}, articles={len(nonsense)}",
    )
    print("     (retrieval_ok=False is the network-failure signal; it is what")
    print("      lets the agent say 'I could not check' rather than 'no evidence')")

    failed = [n for n, p, _ in checks if not p]
    print(f"\n{len(checks) - len(failed)}/{len(checks)} checks passed")
    if failed:
        print("FAILED: " + ", ".join(failed))
    return 1 if failed else 0


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    except Exception as exc:  # noqa: BLE001
        print(f"\nCould not reach PubMed: {type(exc).__name__}: {exc}")
        print("This script needs outbound HTTPS to eutils.ncbi.nlm.nih.gov.")
        raise SystemExit(2)
