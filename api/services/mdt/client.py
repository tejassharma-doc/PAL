"""Async HTTP client for Google Health Medical Data Toolkit (MDT).

MDT Docker: docker run -p 8080:8080 gcr.io/cloud-medical-data-toolkit/mdt:latest
Endpoint:   POST /document_to_fhir  (raw bytes body, Content-Type = MIME of file)
Returns:    FHIR R4 Bundle (JSON), ABDM compliant
"""
from typing import Optional

import httpx

# Resource types that mean MDT actually structured something useful.
_USEFUL_RESOURCE_TYPES = {
    "Observation",
    "MedicationRequest",
    "MedicationStatement",
    "DiagnosticReport",
    "Condition",
}


def is_empty_bundle(bundle: Optional[dict]) -> bool:
    """True when MDT returned nothing usable (e.g. a discarded handwritten doc).

    A bundle with only a Patient entry (or no entries at all) counts as empty —
    there is no clinical content to verify or save.
    """
    if not bundle or not isinstance(bundle, dict):
        return True
    entries = bundle.get("entry") or []
    for entry in entries:
        rtype = (entry.get("resource") or {}).get("resourceType")
        if rtype in _USEFUL_RESOURCE_TYPES:
            return False
    return True


class MDTClient:
    def __init__(self, base_url: str, gemini_api_key: Optional[str] = None, model: Optional[str] = None):
        self._base_url = base_url.rstrip("/")
        # Gemini API key is forwarded to MDT for FHIR extraction.
        # When empty, MDT falls back to local model weights inside the container.
        self._extra_headers: dict[str, str] = {}
        if gemini_api_key:
            self._extra_headers["X-Gemini-Api-Key"] = gemini_api_key
        if model:
            self._extra_headers["X-Model"] = model

    async def document_to_fhir(self, content: bytes, mime_type: str) -> dict:
        """POST raw document bytes to MDT and return the FHIR R4 Bundle dict.

        Raises httpx.HTTPStatusError on non-2xx, httpx.TimeoutException on timeout.
        """
        async with httpx.AsyncClient(timeout=90.0) as client:
            resp = await client.post(
                f"{self._base_url}/document_to_fhir",
                content=content,
                headers={**self._extra_headers, "Content-Type": mime_type},
            )
            resp.raise_for_status()
            response_data = resp.json()

            # MDT wraps the FHIR bundle in standardized_medical_documents array
            if "standardized_medical_documents" in response_data:
                docs = response_data.get("standardized_medical_documents", [])
                if docs and len(docs) > 0:
                    return docs[0].get("fhir_bundle", {})

            # Fallback: return as-is if it's already a bundle
            return response_data
