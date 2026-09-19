"""Quick script to add sample visit data - Run this to populate the database"""
import asyncio
import os
from datetime import datetime
import uuid

# Set the correct database URL before importing
os.environ['DATABASE_URL'] = 'postgresql+asyncpg://pal:change_me_in_prod@localhost:5432/pal'

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import select

from models import User
from models.health_record import AppointmentRequest, AppointmentRequestStatus
from auth import hash_password


async def add_visits():
    DATABASE_URL = 'postgresql+asyncpg://pal:change_me_in_prod@localhost:5432/pal'

    engine = create_async_engine(DATABASE_URL, echo=False)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        # Find any existing user or create test user
        result = await session.execute(select(User).limit(1))
        user = result.scalar_one_or_none()

        if not user:
            print("❌ No users found. Please register a user first at http://localhost:3000/signup")
            return

        print(f"✅ Found user: {user.email} (ID: {user.id})")

        tenant_id = uuid.UUID('00000000-0000-0000-0000-000000000001')

        # Check existing visits
        result = await session.execute(
            select(AppointmentRequest).where(
                AppointmentRequest.member_id == user.id,
                AppointmentRequest.tenant_id == tenant_id,
            )
        )
        existing = result.scalars().all()

        if existing:
            print(f"⚠️  Found {len(existing)} existing visit(s). Deleting them first...")
            for v in existing:
                await session.delete(v)
            await session.commit()

        print("📝 Creating sample visits...")

        # Past visit 1: Dr. Rao - May 12
        visit1 = AppointmentRequest(
            tenant_id=tenant_id,
            member_id=user.id,
            requesting_user_id=user.id,
            session_id='manual_seed',
            action_type='manual_entry',
            action_payload={
                'doctor_name': 'Dr. Rao',
                'specialty': 'Physician · OPD',
                'reason': 'Cardiometabolic review',
                'datetime': '2026-05-12T14:00:00',
                'location': 'City Clinic OPD',
                'care_plan': 'Cardiometabolic care plan',
            },
            status=AppointmentRequestStatus.confirmed,
            confirmed_at=datetime(2026, 5, 12, 14, 0),
        )

        # Past visit 2: Sneha - May 14
        visit2 = AppointmentRequest(
            tenant_id=tenant_id,
            member_id=user.id,
            requesting_user_id=user.id,
            session_id='manual_seed',
            action_type='manual_entry',
            action_payload={
                'doctor_name': 'Sneha',
                'specialty': 'Nutritionist · iNutriMon',
                'reason': 'Nutrition consultation',
                'datetime': '2026-05-14T10:30:00',
                'location': 'iNutriMon Clinic',
                'care_plan': 'Cholesterol nutrition plan',
            },
            status=AppointmentRequestStatus.confirmed,
            confirmed_at=datetime(2026, 5, 14, 10, 30),
        )

        # Upcoming visit: Dr. Rao - June 26
        visit3 = AppointmentRequest(
            tenant_id=tenant_id,
            member_id=user.id,
            requesting_user_id=user.id,
            session_id='hermes_demo',
            action_type='hermes_call',
            action_payload={
                'doctor_name': 'Dr. Rao',
                'specialty': 'Physician · OPD',
                'reason': 'Lipid review',
                'datetime': '2026-06-26T11:30:00',
                'location': 'City Clinic OPD',
                'care_plan': '12-week cholesterol follow-up',
            },
            status=AppointmentRequestStatus.confirmed,
            confirmed_at=datetime.now(),
        )

        session.add_all([visit1, visit2, visit3])
        await session.commit()

        print("✅ Successfully added 3 visits:")
        print("   1. Dr. Rao - May 12, 2026 (past)")
        print("   2. Sneha - May 14, 2026 (past)")
        print("   3. Dr. Rao - June 26, 2026 (upcoming)")
        print()
        print(f"🔑 User: {user.email}")
        print(f"🆔 User ID: {user.id}")
        print(f"🏢 Tenant ID: {tenant_id}")
        print()
        print("✅ Now visit http://localhost:3000/visits to see the data!")


if __name__ == '__main__':
    try:
        asyncio.run(add_visits())
    except Exception as e:
        print(f"❌ Error: {e}")
        print("\nMake sure:")
        print("1. PostgreSQL is running: docker-compose up -d db")
        print("2. Password matches: change_me_in_prod")
