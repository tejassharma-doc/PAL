-- Clear and update users table structure
-- Run this SQL script to update the users table

-- 1. Delete all existing data from users table (and cascades to related tables)
TRUNCATE TABLE users CASCADE;

-- 2. Drop old columns (patient-related fields that moved to patients table)
ALTER TABLE users DROP COLUMN IF EXISTS full_name;
ALTER TABLE users DROP COLUMN IF EXISTS phone;
ALTER TABLE users DROP COLUMN IF EXISTS phone_verified;
ALTER TABLE users DROP COLUMN IF EXISTS date_of_birth;
ALTER TABLE users DROP COLUMN IF EXISTS preferred_language;
ALTER TABLE users DROP COLUMN IF EXISTS byo_key_configured;
ALTER TABLE users DROP COLUMN IF EXISTS standing_personalize_consent;
ALTER TABLE users DROP COLUMN IF EXISTS standing_consent_granted_at;
ALTER TABLE users DROP COLUMN IF EXISTS email_verified;
ALTER TABLE users DROP COLUMN IF EXISTS active;

-- 3. Add new columns for authentication only
ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_updated_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_updated_count INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- 4. Make email and password NOT NULL (required for authentication)
ALTER TABLE users ALTER COLUMN email SET NOT NULL;
ALTER TABLE users ALTER COLUMN hashed_password SET NOT NULL;
ALTER TABLE users ALTER COLUMN username SET NOT NULL;

-- 5. Add unique constraints
ALTER TABLE users ADD CONSTRAINT uq_users_username UNIQUE (username);
ALTER TABLE users ADD CONSTRAINT uq_users_email UNIQUE (email);

-- 6. Create indexes for performance
CREATE INDEX IF NOT EXISTS ix_users_username ON users(username);
CREATE INDEX IF NOT EXISTS ix_users_email ON users(email);

-- 7. Verify the new structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'users'
ORDER BY ordinal_position;

-- Expected columns:
-- id                      | uuid                     | NO
-- username                | character varying(100)   | NO
-- email                   | character varying(320)   | NO
-- hashed_password         | character varying(255)   | NO
-- password_updated_at     | timestamp with time zone | YES
-- password_updated_count  | integer                  | NO
-- is_active               | boolean                  | NO
-- created_at              | timestamp with time zone | NO
-- updated_at              | timestamp with time zone | NO
