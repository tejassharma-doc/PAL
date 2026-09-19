"""
MCP Client - Query patient data from MCP API Server
"""
import os
import logging
from typing import Dict, Optional, List
import httpx

logger = logging.getLogger(__name__)


class MCPClient:
    """Client for querying patient data from MCP API Server"""

    def __init__(self):
        self.base_url = os.getenv("MCP_API_URL", "http://mcp-api:3001")
        self.api_key = os.getenv("PAL_API_KEY", "pal-secret-key-12345")
        self.timeout = 30.0

        logger.info(f"MCPClient initialized with base_url: {self.base_url}")

    def _get_headers(self) -> Dict[str, str]:
        """Get HTTP headers with API key"""
        return {
            "X-API-Key": self.api_key,
            "Content-Type": "application/json"
        }

    async def get_patient_records(self, patient_id: str) -> Dict:
        """
        Get complete patient records (all-in-one endpoint)

        Returns:
            Dict with patient, appointments, prescriptions, labTests
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    f"{self.base_url}/api/v1/patients/{patient_id}/records",
                    headers=self._get_headers()
                )
                response.raise_for_status()
                data = response.json()

                logger.info(f"Fetched records for patient {patient_id}")
                return data

        except httpx.HTTPError as e:
            logger.error(f"Error fetching patient records: {str(e)}")
            raise

    async def get_patient_info(self, patient_id: str) -> Dict:
        """Get patient demographics only"""
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    f"{self.base_url}/api/v1/patients/{patient_id}",
                    headers=self._get_headers()
                )
                response.raise_for_status()
                return response.json()

        except httpx.HTTPError as e:
            logger.error(f"Error fetching patient info: {str(e)}")
            raise

    async def get_latest_prescription(self, patient_id: str) -> Optional[Dict]:
        """Get latest prescription with SOAP notes"""
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    f"{self.base_url}/api/v1/patients/{patient_id}/prescriptions/latest",
                    headers=self._get_headers()
                )

                if response.status_code == 404:
                    return None

                response.raise_for_status()
                return response.json()

        except httpx.HTTPError as e:
            logger.error(f"Error fetching latest prescription: {str(e)}")
            return None

    async def get_lab_tests(self, patient_id: str) -> List[Dict]:
        """Get all lab test results"""
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    f"{self.base_url}/api/v1/patients/{patient_id}/lab-tests",
                    headers=self._get_headers()
                )
                response.raise_for_status()
                return response.json()

        except httpx.HTTPError as e:
            logger.error(f"Error fetching lab tests: {str(e)}")
            return []

    async def get_appointments(self, patient_id: str) -> List[Dict]:
        """Get patient appointments"""
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    f"{self.base_url}/api/v1/appointments",
                    params={"patientId": patient_id},
                    headers=self._get_headers()
                )
                response.raise_for_status()
                return response.json()

        except httpx.HTTPError as e:
            logger.error(f"Error fetching appointments: {str(e)}")
            return []

    async def search_patients(self, **kwargs) -> List[Dict]:
        """Search patients by phone, email, or patient_id"""
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    f"{self.base_url}/api/v1/patients",
                    params=kwargs,
                    headers=self._get_headers()
                )
                response.raise_for_status()
                return response.json()

        except httpx.HTTPError as e:
            logger.error(f"Error searching patients: {str(e)}")
            return []


# Singleton instance
_mcp_client: Optional[MCPClient] = None


def get_mcp_client() -> MCPClient:
    """Get or create singleton MCPClient instance"""
    global _mcp_client
    if _mcp_client is None:
        _mcp_client = MCPClient()
    return _mcp_client
