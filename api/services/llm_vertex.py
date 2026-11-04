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
                "temperature": temperature if temperature is not None else self.temperature,
                "max_tokens": max_tokens if max_tokens is not None else self.max_tokens,
            }

            # Add tools if provided
            if tools:
                kwargs["tools"] = tools

            response = await self.client.chat.completions.create(**kwargs)

            content = response.choices[0].message.content or ""
       
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
        try:
            logger.info("========== VERTEX TOOL REQUEST ==========")
            logger.info(f"Model: {self.model}")
            logger.info(f"API Base: {self.api_base}")
            logger.info(f"Messages count: {len(messages)}")
            logger.info(f"Tools count: {len(tools) if tools else 0}")

            for i, tool in enumerate(tools or []):
                logger.info(
                    f"Tool {i}: {tool.get('function', {}).get('name', 'UNKNOWN')}"
                )

            logger.info("==========================================")

            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                tools=tools,
                temperature=temperature if temperature is not None else self.temperature,
                max_tokens=max_tokens if max_tokens is not None else self.max_tokens,
            )

            logger.info("========== VERTEX TOOL RESPONSE ==========")
            logger.info(f"Finish reason: {response.choices[0].finish_reason}")
            logger.info("==========================================")

            return response

        except Exception as e:
            logger.exception("Error calling LiteLLM proxy with tools")
            raise

    async def stream_tokens(
        self,
        messages: List[Dict],
        tools: Optional[List[Dict]],
        tool_executor,
        max_rounds: int = 6,
    ):
        """Agentic streaming: run tool-call rounds, then stream the final answer's
        text deltas. `tool_executor(name, arguments_json) -> result` (awaitable) runs
        each tool. Yields answer text chunks as they arrive — nothing is yielded
        during tool rounds (there's no user-facing text then).
        """
        import json as _json

        for _ in range(max_rounds):
            stream = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                tools=tools or None,
                temperature=self.temperature,
                max_tokens=self.max_tokens,
                stream=True,
            )
            tool_calls: Dict[int, Dict] = {}
            content_parts: List[str] = []
            async for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if getattr(delta, "content", None):
                    content_parts.append(delta.content)
                    yield delta.content
                for tc in (getattr(delta, "tool_calls", None) or []):
                    slot = tool_calls.setdefault(tc.index, {"id": "", "name": "", "args": ""})
                    if tc.id:
                        slot["id"] = tc.id
                    if tc.function and tc.function.name:
                        slot["name"] = tc.function.name
                    if tc.function and tc.function.arguments:
                        slot["args"] += tc.function.arguments

            if not tool_calls:
                return  # final answer already streamed above

            # Record the assistant's tool-call turn, then run the tools.
            messages.append({
                "role": "assistant",
                "content": "".join(content_parts) or None,
                "tool_calls": [
                    {"id": s["id"], "type": "function",
                     "function": {"name": s["name"], "arguments": s["args"]}}
                    for s in tool_calls.values()
                ],
            })
            for s in tool_calls.values():
                try:
                    result = await tool_executor(s["name"], s["args"])
                except Exception as exc:  # noqa: BLE001
                    result = {"error": str(exc)}
                messages.append({
                    "role": "tool", "tool_call_id": s["id"],
                    "content": _json.dumps(result, default=str),
                })

        # Hit the round cap — stream one last answer with tools disabled.
        stream = await self.client.chat.completions.create(
            model=self.model, messages=messages,
            temperature=self.temperature, max_tokens=self.max_tokens, stream=True,
        )
        async for chunk in stream:
            if chunk.choices and getattr(chunk.choices[0].delta, "content", None):
                yield chunk.choices[0].delta.content

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
