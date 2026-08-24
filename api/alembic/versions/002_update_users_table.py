"""Clear and update users table structure

Revision ID: 002_users_update
Revises: 001_patients
Create Date: 2026-07-09

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers
revision = '002_users_update'
down_revision = '001_patients'
branch_labels = None
depends_on = None


def upgrade():
    # 1. DELETE all data from users table
    op.execute("TRUNCATE TABLE users CASCADE")

    # 2. Drop all old columns that we don't need
    # Check if columns exist before dropping to avoid errors

    # Drop old patient-related columns
    try:
        op.drop_column('users', 'full_name')
    except:
        pass

    try:
        op.drop_column('users', 'phone')
    except:
        pass

    try:
        op.drop_column('users', 'phone_verified')
    except:
        pass

    try:
        op.drop_column('users', 'date_of_birth')
    except:
        pass

    try:
        op.drop_column('users', 'preferred_language')
    except:
        pass

    try:
        op.drop_column('users', 'byo_key_configured')
    except:
        pass

    try:
        op.drop_column('users', 'standing_personalize_consent')
    except:
        pass

    try:
        op.drop_column('users', 'standing_consent_granted_at')
    except:
        pass

    try:
        op.drop_column('users', 'email_verified')
    except:
        pass

    try:
        op.drop_column('users', 'active')
    except:
        pass

    # 3. Add new columns if they don't exist

    # Add username (will be required)
    try:
        op.add_column('users', sa.Column('username', sa.String(100), nullable=True))
    except:
        pass

    # Add password tracking columns
    try:
        op.add_column('users', sa.Column('password_updated_at', sa.DateTime(timezone=True), nullable=True))
    except:
        pass

    try:
        op.add_column('users', sa.Column('password_updated_count', sa.Integer(), nullable=False, server_default='0'))
    except:
        pass

    # Add is_active (replaces old 'active')
    try:
        op.add_column('users', sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'))
    except:
        pass

    # 4. Make email and hashed_password NOT NULL
    op.alter_column('users', 'email',
                    existing_type=sa.String(320),
                    nullable=False)

    op.alter_column('users', 'hashed_password',
                    existing_type=sa.String(255),
                    nullable=False)

    # 5. Make username NOT NULL
    op.alter_column('users', 'username',
                    existing_type=sa.String(100),
                    nullable=False)

    # 6. Create unique constraints
    try:
        op.create_unique_constraint('uq_users_username', 'users', ['username'])
    except:
        pass

    try:
        op.create_unique_constraint('uq_users_email', 'users', ['email'])
    except:
        pass

    # 7. Create indexes
    try:
        op.create_index('ix_users_username', 'users', ['username'])
    except:
        pass

    try:
        op.create_index('ix_users_email', 'users', ['email'])
    except:
        pass

    print("✅ Users table updated successfully!")
    print("   - All old data deleted")
    print("   - Structure updated to: username, email, password, password_updated_at, password_updated_count, is_active")


def downgrade():
    # Add back old columns
    op.add_column('users', sa.Column('full_name', sa.String(255), nullable=True))
    op.add_column('users', sa.Column('phone', sa.String(30), nullable=True))
    op.add_column('users', sa.Column('phone_verified', sa.Boolean(), default=False))
    op.add_column('users', sa.Column('date_of_birth', sa.Date(), nullable=True))
    op.add_column('users', sa.Column('preferred_language', sa.String(10), default='en'))
    op.add_column('users', sa.Column('byo_key_configured', sa.Boolean(), default=False))
    op.add_column('users', sa.Column('standing_personalize_consent', sa.Boolean(), default=False))
    op.add_column('users', sa.Column('standing_consent_granted_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('email_verified', sa.Boolean(), default=False))
    op.add_column('users', sa.Column('active', sa.Boolean(), default=True))

    # Drop new columns
    op.drop_constraint('uq_users_username', 'users')
    op.drop_index('ix_users_username', 'users')
    op.drop_column('users', 'username')
    op.drop_column('users', 'password_updated_at')
    op.drop_column('users', 'password_updated_count')
    op.drop_column('users', 'is_active')
