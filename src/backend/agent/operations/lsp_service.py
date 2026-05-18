import asyncio
import json
import logging
import os
from typing import Dict, Any, Optional
from pathlib import Path

logger = logging.getLogger(__name__)

class LSPClient:
    def __init__(self, name: str, command: list[str], root_path: str):
        self.name = name
        self.command = command
        self.root_path = root_path
        self.proc: Optional[asyncio.subprocess.Process] = None
        self._id_counter = 1
        self._futures: Dict[int, asyncio.Future] = {}
        self._reader_task: Optional[asyncio.Task] = None
        self._diagnostics: Dict[str, list] = {}

    async def start(self):
        logger.info(f"LSP: Starting {self.name} with command {self.command}")
        self.proc = await asyncio.create_subprocess_exec(
            *self.command,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        self._reader_task = asyncio.create_task(self._read_loop())
        
        # Initialize
        root_uri = Path(self.root_path).as_uri()
        await self.request("initialize", {
            "processId": os.getpid(),
            "rootUri": root_uri,
            "capabilities": {
                "textDocument": {
                    "publishDiagnostics": {"relatedInformation": True},
                    "definition": {"dynamicRegistration": True},
                    "references": {"dynamicRegistration": True}
                }
            }
        })
        await self.notify("initialized", {})
        logger.info(f"LSP: {self.name} initialized.")

    async def _read_loop(self):
        while self.proc and not self.proc.stdout.at_eof():
            try:
                line = await self.proc.stdout.readline()
                if not line: break
                if line.startswith(b"Content-Length:"):
                    try:
                        length = int(line.decode().split(":")[1].strip())
                    except (ValueError, IndexError):
                        continue
                        
                    # skip until \r\n\r\n
                    while True:
                        l = await self.proc.stdout.readline()
                        if l == b"\r\n": break
                        if not l: break
                    
                    body = await self.proc.stdout.readexactly(length)
                    msg = json.loads(body.decode())
                    
                    if "id" in msg:
                        msg_id = msg["id"]
                        future = self._futures.pop(msg_id, None)
                        if future:
                            if "error" in msg:
                                future.set_exception(Exception(str(msg["error"])))
                            else:
                                future.set_result(msg.get("result"))
                    elif "method" in msg:
                        method = msg["method"]
                        if method == "textDocument/publishDiagnostics":
                            uri = msg["params"]["uri"]
                            self._diagnostics[uri] = msg["params"]["diagnostics"]
            except Exception as e:
                logger.error(f"LSP {self.name} reader error: {e}")
                break

    async def request(self, method: str, params: Any) -> Any:
        if not self.proc or self.proc.returncode is not None:
             await self.start()

        msg_id = self._id_counter
        self._id_counter += 1
        future = asyncio.get_running_loop().create_future()
        self._futures[msg_id] = future
        
        body = json.dumps({"jsonrpc": "2.0", "id": msg_id, "method": method, "params": params})
        content = f"Content-Length: {len(body)}\r\n\r\n{body}"
        if self.proc and self.proc.stdin:
            self.proc.stdin.write(content.encode())
            await self.proc.stdin.drain()
        
        try:
            return await asyncio.wait_for(future, timeout=15.0)
        except asyncio.TimeoutError:
            self._futures.pop(msg_id, None)
            raise

    async def notify(self, method: str, params: Any):
        if not self.proc or self.proc.returncode is not None:
             await self.start()
             
        body = json.dumps({"jsonrpc": "2.0", "method": method, "params": params})
        content = f"Content-Length: {len(body)}\r\n\r\n{body}"
        if self.proc and self.proc.stdin:
            self.proc.stdin.write(content.encode())
            await self.proc.stdin.drain()

    async def stop(self):
        if self.proc:
            try:
                # Use a background task for shutdown to avoid blocking if the server is hung
                asyncio.create_task(self._shutdown_sequence())
            except:
                pass

    async def _shutdown_sequence(self):
        try:
            await self.request("shutdown", {})
            await self.notify("exit", {})
        except:
            pass
        if self.proc:
            self.proc.terminate()
            await self.proc.wait()
        if self._reader_task:
            self._reader_task.cancel()

class LSPManager:
    def __init__(self):
        self._clients: Dict[str, LSPClient] = {}

    async def get_client(self, lang: str, root_path: str) -> LSPClient:
        if lang not in self._clients:
            if lang == "python":
                # Assuming the venv path from the research
                pylsp_path = "/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/.venv/bin/pylsp"
                cmd = [pylsp_path]
            elif lang == "typescript":
                cmd = ["typescript-language-server", "--stdio"]
            else:
                raise ValueError(f"Unsupported language: {lang}")
            
            client = LSPClient(lang, cmd, root_path)
            await client.start()
            self._clients[lang] = client
        return self._clients[lang]

    async def shutdown_all(self):
        for client in self._clients.values():
            await client.stop()
        self._clients.clear()

# Singleton
lsp_manager = LSPManager()
