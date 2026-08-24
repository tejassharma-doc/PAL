"""Migrate lab_tests to lab reports structure

This migration transforms the lab_tests table to support:
- Report-based structure (not just individual tests)
- File metadata (PDF, scanned images)
- OCR/extraction tracking
- FHIR compliance
- Processing status

Changes:
- Remove: reference_range, abnormal_flag, test_name
- Add: report_name, report_type, has_abnormal_values, report_format,
       processing_status, confidence_score, processed_at, extraction_model,
       extraction_version, raw_extracted_json, fhir_json, file_name,
       file_size, mime_type, storage_path, verified_date

Revision ID: 005_lab_reports
Revises: 004_lab_tests
Create Date: 2026-07-26

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

# revision identifiers, used by Alembic.
revision = '005_lab_reports'
down_revision = ('004_lab_tests', '0009')  # Merge both migration chains
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Step 1: Add new columns

    # Report identification
    op.add_column('lab_tests', sa.Column('report_name', sa.String(255), nullable=True))
    op.add_column('lab_tests', sa.Column('report_type', sa.String(100), nullable=True))

    # Report-level flags
    op.add_column('lab_tests', sa.Column('has_abnormal_values', sa.Boolean, nullable=True, server_default='false'))

    # File metadata
    op.add_column('lab_tests', sa.Column('report_format', sa.String(50), nullable=True))
    op.add_column('lab_tests', sa.Column('file_name', sa.String(512), nullable=True))
    op.add_column('lab_tests', sa.Column('file_size', sa.BigInteger, nullable=True))
    op.add_column('lab_tests', sa.Column('mime_type', sa.String(128), nullable=True))
    op.add_column('lab_tests', sa.Column('storage_path', sa.String(512), nullable=True))

    # Processing metadata
    op.add_column('lab_tests', sa.Column('processing_status', sa.String(50), nullable=True, server_default='pending'))
    op.add_column('lab_tests', sa.Column('confidence_score', sa.Float, nullable=True))
    op.add_column('lab_tests', sa.Column('processed_at', sa.TIMESTAMP(timezone=True), nullable=True))

    # Extraction metadata
    op.add_column('lab_tests', sa.Column('extraction_model', sa.String(100), nullable=True))
    op.add_column('lab_tests', sa.Column('extraction_version', sa.String(50), nullable=True))

    # Structured data
    op.add_column('lab_tests', sa.Column('raw_extracted_json', JSONB, nullable=True))
    op.add_column('lab_tests', sa.Column('fhir_json', JSONB, nullable=True))

    # Verified date (if different from result_date)
    op.add_column('lab_tests', sa.Column('verified_date', sa.Date, nullable=True))

    # Step 2: Migrate existing data
    # Copy test_name to report_name for existing records
    op.execute("""
        UPDATE lab_tests
        SET report_name = test_name,
            report_type = COALESCE(test_category, 'Unknown'),
            has_abnormal_values = abnormal_flag,
            processing_status = 'completed',
            processed_at = created_at
        WHERE report_name IS NULL
    """)

    # Step 3: Drop old columns
    op.drop_index('ix_lab_tests_test_name', table_name='lab_tests')
    op.drop_index('ix_lab_tests_abnormal_flag', table_name='lab_tests')

    op.drop_column('lab_tests', 'test_name')
    op.drop_column('lab_tests', 'reference_range')
    op.drop_column('lab_tests', 'abnormal_flag')

    # Step 4: Make report_name NOT NULL (after data migration)
    op.alter_column('lab_tests', 'report_name', nullable=False)

    # Step 5: Create new indexes
    op.create_index('idx_lab_tests_report_name', 'lab_tests', ['report_name'])
    op.create_index('idx_lab_tests_report_type', 'lab_tests', ['report_type'])
    op.create_index('idx_lab_tests_has_abnormal', 'lab_tests', ['has_abnormal_values'])
    op.create_index('idx_lab_tests_processing_status', 'lab_tests', ['processing_status'])
    op.create_index('idx_lab_tests_report_format', 'lab_tests', ['report_format'])


def downgrade() -> None:
    # Reverse migration - restore old structure

    # Drop new indexes
    op.drop_index('idx_lab_tests_report_format', table_name='lab_tests')
    op.drop_index('idx_lab_tests_processing_status', table_name='lab_tests')
    op.drop_index('idx_lab_tests_has_abnormal', table_name='lab_tests')
    op.drop_index('idx_lab_tests_report_type', table_name='lab_tests')
    op.drop_index('idx_lab_tests_report_name', table_name='lab_tests')

    # Add back old columns
    op.add_column('lab_tests', sa.Column('test_name', sa.String(255), nullable=True))
    op.add_column('lab_tests', sa.Column('reference_range', sa.Text, nullable=True))
    op.add_column('lab_tests', sa.Column('abnormal_flag', sa.Boolean, nullable=True, server_default='false'))

    # Migrate data back
    op.execute("""
        UPDATE lab_tests
        SET test_name = report_name,
            abnormal_flag = COALESCE(has_abnormal_values, false)
        WHERE test_name IS NULL
    """)

    # Make test_name NOT NULL
    op.alter_column('lab_tests', 'test_name', nullable=False)
    op.alter_column('lab_tests', 'abnormal_flag', nullable=False)

    # Recreate old indexes
    op.create_index('ix_lab_tests_test_name', 'lab_tests', ['test_name'])
    op.create_index('ix_lab_tests_abnormal_flag', 'lab_tests', ['abnormal_flag'])

    # Drop new columns
    op.drop_column('lab_tests', 'verified_date')
    op.drop_column('lab_tests', 'fhir_json')
    op.drop_column('lab_tests', 'raw_extracted_json')
    op.drop_column('lab_tests', 'extraction_version')
    op.drop_column('lab_tests', 'extraction_model')
    op.drop_column('lab_tests', 'processed_at')
    op.drop_column('lab_tests', 'confidence_score')
    op.drop_column('lab_tests', 'processing_status')
    op.drop_column('lab_tests', 'storage_path')
    op.drop_column('lab_tests', 'mime_type')
    op.drop_column('lab_tests', 'file_size')
    op.drop_column('lab_tests', 'file_name')
    op.drop_column('lab_tests', 'report_format')
    op.drop_column('lab_tests', 'has_abnormal_values')
    op.drop_column('lab_tests', 'report_type')
    op.drop_column('lab_tests', 'report_name')
