"""
LiteLLM Proxy Client using OpenAI SDK
Connects to LiteLLM proxy server for Vertex AI (Gemma 4)
"""
import os
import logging
from typing import List, Dict, Optional
from openai import OpenAI, AsyncOpenAI

logger = logging.getLogger(__name__)


class VertexAIClient:
    """Client for Vertex AI via LiteLLM proxy using OpenAI SDK"""

    def __init__(self):
        self.api_base = os.getenv("OPENAI_API_BASE")
        self.api_key = os.getenv("OPENAI_API_KEY")
        self.model = os.getenv("GEMINI_MODEL", "vertex_ai/google/gemma-4-26b-a4b-it-maas")
        self.temperature = float(os.getenv("AI_TEMPERATURE", "0.7"))
        self.max_tokens = int(os.getenv("AI_MAX_TOKENS", "2000"))

        if not self.api_key:
            raise ValueError("OPENAI_API_KEY not found in environment variables")

        if not self.api_base:
            raise ValueError("OPENAI_API_BASE not found in environment variables")

        # Create async client
        self.client = AsyncOpenAI(
            base_url=self.api_base,
            api_key=self.api_key
        )

        logger.info(f"VertexAIClient initialized with model: {self.model}")
        logger.info(f"API Base: {self.api_base}")

    async def generate(
        self,
        messages: List[Dict[str, str]],
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        tools: Optional[List[Dict]] = None
    ) -> str:
        """
        Generate response from Vertex AI (Gemma 4) via LiteLLM proxy

        Args:
            messages: List of message dicts with 'role' and 'content'
            temperature: Optional temperature override
            max_tokens: Optional max tokens override
            tools: Optional list of tool definitions for function calling

        Returns:
            Generated text response
        """
        try:
            kwargs = {
                "model": self.model,
                "messages": messages,
                "temperature": temperature or self.temperature,
                "max_tokens": max_tokens or self.max_tokens,
            }

            # Add tools if provided
            if tools:
                kwargs["tools"] = tools

            response = await self.client.chat.completions.create(**kwargs)

            content = response.choices[0].message.content

            logger.info(f"Generated response from {self.model}: {len(content)} chars")
            return content

        except Exception as e:
            logger.error(f"Error calling LiteLLM proxy: {str(e)}")
            raise

    async def generate_with_tools(
        self,
        messages: List[Dict[str, str]],
        tools: List[Dict],
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None
    ) -> Dict:
        """
        Generate response with tool calling support

        Args:
            messages: List of message dicts with 'role' and 'content'
            tools: List of tool definitions
            temperature: Optional temperature override
            max_tokens: Optional max tokens override

        Returns:
            Full response object including tool calls
        """
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                tools=tools,
                temperature=temperature or self.temperature,
                max_tokens=max_tokens or self.max_tokens,
            )

            logger.info(f"Generated response with tools from {self.model}")
            return response

        except Exception as e:
            logger.error(f"Error calling LiteLLM proxy with tools: {str(e)}")
            raise

    def generate_sync(
        self,
        messages: List[Dict[str, str]],
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None
    ) -> str:
        """
        Synchronous version of generate()

        Args:
            messages: List of message dicts with 'role' and 'content'
            temperature: Optional temperature override
            max_tokens: Optional max tokens override

        Returns:
            Generated text response
        """
        try:
            # Create sync client
            sync_client = OpenAI(
                base_url=self.api_base,
                api_key=self.api_key
            )

            response = sync_client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=temperature or self.temperature,
                max_tokens=max_tokens or self.max_tokens,
            )

            content = response.choices[0].message.content

            logger.info(f"Generated response from {self.model}: {len(content)} chars")
            return content

        except Exception as e:
            logger.error(f"Error calling LiteLLM proxy: {str(e)}")
            raise


# Singleton instance
_vertex_client: Optional[VertexAIClient] = None


def get_vertex_client() -> VertexAIClient:
    """Get or create singleton VertexAIClient instance"""
    global _vertex_client
    if _vertex_client is None:
        _vertex_client = VertexAIClient()
    return _vertex_client
