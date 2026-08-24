"""
External MCP Client - Doctor availability and booking
Connects to external MCP server at http://34.14.174.212:8000
"""
import logging
import httpx
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

EXTERNAL_MCP_URL = "http://34.14.174.212:8001/mcp"


class ExternalMCPClient:
    """Client for external MCP server - handles doctor availability and booking"""

    def __init__(self, base_url: str = EXTERNAL_MCP_URL):
        self.base_url = base_url
        self.timeout = 30.0

    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Any:
        """
        Call an external MCP tool

        Args:
            tool_name: Name of the tool
            arguments: Tool arguments as dict

        Returns:
            Tool result as dict
        """
        try:
            if tool_name == "check_doctor_availability":
                return await self._check_doctor_availability(arguments)
            elif tool_name == "get_available_slots":
                return await self._get_available_slots(arguments)
            elif tool_name == "book_appointment":
                return await self._book_appointment(arguments)
            else:
                raise ValueError(f"Unknown external MCP tool: {tool_name}")

        except Exception as e:
            logger.error(f"Error calling external MCP tool {tool_name}: {e}")
            raise

    async def _check_doctor_availability(self, arguments: Dict) -> Dict:
        """Check if a doctor is available on a specific date"""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(
                f"{self.base_url}/api/v1/doctors/availability",
                params={
                    "doctor_name": arguments.get("doctor_name"),
                    "date": arguments.get("date"),
                    "specialty": arguments.get("specialty")
                }
            )
            response.raise_for_status()
            return response.json()

    async def _get_available_slots(self, arguments: Dict) -> List[Dict]:
        """Get available time slots for a doctor on a specific date"""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(
                f"{self.base_url}/api/v1/doctors/slots",
                params={
                    "doctor_name": arguments.get("doctor_name"),
                    "doctor_id": arguments.get("doctor_id"),
                    "date": arguments.get("date")
                }
            )
            response.raise_for_status()
            return response.json()

    async def _book_appointment(self, arguments: Dict) -> Dict:
        """Book an appointment slot"""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}/api/v1/appointments/book",
                json={
                    "patient_id": arguments.get("patient_id"),
                    "doctor_id": arguments.get("doctor_id"),
                    "doctor_name": arguments.get("doctor_name"),
                    "slot_time": arguments.get("slot_time"),
                    "date": arguments.get("date"),
                    "reason": arguments.get("reason", "")
                }
            )
            response.raise_for_status()
            return response.json()

    def get_tool_definitions(self) -> List[Dict[str, Any]]:
        """
        Get OpenAI-compatible tool definitions for external MCP

        Returns:
            List of tool definitions in OpenAI function calling format
        """
        return [
            {
                "type": "function",
                "function": {
                    "name": "check_doctor_availability",
                    "description": "Check if a doctor is available on a specific date. Returns doctor's availability status and schedule.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "doctor_name": {
                                "type": "string",
                                "description": "Name of the doctor (optional if doctor_id provided)"
                            },
                            "date": {
                                "type": "string",
                                "description": "Date in YYYY-MM-DD format"
                            },
                            "specialty": {
                                "type": "string",
                                "description": "Medical specialty (optional, helps filter doctors)"
                            }
                        },
                        "required": ["date"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "get_available_slots",
                    "description": "Get all available appointment time slots for a specific doctor on a given date",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "doctor_name": {
                                "type": "string",
                                "description": "Name of the doctor"
                            },
                            "doctor_id": {
                                "type": "string",
                                "description": "UUID of the doctor (if known)"
                            },
                            "date": {
                                "type": "string",
                                "description": "Date in YYYY-MM-DD format"
                            }
                        },
                        "required": ["date"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "book_appointment",
                    "description": "Book an appointment slot with a doctor. Requires user confirmation before booking.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "patient_id": {
                                "type": "string",
                                "description": "UUID of the patient booking the appointment"
                            },
                            "doctor_id": {
                                "type": "string",
                                "description": "UUID of the doctor"
                            },
                            "doctor_name": {
                                "type": "string",
                                "description": "Name of the doctor"
                            },
                            "slot_time": {
                                "type": "string",
                                "description": "Time slot in HH:MM format (e.g., '14:30')"
                            },
                            "date": {
                                "type": "string",
                                "description": "Date in YYYY-MM-DD format"
                            },
                            "reason": {
                                "type": "string",
                                "description": "Reason for visit (optional)"
                            }
                        },
                        "required": ["patient_id", "date", "slot_time"]
                    }
                }
            }
        ]


# Singleton instance
_external_mcp_client: Optional[ExternalMCPClient] = None


def get_external_mcp_client() -> ExternalMCPClient:
    """Get or create singleton ExternalMCPClient instance"""
    global _external_mcp_client
    if _external_mcp_client is None:
        _external_mcp_client = ExternalMCPClient()
    return _external_mcp_client
