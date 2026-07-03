"""Provider Mesh — vault-managed generation for the ПОЛІС substrate.

Agents call mesh.generate(); the mesh leases the best key from KeyVault,
routes through the existing AIRouter (keeping the Gemini→Ollama last rung
intact), and reports the outcome back so rotation happens transparently.
"""
from __future__ import annotations

import logging
import re
from typing import Any

from config import config
from ai.keyvault import get_vault

logger = logging.getLogger(__name__)

_QUOTA_PAT = re.compile(r"quota|resource.?exhausted|billing", re.I)
_RATE_PAT = re.compile(r"429|rate.?limit|too many requests", re.I)
_AUTH_PAT = re.compile(r"401|403|api.?key|unauthoriz|permission.?denied", re.I)


def classify_outcome(exc: Exception) -> str:
    text = f"{type(exc).__name__}: {exc}"
    if _AUTH_PAT.search(text):
        return "auth_fail"
    if _QUOTA_PAT.search(text):
        return "quota"
    if _RATE_PAT.search(text):
        return "rate_limited"
    return "server_error"


_CONFIG_ATTR = {
    "gemini": "ai_gemini_api_key",
    "anthropic": "ai_anthropic_api_key",
}


class ProviderMesh:
    def __init__(self) -> None:
        self._router: Any = None

    def _get_router(self):
        if self._router is None:
            from ai.provider import AIRouter
            self._router = AIRouter()
        return self._router

    async def generate(
        self,
        *,
        system_prompt: str,
        user_message: str,
        history: list[dict] | None = None,
        provider: str = "gemini",
        task_id: str | None = None,
        user_id: str | None = None,
    ):
        vault = get_vault()
        lease = await vault.acquire(provider)
        attr = _CONFIG_ATTR.get(provider)
        env_secret = getattr(config, attr, "") if attr else ""

        if lease and attr:
            setattr(config, attr, lease.secret)
        try:
            resp = await self._get_router().generate(
                user_message,
                system_prompt,
                history or [],
                task_id=task_id,
                user_id=user_id,
                provider_hint=provider,
            )
            if lease:
                tokens = getattr(resp, "tokens_used", 0) or _rough_tokens(
                    system_prompt, user_message, getattr(resp, "text", "")
                )
                await vault.report(lease.id, "ok", tokens=tokens)
            return resp
        except Exception as exc:
            if lease:
                outcome = classify_outcome(exc)
                await vault.report(lease.id, outcome)
                if outcome in ("rate_limited", "quota", "auth_fail"):
                    retry = await vault.acquire(provider)
                    if retry and retry.id != lease.id and attr:
                        logger.info(
                            "mesh: rotating %s %s → %s after %s",
                            provider, lease.label, retry.label, outcome,
                        )
                        setattr(config, attr, retry.secret)
                        try:
                            resp = await self._get_router().generate(
                                user_message,
                                system_prompt,
                                history or [],
                                task_id=task_id,
                                user_id=user_id,
                                provider_hint=provider,
                            )
                            await vault.report(retry.id, "ok", tokens=_rough_tokens(
                                system_prompt, user_message, getattr(resp, "text", "")
                            ))
                            return resp
                        except Exception as exc2:
                            await vault.report(retry.id, classify_outcome(exc2))
                            raise
            raise
        finally:
            if lease and attr and env_secret:
                setattr(config, attr, env_secret)


def _rough_tokens(*parts: str) -> int:
    return sum(len(p) for p in parts if p) // 4


_mesh: ProviderMesh | None = None


def get_mesh() -> ProviderMesh:
    global _mesh
    if _mesh is None:
        _mesh = ProviderMesh()
    return _mesh
