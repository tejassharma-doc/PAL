-- Fix Existing Patient: Link to phone_user
-- Issue: Patient "Prakash Asadiya" exists but phone_user_id is NULL
-- Solution: Link patient to correct phone_user based on phone number

-- Step 1: Check current state
SELECT
    'BEFORE UPDATE' as status,
    p.id as patient_id,
    p.full_name,
    p.phone as patient_phone,
    p.phone_user_id as current_phone_user_id,
    pu.id as should_be_phone_user_id,
    pu.phone_number
FROM patients p
LEFT JOIN phone_users pu ON p.phone = pu.phone_number
WHERE p.full_name = 'Prakash Asadiya';

-- Step 2: Update patient to link to phone_user
UPDATE patients
SET phone_user_id = (
    SELECT id
    FROM phone_users
    WHERE phone_number = patients.phone
    LIMIT 1
)
WHERE phone_user_id IS NULL
  AND phone IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM phone_users WHERE phone_number = patients.phone
  );

-- Step 3: Verify fix
SELECT
    'AFTER UPDATE' as status,
    p.id as patient_id,
    p.full_name,
    p.phone as patient_phone,
    p.phone_user_id,
    pu.phone_number as phone_user_phone
FROM patients p
LEFT JOIN phone_users pu ON p.phone_user_id = pu.id
WHERE p.full_name = 'Prakash Asadiya';

-- Step 4: Show all patients with missing phone_user_id link
SELECT
    p.id as patient_id,
    p.full_name,
    p.phone,
    p.phone_user_id,
    CASE
        WHEN pu.id IS NOT NULL THEN 'CAN BE LINKED'
        ELSE 'NO MATCHING PHONE_USER'
    END as status
FROM patients p
LEFT JOIN phone_users pu ON p.phone = pu.phone_number
WHERE p.phone_user_id IS NULL
ORDER BY p.created_at DESC;
