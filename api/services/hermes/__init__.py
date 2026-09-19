"""
Hermes package.

Imports are lazy (PEP 562). `safety_triage` documents itself as dependency-free
and trivially testable, but an eager `from .orchestrator import ...` here pulled
SQLAlchemy in through the package __init__, so importing the triage module
needed a database driver after all and its tests stopped being runnable in a
bare environment. Resolving names on attribute access keeps that promise.
"""
from typing import TYPE_CHECKING

__all__ = [
    "HermesOrchestrator",
    "plan",
    "ClassificationResult",
    "PlannerDecision",
    "RoutingDepth",
    "AgentName",
]

if TYPE_CHECKING:  # pragma: no cover - type checkers only
    from .orchestrator import HermesOrchestrator
    from .planner import (
        plan,
        ClassificationResult,
        PlannerDecision,
        RoutingDepth,
        AgentName,
    )

_LAZY = {
    "HermesOrchestrator": ".orchestrator",
    "plan": ".planner",
    "ClassificationResult": ".planner",
    "PlannerDecision": ".planner",
    "RoutingDepth": ".planner",
    "AgentName": ".planner",
}


def __getattr__(name: str):
    module = _LAZY.get(name)
    if module is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    import importlib

    return getattr(importlib.import_module(module, __name__), name)


def __dir__():
    return sorted(__all__)
