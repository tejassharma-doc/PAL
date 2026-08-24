"""
Quick script to create a test user and add sample visit data
Run this to test the visits endpoint
"""
import asyncio
from datetime import datetime, timedelta
import uuid

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import select

from models import User
from models.health_record import AppointmentRequest, AppointmentRequestStatus
from auth import hash_password
from config import get_settings


async def create_test_data():
    settings = get_settings()

    # Create async engine
    engine = create_async_engine(settings.database_url, echo=True)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        # Check if test user exists
        result = await session.execute(
            select(User).where(User.email == 'testuser@example.com')
        )
        user = result.scalar_one_or_none()

        if not user:
            print("Creating test user...")
            user = User(
                email='testuser@example.com',
                hashed_password=hash_password('Test123456'),
                full_name='Test User',
                phone='9876543210',
                phone_verified=False,
                email_verified=False,
                preferred_language='en',
                active=True,
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)
            print(f"✅ Created user: {user.email} (ID: {user.id})")
        else:
            print(f"✅ Test user already exists (ID: {user.id})")

        # Get tenant_id (use default)
        tenant_id = uuid.UUID('00000000-0000-0000-0000-000000000001')

        # Check if visits already exist
        result = await session.execute(
            select(AppointmentRequest).where(
                AppointmentRequest.member_id == user.id,
                AppointmentRequest.tenant_id == tenant_id,
            )
        )
        existing_visits = result.scalars().all()

        if existing_visits:
            print(f"✅ {len(existing_visits)} visit(s) already exist for this user")
            return

        print("Creating sample visit data...")

        # Past visit 1: Dr. Rao - May 12, 2026
        past1 = AppointmentRequest(
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
                'notes': 'Initial consultation for cholesterol management'
            },
            status=AppointmentRequestStatus.confirmed,
            confirmed_at=datetime(2026, 5, 12, 14, 0),
        )

        # Past visit 2: Sneha - May 8, 2026
        past2 = AppointmentRequest(
            tenant_id=tenant_id,
            member_id=user.id,
            requesting_user_id=user.id,
            session_id='manual_seed',
            action_type='manual_entry',
            action_payload={
                'doctor_name': 'Sneha',
                'specialty': 'Nutritionist · iNutriMon',
                'reason': 'Nutrition consultation',
                'datetime': '2026-05-08T10:30:00',
                'location': 'iNutriMon Clinic',
                'care_plan': 'Cholesterol nutrition plan',
                'notes': 'Dietary plan for cholesterol management'
            },
            status=AppointmentRequestStatus.confirmed,
            confirmed_at=datetime(2026, 5, 8, 10, 30),
        )

        # Upcoming visit: Dr. Rao - June 26, 2026
        upcoming = AppointmentRequest(
            tenant_id=tenant_id,
            member_id=user.id,
            requesting_user_id=user.id,
            session_id='hermes_call_demo',
            action_type='hermes_call',
            action_payload={
                'doctor_name': 'Dr. Rao',
                'specialty': 'Physician · OPD',
                'reason': 'Lipid review',
                'datetime': '2026-06-26T11:30:00',
                'location': 'City Clinic OPD',
                'care_plan': '12-week cholesterol follow-up',
                'notes': 'Follow-up to review LDL levels after 12 weeks of medication'
            },
            status=AppointmentRequestStatus.confirmed,
            confirmed_at=datetime.now(),
        )

        session.add_all([past1, past2, upcoming])
        await session.commit()

        print("✅ Created 3 sample visits:")
        print(f"   - Past: Dr. Rao (May 12, 2026)")
        print(f"   - Past: Sneha (May 8, 2026)")
        print(f"   - Upcoming: Dr. Rao (June 26, 2026)")
        print()
        print("📋 Test credentials:")
        print(f"   Email: testuser@example.com")
        print(f"   Password: Test123456")
        print(f"   User ID: {user.id}")
        print(f"   Tenant ID: {tenant_id}")
        print()
        print("🧪 Test the API:")
        print(f"   1. Login: POST http://localhost:8000/v2/auth/login/password")
        print(f"   2. Get visits: GET http://localhost:8000/appointments/{tenant_id}/{user.id}/history")


if __name__ == '__main__':
    asyncio.run(create_test_data())
