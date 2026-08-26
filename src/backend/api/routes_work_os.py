"""Work OS & Dev Ecosystem Routes for PHANTOM OS.

Provides:
- Webhooks Ingestion (GitHub, GitLab, CI/CD, AlertManager)
- CLI client control endpoints
- Canvas Document & State Synchronization
- Local Smart Digest & Action Extraction
"""
from __future__ import annotations

import logging
import json
import time
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Header, HTTPException, Request, status
from pydantic import BaseModel, Field

try:
    from api.websocket_hub import hub
except ImportError:
    try:
        from websocket_hub import hub
    except ImportError:
        hub = None

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/work-os", tags=["work-os"])


class WebhookPayload(BaseModel):
    source: str = "custom"
    event_type: str = "event"
    repository: Optional[str] = None
    sender: Optional[str] = None
    title: str
    description: Optional[str] = None
    url: Optional[str] = None
    status: str = "neutral"
    commit_hash: Optional[str] = None


class CliSendMessageRequest(BaseModel):
    conversation_id: str
    text: Optional[str] = None
    kind: str = "text"
    widget_type: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None


class CanvasSaveRequest(BaseModel):
    canvas_id: str
    thread_id: str
    title: str
    blocks: List[Dict[str, Any]]
    raw_markdown: str
    updated_by: str = "User"


# In-memory fast cache for canvas documents & webhook tokens
_CANVAS_STORE: Dict[str, Dict[str, Any]] = {}


@router.post("/webhooks/{channel_token}")
async def ingest_webhook(channel_token: str, request: Request):
    """Ingest webhooks from GitHub, GitLab, Gitea, CI/CD or local curl."""
    try:
        data = await request.json()
    except Exception:
        body_bytes = await request.body()
        data = {"raw": body_bytes.decode(errors="ignore")}

    headers = dict(request.headers)
    event_name = (
        headers.get("x-github-event")
        or headers.get("x-gitlab-event")
        or headers.get("x-event-key")
        or "custom_event"
    )

    # Normalize into WebhookEventData
    repo_name = data.get("repository", {}).get("name") if isinstance(data.get("repository"), dict) else None
    sender_name = data.get("sender", {}).get("login") if isinstance(data.get("sender"), dict) else data.get("user_name")
    
    title = f"Webhook Event: {event_name}"
    description = None
    status_flag = "neutral"
    commit_hash = None
    url = None

    if "commits" in data and isinstance(data["commits"], list) and len(data["commits"]) > 0:
        latest = data["commits"][-1]
        commit_hash = latest.get("id")
        title = f"Git Push: {len(data['commits'])} commit(s) to {data.get('ref', 'main')}"
        description = latest.get("message")
        url = latest.get("url")
        status_flag = "success"
    elif "pull_request" in data:
        pr = data["pull_request"]
        title = f"PR #{pr.get('number')}: {pr.get('title')}"
        description = pr.get("body", "")[:200]
        url = pr.get("html_url")
        status_flag = "success" if pr.get("state") == "open" else "neutral"

    webhook_msg = {
        "id": f"wh_{int(time.time()*1000)}",
        "type": "webhook:event",
        "senderId": "webhook_bot",
        "senderName": "DevHub Bot",
        "senderAvatar": "https://images.unsplash.com/photo-1618401471353-b98afee0b2eb?w=200&auto=format&fit=crop&q=80",
        "timestamp": time.strftime("%H:%M"),
        "webhookEventData": {
            "source": "github" if "x-github-event" in headers else "gitlab" if "x-gitlab-event" in headers else "custom",
            "eventType": event_name,
            "repository": repo_name,
            "sender": sender_name,
            "title": title,
            "description": description,
            "url": url,
            "status": status_flag,
            "commitHash": commit_hash,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        },
    }

    if hub:
        await hub.broadcast("messenger", "incoming_message", webhook_msg)
    logger.info("Webhook event %s processed and broadcasted", event_name)

    return {"status": "ok", "delivered": True, "event": webhook_msg}


@router.post("/cli/send")
async def cli_send_message(req: CliSendMessageRequest):
    """CLI client endpoint to send text, tasks, or micro-widgets."""
    msg_id = f"cli_{int(time.time()*1000)}"
    msg_type = req.kind

    msg_obj: Dict[str, Any] = {
        "id": msg_id,
        "senderId": "cli_operator",
        "senderName": "Phantom CLI",
        "senderAvatar": "https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=200&auto=format&fit=crop&q=80",
        "timestamp": time.strftime("%H:%M"),
        "type": msg_type,
        "text": req.text,
        "isSelf": False,
    }

    if req.payload:
        if req.widget_type == "kanban":
            msg_obj["type"] = "widget:kanban"
            msg_obj["kanbanData"] = req.payload
        elif req.widget_type == "voting":
            msg_obj["type"] = "widget:voting"
            msg_obj["votingData"] = req.payload
        elif req.widget_type == "raci":
            msg_obj["type"] = "widget:raci"
            msg_obj["raciData"] = req.payload

    if hub:
        await hub.broadcast("messenger", "incoming_message", msg_obj)
    return {"status": "ok", "message_id": msg_id}


@router.get("/threads/{thread_id}/canvas")
async def get_thread_canvas(thread_id: str):
    """Get canvas document for a thread."""
    doc = _CANVAS_STORE.get(thread_id)
    if not doc:
        return {
            "id": f"canvas_{thread_id}",
            "threadId": thread_id,
            "title": "Документ рішень",
            "blocks": [],
            "rawMarkdown": "",
            "lastUpdated": time.strftime("%H:%M"),
        }
    return doc


@router.put("/threads/{thread_id}/canvas")
async def save_thread_canvas(thread_id: str, req: CanvasSaveRequest):
    """Save/update canvas document for a thread."""
    doc_data = {
        "id": req.canvas_id,
        "threadId": thread_id,
        "title": req.title,
        "blocks": req.blocks,
        "rawMarkdown": req.raw_markdown,
        "updatedBy": req.updated_by,
        "lastUpdated": time.strftime("%H:%M"),
    }
    _CANVAS_STORE[thread_id] = doc_data
    # Broadcast update
    if hub:
        await hub.broadcast("messenger", "canvas_update", doc_data)
    return {"status": "ok", "canvas": doc_data}
