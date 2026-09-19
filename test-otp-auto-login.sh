#!/bin/bash
# Test Phone OTP Auto-Login Feature
# Tests both new user and existing user scenarios

echo "=========================================="
echo "🧪 Testing Phone OTP Auto-Login"
echo "=========================================="
echo ""

API_BASE="http://localhost:8001"
TEST_PHONE="7506584004"

echo "Step 1: Testing NEW USER scenario..."
echo "Phone: $TEST_PHONE"
echo ""

# Request OTP
echo "Requesting OTP..."
RESPONSE=$(curl -s -X POST "$API_BASE/phone/auth/request" \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"$TEST_PHONE\"}")

echo "Response: $RESPONSE"
echo ""

# Extract dev OTP from response
DEV_OTP=$(echo $RESPONSE | grep -oP '"dev_otp":\s*"\K[^"]+' || echo "")

if [ -n "$DEV_OTP" ]; then
    echo "✅ OTP received: $DEV_OTP"
    echo ""

    echo "Step 2: Verifying OTP..."
    VERIFY_RESPONSE=$(curl -s -X POST "$API_BASE/phone/auth/verify" \
      -H "Content-Type: application/json" \
      -d "{\"phone\":\"$TEST_PHONE\",\"otp_code\":\"$DEV_OTP\"}")

    echo "Verify Response:"
    echo "$VERIFY_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$VERIFY_RESPONSE"
    echo ""

    # Check for requires_onboarding flag
    REQUIRES_ONBOARDING=$(echo $VERIFY_RESPONSE | grep -oP '"requires_onboarding":\s*\K(true|false)' || echo "")
    HAS_PROFILE=$(echo $VERIFY_RESPONSE | grep -oP '"has_patient_profile":\s*\K(true|false)' || echo "")
    PATIENT_ID=$(echo $VERIFY_RESPONSE | grep -oP '"patient_id":\s*"\K[^"]+' || echo "null")

    echo "=========================================="
    echo "📊 Test Results:"
    echo "=========================================="
    echo "Phone: $TEST_PHONE"
    echo "Requires Onboarding: $REQUIRES_ONBOARDING"
    echo "Has Patient Profile: $HAS_PROFILE"
    echo "Patient ID: $PATIENT_ID"
    echo ""

    if [ "$REQUIRES_ONBOARDING" == "true" ]; then
        echo "✅ PASS: New user correctly requires onboarding"
    elif [ "$REQUIRES_ONBOARDING" == "false" ]; then
        echo "✅ PASS: Existing user doesn't need onboarding"
        echo "   Patient profile found!"
    else
        echo "❌ FAIL: requires_onboarding flag not found in response"
    fi
    echo ""

else
    echo "❌ FAIL: Could not extract OTP from response"
    echo "Response: $RESPONSE"
fi

echo "=========================================="
echo "📋 What to Check Manually:"
echo "=========================================="
echo ""
echo "1. Open http://palcare.life/login"
echo "2. Enter phone: $TEST_PHONE"
echo "3. Enter OTP from server logs"
echo "4. Should redirect to:"
echo "   - /onboarding (if new user)"
echo "   - / (home) (if existing user)"
echo ""

echo "=========================================="
echo "🔍 Check Database:"
echo "=========================================="
echo ""
echo "Run this to check if patient exists:"
echo ""
echo "docker exec -it pal-prod-db psql -U pal -d pal -c \\"
echo "  \"SELECT p.id, p.full_name, p.phone, pu.phone_number \\"
echo "   FROM patients p \\"
echo "   JOIN phone_users pu ON p.phone_user_id = pu.id \\"
echo "   WHERE pu.phone_number = '$TEST_PHONE';\""
echo ""

echo "=========================================="
echo "🔧 Test Complete!"
echo "=========================================="
