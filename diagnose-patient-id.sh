#!/bin/bash
# Diagnose Patient ID Issue
# Checks what patient IDs are in database vs what's being passed

echo "=========================================="
echo "🔍 Patient ID Diagnostic Tool"
echo "=========================================="
echo ""

# Check what patient IDs exist in database
echo "Step 1: Checking patient IDs in database..."
echo ""

docker exec -it pal-prod-db psql -U pal -d pal -c "
SELECT
    p.id as patient_id,
    p.full_name,
    p.phone,
    p.phone_user_id,
    pu.phone_number,
    pu.id as phone_user_id_actual
FROM patients p
LEFT JOIN phone_users pu ON p.phone_user_id = pu.id
ORDER BY p.created_at DESC
LIMIT 10;
" 2>/dev/null || echo "❌ Could not connect to database"

echo ""
echo "=========================================="
echo "Step 2: Check API logs for patient_id in response..."
echo ""

docker logs pal-prod-api --tail 100 | grep -A 5 "patient_id\|Patient" | tail -20

echo ""
echo "=========================================="
echo "Step 3: Common Issues & Fixes"
echo "=========================================="
echo ""

echo "Issue 1: Wrong patient_id cached in browser localStorage"
echo "Fix: Clear browser localStorage and login again"
echo "  1. Open browser DevTools (F12)"
echo "  2. Go to Application > Local Storage"
echo "  3. Delete 'pal_patient_id'"
echo "  4. Login again"
echo ""

echo "Issue 2: Backend returning wrong patient_id"
echo "Fix: Check backend logs when user logs in"
echo "  docker logs -f pal-prod-api | grep 'patient_id'"
echo ""

echo "Issue 3: Multiple patients for same phone_user"
echo "Fix: Ensure one patient per phone_user_id"
echo "  Check query above for duplicates"
echo ""

echo "=========================================="
echo "📋 Debug Steps:"
echo "=========================================="
echo ""
echo "1. Login with phone OTP"
echo "2. Check browser localStorage for pal_patient_id"
echo "3. Compare with database patient IDs above"
echo "4. If mismatch, clear localStorage and login again"
echo ""

echo "=========================================="
echo "🔧 Get Actual Patient ID for Phone:"
echo "=========================================="
echo ""
echo "Run this command with the user's phone number:"
echo ""
echo "docker exec -it pal-prod-db psql -U pal -d pal -c \\"
echo "  \"SELECT p.id, p.full_name, pu.phone_number \\"
echo "   FROM patients p \\"
echo "   JOIN phone_users pu ON p.phone_user_id = pu.id \\"
echo "   WHERE pu.phone_number = 'PHONE_NUMBER_HERE';\""
echo ""

echo "=========================================="
echo "✅ To test patient_id in API call:"
echo "=========================================="
echo ""
echo "# Get token from login"
echo "TOKEN=\$(curl -s -X POST http://localhost:8001/phone/auth/verify \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{\"phone\":\"7506584004\",\"otp_code\":\"123456\"}' \\"
echo "  | grep -oP '\"access_token\":\s*\"\K[^\"]+' || echo 'FAILED')"
echo ""
echo "# Test Hermes with patient_id"
echo "curl -X POST http://localhost:8001/hermes/chat \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -H \"Authorization: Bearer \$TOKEN\" \\"
echo "  -d '{\"query\":\"test\",\"patient_id\":\"ACTUAL_PATIENT_ID_HERE\"}'"
echo ""
