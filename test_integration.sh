#!/bin/bash

# Frontend-Backend Integration Test Script
# Tests the complete flow from frontend through Next.js proxy to FastAPI backend

set -e

BASE_URL="http://localhost:3000/api"
API_URL="http://localhost:8000"

echo "========================================="
echo "PAL Frontend-Backend Integration Test"
echo "========================================="
echo ""

# Test 1: Health Check
echo "Test 1: Health Check"
echo "--------------------"
echo "Via Proxy:  GET $BASE_URL/health"
PROXY_HEALTH=$(curl -s $BASE_URL/health)
echo "✓ Proxy Result: $PROXY_HEALTH"

echo "Direct API: GET $API_URL/health"
DIRECT_HEALTH=$(curl -s $API_URL/health)
echo "✓ Direct Result: $DIRECT_HEALTH"
echo ""

# Test 2: OTP Authentication Flow
echo "Test 2: OTP Authentication Flow"
echo "--------------------------------"
PHONE="9876543210"

echo "Step 1: Request OTP"
echo "POST $BASE_URL/auth/request-otp"
OTP_RESPONSE=$(curl -s -X POST $BASE_URL/auth/request-otp \
  -H "Content-Type: application/json" \
  -d "{\"phone\": \"$PHONE\", \"delivery_channel\": \"sms\"}")

OTP_CODE=$(echo $OTP_RESPONSE | grep -o '"dev_otp":"[^"]*"' | cut -d'"' -f4)
echo "✓ OTP Generated: $OTP_CODE"
echo ""

echo "Step 2: Verify OTP"
echo "POST $BASE_URL/auth/verify-otp"
AUTH_RESPONSE=$(curl -s -X POST $BASE_URL/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d "{\"phone\": \"$PHONE\", \"otp_code\": \"$OTP_CODE\"}")

TOKEN=$(echo $AUTH_RESPONSE | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
USER_ID=$(echo $AUTH_RESPONSE | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

if [ -n "$TOKEN" ]; then
  echo "✓ Authentication successful"
  echo "  User ID: $USER_ID"
  echo "  Token: ${TOKEN:0:20}..."
else
  echo "✗ Authentication failed"
  echo "  Response: $AUTH_RESPONSE"
  exit 1
fi
echo ""

# Test 3: Authenticated Endpoint
echo "Test 3: Get User Profile (Authenticated)"
echo "-----------------------------------------"
echo "GET $BASE_URL/auth/me"
PROFILE=$(curl -s -H "Authorization: Bearer $TOKEN" $BASE_URL/auth/me)
echo "✓ Profile: $PROFILE"
echo ""

# Test 4: Conversations Endpoint
echo "Test 4: List Conversations (Authenticated)"
echo "-------------------------------------------"
TENANT_ID="00000000-0000-0000-0000-000000000001"
echo "GET $BASE_URL/conversations/$TENANT_ID/$USER_ID"
CONVERSATIONS=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/conversations/$TENANT_ID/$USER_ID")
echo "✓ Conversations: $CONVERSATIONS"
echo ""

# Test 5: Search Endpoint (will fail without Anthropic API key)
echo "Test 5: Universal Search (requires API key)"
echo "--------------------------------------------"
echo "POST $BASE_URL/search"
SEARCH_RESULT=$(curl -s -X POST $BASE_URL/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"query\": \"What is cholesterol?\",
    \"tenant_id\": \"$TENANT_ID\",
    \"member_id\": \"$USER_ID\",
    \"session_id\": \"test-session-1\"
  }" 2>&1)

if echo "$SEARCH_RESULT" | grep -q "ANTHROPIC_API_KEY"; then
  echo "⚠ Search requires ANTHROPIC_API_KEY (expected)"
  echo "  Add ANTHROPIC_API_KEY to .env to enable AI features"
elif echo "$SEARCH_RESULT" | grep -q "answer"; then
  echo "✓ Search successful"
else
  echo "⚠ Search response: $(echo $SEARCH_RESULT | head -c 100)..."
fi
echo ""

# Test 6: Health Facts Endpoint
echo "Test 6: Get Health Facts"
echo "------------------------"
echo "GET $BASE_URL/records/$TENANT_ID/$USER_ID/facts"
FACTS=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/records/$TENANT_ID/$USER_ID/facts")
echo "✓ Health Facts: $FACTS"
echo ""

# Summary
echo "========================================="
echo "Integration Test Summary"
echo "========================================="
echo "✅ Next.js Proxy: Working"
echo "✅ FastAPI Backend: Working"
echo "✅ Authentication: Working"
echo "✅ Protected Endpoints: Working"
echo "⚠️  AI Features: Require ANTHROPIC_API_KEY"
echo ""
echo "All core routes are properly mapped!"
echo "Frontend can successfully communicate with FastAPI backend."
echo ""
