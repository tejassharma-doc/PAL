#!/bin/bash
# Quick Patient ID Checker
# Usage: bash check-patient-id.sh PHONE_NUMBER

PHONE="${1:-7506584004}"

echo "=========================================="
echo "🔍 Checking Patient ID for: $PHONE"
echo "=========================================="
echo ""

# Check database for this phone number
echo "📊 Database Query:"
docker exec -it pal-prod-db psql -U pal -d pal << EOF
SELECT
    '=== PATIENT INFO ===' as info,
    p.id as patient_id,
    p.full_name as patient_name,
    p.phone as patient_phone,
    p.created_at::date as created_date,
    pu.id as phone_user_id,
    pu.phone_number as phone_user_phone
FROM patients p
JOIN phone_users pu ON p.phone_user_id = pu.id
WHERE pu.phone_number = '$PHONE'
ORDER BY p.created_at DESC;
EOF

echo ""
echo "=========================================="
echo "📝 What to do next:"
echo "=========================================="
echo ""
echo "1. Compare patient_id above with wrong ID: 2968bd7b-f9a3-436f-9714-a2e8d22a113d"
echo ""
echo "2. If patient_id is different:"
echo "   - Clear browser localStorage"
echo "   - Login again"
echo "   - Should get correct patient_id"
echo ""
echo "3. If no patient found:"
echo "   - User needs to complete onboarding"
echo "   - Create patient profile"
echo ""
echo "4. If multiple patients found:"
echo "   - Delete duplicates"
echo "   - Keep only one patient per phone_user"
echo ""

echo "=========================================="
echo "🧪 Test Login:"
echo "=========================================="
echo ""
echo "curl -X POST http://localhost:8001/phone/auth/verify \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{\"phone\":\"$PHONE\",\"otp_code\":\"YOUR_OTP\"}' \\"
echo "  | python3 -m json.tool | grep patient_id"
echo ""
