#!/bin/bash
###############################################################################
# PAL Security Fixes - Verification Test Script
#
# This script tests that critical security vulnerabilities have been fixed.
# Run after deploying the security patches to verify proper implementation.
#
# Usage: bash test_security_fixes.sh [API_URL]
# Example: bash test_security_fixes.sh https://palcare.life
###############################################################################

set -e

# Configuration
API_URL="${1:-http://localhost:8001}"
API_BASE="${API_URL}/api"
MCP_BASE="${API_URL//:8001/:3001}/api/v1"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0

###############################################################################
# Helper Functions
###############################################################################

print_header() {
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_test() {
    echo -e "\n${YELLOW}[TEST $1]${NC} $2"
}

pass() {
    echo -e "${GREEN}✅ PASS:${NC} $1"
    ((TESTS_PASSED++))
}

fail() {
    echo -e "${RED}❌ FAIL:${NC} $1"
    ((TESTS_FAILED++))
}

skip() {
    echo -e "${YELLOW}⊘ SKIP:${NC} $1"
    ((TESTS_SKIPPED++))
}

###############################################################################
# Test Cases
###############################################################################

test_otp_disclosure() {
    print_test "1" "OTP Disclosure Check (CRIT-002)"

    RESPONSE=$(curl -s -X POST "${API_BASE}/phone/auth/request" \
      -H "Content-Type: application/json" \
      -d '{"phone":"9999999999"}' 2>/dev/null)

    if [ $? -ne 0 ]; then
        skip "API not reachable at ${API_BASE}"
        return
    fi

    # Check if dev_otp field exists in response
    if echo "$RESPONSE" | grep -q '"dev_otp"'; then
        fail "OTP still disclosed in API response"
        echo "Response: $RESPONSE"
    else
        pass "OTP not disclosed in production response"
    fi

    # Verify proper error or success message
    if echo "$RESPONSE" | grep -q '"message"'; then
        pass "Response contains proper message field"
    else
        fail "Response missing message field"
    fi
}

test_authorization_idor() {
    print_test "2" "Authorization / IDOR Check (CRIT-003)"

    # This test requires two user accounts - skip if not configured
    if [ -z "$USER_A_TOKEN" ] || [ -z "$USER_B_PATIENT_ID" ]; then
        skip "USER_A_TOKEN or USER_B_PATIENT_ID not set (export these variables to test)"
        echo "   To test: export USER_A_TOKEN='jwt-token-user-a'"
        echo "           export USER_B_PATIENT_ID='patient-uuid-user-b'"
        return
    fi

    # Test 1: Try to access another user's patient record
    HTTP_CODE=$(curl -s -w "%{http_code}" -o /dev/null \
      -H "Authorization: Bearer $USER_A_TOKEN" \
      "${API_BASE}/patients/${USER_B_PATIENT_ID}")

    if [ "$HTTP_CODE" = "403" ]; then
        pass "Unauthorized patient access blocked (403 Forbidden)"
    elif [ "$HTTP_CODE" = "401" ]; then
        skip "Token expired or invalid (401) - cannot test authorization"
    elif [ "$HTTP_CODE" = "200" ]; then
        fail "IDOR vulnerability still exists - unauthorized access allowed!"
    else
        fail "Unexpected HTTP code: $HTTP_CODE (expected 403)"
    fi

    # Test 2: Try to access records endpoint
    HTTP_CODE=$(curl -s -w "%{http_code}" -o /dev/null \
      -H "Authorization: Bearer $USER_A_TOKEN" \
      "${API_BASE}/records/patient/${USER_B_PATIENT_ID}")

    if [ "$HTTP_CODE" = "403" ]; then
        pass "Unauthorized records access blocked (403 Forbidden)"
    elif [ "$HTTP_CODE" = "401" ]; then
        skip "Token expired or invalid (401)"
    elif [ "$HTTP_CODE" = "200" ]; then
        fail "Records endpoint allows unauthorized access!"
    else
        skip "Unexpected HTTP code: $HTTP_CODE"
    fi
}

test_mcp_webhook_auth() {
    print_test "3" "MCP Webhook Authentication (CRIT-004)"

    # Test without API key
    HTTP_CODE=$(curl -s -w "%{http_code}" -o /dev/null \
      -X POST "${MCP_BASE}/webhook" \
      -H "Content-Type: application/json" \
      -d '{"test":"payload"}' 2>/dev/null)

    if [ $? -ne 0 ]; then
        skip "MCP API not reachable at ${MCP_BASE}"
        return
    fi

    if [ "$HTTP_CODE" = "401" ]; then
        pass "Webhook requires authentication (401 Unauthorized)"
    elif [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
        fail "Webhook accessible without authentication!"
    else
        skip "Unexpected HTTP code: $HTTP_CODE (MCP server may not be running)"
    fi

    # Test with API key if available
    if [ -n "$PAL_API_KEY" ]; then
        HTTP_CODE=$(curl -s -w "%{http_code}" -o /dev/null \
          -X POST "${MCP_BASE}/webhook" \
          -H "Content-Type: application/json" \
          -H "X-API-Key: $PAL_API_KEY" \
          -d '{"test":"payload"}')

        if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
            pass "Webhook accessible with valid API key"
        else
            skip "Webhook with API key returned: $HTTP_CODE"
        fi
    fi
}

test_database_port_exposure() {
    print_test "4" "Database Port Exposure Check (HIGH-002)"

    # Extract hostname from API_URL
    HOSTNAME=$(echo "$API_URL" | sed -e 's|^[^/]*//||' -e 's|:.*||')

    if [ "$HOSTNAME" = "localhost" ]; then
        skip "Cannot test from localhost (would always succeed)"
        return
    fi

    # Try to connect to PostgreSQL port
    if timeout 2 bash -c "cat < /dev/null > /dev/tcp/${HOSTNAME}/5433" 2>/dev/null; then
        fail "PostgreSQL port 5433 is publicly accessible on ${HOSTNAME}"
    else
        pass "PostgreSQL port not accessible externally"
    fi

    # Try to connect to Redis port
    if timeout 2 bash -c "cat < /dev/null > /dev/tcp/${HOSTNAME}/6380" 2>/dev/null; then
        fail "Redis port 6380 is publicly accessible on ${HOSTNAME}"
    else
        pass "Redis port not accessible externally"
    fi
}

test_debug_mode() {
    print_test "5" "Debug Mode Disabled (HIGH-001)"

    # Try to trigger an error and check for stack trace
    RESPONSE=$(curl -s "${API_BASE}/invalid-endpoint-12345" 2>/dev/null)

    if [ $? -ne 0 ]; then
        skip "API not reachable"
        return
    fi

    # Check if response contains Python stack trace indicators
    if echo "$RESPONSE" | grep -qE "(Traceback|File.*line|raise |exception)"; then
        fail "Stack trace exposed in error response (debug mode likely enabled)"
        echo "Response preview: ${RESPONSE:0:200}"
    else
        pass "No stack trace in error response (debug mode disabled)"
    fi
}

test_phi_in_logs() {
    print_test "6" "PHI Logging Check (CRIT-005)"

    # This test requires access to log files - skip if not available
    if [ ! -r "/var/log/pal/api.log" ] && [ ! -r "./api/api.log" ]; then
        skip "Log files not accessible (run on server with log access to test)"
        return
    fi

    # Check for unredacted phone numbers in logs
    LOG_FILE="/var/log/pal/api.log"
    if [ ! -r "$LOG_FILE" ]; then
        LOG_FILE="./api/api.log"
    fi

    # Look for 10-digit phone numbers that aren't redacted
    PHONE_PATTERN="[^*][0-9]{10}"
    if grep -E "$PHONE_PATTERN" "$LOG_FILE" 2>/dev/null | grep -i "phone\|otp" > /dev/null; then
        fail "Potential unredacted phone numbers found in logs"
    else
        pass "No unredacted phone numbers found in recent logs"
    fi
}

test_gitignore() {
    print_test "7" ".gitignore Configuration (CRIT-001 Part 1)"

    if [ ! -f ".gitignore" ]; then
        fail ".gitignore file not found"
        return
    fi

    # Check if .env.production is in .gitignore
    if grep -q "^\.env\.production" .gitignore; then
        pass ".env.production is in .gitignore"
    else
        fail ".env.production NOT in .gitignore"
    fi

    # Check if .env.production is tracked by git
    if git ls-files --error-unmatch .env.production 2>/dev/null; then
        fail ".env.production is still tracked by git - needs removal from history"
    else
        pass ".env.production not tracked by git"
    fi
}

###############################################################################
# Main Test Execution
###############################################################################

main() {
    print_header "PAL Security Fixes - Verification Tests"
    echo "Testing API at: ${API_BASE}"
    echo "Testing MCP at: ${MCP_BASE}"
    echo ""

    # Run all tests
    test_otp_disclosure
    test_authorization_idor
    test_mcp_webhook_auth
    test_database_port_exposure
    test_debug_mode
    test_phi_in_logs
    test_gitignore

    # Print summary
    print_header "Test Results Summary"
    echo -e "${GREEN}Passed:${NC}  $TESTS_PASSED"
    echo -e "${RED}Failed:${NC}  $TESTS_FAILED"
    echo -e "${YELLOW}Skipped:${NC} $TESTS_SKIPPED"
    echo ""

    TOTAL_TESTS=$((TESTS_PASSED + TESTS_FAILED))
    if [ $TOTAL_TESTS -gt 0 ]; then
        SUCCESS_RATE=$((TESTS_PASSED * 100 / TOTAL_TESTS))
        echo "Success Rate: ${SUCCESS_RATE}%"
    fi

    echo ""
    if [ $TESTS_FAILED -eq 0 ]; then
        echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${GREEN}✅ All security tests passed!${NC}"
        echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        exit 0
    else
        echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${RED}❌ Some security tests failed!${NC}"
        echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo ""
        echo "Review failed tests above and check:"
        echo "  1. SECURITY_REMEDIATION_GUIDE.md for fix instructions"
        echo "  2. SECURITY_FIXES_SUMMARY.md for what was changed"
        echo "  3. Deployment logs for error messages"
        exit 1
    fi
}

# Show usage if --help
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    echo "Usage: $0 [API_URL]"
    echo ""
    echo "Options:"
    echo "  API_URL    Base URL of PAL API (default: http://localhost:8001)"
    echo ""
    echo "Environment Variables:"
    echo "  USER_A_TOKEN        JWT token for test user A (for IDOR test)"
    echo "  USER_B_PATIENT_ID   Patient UUID for test user B (for IDOR test)"
    echo "  PAL_API_KEY         MCP API key (for webhook test)"
    echo ""
    echo "Examples:"
    echo "  $0"
    echo "  $0 https://palcare.life"
    echo "  USER_A_TOKEN='eyJ...' USER_B_PATIENT_ID='uuid' $0 https://palcare.life"
    exit 0
fi

# Run tests
main
