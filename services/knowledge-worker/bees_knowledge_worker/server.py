from __future__ import annotations

import hmac
import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from .config import TokenScope, WorkerConfig, token_digest
from .indexes import IndexManager, KnowledgeError


TOOL = {
    "name": "knowledge_search",
    "description": "Search organization documents available to this team and return cited evidence.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "question": {"type": "string", "minLength": 1, "maxLength": 8000},
            "sourceIds": {"type": "array", "items": {"type": "string"}, "maxItems": 100},
            "maxResults": {"type": "integer", "minimum": 1, "maximum": 20, "default": 8},
            "includeSnippets": {"type": "boolean", "default": True},
        },
        "required": ["question"],
        "additionalProperties": False,
    },
    "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True},
}


class KnowledgeService:
    def __init__(self, config: WorkerConfig, indexes: IndexManager):
        self.config = config
        self.indexes = indexes

    def authenticate(self, authorization: str | None) -> TokenScope | None:
        if not authorization or not authorization.startswith("Bearer "):
            return None
        digest = token_digest(authorization[7:])
        for scope in self.config.tokens:
            if hmac.compare_digest(digest, scope.token_sha256):
                return scope
        return None

    def authorized_sources(self, scope: TokenScope, requested: Any) -> list[str]:
        allowed = {
            source_id
            for source_id in scope.source_ids
            if (source := self.config.sources.get(source_id)) is not None
            and source.enabled
            and source.organization_id == scope.organization_id
            and source.team_id in (None, scope.team_id)
        }
        if requested is None:
            selected = sorted(allowed)
        else:
            if not isinstance(requested, list) or len(requested) > 100 or not all(
                isinstance(item, str) for item in requested
            ):
                raise KnowledgeError("sourceIds must be an array of source identifiers")
            selected = list(dict.fromkeys(requested))
        if not selected:
            raise KnowledgeError("no knowledge sources are authorized for this team")
        denied = [source_id for source_id in selected if source_id not in allowed]
        if denied:
            raise KnowledgeError("KNOWLEDGE_SOURCE_FORBIDDEN")
        return selected

    def call_search(self, scope: TokenScope, arguments: Any) -> dict[str, Any]:
        if not isinstance(arguments, dict):
            raise KnowledgeError("tool arguments must be an object")
        unknown = set(arguments) - {"question", "sourceIds", "maxResults", "includeSnippets"}
        if unknown:
            raise KnowledgeError(f"unknown argument: {sorted(unknown)[0]}")
        question = arguments.get("question")
        if not isinstance(question, str) or not question.strip() or len(question) > 8_000:
            raise KnowledgeError("question must be 1-8000 characters")
        maximum = arguments.get("maxResults", 8)
        if isinstance(maximum, bool) or not isinstance(maximum, int) or not 1 <= maximum <= 20:
            raise KnowledgeError("maxResults must be an integer from 1 to 20")
        snippets = arguments.get("includeSnippets", True)
        if not isinstance(snippets, bool):
            raise KnowledgeError("includeSnippets must be a boolean")
        sources = self.authorized_sources(scope, arguments.get("sourceIds"))
        evidence, unavailable = self.indexes.search(sources, question.strip(), maximum)
        if not snippets:
            for item in evidence:
                item.pop("snippet", None)
        else:
            for item in evidence:
                item["snippet"] = item.get("snippet", "")[:4_000]
        searched = [source_id for source_id in sources if source_id not in unavailable]
        if not unavailable:
            return {"evidence": evidence, "searchedSourceIds": searched}
        return {"evidence": evidence, "searchedSourceIds": searched, "unavailableSourceIds": unavailable}

    def health(self) -> dict[str, Any]:
        statuses = [self.indexes.status(source.id).status for source in self.config.sources.values()]
        return {
            "ok": True,
            "sources": len(statuses),
            "ready": statuses.count("ready"),
            "indexing": statuses.count("indexing"),
            "errors": statuses.count("error"),
        }


class KnowledgeServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], service: KnowledgeService):
        super().__init__(address, KnowledgeHandler)
        self.service = service


class KnowledgeHandler(BaseHTTPRequestHandler):
    server: KnowledgeServer
    protocol_version = "HTTP/1.1"
    maximum_body = 1_048_576

    def do_GET(self) -> None:
        if self.path != "/health":
            self._send(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        self._send(HTTPStatus.OK, self.server.service.health())

    def do_POST(self) -> None:
        if self.path != "/mcp":
            self._send(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        scope = self.server.service.authenticate(self.headers.get("authorization"))
        if scope is None:
            self._send(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            if length <= 0 or length > self.maximum_body:
                raise ValueError("MCP request size is invalid")
            message = json.loads(self.rfile.read(length))
            status, response = self._handle_message(scope, message)
            self._send(status, response, {"mcp-session-id": "bees-knowledge"})
        except Exception as error:
            self.log_error("Knowledge MCP request failed: %s", error)
            self._send(
                HTTPStatus.OK,
                {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {"code": -32603, "message": "Knowledge request failed"},
                },
                {"mcp-session-id": "bees-knowledge"},
            )

    def _handle_message(self, scope: TokenScope, message: Any) -> tuple[HTTPStatus, Any]:
        if not isinstance(message, dict):
            raise ValueError("MCP request must be an object")
        method = message.get("method")
        request_id = message.get("id")
        if method in ("notifications/initialized", "notifications/cancelled"):
            return HTTPStatus.ACCEPTED, None
        if method == "initialize":
            return HTTPStatus.OK, self._rpc(
                request_id,
                {
                    "protocolVersion": message.get("params", {}).get("protocolVersion", "2025-03-26"),
                    "capabilities": {"tools": {"listChanged": False}},
                    "serverInfo": {"name": "Bees Knowledge", "version": "1"},
                },
            )
        if method == "ping":
            return HTTPStatus.OK, self._rpc(request_id, {})
        if method == "tools/list":
            return HTTPStatus.OK, self._rpc(request_id, {"tools": [TOOL]})
        if method == "tools/call":
            params = message.get("params")
            if not isinstance(params, dict) or params.get("name") != "knowledge_search":
                raise KnowledgeError("unknown knowledge tool")
            try:
                output = self.server.service.call_search(scope, params.get("arguments", {}))
                return HTTPStatus.OK, self._rpc(
                    request_id,
                    {
                        "content": [{"type": "text", "text": json.dumps(output)}],
                        "structuredContent": output,
                    },
                )
            except KnowledgeError as error:
                return HTTPStatus.OK, self._rpc(
                    request_id,
                    {"content": [{"type": "text", "text": str(error)}], "isError": True},
                )
        return HTTPStatus.OK, {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": -32601, "message": "Unsupported method"},
        }

    @staticmethod
    def _rpc(request_id: Any, result: Any) -> dict[str, Any]:
        return {"jsonrpc": "2.0", "id": request_id, "result": result}

    def _send(self, status: HTTPStatus, body: Any, headers: dict[str, str] | None = None) -> None:
        content = b"" if body is None else json.dumps(body).encode("utf-8")
        self.send_response(status)
        if content:
            self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(content)))
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        if content:
            self.wfile.write(content)

    def log_message(self, format: str, *args: Any) -> None:
        # Keep stdlib's useful request log, but never print authorization headers or bodies.
        super().log_message(format, *args)
