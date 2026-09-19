#!/usr/bin/env python3
"""Test MDT upload flow end-to-end"""

import requests
import sys

# Login first
login_resp = requests.post(
    'http://localhost:8000/v3/auth/login',
    json={'username': 'sharma18', 'password': 'Password123'}
)

if not login_resp.ok:
    print(f"Login failed: {login_resp.status_code}")
    print(login_resp.text)
    sys.exit(1)

token = login_resp.json()['access_token']
user_id = login_resp.json()['user_id']

print(f"✅ Logged in successfully")
print(f"Token: {token[:20]}...")
print(f"User ID: {user_id}")

# Create a fake PDF for testing
fake_pdf = b"%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n/Pages 2 0 R\n>>\nendobj\n2 0 obj\n<<\n/Type /Pages\n/Kids [3 0 R]\n/Count 1\n>>\nendobj\n3 0 obj\n<<\n/Type /Page\n/Parent 2 0 R\n/Resources <<\n/Font <<\n/F1 4 0 R\n>>\n>>\n/MediaBox [0 0 612 792]\n/Contents 5 0 R\n>>\nendobj\n4 0 obj\n<<\n/Type /Font\n/Subtype /Type1\n/BaseFont /Helvetica\n>>\nendobj\n5 0 obj\n<<\n/Length 44\n>>\nstream\nBT\n/F1 12 Tf\n100 700 Td\n(Test Lab Report) Tj\nET\nendstream\nendobj\nxref\n0 6\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n0000000262 00000 n\n0000000341 00000 n\ntrailer\n<<\n/Size 6\n/Root 1 0 R\n>>\nstartxref\n433\n%%EOF"

# Upload to backend
print(f"\n📤 Uploading test PDF...")

upload_resp = requests.post(
    'http://localhost:8000/medical/upload',
    headers={'Authorization': f'Bearer {token}'},
    files={'file': ('test_lab_report.pdf', fake_pdf, 'application/pdf')},
    data={
        'tenant_id': '00000000-0000-0000-0000-000000000001',
        'member_id': user_id
    }
)

print(f"Upload status: {upload_resp.status_code}")
print(f"Response:")
print(upload_resp.json())

if upload_resp.ok:
    result = upload_resp.json()

    if result['type'] == 'pending_verification':
        print(f"\n✅ MDT extraction successful!")
        print(f"Raw source ID: {result['raw_source_id']}")
        print(f"Report title: {result.get('report_title', 'N/A')}")
        print(f"Observations: {len(result.get('observations', []))}")

        if result.get('observations'):
            print(f"\nExtracted lab values:")
            for obs in result['observations'][:5]:
                print(f"  - {obs['display']}: {obs.get('value')} {obs.get('unit', '')}")

    elif result['type'] == 'document_accepted':
        print(f"\n⚠️  Document saved but MDT extraction skipped")
        print(f"Reason: {result.get('message', 'Unknown')}")
        print(f"MDT enabled: {result.get('mdt_enabled', False)}")

else:
    print(f"\n❌ Upload failed!")
