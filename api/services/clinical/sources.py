"""
Source allowlist and domain → provenance mapping.

NEJM, BMJ, Nature and the rest are not search engines you can select; they are
allowlist entries, applied as `site:` operators on the way out and as a hard
host filter on the way back. Both halves are needed: the operator is a hint to
the engine, the host filter is the guarantee.

On why journal domains map to `peer-reviewed-other` rather than
`peer-reviewed-human`: the domain establishes that a page was peer reviewed,
not that the study was conducted in humans. Only the filtered PubMed path can
establish that, so only it returns `peer-reviewed-human`. Deliberately
conservative — an unverified journal page gets hedged in prose and can never
support a dosing statement.

Dependency-free: stdlib only.
"""
from __future__ import annotations

from urllib.parse import urlparse

from .provenance import ProvenanceClass

__all__ = [
    "JOURNAL_HOSTS",
    "PREPRINT_HOSTS",
    "REFERENCE_HOSTS",
    "PHARMACY_HOSTS",
    "classify_url",
    "is_allowed_journal_url",
    "is_pharmacy_url",
    "journal_site_query",
    "pharmacy_site_query",
    "with_site_restriction",
]

#: Peer-reviewed journals. Study type unverified at the domain level.
JOURNAL_HOSTS = [
    "nejm.org",
    "bmj.com",
    "thelancet.com",
    "jamanetwork.com",
    "nature.com",
    "acpjournals.org",
    "ahajournals.org",
    "diabetesjournals.org",
    "academic.oup.com",
    "cochranelibrary.com",
]

#: Preprint servers. Not peer reviewed at all — same conservative class, and
#: the synthesizer is told to say so.
PREPRINT_HOSTS = ["biorxiv.org", "medrxiv.org", "arxiv.org", "ssrn.com"]

#: Clinical reference and guideline bodies. Background and definitions.
REFERENCE_HOSTS = [
    "medscape.com",
    "bestpractice.bmj.com",
    "uptodate.com",
    "who.int",
    "cdc.gov",
    "nih.gov",
    "nice.org.uk",
    "mohfw.gov.in",
    "icmr.gov.in",
    "nhp.gov.in",
]

#: Indian pharmacy listings. Brand identity and pack data only.
PHARMACY_HOSTS = [
    "tata1mg.com",
    "1mg.com",
    "pharmeasy.in",
    "netmeds.com",
    "apollopharmacy.in",
]

_ALL_JOURNAL_HOSTS = JOURNAL_HOSTS + PREPRINT_HOSTS + REFERENCE_HOSTS


def _host_of(url: str) -> str:
    try:
        host = urlparse(url).hostname or ""
    except ValueError:
        return ""
    return host.lower().removeprefix("www.")


def _matches(host: str, allowed: str) -> bool:
    return host == allowed or host.endswith("." + allowed)


def classify_url(url: str) -> str | None:
    """The provenance class for a URL, or None when it is on no allowlist."""
    host = _host_of(url)
    if not host:
        return None

    if host in ("pubmed.ncbi.nlm.nih.gov", "pmc.ncbi.nlm.nih.gov"):
        # Reached through plain search rather than the filtered PubMed path,
        # so the human-studies claim has not been established.
        return ProvenanceClass.peer_reviewed_other.value

    if any(_matches(host, h) for h in JOURNAL_HOSTS):
        return ProvenanceClass.peer_reviewed_other.value
    if any(_matches(host, h) for h in PREPRINT_HOSTS):
        return ProvenanceClass.peer_reviewed_other.value
    if any(_matches(host, h) for h in REFERENCE_HOSTS):
        return ProvenanceClass.editorial_clinical.value
    if any(_matches(host, h) for h in PHARMACY_HOSTS):
        return ProvenanceClass.commercial.value

    return None


def is_allowed_journal_url(url: str) -> bool:
    host = _host_of(url)
    return bool(host) and (
        host.endswith("ncbi.nlm.nih.gov")
        or any(_matches(host, h) for h in _ALL_JOURNAL_HOSTS)
    )


#: The only scheme a pharmacy page is ever fetched over. Without this check
#: `file://1mg.com/etc/passwd` and `gopher://1mg.com:6379/_FLUSHALL` both
#: satisfied the allowlist — not reachable through today's fetcher, but this
#: function is documented as the last gate before anything is requested, and
#: other callers are entitled to believe that.
_FETCHABLE_SCHEMES = {"https", "http"}


def is_pharmacy_url(url: str) -> bool:
    parsed = urlparse(url if "//" in url else f"//{url}")
    if parsed.scheme and parsed.scheme.lower() not in _FETCHABLE_SCHEMES:
        return False
    host = _host_of(url)
    return bool(host) and any(_matches(host, h) for h in PHARMACY_HOSTS)


def with_site_restriction(query: str, hosts: list[str]) -> str:
    return f"{query} ({' OR '.join('site:' + h for h in hosts)})"


def journal_site_query(query: str) -> str:
    return with_site_restriction(query, _ALL_JOURNAL_HOSTS)


def pharmacy_site_query(query: str) -> str:
    return with_site_restriction(query, PHARMACY_HOSTS)
