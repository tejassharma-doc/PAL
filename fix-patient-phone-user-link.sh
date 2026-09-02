#!/bin/bash
# Fix Patient Phone User Link
# Links existing patients to phone_users table

echo "=========================================="
echo "🔧 Fix Patient → Phone User Link"
echo "=========================================="
echo ""

echo "Step 1: Check current state..."
docker exec -it pal-prod-db psql -U pal -d pal << 'EOF'
SELECT
    'PATIENTS WITH MISSING LINK' as issue,
    COUNT(*) as count
FROM patients
WHERE phone_user_id IS NULL AND phone IS NOT NULL;
EOF

echo ""
echo "Step 2: Show affected patients..."
docker exec -it pal-prod-db psql -U pal -d pal << 'EOF'
SELECT
    p.id as patient_id,
    p.full_name,
    p.phone as patient_phone,
    p.phone_user_id as current_link,
    pu.id as should_link_to,
    pu.phone_number
FROM patients p
LEFT JOIN phone_users pu ON p.phone = pu.phone_number
WHERE p.phone_user_id IS NULL AND p.phone IS NOT NULL
ORDER BY p.created_at DESC
LIMIT 10;
EOF

echo ""
read -p "Fix these patients? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "Step 3: Fixing patients..."
docker exec -it pal-prod-db psql -U pal -d pal << 'EOF'
UPDATE patients
SET phone_user_id = (
    SELECT id
    FROM phone_users
    WHERE phone_number = patients.phone
    LIMIT 1
),
updated_at = NOW()
WHERE phone_user_id IS NULL
  AND phone IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM phone_users WHERE phone_number = patients.phone
  );

SELECT 'PATIENTS FIXED' as status, COUNT(*) as count
FROM patients
WHERE phone_user_id IS NOT NULL AND phone IS NOT NULL;
EOF

echo ""
echo "Step 4: Verify Prakash Asadiya..."
docker exec -it pal-prod-db psql -U pal -d pal << 'EOF'
SELECT
    p.id as patient_id,
    p.full_name,
    p.phone,
    p.phone_user_id,
    pu.phone_number as phone_user_phone
FROM patients p
JOIN phone_users pu ON p.phone_user_id = pu.id
WHERE p.full_name = 'Prakash Asadiya';
EOF

echo ""
echo "=========================================="
echo "✅ Fix Complete!"
echo "=========================================="
echo ""
echo "📋 Next Steps:"
echo "1. Test phone OTP login for fixed patients"
echo "2. Rebuild MCP server to apply webhook fix"
echo "3. Future webhooks will auto-link patients"
echo ""
echo "🧪 Test Login:"
echo "curl -X POST http://localhost:8001/phone/auth/verify \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{\"phone\":\"9638882409\",\"otp_code\":\"YOUR_OTP\"}' \\"
echo "  | python3 -m json.tool"
echo ""
