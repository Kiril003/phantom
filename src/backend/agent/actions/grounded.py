"""
GroundedParam abstraction — placeholder for Phase 9.2 visual grounding.

In this phase no action populates a GroundedParam, but the type lives here so
that the executor's resolution path is already wired. When SeeClick / OmniParser
land in 9.2, this resolver becomes the only thing that has to change.
"""
from __future__ import annotations

from typing import Any, Awaitable, Callable, Literal, Union

from pydantic import BaseModel


class DirectParam(BaseModel):
    kind: Literal["direct"] = "direct"
    value: Any


class GroundedParam(BaseModel):
    kind: Literal["grounded"] = "grounded"
    description: str
    expected_type: Literal["button", "input", "link", "image", "text", "element"]
    resolved_value: Any | None = None

    async def resolve(
        self,
        grounder: Callable[["GroundedParam"], Awaitable[Any]] | None,
    ) -> Any:
        if grounder is None:
            raise NotImplementedError(
                "GroundedParam.resolve called but no grounder registered. "
                "Visual grounding lands in Phase 9.2."
            )
        self.resolved_value = await grounder(self)
        return self.resolved_value


Param = Union[DirectParam, GroundedParam]


__all__ = ["DirectParam", "GroundedParam", "Param"]
