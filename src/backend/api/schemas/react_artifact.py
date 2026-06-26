from typing import Dict, Optional
from pydantic import BaseModel, Field

class ReactArtifactSceneData(BaseModel):
    """
    Data payload for rendering a dynamic sandboxed React artifact.
    Contains the raw React source code and any external dependencies required.
    """
    title: Optional[str] = Field(
        None,
        description="Optional title for the artifact window.",
    )
    code: str = Field(
        ...,
        description=(
            "The raw React source code to be rendered in the sandbox. "
            "It MUST have a default export (e.g. `export default function App() { ... }`). "
            "Tailwind CSS classes can be used natively."
        ),
    )
    dependencies: Optional[Dict[str, str]] = Field(
        default_factory=dict,
        description=(
            "Key-value mapping of npm dependencies and their versions (e.g. {'lucide-react': 'latest', 'recharts': '2.1.9'})."
        ),
    )
