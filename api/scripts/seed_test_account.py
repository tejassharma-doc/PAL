#!/usr/bin/env python3
"""
Create (or repair) the default PAL test account used by the Android app.

    docker compose exec api python scripts/seed_test_account.py
    docker compose exec api python scripts/seed_test_account.py --password 'Other@2026'
    docker compose exec api python scripts/seed_test_account.py --reset-password

What it creates — idempotent, safe to run repeatedly:
  1. users               username + email + bcrypt password (no phone — linked later)
  2. patients            a patient profile whose email == the user's email.
                         That email match is how /v3/auth/login, /user/profile and
                         verify_patient_ownership find "your" patient.
  3. user_patient_links  user_id -> patient_id. /conversations needs this row and
                         no API endpoint creates it.
  4. user_llm_credits    starting balance (otherwise lazily created anyway).

Defaults can be overridden with flags or env vars:
  PAL_TEST_USERNAME  (paltest)
  PAL_TEST_EMAIL     (test@palcare.life)
  PAL_TEST_PASSWORD  (PalTest@2026)   meets signup rules: upper, lower, digit, 8+
  PAL_TEST_NAME      (PAL Test User)

Linking a mobile number later: once the phone number logs in via OTP once (which
creates its phone_users row), run with --link-phone 9XXXXXXXXX. That sets
patients.phone_user_id so the SAME patient is reachable from both logins.

This is a TEST account. Do not leave it active on a production database that
holds real patients longer than needed: --deactivate disables it.
"""
import argparse
import asyncio
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import func, select  # noqa: E402

from auth import hash_password  # noqa: E402
from database import AsyncSessionLocal  # noqa: E402
from models.credits import UserLLMCredits  # noqa: E402
from models.patient import Patient  # noqa: E402
from models.phone_user import PhoneUser  # noqa: E402
from models.user import User  # noqa: E402
from models.user_patient_link import UserPatientLink  # noqa: E402


def _args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--username", default=os.getenv("PAL_TEST_USERNAME", "paltest"))
    p.add_argument("--email", default=os.getenv("PAL_TEST_EMAIL", "test@palcare.life"))
    p.add_argument("--password", default=os.getenv("PAL_TEST_PASSWORD", "PalTest@2026"))
    p.add_argument("--name", default=os.getenv("PAL_TEST_NAME", "PAL Test User"))
    p.add_argument("--reset-password", action="store_true",
                   help="overwrite the password if the user already exists")
    p.add_argument("--link-phone", metavar="10_DIGITS",
                   help="attach an existing phone_users row to the test patient")
    p.add_argument("--deactivate", action="store_true", help="disable the test user and patient")
    return p.parse_args()


def _check_password(pw: str) -> None:
    problems = []
    if len(pw) < 8:
        problems.append("at least 8 characters")
    if not any(c.isupper() for c in pw):
        problems.append("an uppercase letter")
    if not any(c.islower() for c in pw):
        problems.append("a lowercase letter")
    if not any(c.isdigit() for c in pw):
        problems.append("a digit")
    if problems:
        sys.exit("Password needs " + ", ".join(problems) + " (same rules as /v3/auth/signup).")


async def main() -> None:
    a = _args()
    email = a.email.strip().lower()
    _check_password(a.password)

    async with AsyncSessionLocal() as db:
        # ── 1. user ────────────────────────────────────────────────────────
        user = (await db.execute(
            select(User).where((User.username == a.username) | (func.lower(User.email) == email))
        )).scalars().first()

        if a.deactivate:
            if not user:
                sys.exit("No test user found.")
            user.is_active = False
            for pt in (await db.execute(select(Patient).where(func.lower(Patient.email) == email))).scalars():
                pt.is_active = False
            await db.commit()
            print(f"Deactivated {user.username} and its patient(s).")
            return

        if user is None:
            user = User(
                username=a.username,
                email=email,
                hashed_password=hash_password(a.password),
                password_updated_at=datetime.now(timezone.utc),
                password_updated_count=0,
                is_active=True,
                roles=["patient"],
            )
            db.add(user)
            await db.flush()
            print(f"created user      {user.id}  ({a.username} / {email})")
        else:
            if user.username != a.username or (user.email or "").lower() != email:
                sys.exit(f"A different user already holds that username or email "
                         f"({user.username} / {user.email}). Pick another --username/--email.")
            user.is_active = True
            if a.reset_password:
                user.hashed_password = hash_password(a.password)
                user.password_updated_at = datetime.now(timezone.utc)
                user.password_updated_count = (user.password_updated_count or 0) + 1
                print("password reset")
            print(f"user exists       {user.id}")

        # ── 2. patient (oldest active row with this email, as login does) ───
        patient = (await db.execute(
            select(Patient).where(func.lower(Patient.email) == email)
            .order_by(Patient.created_at.asc())
        )).scalars().first()
        if patient is None:
            patient = Patient(
                full_name=a.name,
                email=email,
                gender="prefer_not_to_say",
                blood_group="unknown",
                date_of_birth=date(1990, 1, 1),
                allergies="NA",
                is_active=True,
            )
            db.add(patient)
            await db.flush()
            print(f"created patient   {patient.id}")
        else:
            patient.is_active = True
            print(f"patient exists    {patient.id}")

        # ── 3. user_patient_links ──────────────────────────────────────────
        link = (await db.execute(
            select(UserPatientLink).where(UserPatientLink.patient_id == patient.id)
        )).scalars().first()
        if link is None:
            existing_primary = (await db.execute(
                select(UserPatientLink).where(UserPatientLink.user_id == user.id,
                                              UserPatientLink.is_primary == True)  # noqa: E712
            )).scalars().first()
            if existing_primary is not None:
                print(f"note: user already has a primary link to patient {existing_primary.patient_id}; "
                      f"leaving it")
            else:
                db.add(UserPatientLink(user_id=user.id, patient_id=patient.id,
                                       is_primary=True, is_active=True))
                print("created user_patient_link")
        else:
            if link.user_id is None:
                link.user_id = user.id
            link.is_active = True
            print("link exists")

        # ── 4. credits ─────────────────────────────────────────────────────
        if await db.get(UserLLMCredits, user.id) is None:
            db.add(UserLLMCredits(user_id=user.id, balance=100, total_purchased=0, total_used=0))
            print("created credits   balance=100")

        # ── optional: attach a phone login to the same patient ─────────────
        if a.link_phone:
            digits = "".join(ch for ch in a.link_phone if ch.isdigit())
            if len(digits) == 12 and digits.startswith("91"):
                digits = digits[2:]
            if len(digits) != 10:
                sys.exit("--link-phone must be a 10-digit Indian mobile number")
            pu = (await db.execute(select(PhoneUser).where(PhoneUser.phone_number == digits))).scalars().first()
            if pu is None:
                sys.exit(f"No phone_users row for {digits}. Log in once with that number "
                         f"(Phone tab in the app) so it exists, then re-run.")
            other = (await db.execute(
                select(Patient).where(Patient.phone_user_id == pu.id, Patient.id != patient.id)
            )).scalars().first()
            if other is not None:
                sys.exit(f"{digits} already owns patient {other.id}. Linking a second patient would "
                         f"break /phone/auth/verify (it expects exactly one). Resolve that first.")
            patient.phone_user_id = pu.id
            patient.phone = digits
            if link is not None and link.phone_user_id is None:
                link.phone_user_id = pu.id
            print(f"linked phone      {digits} -> patient {patient.id}")

        await db.commit()

    print()
    print("Test login for the PAL app (Email tab):")
    print(f"  username : {a.username}   (or email {email})")
    print(f"  password : {a.password}")
    print(f"  patient  : {patient.id}")


if __name__ == "__main__":
    asyncio.run(main())
