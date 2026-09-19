#!/usr/bin/env python3
"""
PubMed setup, in one command.

    python scripts/pubmed_setup.py            # what is in force, and from where
    python scripts/pubmed_setup.py --check    # the same, then one live request
    python scripts/pubmed_setup.py --env      # lines to paste into .env

Nothing here is required to make PubMed work. The point of the script is that
you should not have to read the source to find out what it is doing — it
prints the effective configuration, says where each value came from, and
explains what changing it would do.

It never prints an API key. It prints whether one is set and how long it is,
which is what you need to tell "the key is missing" from "the key is wrong",
and is safe to paste into a ticket.
"""
import argparse
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.clinical import pubmed  # noqa: E402

#: field, env var, Settings attribute, default, what it does
KNOBS = [
    ("api_key", "NCBI_API_KEY", "ncbi_api_key", "",
     "Raises the rate limit from 3 to 10 requests/second. Free from "
     "https://account.ncbi.nlm.nih.gov/settings/ . Optional."),
    ("email", "PUBMED_EMAIL", "pubmed_email", "",
     "Contact address sent with every request. NCBI asks for it so they can "
     "email you before blocking you. Strongly recommended."),
    ("tool", "PUBMED_TOOL", "pubmed_tool", pubmed.DEFAULT_TOOL,
     "The name PAL identifies itself by to NCBI."),
    ("min_year", "PUBMED_MIN_YEAR", "pubmed_min_year", pubmed.DEFAULT_MIN_YEAR,
     "Oldest publication year retrieved. Nothing before it is fetched, and "
     "anything before it that slips through is dropped locally."),
    ("max_results", "PUBMED_MAX_RESULTS", "pubmed_max_results", 8,
     "Articles per query. Higher recall, more tokens into the synthesiser."),
    ("timeout_seconds", None, "pubmed_timeout_seconds", 12.0,
     "Per-request timeout. A timeout is reported as 'could not check the "
     "literature', never as 'no evidence exists'."),
]


def _settings():
    try:
        from config import get_settings

        return get_settings()
    except Exception as exc:  # noqa: BLE001
        print(f"  (application settings not importable here: {exc})")
        return None


def _source(field, env_var, attr, default, settings, effective) -> str:
    """Where the value in force actually came from."""
    if str(effective) == str(default):
        return "default"
    if settings is not None and str(getattr(settings, attr, "")) == str(effective):
        return f".env / Settings ({attr})"
    if env_var and os.getenv(env_var) and str(os.getenv(env_var)) == str(effective):
        return f"environment ({env_var})"
    return "set in code"


def _shown(field: str, value) -> str:
    if field == "api_key":
        return f"set ({len(value)} chars)" if value else "unset"
    return str(value) if value != "" else "(unset)"


def show() -> pubmed.PubmedConfig:
    pubmed.reset_config()
    config = pubmed.get_config()
    settings = _settings()

    print("\nPubMed configuration in force")
    print("=" * 70)
    for field, env_var, attr, default, what in KNOBS:
        value = getattr(config, field)
        source = _source(field, env_var, attr, default, settings, value)
        print(f"\n  {field}")
        print(f"    value   {_shown(field, value)}")
        print(f"    from    {source}")
        print(f"    set via {env_var or '(settings only)'}  /  Settings.{attr}")
        print(f"    {what}")

    print("\n" + "=" * 70)
    print("Search window   ", pubmed.date_window())
    print("Example term    ", pubmed.build_term("metformin prediabetes", "humans"))
    print("Rate limit      ", "10 req/s" if config.api_key else "3 req/s (no API key)")
    return config


def env_lines(config: pubmed.PubmedConfig) -> None:
    print("\n# --- PubMed (append to api/.env) ---")
    print("# An API key is optional and only raises the rate limit.")
    print(f"NCBI_API_KEY={'<your key>' if not config.api_key else '<unchanged>'}")
    print(f"PUBMED_EMAIL={config.email or '<your contact address>'}")
    print(f"PUBMED_TOOL={config.tool}")
    print(f"PUBMED_MIN_YEAR={config.min_year}")
    print(f"PUBMED_MAX_RESULTS={config.max_results}")
    print()


async def live_check(config: pubmed.PubmedConfig) -> int:
    print("\nLive check")
    print("=" * 70)
    try:
        articles = await pubmed.search_pubmed("metformin type 2 diabetes", max_results=5)
    except Exception as exc:  # noqa: BLE001
        print(f"  FAIL  could not reach NCBI: {type(exc).__name__}: {exc}")
        print("        Check outbound HTTPS to eutils.ncbi.nlm.nih.gov.")
        return 1

    if not articles:
        print("  FAIL  reached NCBI but got nothing back for a query that should work.")
        print("        Run scripts/verify_pubmed_live.py for the full diagnosis.")
        return 1

    print(f"  PASS  {len(articles)} article(s) returned")
    oldest = min((a.year_int for a in articles if a.year_int), default=None)
    print(f"  PASS  oldest year returned: {oldest} (floor is {config.min_year})")
    if oldest is not None and oldest < config.min_year:
        print("  FAIL  an article older than the floor came back — the window is broken.")
        return 1
    non_human = [a.pmid for a in articles if not a.is_human_study]
    print(f"  {'PASS' if not non_human else 'WARN'}  human-studies filter: "
          f"{len(articles) - len(non_human)}/{len(articles)} carry the Humans descriptor")
    for a in articles[:3]:
        print(f"        {a.year}  {a.journal[:34]:34}  {a.title[:52]}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="also make one live request")
    parser.add_argument("--env", action="store_true", help="print .env lines and exit")
    args = parser.parse_args()

    config = show()
    if args.env:
        env_lines(config)
        return 0
    if args.check:
        return asyncio.run(live_check(config))

    print("\nNothing above is required — these are the defaults working.")
    print("Add --check to make one live request, or --env for .env lines.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
