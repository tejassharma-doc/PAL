"""
Brand → molecule resolution, behind an interface.

Open decision 2 (licensed feed vs scraping) is a commercial and legal call,
not an engineering one — but it should not block the code. This is the seam:
`DrugResolver` is the contract, and the default implementation returns nothing
rather than guessing, so the system is safe before the decision is made and
becomes useful the moment a dataset lands.

Three implementations, in the order I would build them:

  NullResolver   (here, now)
      Resolves nothing. The assistant says it cannot look the brand up and
      asks what is printed on the strip. Safe, honest, ships today.

  TableResolver  (here, needs data)
      A local brand → composition table. The licit spine for India is the
      NPPA ceiling-price data published under DPCO 2013: it is government
      published, freely available, and carries exactly the fields needed —
      brand, composition, strength, manufacturer, ceiling price. It covers
      scheduled formulations, which is a large share of what patients in the
      Gujarat cohort are actually dispensed, and it sidesteps the ToS and
      fragility problems of scraping a pharmacy. Jan Aushadhi's generic
      catalogue extends the coverage at the generic end.
      Load it with `TableResolver.from_rows(...)`; the schema is `DrugRecord`.

  LicensedResolver  (not here)
      A commercial feed, if NPPA plus Jan Aushadhi leaves too much uncovered.
      Measure the gap before paying for it — `coverage_report` exists for
      exactly that.

What deliberately does NOT exist here: a resolver that infers a molecule from
a condition. The name-provenance guard already rejects names the patient never
typed, and nothing in this module may reintroduce that path.

Dependency-free: stdlib only.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Iterable, Protocol, runtime_checkable

from .provenance import ProvenanceClass

__all__ = [
    "DrugRecord",
    "DrugResolver",
    "NullResolver",
    "TableResolver",
    "get_resolver",
    "coverage_report",
]


@dataclass(frozen=True)
class DrugRecord:
    """
    One brand as the patient would read it off the strip.

    `molecule` is the composition as published — "metformin hydrochloride
    500mg", not a normalised INN code. Printing what the source says beats
    printing something tidier that the source did not say.
    """
    brand: str
    molecule: str
    strength: str | None = None
    form: str | None = None
    manufacturer: str | None = None
    #: Schedule H / H1 / X. Drives the prescription-only badge on the card.
    schedule: str | None = None
    ceiling_price_inr: float | None = None
    source: str = "unknown"

    def to_chunk(self) -> dict:
        return {
            "brand": self.brand,
            "molecule": self.molecule,
            "strength": self.strength,
            "form": self.form,
            "manufacturer": self.manufacturer,
            "schedule": self.schedule,
            "ceiling_price_inr": self.ceiling_price_inr,
            "source": self.source,
            # Brand identity and pack data. Never the pharmacology.
            "provenance_class": ProvenanceClass.commercial.value,
            "phi": False,
        }


@runtime_checkable
class DrugResolver(Protocol):
    def resolve(self, brand: str) -> DrugRecord | None:
        """Return the record for a brand, or None. Never guess."""
        ...


def _normalise(value: str) -> str:
    text = unicodedata.normalize("NFKC", value).lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


class NullResolver:
    """
    Resolves nothing, on purpose.

    With this in place the assistant says "I can't look that brand up — what
    does the strip say it contains?" rather than inventing a molecule. That is
    a worse answer than a real resolver gives and a much better one than a
    confident wrong molecule.
    """

    name = "null"

    def resolve(self, brand: str) -> DrugRecord | None:
        return None


class TableResolver:
    """
    Exact-match lookup over a local table. No fuzzy matching by design: a near
    miss on a brand name is a different medicine, and "close enough" is how a
    patient reads about the wrong drug.
    """

    name = "table"

    def __init__(self, records: Iterable[DrugRecord], source: str = "local-table"):
        self._by_brand: dict[str, DrugRecord] = {}
        self.source = source
        for record in records:
            self._by_brand.setdefault(_normalise(record.brand), record)

    @classmethod
    def from_rows(cls, rows: Iterable[dict], source: str = "nppa-dpco") -> "TableResolver":
        """
        Build from NPPA-shaped rows. Expected keys, all optional but `brand`
        and `molecule`: brand, molecule, strength, form, manufacturer,
        schedule, ceiling_price_inr.
        """
        records = []
        for row in rows:
            brand = (row.get("brand") or "").strip()
            molecule = (row.get("molecule") or "").strip()
            if not brand or not molecule:
                continue
            price = row.get("ceiling_price_inr")
            records.append(
                DrugRecord(
                    brand=brand,
                    molecule=molecule,
                    strength=(row.get("strength") or None),
                    form=(row.get("form") or None),
                    manufacturer=(row.get("manufacturer") or None),
                    schedule=(row.get("schedule") or None),
                    ceiling_price_inr=float(price) if price not in (None, "") else None,
                    source=source,
                )
            )
        return cls(records, source=source)

    def __len__(self) -> int:
        return len(self._by_brand)

    def resolve(self, brand: str) -> DrugRecord | None:
        return self._by_brand.get(_normalise(brand))


_resolver: DrugResolver = NullResolver()


def get_resolver() -> DrugResolver:
    """
    The active resolver. Swap it once at startup:

        from services.clinical import drug_resolver
        drug_resolver._resolver = TableResolver.from_rows(load_nppa_rows())
    """
    return _resolver


@dataclass
class Coverage:
    total: int = 0
    resolved: int = 0
    misses: list[str] = field(default_factory=list)

    @property
    def rate(self) -> float:
        return self.resolved / self.total if self.total else 0.0


def coverage_report(resolver: DrugResolver, brands: Iterable[str]) -> Coverage:
    """
    Measure before you buy. Run this over the brand names your own patients
    actually type — from `conversation_turns`, not from a vendor's sample —
    and only pay for a licensed feed if NPPA plus Jan Aushadhi leaves a gap
    that matters.
    """
    report = Coverage()
    for brand in brands:
        report.total += 1
        if resolver.resolve(brand) is not None:
            report.resolved += 1
        else:
            report.misses.append(brand)
    return report
