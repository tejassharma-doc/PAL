"""Dev seed data. Run once after `alembic upgrade head`:
    cd api && python seed.py
"""
import asyncio
import sys
import uuid
from datetime import datetime, timezone

# Make sure we can import project modules
sys.path.insert(0, ".")

from database import AsyncSessionLocal
from models import User, HealthFact, EvidenceClass
from sqlalchemy import select, func

SEED_PHONE = "9876543210"
DEFAULT_TENANT_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")

FACTS = [
    ("lab",        "HbA1c",             "7.2",                          "%"),
    ("vitals",     "Blood Pressure",    "128/82",                        "mmHg"),
    ("medication", "Metformin",         "500 mg twice daily",            None),
    ("allergy",    "Penicillin",        "rash, anaphylaxis",             None),
    ("visit",      "Last Consultation", "General checkup — Dr. S. Mehta, Apollo Hospital, Mumbai", None),
]


async def seed() -> None:
    async with AsyncSessionLocal() as db:
        # Upsert the seed patient
        result = await db.execute(select(User).where(User.phone == SEED_PHONE))
        user = result.scalar_one_or_none()

        if not user:
            user = User(
                phone=SEED_PHONE,
                phone_verified=True,
                full_name="Anil Kumar",
                preferred_language="hi",
            )
            db.add(user)
            await db.flush()
            print(f"Created seed user  id={user.id}")
        else:
            print(f"Seed user exists   id={user.id}")

        # Seed health facts (idempotent)
        count = await db.scalar(
            select(func.count()).select_from(HealthFact).where(HealthFact.member_id == user.id)
        )
        if count == 0:
            now = datetime.now(timezone.utc)
            for fact_type, key, value, unit in FACTS:
                db.add(HealthFact(
                    tenant_id=DEFAULT_TENANT_ID,
                    member_id=user.id,
                    fact_type=fact_type,
                    fact_key=key,
                    fact_value=value,
                    unit=unit,
                    evidence_class=EvidenceClass.user_canonical,
                    recorded_at=now,
                ))
            print(f"Seeded {len(FACTS)} health facts")
        else:
            print(f"Health facts already present ({count} rows) — skipping")

        await db.commit()
        print("Done.")


if __name__ == "__main__":
    asyncio.run(seed())
