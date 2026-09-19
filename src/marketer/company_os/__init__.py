"""Company OS decision surface (opencompany-inspired)."""
from .knowledge import capture_from_state, extract_constraints, prompt_block
from .opencompany import CompanyRoute, route_workspace

__all__ = [
    "CompanyRoute",
    "capture_from_state",
    "extract_constraints",
    "prompt_block",
    "route_workspace",
]
