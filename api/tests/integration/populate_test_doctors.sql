-- Populate test doctors and clinics for DocEHR integration

-- Insert test clinics
INSERT INTO clinics (id, name, external_id, address, is_active, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'Sunset Clinic', 'docehr-sunset-456', '123 Main St, Mumbai', true, NOW(), NOW()),
  (gen_random_uuid(), 'Apollo Hospital', 'docehr-apollo-789', '456 Oak Ave, Delhi', true, NOW(), NOW()),
  (gen_random_uuid(), 'City Health Center', 'docehr-city-123', '789 Pine Rd, Bangalore', true, NOW(), NOW())
ON CONFLICT (external_id) DO NOTHING;

-- Insert test doctors
WITH clinic_ids AS (
  SELECT id, name FROM clinics WHERE external_id IN ('docehr-sunset-456', 'docehr-apollo-789', 'docehr-city-123')
)
INSERT INTO doctors (id, full_name, external_id, specialization, clinic_id, email, phone, is_active, created_at, updated_at)
SELECT
  gen_random_uuid(),
  'Dr. Arjun Mehta',
  'docehr-dr-arjun-mehta-123',
  'Cardiology',
  (SELECT id FROM clinic_ids WHERE name = 'Sunset Clinic'),
  'arjun.mehta@sunset.com',
  '+919876543210',
  true,
  NOW(),
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM doctors WHERE external_id = 'docehr-dr-arjun-mehta-123')
UNION ALL
SELECT
  gen_random_uuid(),
  'Dr. Arjun Singh',
  'docehr-dr-arjun-singh-456',
  'Orthopedics',
  (SELECT id FROM clinic_ids WHERE name = 'Sunset Clinic'),
  'arjun.singh@sunset.com',
  '+919876543211',
  true,
  NOW(),
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM doctors WHERE external_id = 'docehr-dr-arjun-singh-456')
UNION ALL
SELECT
  gen_random_uuid(),
  'Dr. Priya Sharma',
  'docehr-dr-priya-789',
  'Pediatrics',
  (SELECT id FROM clinic_ids WHERE name = 'Apollo Hospital'),
  'priya.sharma@apollo.com',
  '+919876543212',
  true,
  NOW(),
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM doctors WHERE external_id = 'docehr-dr-priya-789')
UNION ALL
SELECT
  gen_random_uuid(),
  'Dr. Rajesh Kumar',
  'docehr-dr-rajesh-321',
  'General Medicine',
  (SELECT id FROM clinic_ids WHERE name = 'City Health Center'),
  'rajesh.kumar@cityhc.com',
  '+919876543213',
  true,
  NOW(),
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM doctors WHERE external_id = 'docehr-dr-rajesh-321')
UNION ALL
SELECT
  gen_random_uuid(),
  'Dr. Sneha Patel',
  'docehr-dr-sneha-654',
  'Dermatology',
  (SELECT id FROM clinic_ids WHERE name = 'Apollo Hospital'),
  'sneha.patel@apollo.com',
  '+919876543214',
  true,
  NOW(),
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM doctors WHERE external_id = 'docehr-dr-sneha-654');

-- Verify data
SELECT 'Clinics:' AS category, COUNT(*) AS count FROM clinics WHERE external_id IS NOT NULL
UNION ALL
SELECT 'Doctors:', COUNT(*) FROM doctors WHERE external_id IS NOT NULL;

-- Show sample data
SELECT 
  d.full_name,
  d.specialization,
  c.name AS clinic_name,
  d.external_id
FROM doctors d
LEFT JOIN clinics c ON d.clinic_id = c.id
WHERE d.external_id IS NOT NULL
ORDER BY c.name, d.full_name;
