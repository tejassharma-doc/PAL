#!/usr/bin/env python3
"""Test MDT extraction directly"""
import asyncio
import httpx
from pathlib import Path

async def test_mdt():
    # Read the PDF
    pdf_path = Path("/app/uploads/628ecd64150df0027c57997519802bac9ccd25d9a4d734e935e45e0ba79ee9ca.pdf")
    content = pdf_path.read_bytes()

    print(f"PDF size: {len(content)} bytes")

    # Call MDT
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            "http://mdt:8080/document_to_fhir",
            content=content,
            headers={"Content-Type": "application/pdf"},
        )
        print(f"Status: {resp.status_code}")
        print(f"Headers: {resp.headers}")

        bundle = resp.json()
        print(f"\nRaw response (first 2000 chars):")
        import json
        print(json.dumps(bundle, indent=2)[:2000])

        print(f"\nFHIR Bundle:")
        print(f"  resourceType: {bundle.get('resourceType')}")
        print(f"  type: {bundle.get('type')}")
        print(f"  entry count: {len(bundle.get('entry', []))}")

        for i, entry in enumerate(bundle.get('entry', [])[:5]):
            resource = entry.get('resource', {})
            rtype = resource.get('resourceType')
            print(f"\n  Entry {i}: {rtype}")
            if rtype == "Patient":
                names = resource.get('name', [])
                if names:
                    print(f"    Name: {names[0]}")
            elif rtype == "DiagnosticReport":
                print(f"    Code: {resource.get('code', {}).get('text')}")
            elif rtype == "Observation":
                print(f"    Code: {resource.get('code', {}).get('text')}")
                print(f"    Value: {resource.get('valueQuantity', resource.get('valueString', 'N/A'))}")

if __name__ == "__main__":
    asyncio.run(test_mdt())
