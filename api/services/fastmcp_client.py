"""
FastMCP Client - Bridge to both MCP servers
Connects to:
1. FastMCP server (http://fastmcp:8002) - Patient data tools
2. External MCP-DocEHR (from config DOCEHR_MCP_URL) - Doctor/appointment tools
"""
import logging
import httpx
from typing import Any, Dict, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from config import get_settings
from models.patient import Patient
from models.doctor import Doctor
from models.clinic import Clinic

logger = logging.getLogger(__name__)

# MCP Server URLs
FASTMCP_SERVER_URL = "http://fastmcp:8002"  # Internal docker network


class FastMCPClient:
    """Bridge client connecting to both FastMCP and external MCP servers"""

    def __init__(self):
        settings = get_settings()
        self.fastmcp_url = FASTMCP_SERVER_URL
        self.external_mcp_url = settings.docehr_mcp_url
        self.external_mcp_enabled = settings.docehr_enabled and bool(settings.docehr_mcp_url)
        self.timeout = 30.0

        if self.external_mcp_enabled:
            logger.info(f"External MCP enabled: {self.external_mcp_url}")
        else:
            logger.info("External MCP disabled")

    async def call_tool(self, tool_name: str, arguments: Dict[str, Any], db: AsyncSession) -> Any:
        """
        Route tool calls to appropriate MCP server

        Args:
            tool_name: Name of the tool
            arguments: Tool arguments as dict
            db: Database session (for external MCP ID translation)

        Returns:
            Tool result from MCP server
        """
        try:
            # Check if it's a local FastMCP tool (patient data)
            if tool_name in ["get_patient_info", "get_patient_records", "get_latest_prescription", "get_lab_results", "search_patients"]:
                logger.info(f"FastMCP: Calling {tool_name}")
                result = await self._call_fastmcp_tool(tool_name, arguments)
                logger.info(f"FastMCP: Got response from {tool_name}")
                return result
            else:
                # External MCP tool (doctor/appointment) - needs ID translation
                logger.info(f"MCP-DocEHR: Calling {tool_name} with args: {arguments}")
                result = await self._call_external_mcp_tool(tool_name, arguments, db)
                logger.info(f"MCP-DocEHR: Got response from {tool_name}")
                return result

        except Exception as e:
            logger.error(f"Error calling tool {tool_name}: {e}")
            raise

    async def _call_fastmcp_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Any:
        """Call a tool on the FastMCP server (uses HTTP wrapper over FastMCP)"""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.fastmcp_url}/tools/call",
                json={
                    "name": tool_name,
                    "arguments": arguments
                }
            )
            response.raise_for_status()
            result = response.json()

            # Extract content from response
            if isinstance(result, dict) and "content" in result:
                return result["content"]
            return result

    async def _translate_external_params(self, tool_name: str, arguments: Dict[str, Any], db: AsyncSession) -> Dict[str, Any]:
        """
        Translate PAL parameters to DocEHR external IDs

        Translations:
        - patient_id (UUID) → patient_phonenumber (phone from patients)
        - doctor_name (string) → doctorId (external_id from doctors by name)
        - clinic_name (string) → clinicId (external_id from clinics by name)
        """
        translated = {}

        # Translate patient_id to phone number
        if "patient_id" in arguments:
            patient_id = arguments["patient_id"]
            logger.info(f"MCP-DocEHR: Translating patient_id {patient_id} to phone number")

            # Use ORM query instead of raw SQL
            result = await db.execute(
                select(Patient).where(Patient.id == patient_id)
            )
            patient = result.scalar_one_or_none()

            logger.info(f"MCP-DocEHR: Patient found: {patient is not None}")

            if patient:
                logger.info(f"MCP-DocEHR: Patient phone: {patient.phone}, phone_user_id: {patient.phone_user_id}")

                if patient.phone:
                    translated["patient_phonenumber"] = patient.phone
                    logger.info(f"MCP-DocEHR: patient_id → patient_phonenumber: {patient.phone}")
                else:
                    logger.error(f"MCP-DocEHR: Patient phone is null for id: {patient_id}")
                    raise Exception(f"Patient phone number is null for id: {patient_id}")
            else:
                logger.error(f"MCP-DocEHR: No patient found with id: {patient_id}")
                raise Exception(f"No patient found with id: {patient_id}")

        # Translate doctor_name to external_id
        if "doctor_name" in arguments:
            doctor_name = arguments["doctor_name"]
            logger.info(f"MCP-DocEHR: Translating doctor_name '{doctor_name}' to external_id")

            # Use ORM query
            result = await db.execute(
                select(Doctor).where(Doctor.full_name.ilike(f"%{doctor_name}%"))
            )
            doctor = result.scalars().first()

            if doctor and doctor.external_id:
                translated["doctorId"] = doctor.external_id
                logger.info(f"MCP-DocEHR: doctor_name '{doctor_name}' → doctorId: {doctor.external_id}")
            else:
                logger.error(f"MCP-DocEHR: Doctor not found with name: {doctor_name}")
                raise Exception(f"Doctor not found with name: {doctor_name}")

        # Translate clinic_name to external_id
        if "clinic_name" in arguments:
            clinic_name = arguments["clinic_name"]
            logger.info(f"MCP-DocEHR: Translating clinic_name '{clinic_name}' to external_id")

            # Use ORM query
            result = await db.execute(
                select(Clinic).where(Clinic.name.ilike(f"%{clinic_name}%"))
            )
            clinic = result.scalars().first()

            if clinic and clinic.external_id:
                translated["clinicId"] = clinic.external_id
                logger.info(f"MCP-DocEHR: clinic_name '{clinic_name}' → clinicId: {clinic.external_id}")
            else:
                logger.error(f"MCP-DocEHR: Clinic not found with name: {clinic_name}")
                raise Exception(f"Clinic not found with name: {clinic_name}")

        # Pass through all other arguments as-is
        for key, value in arguments.items():
            if key not in ["patient_id", "doctor_name", "clinic_name"]:
                translated[key] = value

        logger.info(f"MCP-DocEHR: Translation complete. Original: {arguments} ? Translated: {translated}")
        return translated

    async def _call_external_mcp_tool(self, tool_name: str, arguments: Dict[str, Any], db: AsyncSession) -> Any:
        """Call a tool on the external MCP-DocEHR server (FastMCP-style REST API)"""
        if not self.external_mcp_enabled:
            logger.error("MCP-DocEHR: External MCP is not enabled")
            raise Exception("External MCP is not configured")

        # TRANSLATE PAL IDs to DocEHR external IDs
        translated_args = await self._translate_external_params(tool_name, arguments, db)

        url = f"{self.external_mcp_url}/tools/call"
        payload = {"name": tool_name, "arguments": translated_args}

        try:
            logger.info(f"MCP-DocEHR: POST {url}")
            logger.info(f"MCP-DocEHR: Original arguments: {arguments}")
            logger.info(f"MCP-DocEHR: Translated arguments: {translated_args}")

            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(url, json=payload)

                # Log response details
                logger.info(f"MCP-DocEHR: Response status: {response.status_code}")

                if response.status_code != 200:
                    logger.error(f"MCP-DocEHR: HTTP {response.status_code} error from {url}")
                    logger.error(f"MCP-DocEHR: Response body: {response.text[:500]}")

                response.raise_for_status()
                result = response.json()

                # Log the full response for debugging
                logger.debug(f"MCP-DocEHR: Response data: {result}")

                # Check if the tool call itself failed
                if isinstance(result, dict):
                    if result.get("success") is False:
                        logger.warning(f"MCP-DocEHR: Tool {tool_name} returned success=false: {result}")
                    elif "content" in result and isinstance(result["content"], dict):
                        if result["content"].get("success") is False:
                            logger.warning(f"MCP-DocEHR: Tool {tool_name} content has success=false: {result['content']}")

                # Extract content from response
                if isinstance(result, dict) and "content" in result:
                    return result["content"]
                return result

        except httpx.TimeoutException as e:
            logger.error(f"MCP-DocEHR: Timeout calling {tool_name} at {url}: {e}")
            raise Exception(f"External MCP timeout: {e}")
        except httpx.HTTPStatusError as e:
            logger.error(f"MCP-DocEHR: HTTP error calling {tool_name}: {e.response.status_code}")
            logger.error(f"MCP-DocEHR: Error response: {e.response.text[:500]}")
            raise Exception(f"External MCP HTTP error {e.response.status_code}: {e.response.text[:200]}")
        except httpx.RequestError as e:
            logger.error(f"MCP-DocEHR: Connection error calling {tool_name} at {url}: {e}")
            raise Exception(f"External MCP connection error: {e}")
        except Exception as e:
            logger.error(f"MCP-DocEHR: Unexpected error calling {tool_name}: {type(e).__name__}: {e}")
            raise

    async def _fetch_fastmcp_tools(self) -> List[Dict[str, Any]]:
        """Fetch tool definitions from FastMCP server"""
        try:
            logger.info(f"FastMCP: Fetching tools from {self.fastmcp_url}")
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    f"{self.fastmcp_url}/tools/list"
                )
                response.raise_for_status()
                result = response.json()

                # Extract tools from response
                if isinstance(result, dict) and "tools" in result:
                    tools = result["tools"]
                elif isinstance(result, list):
                    tools = result
                else:
                    logger.warning(f"FastMCP: Unexpected response format: {result}")
                    return []

                logger.info(f"FastMCP: Got {len(tools)} tools")

                # Convert to OpenAI function calling format
                openai_tools = []
                for tool in tools:
                    openai_tools.append({
                        "type": "function",
                        "function": {
                            "name": tool.get("name"),
                            "description": tool.get("description", ""),
                            "parameters": tool.get("inputSchema", {})
                        }
                    })

                return openai_tools

        except Exception as e:
            logger.error(f"FastMCP: Error fetching tools: {e}")
            return []

    async def _fetch_external_tools(self) -> List[Dict[str, Any]]:
        """Fetch tool definitions from external MCP-DocEHR server (FastMCP-style REST API)"""
        if not self.external_mcp_enabled:
            logger.info("MCP-DocEHR: Disabled, skipping external tools")
            return []

        url = f"{self.external_mcp_url}/tools/list"

        try:
            logger.info(f"MCP-DocEHR: Fetching tools from {url}")

            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(url)

                logger.info(f"MCP-DocEHR: Tools list response status: {response.status_code}")

                if response.status_code != 200:
                    logger.error(f"MCP-DocEHR: HTTP {response.status_code} error fetching tools from {url}")
                    logger.error(f"MCP-DocEHR: Response body: {response.text[:500]}")
                    return []

                response.raise_for_status()
                result = response.json()

                # Extract tools from MCP response
                if isinstance(result, dict) and "tools" in result:
                    tools = result["tools"]
                elif isinstance(result, list):
                    tools = result
                else:
                    logger.warning(f"MCP-DocEHR: Unexpected response format: {result}")
                    return []

                logger.info(f"MCP-DocEHR: Successfully fetched {len(tools)} tools")
                logger.debug(f"MCP-DocEHR: Tool names: {[t.get('name') for t in tools]}")

                # Convert MCP tool format to OpenAI function calling format
                # AND modify parameter schemas to use PAL IDs instead of external IDs
                openai_tools = []
                for tool in tools:
                    tool_name = tool.get("name")

                    # Modify parameter schema for appointment tools to use doctor/clinic NAMES
                    if tool_name == "get_appointment_slots":
                        openai_tools.append({
                            "type": "function",
                            "function": {
                                "name": tool_name,
                                "description": tool.get("description", "Get available appointment slots for a doctor at a clinic"),
                                "parameters": {
                                    "type": "object",
                                    "properties": {
                                        "patient_id": {
                                            "type": "string",
                                            "description": "PAL internal patient UUID (current logged-in user)"
                                        },
                                        "doctor_name": {
                                            "type": "string",
                                            "description": "Doctor's full name (e.g., 'Dr. Rajesh Kumar')"
                                        },
                                        "clinic_name": {
                                            "type": "string",
                                            "description": "Clinic name (e.g., 'Apollo Clinic')"
                                        },
                                        "date": {
                                            "type": "string",
                                            "description": "Date in YYYY-MM-DD format"
                                        }
                                    },
                                    "required": ["patient_id", "doctor_name", "clinic_name", "date"]
                                }
                            }
                        })
                        logger.info(f"MCP-DocEHR: Modified {tool_name} to use doctor_name and clinic_name")

                    elif tool_name == "book_appointment":
                        openai_tools.append({
                            "type": "function",
                            "function": {
                                "name": tool_name,
                                "description": tool.get("description", "Book an appointment with a doctor at a clinic"),
                                "parameters": {
                                    "type": "object",
                                    "properties": {
                                        "patient_id": {
                                            "type": "string",
                                            "description": "PAL internal patient UUID (current logged-in user)"
                                        },
                                        "doctor_name": {
                                            "type": "string",
                                            "description": "Doctor's full name (e.g., 'Dr. Rajesh Kumar')"
                                        },
                                        "clinic_name": {
                                            "type": "string",
                                            "description": "Clinic name (e.g., 'Apollo Clinic')"
                                        },
                                        "date": {
                                            "type": "string",
                                            "description": "Date in YYYY-MM-DD format"
                                        },
                                        "startTime": {
                                            "type": "string",
                                            "description": "Start time in HH:MM format (24-hour)"
                                        }
                                    },
                                    "required": ["patient_id", "doctor_name", "clinic_name", "date", "startTime"]
                                }
                            }
                        })
                        logger.info(f"MCP-DocEHR: Modified {tool_name} to use doctor_name and clinic_name")

                    else:
                        # For other external tools, keep original schema
                        openai_tools.append({
                            "type": "function",
                            "function": {
                                "name": tool.get("name"),
                                "description": tool.get("description", ""),
                                "parameters": tool.get("inputSchema", {})
                            }
                        })
                        logger.info(f"MCP-DocEHR: Keeping original schema for {tool_name}")

                return openai_tools

        except httpx.TimeoutException as e:
            logger.error(f"MCP-DocEHR: Timeout fetching tools from {url}: {e}")
            return []
        except httpx.HTTPStatusError as e:
            logger.error(f"MCP-DocEHR: HTTP error fetching tools: {e.response.status_code}")
            logger.error(f"MCP-DocEHR: Error response: {e.response.text[:500]}")
            return []
        except httpx.RequestError as e:
            logger.error(f"MCP-DocEHR: Connection error fetching tools from {url}: {e}")
            return []
        except Exception as e:
            logger.error(f"MCP-DocEHR: Unexpected error fetching tools: {type(e).__name__}: {e}")
            return []

    async def get_tool_definitions(self) -> List[Dict[str, Any]]:
        """
        Get OpenAI-compatible tool definitions for Gemma
        Combines FastMCP tools + external MCP-DocEHR tools

        Returns:
            List of tool definitions in OpenAI function calling format
        """
        # Fetch tools from both MCP servers (fresh each time, no caching)
        fastmcp_tools = await self._fetch_fastmcp_tools()
        external_tools = await self._fetch_external_tools()

        # Combine all tools
        all_tools = fastmcp_tools + external_tools
        logger.info(f"Total tools available: {len(all_tools)} (FastMCP: {len(fastmcp_tools)}, DocEHR: {len(external_tools)})")

        return all_tools


# Singleton instance
_fastmcp_client = None

def get_fastmcp_client() -> FastMCPClient:
    """Get singleton FastMCP client instance"""
    global _fastmcp_client
    if _fastmcp_client is None:
        _fastmcp_client = FastMCPClient()
    return _fastmcp_client
