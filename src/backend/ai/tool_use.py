"""
Unified tool-use abstraction (Phase 9.2).

Why this exists: in 9.1 the tactical planner asked the LLM for a free-form
JSON object naming an action. Gemini routinely invented action names that
were never in the catalog. This module replaces that with native function
calling (Gemini) / strict JSON-mode (Ollama) behind one Protocol — both
providers translate `ToolSchema` into their own format and return either a
validated `ToolCallResult` or a structured `ToolUseError`.

Result-of-result discipline: providers should NEVER raise on a model that
refused or hallucinated. Wrap as ToolUseError so the router can decide
whether to retry, fall through to the fallback provider, or surface the
failure as an observation.
"""
from __future__ import annotations

from enum import StrEnum
from typing import Any, Protocol, runtime_checkable

from pydantic import BaseModel, Field

from agent.actions.registry import ActionRegistry
from agent.schemas import RiskLevel


# ── Schemas ────────────────────────────────────────────────────────────────────


class ToolSchema(BaseModel):
    """Provider-agnostic tool description.

    `parameters` is a JSON Schema draft-07 object. Both Gemini and Ollama
    can consume this format directly (Gemini via FunctionDeclaration,
    Ollama via OpenAI-compatible tool spec).
    """

    name: str
    description: str
    parameters: dict[str, Any] = Field(default_factory=lambda: {"type": "object", "properties": {}})
    required: list[str] = Field(default_factory=list)
    risk_level: int = int(RiskLevel.SAFE)
    examples: list[dict[str, Any]] = Field(default_factory=list)


class ToolCallResult(BaseModel):
    """Successful tool selection by an LLM."""

    tool_name: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    raw_reasoning: str = ""
    confidence: float = 1.0
    parse_attempts: int = 1
    provider: str = "unknown"
    model: str = ""


class ToolErrorKind(StrEnum):
    UNKNOWN_TOOL = "unknown_tool"
    INVALID_ARGS = "invalid_args"
    PARSE_FAILED = "parse_failed"
    MODEL_REFUSED = "model_refused"
    NETWORK = "network"
    TIMEOUT = "timeout"
    UNKNOWN = "unknown"


class ToolUseError(BaseModel):
    """Structured failure from a tool-use call. Never raised — always returned."""

    kind: ToolErrorKind
    message: str
    retriable: bool = True
    provider: str = "unknown"
    model: str = ""
    parse_attempts: int = 1


# ── Provider Protocol ──────────────────────────────────────────────────────────


@runtime_checkable
class ToolUseProvider(Protocol):
    """Both GeminiProvider and OllamaProvider implement this."""

    async def call_with_tools(  # pragma: no cover - protocol stub
        self,
        *,
        system_prompt: str,
        user_message: str,
        tools: list[ToolSchema],
        max_retries: int = 3,
    ) -> ToolCallResult | ToolUseError: ...


# ── ActionRegistry → ToolSchema bridge ─────────────────────────────────────────


_TYPE_TO_JSON: dict[str, str] = {
    "str": "string",
    "int": "integer",
    "float": "number",
    "bool": "boolean",
    "list": "array",
    "dict": "object",
}


def _python_type_to_json_schema(annotation: Any) -> dict[str, Any]:
    """Best-effort Python annotation → JSON Schema fragment."""
    name = getattr(annotation, "__name__", None) or str(annotation)
    # Strip "<class '...'>" noise and Optional[...] wrappers heuristically.
    lower = name.lower()
    for py, js in _TYPE_TO_JSON.items():
        if py == lower or lower.startswith(py + "["):
            base: dict[str, Any] = {"type": js}
            if js == "array":
                base["items"] = {"type": "string"}
            return base
    if "literal" in lower or "enum" in lower:
        # Best-effort: treat as string. Actual enum constraints are enforced
        # by Pydantic on the agent side.
        return {"type": "string"}
    return {"type": "string"}


def action_to_tool_schema(cls: type) -> ToolSchema:
    """Translate a registered Action subclass into a ToolSchema."""
    properties: dict[str, Any] = {}
    required: list[str] = []
    for field_name, field_info in cls.model_fields.items():
        prop = _python_type_to_json_schema(field_info.annotation)
        if field_info.description:
            prop["description"] = field_info.description
        properties[field_name] = prop
        if field_info.is_required():
            required.append(field_name)
    return ToolSchema(
        name=cls.name,
        description=getattr(cls, "__doc__", None) or f"Action: {cls.name}",
        parameters={
            "type": "object",
            "properties": properties,
            "required": required,
        },
        required=required,
        risk_level=int(cls.risk_level),
    )


def registry_as_tools(registry: ActionRegistry) -> list[ToolSchema]:
    """Build a ToolSchema list for every action in the registry."""
    return [action_to_tool_schema(cls) for cls in registry.all()]


# ── Terminal-marker tools ──────────────────────────────────────────────────────
# DONE_SUBGOAL / DONE_TASK / REFLECT are not Action subclasses but the planner
# must still be able to "call" them. Expose them as synthetic tools so the LLM
# sees them in the function-calling catalog.


def terminal_marker_tools() -> list[ToolSchema]:
    summary_param = {
        "type": "object",
        "properties": {
            "summary": {
                "type": "string",
                "description": (
                    "The text answer / outcome. For summarize/present/explain "
                    "sub-goals the prose answer to the user goes HERE."
                ),
            },
        },
        "required": ["summary"],
    }
    return [
        ToolSchema(
            name="DONE_SUBGOAL",
            description=(
                "Mark the current sub-goal complete. MUST be used for "
                "summarize / present / explain / respond / answer sub-goals "
                "with the prose answer in args.summary."
            ),
            parameters=summary_param,
            required=["summary"],
            risk_level=int(RiskLevel.SAFE),
        ),
        ToolSchema(
            name="DONE_TASK",
            description="Mark the WHOLE task complete with a final outcome summary.",
            parameters=summary_param,
            required=["summary"],
            risk_level=int(RiskLevel.SAFE),
        ),
        ToolSchema(
            name="REFLECT",
            description="Stop and reflect on progress before choosing the next action.",
            parameters={"type": "object", "properties": {}, "required": []},
            required=[],
            risk_level=int(RiskLevel.SAFE),
        ),
    ]


def all_tactical_tools(registry: ActionRegistry) -> list[ToolSchema]:
    """Tactical planner sees both real actions and terminal markers."""
    return [*registry_as_tools(registry), *terminal_marker_tools()]


__all__ = [
    "ToolSchema",
    "ToolCallResult",
    "ToolErrorKind",
    "ToolUseError",
    "ToolUseProvider",
    "action_to_tool_schema",
    "registry_as_tools",
    "terminal_marker_tools",
    "all_tactical_tools",
]
