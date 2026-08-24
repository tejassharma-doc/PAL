"""Create patients table and migrate data from users

Revision ID: 001_patients
Revises:
Create Date: 2026-07-09

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import uuid

# revision identifiers
revision = '001_patients'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # 1. Create patients table with all required fields
    op.create_table(
        'patients',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),

        # Healthcare identifiers
        sa.Column('clinic_id', sa.String(100), nullable=True),
        sa.Column('mrn', sa.String(100), nullable=True),
        sa.Column('abha_id', sa.String(100), nullable=True),
        sa.Column('abha_address', sa.String(255), nullable=True),

        # Personal information
        sa.Column('full_name', sa.String(255), nullable=False),
        sa.Column('date_of_birth', sa.Date(), nullable=True),
        sa.Column('gender', sa.String(20), nullable=True),
        sa.Column('phone', sa.String(30), nullable=True),
        sa.Column('email', sa.String(320), nullable=True),

        # Medical information
        sa.Column('blood_group', sa.String(10), nullable=True),
        sa.Column('address', sa.Text(), nullable=True),
        sa.Column('allergies', sa.Text(), nullable=True),
        sa.Column('chronic_conditions', sa.Text(), nullable=True),
        sa.Column('current_medications', sa.Text(), nullable=True),
        sa.Column('emergency_contact', postgresql.JSONB(), nullable=True),

        # Profile
        sa.Column('photo_url', sa.String(500), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, default=True),

        # Timestamps
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),

        # Foreign key and constraints
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('abha_id', name='uq_patients_abha_id')
    )

    # Create indexes
    op.create_index('ix_patients_user_id', 'patients', ['user_id'])
    op.create_index('ix_patients_clinic_id', 'patients', ['clinic_id'])
    op.create_index('ix_patients_mrn', 'patients', ['mrn'])
    op.create_index('ix_patients_abha_id', 'patients', ['abha_id'])
    op.create_index('ix_patients_phone', 'patients', ['phone'])

    # 2. Add new columns to users table
    op.add_column('users', sa.Column('username', sa.String(100), nullable=True))
    op.add_column('users', sa.Column('password_updated_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('password_updated_count', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('users', sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'))

    # 3. Migrate existing user data to patients table
    # Create a patient record for each existing user
    op.execute("""
        INSERT INTO patients (
            id, user_id, full_name, date_of_birth, phone, email,
            is_active, created_at, updated_at
        )
        SELECT
            id as id,  -- Keep same ID for FK compatibility
            id as user_id,  -- User owns their own patient record
            COALESCE(full_name, 'Patient ' || SUBSTRING(CAST(id AS VARCHAR), 1, 8)) as full_name,
            date_of_birth,
            phone,
            email,
            COALESCE(active, true) as is_active,
            COALESCE(created_at, NOW()) as created_at,
            COALESCE(updated_at, NOW()) as updated_at
        FROM users
        WHERE id IS NOT NULL
    """)

    # 4. Set username for existing users (use email prefix or generate from ID)
    op.execute("""
        UPDATE users
        SET username = CASE
            WHEN email IS NOT NULL THEN SPLIT_PART(email, '@', 1)
            ELSE 'user_' || SUBSTRING(CAST(id AS VARCHAR), 1, 8)
        END
        WHERE username IS NULL
    """)

    # 5. Ensure email and hashed_password are not null for existing users
    op.execute("UPDATE users SET email = 'user_' || id || '@noemail.local' WHERE email IS NULL")
    op.execute("UPDATE users SET hashed_password = 'DISABLED_ACCOUNT' WHERE hashed_password IS NULL")

    # 6. Now make username, email, hashed_password NOT NULL
    op.alter_column('users', 'username', nullable=False)
    op.alter_column('users', 'email', nullable=False)
    op.alter_column('users', 'hashed_password', nullable=False)

    # 7. Create unique constraints on new user fields
    op.create_unique_constraint('uq_users_username', 'users', ['username'])
    op.create_index('ix_users_username', 'users', ['username'])

    # 8. Drop old columns from users (moved to patients)
    op.drop_column('users', 'full_name')
    op.drop_column('users', 'phone')
    op.drop_column('users', 'phone_verified')
    op.drop_column('users', 'date_of_birth')
    op.drop_column('users', 'preferred_language')
    op.drop_column('users', 'byo_key_configured')
    op.drop_column('users', 'standing_personalize_consent')
    op.drop_column('users', 'standing_consent_granted_at')
    op.drop_column('users', 'active')
    op.drop_column('users', 'email_verified')


def downgrade():
    # Reverse migration - add columns back to users
    op.add_column('users', sa.Column('full_name', sa.String(255), nullable=True))
    op.add_column('users', sa.Column('phone', sa.String(30), nullable=True))
    op.add_column('users', sa.Column('phone_verified', sa.Boolean(), default=False))
    op.add_column('users', sa.Column('date_of_birth', sa.Date(), nullable=True))
    op.add_column('users', sa.Column('preferred_language', sa.String(10), default='en'))
    op.add_column('users', sa.Column('byo_key_configured', sa.Boolean(), default=False))
    op.add_column('users', sa.Column('standing_personalize_consent', sa.Boolean(), default=False))
    op.add_column('users', sa.Column('standing_consent_granted_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('active', sa.Boolean(), default=True))
    op.add_column('users', sa.Column('email_verified', sa.Boolean(), default=False))

    # Copy data back from patients to users
    op.execute("""
        UPDATE users u
        SET full_name = p.full_name,
            phone = p.phone,
            date_of_birth = p.date_of_birth,
            active = p.is_active
        FROM patients p
        WHERE u.id = p.user_id
    """)

    # Drop new columns from users
    op.drop_constraint('uq_users_username', 'users')
    op.drop_index('ix_users_username', 'users')
    op.drop_column('users', 'username')
    op.drop_column('users', 'password_updated_at')
    op.drop_column('users', 'password_updated_count')
    op.drop_column('users', 'is_active')

    # Drop patients table
    op.drop_table('patients')
