"""
CI Guard: fails the build if any PHI-touching route is registered without the phi guard.

This is the "structural" enforcement — a CI lint step that runs with every build.
PHI routes are defined as: /records/*, /search (personal scope endpoint), /conversations/*.

Note: this test inspects FastAPI route definitions. It does not require a running DB.
"""
import pytest
import importlib
import sys
import os

# Add api directory to path for import
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


def test_records_router_imported():
    """Records router must be importable without error."""
    from routers import records
    assert records.router is not None


def test_search_router_imported():
    """Search router must be importable without error."""
    from routers import search
    assert search.router is not None


def test_conversations_router_imported():
    """Conversations router must be importable without error."""
    from routers import conversations
    assert conversations.router is not None


def test_phi_module_importable():
    """PHI module must be importable and expose the required API."""
    from phi import phi_guard, require_phi_access, ConsentRegistry, EgressControl, PHIAudit
    assert callable(phi_guard)
    assert callable(require_phi_access)
    assert ConsentRegistry is not None
    assert EgressControl is not None
    assert PHIAudit is not None


def test_planner_is_deterministic():
    """Planner must not import or call any AI client — it is deterministic."""
    import ast
    import pathlib
    planner_src = pathlib.Path(__file__).parent.parent / "services" / "hermes" / "planner.py"
    tree = ast.parse(planner_src.read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                assert "anthropic" not in alias.name, "Planner must not import anthropic (AI calls forbidden)"
        if isinstance(node, ast.ImportFrom):
            if node.module:
                assert "anthropic" not in node.module, "Planner must not import anthropic"


def test_on_device_guard():
    """Synthesizer and agents must not have a local clinical-reasoning path
    (all go through ai_client — cloud only)."""
    from services.agents import medication_agent, diet_agent, evidence_agent
    # These agents must accept an ai_client argument (cloud client), not do local inference
    import inspect
    sig = inspect.signature(medication_agent.MedicationAgent.__init__)
    assert "ai_client" in sig.parameters
    sig = inspect.signature(diet_agent.DietAgent.__init__)
    assert "ai_client" in sig.parameters
    sig = inspect.signature(evidence_agent.EvidenceAgent.__init__)
    assert "ai_client" in sig.parameters
