from __future__ import annotations
import asyncio
import os
import time
from typing import ClassVar, Any
from pydantic import Field
from pathlib import Path

from ..schemas import ActionResult, RiskLevel
from .base import Action, ActionContext
from ..operations.lsp_service import lsp_manager

class LspDiagnostics(Action):
    """Get linting/type errors for a file using LSP (Language Server Protocol)."""
    name: ClassVar[str] = "lsp.diagnostics"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    reversible: ClassVar[bool] = True

    path: str = Field(..., description="Absolute or ~-relative path to the file to check")

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        path = os.path.abspath(os.path.expanduser(self.path))
        ext = os.path.splitext(path)[1]
        
        lang = "python" if ext == ".py" else "typescript" if ext in {".ts", ".tsx", ".js", ".jsx"} else None
        if not lang:
             return ActionResult(ok=False, error=f"Unsupported file extension: {ext}", error_class="unsupported")

        try:
            client = await lsp_manager.get_client(lang, ctx.workspace_dir)
            uri = Path(path).as_uri()
            
            # Read content to sync with server
            try:
                with open(path, "r", encoding="utf-8") as f:
                    text = f.read()
            except Exception as exc:
                return ActionResult(ok=False, error=f"read_failed: {exc}", error_class="os_error")
            
            # 1. Open/Update the document
            await client.notify("textDocument/didOpen", {
                "textDocument": {
                    "uri": uri,
                    "languageId": lang,
                    "version": 1,
                    "text": text
                }
            })
            
            # 2. Wait for diagnostics (asynchronous notification)
            await asyncio.sleep(2.0)
            
            diags = client._diagnostics.get(uri, [])
            
            # Format diagnostics for the agent
            formatted = []
            for d in diags:
                severity = ["Error", "Warning", "Info", "Hint"][d.get("severity", 1) - 1]
                line = d["range"]["start"]["line"] + 1
                col = d["range"]["start"]["character"] + 1
                msg = d["message"]
                formatted.append(f"[{severity}] Line {line}:{col} - {msg}")

            return ActionResult(
                ok=True,
                output={
                    "path": path,
                    "language": lang,
                    "diagnostics": formatted,
                    "count": len(formatted),
                    "raw": diags
                },
                elapsed_ms=int((time.monotonic() - t0) * 1000)
            )
        except Exception as e:
            return ActionResult(ok=False, error=str(e), error_class="lsp_error")


class LspGotoDefinition(Action):
    """Find the definition of a symbol at a specific position."""
    name: ClassVar[str] = "lsp.goto_definition"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    reversible: ClassVar[bool] = True

    path: str = Field(..., description="Path to the file")
    line: int = Field(..., description="Line number (1-indexed)")
    character: int = Field(..., description="Character position (1-indexed)")

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        path = os.path.abspath(os.path.expanduser(self.path))
        ext = os.path.splitext(path)[1]
        lang = "python" if ext == ".py" else "typescript" if ext in {".ts", ".tsx", ".js", ".jsx"} else None
        
        if not lang:
             return ActionResult(ok=False, error=f"Unsupported file: {ext}", error_class="unsupported")

        try:
            client = await lsp_manager.get_client(lang, ctx.workspace_dir)
            uri = Path(path).as_uri()
            
            result = await client.request("textDocument/definition", {
                "textDocument": {"uri": uri},
                "position": {"line": self.line - 1, "character": self.character - 1}
            })
            
            return ActionResult(
                ok=True,
                output={"definition": result},
                elapsed_ms=int((time.monotonic() - t0) * 1000)
            )
        except Exception as e:
            return ActionResult(ok=False, error=str(e), error_class="lsp_error")


class LspGetSymbols(Action):
    """Retrieve structured symbols (classes, functions, methods) from a file using LSP.
    Replaces noisy regex searches with precise semantic indexing.
    """
    name: ClassVar[str] = "lsp.get_symbols"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    reversible: ClassVar[bool] = True

    path: str = Field(..., description="Path to the file to index")

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        path = os.path.abspath(os.path.expanduser(self.path))
        ext = os.path.splitext(path)[1]
        lang = "python" if ext == ".py" else "typescript" if ext in {".ts", ".tsx", ".js", ".jsx"} else None
        
        if not lang:
             return ActionResult(ok=False, error=f"Unsupported file: {ext}", error_class="unsupported")

        try:
            client = await lsp_manager.get_client(lang, ctx.workspace_dir)
            uri = Path(path).as_uri()
            
            # Ensure file is open
            try:
                with open(path, "r", encoding="utf-8") as f:
                    text = f.read()
            except Exception as exc:
                return ActionResult(ok=False, error=f"read_failed: {exc}", error_class="os_error")
                
            await client.notify("textDocument/didOpen", {
                "textDocument": {"uri": uri, "languageId": lang, "version": 1, "text": text}
            })

            result = await client.request("textDocument/documentSymbol", {
                "textDocument": {"uri": uri}
            })
            
            # 3. Format symbols for the agent (simplify the tree)
            def _format_symbol(s: dict, indent: int = 0) -> list[str]:
                # SymbolKind: 1=File, 5=Class, 6=Method, 12=Function, etc.
                kind_map = {1: "File", 5: "Class", 6: "Method", 12: "Function", 13: "Variable"}
                kind_name = kind_map.get(s.get("kind"), "Symbol")
                name = s.get("name", "unknown")
                rng = s.get("range", {}).get("start", {})
                line = rng.get("line", 0) + 1
                
                out = [f"{'  ' * indent}[{kind_name}] {name} (line {line})"]
                for child in s.get("children", []):
                    out.extend(_format_symbol(child, indent + 1))
                return out

            formatted = []
            if isinstance(result, list):
                for s in result:
                    formatted.extend(_format_symbol(s))

            return ActionResult(
                ok=True,
                output={
                    "path": path,
                    "symbols": formatted,
                    "count": len(formatted)
                },
                elapsed_ms=int((time.monotonic() - t0) * 1000)
            )
        except Exception as e:
            return ActionResult(ok=False, error=str(e), error_class="lsp_error")
