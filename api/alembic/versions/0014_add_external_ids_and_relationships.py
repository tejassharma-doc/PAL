"Add external_id to clinics and clinic_id to doctors

Revision ID: 0014_add_external_ids_rels
Revises: 0013_chat_read_watermark
Create Date: 2026-08-20

"
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers
revision = '0014_add_external_ids_rels'
down_revision = '0013_chat_read_watermark'
branch_labels = None
depends_on = None


def upgrade():
    # Add external_id to clinics table
    op.add_column('clinics', sa.Column('external_id', sa.String(255), nullable=True))
    op.create_index('ix_clinics_external_id', 'clinics', ['external_id'], unique=True)
    
    # Add clinic_id to doctors table
    op.add_column('doctors', sa.Column('clinic_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index('ix_doctors_clinic_id', 'doctors', ['clinic_id'])
    op.create_foreign_key(
        'fk_doctors_clinic_id_clinics',
        'doctors', 'clinics',
        ['clinic_id'], ['id']
    )
    
    # Add index on doctor full_name for faster lookups (if not exists)
    op.execute("
 DO \$\$
 BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_doctors_full_name') THEN
 CREATE INDEX ix_doctors_full_name ON doctors(full_name);
 END IF;
 END \$\$;
 ")
    
    # Add index on clinic name for faster lookups (if not exists)
    op.execute("
 DO \$\$
 BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_clinics_name') THEN
 CREATE INDEX ix_clinics_name ON clinics(name);
 END IF;
 END \$\$;
 ")


def downgrade():
    # Remove indices (ignore if they don't exist)
    op.execute(DROP INDEX IF EXISTS ix_clinics_name)
    op.execute(DROP INDEX IF EXISTS ix_doctors_full_name)
    
    # Remove foreign key and column from doctors
    op.drop_constraint('fk_doctors_clinic_id_clinics', 'doctors', type_='foreignkey')
    op.drop_index('ix_doctors_clinic_id', table_name='doctors')
    op.drop_column('doctors', 'clinic_id')
    
    # Remove external_id from clinics
    op.drop_index('ix_clinics_external_id', table_name='clinics')
    op.drop_column('clinics', 'external_id')
