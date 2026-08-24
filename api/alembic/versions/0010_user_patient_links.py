"""Add user_patient_links table for unified auth

Revision ID: 0010_user_patient_links
Revises:
Create Date: 2026-08-04

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '0010_user_patient_links'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create user_patient_links table
    op.create_table(
        'user_patient_links',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('phone_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('patient_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('is_primary', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['phone_user_id'], ['phone_users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['patient_id'], ['patients.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('patient_id', name='uq_patient_link'),
    )

    # Create indexes
    op.create_index('ix_user_patient_links_phone_user_id', 'user_patient_links', ['phone_user_id'])
    op.create_index('ix_user_patient_links_user_id', 'user_patient_links', ['user_id'])
    op.create_index('ix_user_patient_links_patient_id', 'user_patient_links', ['patient_id'])


def downgrade() -> None:
    op.drop_index('ix_user_patient_links_patient_id')
    op.drop_index('ix_user_patient_links_user_id')
    op.drop_index('ix_user_patient_links_phone_user_id')
    op.drop_table('user_patient_links')
