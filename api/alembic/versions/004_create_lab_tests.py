"""Create lab_tests table

Revision ID: 004_lab_tests
Revises: 003_clinic_models
Create Date: 2026-07-14

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

# revision identifiers, used by Alembic.
revision = '004_lab_tests'
down_revision = '002_users_update'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create lab_tests table
    op.create_table(
        'lab_tests',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),

        # Foreign Keys
        sa.Column('patient_id', UUID(as_uuid=True), sa.ForeignKey('patients.id', ondelete='CASCADE'), nullable=False),
        sa.Column('appointment_id', UUID(as_uuid=True), sa.ForeignKey('appointments.id', ondelete='SET NULL'), nullable=True),
        sa.Column('document_id', UUID(as_uuid=True), sa.ForeignKey('patient_documents.id', ondelete='SET NULL'), nullable=True),

        # Test Information
        sa.Column('test_name', sa.String(255), nullable=False),
        sa.Column('test_category', sa.String(100), nullable=True),
        sa.Column('test_type', sa.String(100), nullable=True),

        # Dates
        sa.Column('ordered_date', sa.Date, nullable=False),
        sa.Column('sample_collected_date', sa.Date, nullable=True),
        sa.Column('result_date', sa.Date, nullable=True),

        # Status
        sa.Column('status', sa.String(50), nullable=False, server_default='ordered'),

        # Results
        sa.Column('results', JSONB, nullable=True),
        sa.Column('reference_range', sa.Text, nullable=True),
        sa.Column('abnormal_flag', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('interpretation', sa.Text, nullable=True),

        # Provider Information
        sa.Column('ordered_by', sa.String(255), nullable=True),
        sa.Column('lab_name', sa.String(255), nullable=True),
        sa.Column('lab_location', sa.String(255), nullable=True),

        # Notes
        sa.Column('notes', sa.Text, nullable=True),

        # Timestamps
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=False),
    )

    # Create indexes
    op.create_index('idx_lab_tests_patient_id', 'lab_tests', ['patient_id'])
    op.create_index('idx_lab_tests_appointment_id', 'lab_tests', ['appointment_id'])
    op.create_index('idx_lab_tests_test_name', 'lab_tests', ['test_name'])
    op.create_index('idx_lab_tests_test_category', 'lab_tests', ['test_category'])
    op.create_index('idx_lab_tests_ordered_date', 'lab_tests', ['ordered_date'])
    op.create_index('idx_lab_tests_status', 'lab_tests', ['status'])
    op.create_index('idx_lab_tests_abnormal_flag', 'lab_tests', ['abnormal_flag'])


def downgrade() -> None:
    # Drop indexes
    op.drop_index('idx_lab_tests_abnormal_flag', table_name='lab_tests')
    op.drop_index('idx_lab_tests_status', table_name='lab_tests')
    op.drop_index('idx_lab_tests_ordered_date', table_name='lab_tests')
    op.drop_index('idx_lab_tests_test_category', table_name='lab_tests')
    op.drop_index('idx_lab_tests_test_name', table_name='lab_tests')
    op.drop_index('idx_lab_tests_appointment_id', table_name='lab_tests')
    op.drop_index('idx_lab_tests_patient_id', table_name='lab_tests')

    # Drop table
    op.drop_table('lab_tests')
