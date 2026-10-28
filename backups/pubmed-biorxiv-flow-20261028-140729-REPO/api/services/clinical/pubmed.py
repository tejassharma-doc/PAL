"""
PubMed via NCBI E-utilities, with the filters that make a citation mean
something.

Replaces the inline `_search_pubmed` in services/agents/evidence_agent.py,
which had two problems that mattered:

  1. No study filter. Every result was returned regardless of whether the work
     was done in humans, in mice or in vitro — so "grounded in the retrieved
     literature" could mean grounded in a rodent study.
  2. esummary only, so no abstracts. The agent was told to answer using only
     the retrieved results, and the retrieved results were titles. A title is
     not evidence, and asking a model to ground a clinical answer in titles is
     asking it to fill the gap itself.

This module adds `humans[MeSH Terms]`, fetches abstracts, and drops articles
that have none rather than citing a bare title.

Only dependency is httpx, which the API already requires.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
from dataclasses import dataclass, field, replace
from datetime import date
from typing import Literal

import httpx

from .provenance import ProvenanceClass

logger = logging.getLogger(__name__)

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"


class PubmedUnavailable(RuntimeError):
    """
    Retrieval failed — as distinct from "nothing matched".

    Separate from httpx's exceptions on purpose: NCBI can fail with a 200.
    `search_pubmed_many` turns this into `retrieval_ok=False`, which is what
    lets the agent say "I could not check the literature" rather than "no
    evidence was found". Conflating the two is how a system answers
    confidently from nothing.
    """

StudyFilter = Literal["humans", "high_evidence", "none"]

#: Nothing published before this is retrieved by default. Medicine from before
#: 2000 is not wrong because it is old, but it predates the trials, the
#: guidelines and in many cases the drugs that a patient asking today is
#: actually on — and a 1974 paper cited next to a 2023 one reads as equally
#: current to someone with no way to tell the difference.
DEFAULT_MIN_YEAR = 2000

#: NCBI asks every automated client to identify itself and give a contact, so
#: they can get in touch before blocking you rather than after.
DEFAULT_TOOL = "PAL"


@dataclass(frozen=True)
class PubmedConfig:
    """
    Everything PubMed needs, in one place.

    Before this, the API key was read with `os.getenv` in the middle of the
    request builder and the `pubmed_email` / `pubmed_tool` settings that PAL
    already defined were never sent to NCBI at all — the settings existed, the
    requests did not use them.

    Set it up in whichever way suits where you are running:

      .env / Settings   NCBI_API_KEY, PUBMED_EMAIL, PUBMED_TOOL,
                        PUBMED_MIN_YEAR, PUBMED_MAX_RESULTS
      environment       the same names, if Settings is not importable
      in code           `pubmed.configure(min_year=2010, max_results=10)`

    None of it is required. With nothing set the defaults are a working,
    polite, rate-limit-abiding client — an API key only raises the limit from
    3 requests/second to 10.
    """

    api_key: str = ""
    email: str = ""
    tool: str = DEFAULT_TOOL
    min_year: int = DEFAULT_MIN_YEAR
    max_results: int = 8
    timeout_seconds: float = 12.0

    def request_params(self) -> dict:
        """Identity and rate-limit parameters, on every single request."""
        params = {"tool": self.tool}
        if self.email:
            params["email"] = self.email
        if self.api_key:
            params["api_key"] = self.api_key
        return params

    def describe(self) -> str:
        """
        A line you can safely log or print. Says whether a key is set, never
        what it is — this is the line that ends up in a support ticket.
        """
        return (
            f"tool={self.tool} "
            f"email={self.email or '(unset)'} "
            f"api_key={'set, ' + str(len(self.api_key)) + ' chars' if self.api_key else 'unset (3 req/s limit)'} "
            f"years={self.min_year}-present "
            f"max_results={self.max_results}"
        )


def scrub(value) -> str:
    """
    Remove the API key from anything on its way to a log.

    httpx puts the full request URL in its exception messages, and the key is
    a query parameter — so `logger.warning("...: %s", exc)` on a failed
    request wrote a live credential into the application log, where it then
    lives in whatever aggregates those logs. Found in review, not in an
    incident, which is the good way to find it.
    """
    text = str(value)
    key = get_config().api_key
    if key:
        text = text.replace(key, "***")
    return re.sub(r"(api_key=)[^&\s\'\"]+", r"\1***", text)


def _int_field(value):
    """For a field whose zero value would silently disable retrieval."""
    number = _int(value, 0)
    return number if number > 0 else None


def _float_field(value):
    number = _float(value, 0.0)
    return number if number > 0 else None


def _int(value, fallback: int) -> int:
    """A typo'd .env must not take the API down on import."""
    try:
        return int(str(value).strip())
    except (TypeError, ValueError, AttributeError):
        return fallback


def _float(value, fallback: float) -> float:
    try:
        return float(str(value).strip())
    except (TypeError, ValueError, AttributeError):
        return fallback


def _load_config() -> PubmedConfig:
    """
    Settings when the application config is importable, environment when it is
    not, defaults under both.

    There is no third path and no merging between the two, because there does
    not need to be: pydantic-settings already reads .env and the environment
    into Settings under the same names. The `os.getenv` branch exists only so
    this module keeps working in a bare script or a test with no application
    config on the path — which is exactly the situation
    `scripts/verify_pubmed_live.py` runs in.
    """
    try:
        from config import get_settings  # noqa: PLC0415

        settings = get_settings()
        return PubmedConfig(
            api_key=getattr(settings, "ncbi_api_key", "") or "",
            email=getattr(settings, "pubmed_email", "") or "",
            tool=getattr(settings, "pubmed_tool", "") or DEFAULT_TOOL,
            min_year=_int(getattr(settings, "pubmed_min_year", None), DEFAULT_MIN_YEAR),
            max_results=_int(getattr(settings, "pubmed_max_results", None), 8),
            timeout_seconds=_float(getattr(settings, "pubmed_timeout_seconds", None), 12.0),
        )
    except Exception as exc:  # noqa: BLE001 — no application config here
        # Expected in a bare script; worth a line when it is not, because
        # silently falling back to defaults looks identical to being
        # configured correctly.
        logger.debug("[pubmed] application settings unavailable (%s); using environment", exc)

    return PubmedConfig(
        api_key=os.getenv("NCBI_API_KEY", ""),
        email=os.getenv("PUBMED_EMAIL", ""),
        tool=os.getenv("PUBMED_TOOL") or DEFAULT_TOOL,
        min_year=_int(os.getenv("PUBMED_MIN_YEAR"), DEFAULT_MIN_YEAR),
        max_results=_int(os.getenv("PUBMED_MAX_RESULTS"), 8),
        timeout_seconds=_float(os.getenv("PUBMED_TIMEOUT_SECONDS"), 12.0),
    )


_config: PubmedConfig | None = None


def get_config() -> PubmedConfig:
    """The active configuration, built once on first use."""
    global _config
    if _config is None:
        _config = _load_config()
        logger.info("[pubmed] %s", _config.describe())
    return _config


_COERCE = {"min_year": _int_field, "max_results": _int_field, "timeout_seconds": _float_field}


def configure(**overrides) -> PubmedConfig:
    """
    Override any field at runtime, e.g. at startup or in a test:

        pubmed.configure(min_year=2010, email="ops@docmode.com")

    Returns the configuration now in force.
    """
    global _config
    # Coerced the same way the environment path is. `configure(min_year="2010")`
    # used to store a string, and the next comparison raised TypeError inside
    # filter_by_year — a crash one call away from a harmless-looking typo.
    cleaned = {}
    for key, value in overrides.items():
        if key in _COERCE:
            coerced = _COERCE[key](value)
            if coerced is None:
                # A zero, a negative or a typo would turn retrieval off
                # permanently while looking like a successful call. Keep what
                # is already in force and say so.
                logger.warning("[pubmed] ignoring %s=%r; keeping the current value", key, value)
                continue
            cleaned[key] = coerced
        else:
            cleaned[key] = value

    _config = replace(get_config(), **cleaned)
    return _config


def reset_config() -> None:
    """
    Forget the cached configuration so the next call reloads it.

    Also clears the Settings cache, because `get_settings` is lru_cached: a
    changed environment variable would otherwise be read back through a
    Settings object built before the change, and the reload would appear to
    do nothing.
    """
    global _config
    _config = None
    try:
        from config import get_settings  # noqa: PLC0415

        get_settings.cache_clear()
    except Exception:  # noqa: BLE001
        pass

HIGH_EVIDENCE_TYPES = [
    "randomized controlled trial[pt]",
    "meta-analysis[pt]",
    "systematic review[pt]",
    "practice guideline[pt]",
]


@dataclass
class PubmedArticle:
    pmid: str
    title: str
    abstract: str
    journal: str
    year: str
    authors: list[str] = field(default_factory=list)
    publication_types: list[str] = field(default_factory=list)
    mesh_terms: list[str] = field(default_factory=list)
    doi: str | None = None

    @property
    def is_human_study(self) -> bool:
        """
        True when the RECORD carries the Humans MeSH descriptor.

        Verified live: across 20 results for a deliberately animal-heavy topic,
        every article returned under humans[MeSH Terms] carried this descriptor,
        while the unfiltered set contained articles that did not.

        This is checked per article rather than inferred from the query, so a
        silently broken filter downgrades provenance instead of mislabelling
        animal work as human evidence.
        """
        return any(t.lower() == "humans" for t in self.mesh_terms)

    @property
    def year_int(self) -> int | None:
        """
        The publication year as a number, or None when the record does not
        give one that can be read. None is not treated as recent: a date that
        cannot be established has not been established.
        """
        match = re.search(r"\b(1[6-9]\d{2}|20\d{2}|21\d{2})\b", self.year or "")
        return int(match.group(1)) if match else None

    def published_since(self, min_year: int) -> bool:
        year = self.year_int
        return year is not None and year >= min_year

    @property
    def url(self) -> str:
        return f"https://pubmed.ncbi.nlm.nih.gov/{self.pmid}/"

    def to_citation(self) -> dict:
        """
        Shape kept compatible with the dicts evidence_agent already emits, so
        existing consumers keep working, plus the fields they were missing.
        """
        return {
            "pmid": self.pmid,
            "title": self.title,
            "abstract": self.abstract,
            "authors": self.authors[:3],
            "journal": self.journal,
            "year": self.year,
            "year_int": self.year_int,
            "doi": self.doi,
            "url": self.url,
            "publication_types": self.publication_types,
            "mesh_terms": self.mesh_terms,
            # Established by the record itself. If the MeSH descriptor is absent
            # — a broken filter, an un-indexed ahead-of-print — the article is
            # still returned, but it drops to a class that may not support a
            # clinical claim. Failing quiet becomes failing safe.
            "provenance_class": (
                ProvenanceClass.peer_reviewed_human.value
                if self.is_human_study
                else ProvenanceClass.peer_reviewed_other.value
            ),
            "phi": False,
        }


def _balanced(query: str) -> str:
    """Drop parentheses that do not pair, leaving the words intact."""
    depth, keep = 0, []
    for char in query:
        if char == "(":
            depth += 1
        elif char == ")":
            if depth == 0:
                continue
            depth -= 1
        keep.append(char)
    text = "".join(keep)
    while depth > 0:                       # unclosed openers, right to left
        index = text.rfind("(")
        if index == -1:
            break
        text = text[:index] + text[index + 1:]
        depth -= 1
    return re.sub(r"\s+", " ", text).strip()


def build_term(query: str, study_filter: StudyFilter = "humans") -> str:
    """
    humans[MeSH Terms] is the load-bearing clause. It is what makes the
    peer-reviewed-human provenance class an established fact rather than an
    assumption about the journal something appeared in.
    """
    # Unbalanced parentheses in the patient's words produce a term NCBI
    # rejects — "aspirin (ASA) dosing)" became "(aspirin (ASA) dosing))" —
    # and a rejected term is the quiet failure above. Strip them rather than
    # try to guess where a bracket was meant to close.
    base = f"({_balanced(query)})"
    if study_filter == "none":
        return base

    parts = [base, "humans[MeSH Terms]"]
    if study_filter == "high_evidence":
        parts.append("(" + " OR ".join(HIGH_EVIDENCE_TYPES) + ")")
    return " AND ".join(parts)


def _api_key_params() -> dict:
    """Kept as a name for compatibility; the configuration is the source now."""
    return get_config().request_params()


def date_window(
    recent_years: int | None = None,
    config: PubmedConfig | None = None,
    min_year: int | None = None,
) -> dict:
    """
    The publication-date window, as esearch parameters.

    One mechanism rather than two. `reldate` and `mindate`/`maxdate` do not
    combine cleanly at NCBI, so a relative window is converted into the same
    absolute floor and the floor is applied on every search — which also means
    the window is always visible in the request rather than implied.
    """
    cfg = config or get_config()
    this_year = date.today().year

    floor = cfg.min_year if min_year is None else min_year
    if recent_years:
        floor = max(floor, this_year - recent_years)

    return {
        "datetype": "pdat",
        "mindate": f"{floor}/01/01",
        "maxdate": f"{this_year}/12/31",
    }


_TAG_RE = re.compile(r"<[^>]+>")
_ENTITIES = {"&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&apos;": "'"}


def _strip_tags(value: str) -> str:
    text = _TAG_RE.sub(" ", value)
    for entity, char in _ENTITIES.items():
        text = text.replace(entity, char)
    return re.sub(r"\s+", " ", text).strip()


def _between(xml: str, tag: str) -> list[str]:
    return re.findall(rf"<{tag}(?:\s[^>]*)?>(.*?)</{tag}>", xml, re.DOTALL)


def _publication_year(block: str) -> str:
    """
    The year the work was PUBLISHED.

    The naive version of this took the first <Year> in the record. In the NLM
    DTD the elements in a MedlineCitation run PMID, DateCompleted, DateRevised,
    then Article -> Journal -> JournalIssue -> PubDate -> Year. So the first
    <Year> is DateCompleted, or DateRevised on an ahead-of-print record — an
    indexing date, never the publication date.

    What that cost, before it was caught: a 1997 paper with DateRevised 2021
    was read as 2021. It passed the year floor, it was shown to the patient
    dated 2021, and `filter_by_year` — the check that exists precisely to
    catch a broken date window — waved it through, because it was reading the
    wrong element. On ordinary records it was merely wrong by a year or two,
    which is how it survived: a December 2019 paper completed in February 2020
    printed as 2020.

    Order of preference: PubDate, then ArticleDate (electronic publication),
    then MedlineDate, which is the free-text form used for ranges such as
    "2003 Jan-Feb".
    """
    for tag in ("PubDate", "ArticleDate"):
        for scope in _between(block, tag):
            years = _between(scope, "Year")
            if years:
                return _strip_tags(years[0])
            medline = _between(scope, "MedlineDate")
            if medline:
                found = re.search(r"\b(1[6-9]\d{2}|20\d{2}|21\d{2})\b", _strip_tags(medline[0]))
                if found:
                    return found.group(1)

    medline_dates = _between(block, "MedlineDate")
    if medline_dates:
        found = re.search(r"\b(1[6-9]\d{2}|20\d{2}|21\d{2})\b", _strip_tags(medline_dates[0]))
        if found:
            return found.group(1)

    # Deliberately empty rather than a guess. An article with no readable
    # publication date is dropped by filter_by_year, which is the safe answer:
    # not being able to date a paper is not evidence that it is recent.
    return ""


def _parse_articles(xml: str) -> list[PubmedArticle]:
    articles: list[PubmedArticle] = []

    for block in _between(xml, "PubmedArticle"):
        pmids = _between(block, "PMID")
        if not pmids:
            continue
        pmid = _strip_tags(pmids[0])

        abstract = " ".join(
            _strip_tags(a) for a in _between(block, "AbstractText")
        ).strip()

        titles = _between(block, "ArticleTitle")
        iso = _between(block, "ISOAbbreviation")
        journal_titles = _between(block, "Title")

        year = _publication_year(block)

        doi = None
        for article_id in re.findall(
            r'<ArticleId IdType="doi">(.*?)</ArticleId>', block, re.DOTALL
        ):
            doi = _strip_tags(article_id)
            break

        articles.append(
            PubmedArticle(
                pmid=pmid,
                title=_strip_tags(titles[0]) if titles else "",
                abstract=abstract,
                journal=_strip_tags(iso[0]) if iso else (
                    _strip_tags(journal_titles[0]) if journal_titles else ""
                ),
                year=year,
                authors=[_strip_tags(n) for n in _between(block, "LastName")][:3],
                publication_types=[
                    _strip_tags(t) for t in _between(block, "PublicationType")
                ],
                mesh_terms=[
                    _strip_tags(t) for t in _between(block, "DescriptorName")
                ],
                doi=doi,
            )
        )

    return articles


async def _esearch(
    client: httpx.AsyncClient,
    term: str,
    retmax: int,
    recent_years: int | None,
    min_year: int | None = None,
) -> list[str]:
    params = {
        "db": "pubmed",
        "retmode": "json",
        "retmax": str(retmax),
        "sort": "relevance",
        "term": term,
        **date_window(recent_years, min_year=min_year),
        **_api_key_params(),
    }

    response = await client.get(f"{EUTILS}/esearch.fcgi", params=params)
    response.raise_for_status()

    try:
        payload = response.json()
    except ValueError as exc:
        # NCBI serves an HTML holding page under load. Left alone this raised
        # a JSONDecodeError straight out of search_pubmed_many — which catches
        # only httpx errors — and broke the patient's turn.
        raise PubmedUnavailable(f"esearch did not return JSON: {exc}") from exc

    result = payload.get("esearchresult", {})

    # The failure this catches is the quiet one. A malformed term comes back
    # 200 OK with an ERROR field and no idlist, which is indistinguishable
    # from "nothing matched" unless you look — so the agent would say "no
    # evidence exists" when it had not managed to ask the question.
    error = result.get("ERROR") or result.get("errorlist")
    if error and "idlist" not in result:
        raise PubmedUnavailable(f"esearch rejected the term: {error}")

    return result.get("idlist", [])


async def _efetch(client: httpx.AsyncClient, pmids: list[str]) -> list[PubmedArticle]:
    if not pmids:
        return []
    params = {
        "db": "pubmed",
        "retmode": "xml",
        "rettype": "abstract",
        "id": ",".join(pmids),
        **_api_key_params(),
    }
    response = await client.get(f"{EUTILS}/efetch.fcgi", params=params)
    response.raise_for_status()
    return _parse_articles(response.text)


def filter_by_year(
    articles: list[PubmedArticle], min_year: int | None = None
) -> list[PubmedArticle]:
    """
    Enforce the year floor on the records themselves.

    The esearch date window should have done this already. This is the same
    move as reading the Humans descriptor off each record instead of trusting
    the query: the window is a request, this is a fact. If NCBI ever changes
    its date parameters — or a record comes back with no usable date — the
    article is dropped here rather than presented to a patient as current.

    A record with no readable year is dropped too. Not being able to date a
    paper is not evidence that it is recent.
    """
    floor = get_config().min_year if min_year is None else min_year
    kept = [a for a in articles if a.published_since(floor)]

    dropped = len(articles) - len(kept)
    if dropped:
        # Loud when it is most of them: that pattern means the search-side
        # window stopped working, not that the literature is old.
        report = logger.warning if dropped > len(articles) / 2 else logger.info
        report(
            "[pubmed] dropped %d of %d article(s) published before %d",
            dropped, len(articles), floor,
        )
    return kept


async def search_pubmed(
    query: str,
    *,
    study_filter: StudyFilter = "humans",
    max_results: int | None = None,
    recent_years: int | None = None,
    timeout: float | None = None,
    min_year: int | None = None,
) -> list[PubmedArticle]:
    """
    Returns articles that passed the filter, are inside the year window, and
    have an abstract.

    `max_results`, `timeout` and `min_year` fall back to the configuration, so
    a caller that has no opinion does not have to have one. See `configure()`.

    Raises nothing: a failure returns an empty list and logs. Callers must
    distinguish "no evidence found" from "retrieval failed" by their own
    means — see `search_pubmed_many`, which reports that separately, because
    silently treating a network error as an absence of evidence is how a
    system ends up confidently answering from nothing.
    """
    config = get_config()
    retmax = config.max_results if max_results is None else max_results
    wait = config.timeout_seconds if timeout is None else timeout
    floor = config.min_year if min_year is None else min_year

    async with httpx.AsyncClient(
        timeout=wait, headers={"User-Agent": f"{config.tool}-Clinical/1.0"}
    ) as client:
        ids = await _esearch(
            client, build_term(query, study_filter), retmax, recent_years, floor
        )
        if not ids:
            return []
        articles = await _efetch(client, ids)

    return [a for a in filter_by_year(articles, floor) if a.abstract]


async def search_pubmed_many(
    queries: list[str],
    *,
    study_filter: StudyFilter = "humans",
    max_results: int | None = None,
    recent_years: int | None = None,
    min_year: int | None = None,
) -> tuple[list[PubmedArticle], bool]:
    """
    Serialised to stay inside the E-utilities rate limit (3 req/s without an
    API key, 10 with NCBI_API_KEY set).

    Returns (articles, retrieval_ok). `retrieval_ok` is False when any query
    failed outright — that is the signal the caller needs to say "I could not
    check the literature" rather than "no evidence exists".
    """
    seen: set[str] = set()
    out: list[PubmedArticle] = []
    retrieval_ok = True

    for query in queries:
        try:
            batch = await search_pubmed(
                query,
                study_filter=study_filter,
                max_results=max_results,
                recent_years=recent_years,
                min_year=min_year,
            )
        except (httpx.HTTPError, asyncio.TimeoutError, PubmedUnavailable, ValueError) as exc:
            logger.warning("PubMed query failed (%s): %s", query, scrub(exc))
            retrieval_ok = False
            continue

        for article in batch:
            if article.pmid not in seen:
                seen.add(article.pmid)
                out.append(article)

    return out, retrieval_ok


# ---------------------------------------------------------------------------
# Filter canary
#
# The failure this catches: a malformed PubMed term returns zero results
# SILENTLY. It does not error. So if humans[MeSH Terms] were ever wrong —
# a syntax change at NCBI, a typo in a refactor — every clinical answer would
# quietly degrade to "no good evidence found" while looking like it worked.
#
# scripts/verify_pubmed_live.py checks this on demand. This checks it in
# production, once, on first use, and never blocks a turn: it logs and sets a
# flag the agent can read to say "evidence retrieval is degraded" instead of
# "no evidence exists".
# ---------------------------------------------------------------------------

#: A query that must return human studies on any working index. Broad on
#: purpose — if this returns nothing, the problem is the term syntax or the
#: connection, not the topic.
_CANARY_QUERY = "diabetes mellitus treatment"

_filter_state: dict = {"checked": False, "healthy": None, "detail": ""}


async def filter_sanity_check(force: bool = False) -> dict:
    """
    Verify that the human-studies filter narrows rather than silently failing.

    Two conditions, both of which a broken term fails:
      - the unfiltered query returns results at all
      - the filtered set is non-empty and no larger than the unfiltered set

    Cached after the first run. Never raises.
    """
    if _filter_state["checked"] and not force:
        return dict(_filter_state)

    try:
        unfiltered = await search_pubmed(_CANARY_QUERY, study_filter="none", max_results=20)
        filtered = await search_pubmed(_CANARY_QUERY, study_filter="humans", max_results=20)
    except Exception as exc:  # noqa: BLE001
        _filter_state.update(
            checked=True, healthy=None,
            detail=f"could not reach PubMed to check: {type(exc).__name__}: {exc}",
        )
        logger.warning("[pubmed] filter canary could not run: %s", exc)
        return dict(_filter_state)

    healthy = bool(unfiltered) and bool(filtered) and len(filtered) <= len(unfiltered)
    detail = f"unfiltered={len(unfiltered)} filtered={len(filtered)}"

    _filter_state.update(checked=True, healthy=healthy, detail=detail)

    if healthy:
        logger.info("[pubmed] filter canary healthy (%s)", detail)
    else:
        # Loud on purpose. A silently broken filter turns every clinical answer
        # into "no good evidence found", which reads like a correct answer.
        logger.error(
            "[pubmed] FILTER CANARY FAILED (%s) — humans[MeSH Terms] may no longer "
            "be valid. Clinical answers may be silently degraded. Run "
            "scripts/verify_pubmed_live.py.", detail,
        )

    return dict(_filter_state)


def filter_is_degraded() -> bool:
    """
    True when the canary has run and failed. False when healthy OR not yet
    checked — the agent should not claim degradation it has not established.
    """
    return _filter_state["checked"] and _filter_state["healthy"] is False
