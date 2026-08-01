"""
Marketplace routes.
"""
from __future__ import annotations

import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from security.auth import get_current_user
from db.models import User

logger = logging.getLogger(__name__)

router = APIRouter(tags=["marketplace"])

class AgentTemplate(BaseModel):
    id: str
    name: str
    description: str
    cost_per_token: float
    avatar_url: str

class DeployAgentRequest(BaseModel):
    template_id: str

AGENT_TEMPLATES = [
    AgentTemplate(
        id="code_reviewer",
        name="Code Reviewer",
        description="An AI agent specializing in code reviews.",
        cost_per_token=0.002,
        avatar_url="https://example.com/avatar/code.png"
    ),
    AgentTemplate(
        id="sales_bot",
        name="Sales Bot",
        description="Automates initial sales inquiries.",
        cost_per_token=0.001,
        avatar_url="https://example.com/avatar/sales.png"
    ),
    AgentTemplate(
        id="data_analyst",
        name="Data Analyst",
        description="Creates actionable insights from your data.",
        cost_per_token=0.005,
        avatar_url="https://example.com/avatar/data.png"
    ),
    AgentTemplate(
        id="phantom_oracle",
        name="Phantom Oracle",
        description="An all-knowing general-purpose agent.",
        cost_per_token=0.01,
        avatar_url="https://example.com/avatar/oracle.png"
    )
]

@router.get("/marketplace/agents", response_model=List[AgentTemplate])
async def list_marketplace_agents(user: User = Depends(get_current_user)):
    """Returns a hardcoded list of available Agent Templates."""
    return AGENT_TEMPLATES

@router.post("/tenant/agents/deploy")
async def deploy_agent(request: DeployAgentRequest, user: User = Depends(get_current_user)):
    """Mocks the deployment of an agent to the current tenant."""
    # Find the template
    template = next((t for t in AGENT_TEMPLATES if t.id == request.template_id), None)
    if not template:
        raise HTTPException(status_code=404, detail="Agent template not found.")
    
    return {
        "status": "success",
        "message": f"Successfully deployed {template.name} to your tenant.",
        "deployed_agent_id": f"agent_{request.template_id}_mocked_id"
    }
