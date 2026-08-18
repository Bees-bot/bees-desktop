from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$")


def _identifier(value: Any, field: str) -> str:
    if not isinstance(value, str) or not _IDENTIFIER.fullmatch(value):
        raise ValueError(f"{field} must be a 1-120 character identifier")
    return value


@dataclass(frozen=True)
class Source:
    id: str
    organization_id: str
    team_id: str | None
    name: str
    path: Path
    enabled: bool = True


@dataclass(frozen=True)
class TokenScope:
    token_sha256: str
    organization_id: str
    team_id: str
    source_ids: frozenset[str]


@dataclass(frozen=True)
class WorkerConfig:
    index_root: Path
    sources: dict[str, Source]
    tokens: tuple[TokenScope, ...]
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    rebuild_interval_hours: int = 24

    @classmethod
    def from_file(cls, path: str | Path) -> "WorkerConfig":
        config_path = Path(path).expanduser().resolve()
        with config_path.open(encoding="utf-8") as handle:
            raw = json.load(handle)
        return cls.from_dict(raw, config_path.parent)

    @classmethod
    def from_dict(cls, raw: Any, base_directory: str | Path = ".") -> "WorkerConfig":
        if not isinstance(raw, dict):
            raise ValueError("configuration must be an object")
        base = Path(base_directory).resolve()
        root_value = raw.get("indexRoot")
        if not isinstance(root_value, str) or not root_value.strip():
            raise ValueError("indexRoot is required")
        index_root = Path(root_value).expanduser()
        if not index_root.is_absolute():
            index_root = base / index_root

        sources: dict[str, Source] = {}
        for value in raw.get("sources", []):
            if not isinstance(value, dict):
                raise ValueError("each source must be an object")
            source_id = _identifier(value.get("id"), "source.id")
            organization_id = _identifier(value.get("organizationId"), "source.organizationId")
            team_value = value.get("teamId")
            team_id = None if team_value is None else _identifier(team_value, "source.teamId")
            name = value.get("name")
            if not isinstance(name, str) or not name.strip() or len(name) > 120:
                raise ValueError("source.name must be 1-120 characters")
            path_value = value.get("path")
            if not isinstance(path_value, str) or not path_value.strip():
                raise ValueError("source.path is required")
            source_path = Path(path_value).expanduser()
            if not source_path.is_absolute():
                source_path = base / source_path
            if source_id in sources:
                raise ValueError(f"duplicate source: {source_id}")
            enabled = value.get("enabled", True)
            if not isinstance(enabled, bool):
                raise ValueError("source.enabled must be true or false")
            sources[source_id] = Source(
                id=source_id,
                organization_id=organization_id,
                team_id=team_id,
                name=name.strip(),
                path=source_path.resolve(),
                enabled=enabled,
            )

        tokens: list[TokenScope] = []
        token_digests: set[str] = set()
        for value in raw.get("tokens", []):
            if not isinstance(value, dict):
                raise ValueError("each token must be an object")
            digest = value.get("tokenSha256")
            if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
                raise ValueError("token.tokenSha256 must be a lowercase SHA-256 digest")
            if digest in token_digests:
                raise ValueError("token digests must be unique")
            token_digests.add(digest)
            organization_id = _identifier(value.get("organizationId"), "token.organizationId")
            team_id = _identifier(value.get("teamId"), "token.teamId")
            source_values = value.get("sourceIds")
            if not isinstance(source_values, list) or not source_values:
                raise ValueError("token.sourceIds must be a non-empty array")
            source_ids = frozenset(_identifier(item, "token.sourceIds") for item in source_values)
            for source_id in source_ids:
                source = sources.get(source_id)
                if source is None:
                    raise ValueError(f"token references unknown source: {source_id}")
                if source.organization_id != organization_id:
                    raise ValueError(f"token cannot cross organizations: {source_id}")
                if source.team_id not in (None, team_id):
                    raise ValueError(f"token cannot cross teams: {source_id}")
            tokens.append(TokenScope(digest, organization_id, team_id, source_ids))

        interval = raw.get("rebuildIntervalHours", 24)
        if not isinstance(interval, int) or isinstance(interval, bool) or not 1 <= interval <= 168:
            raise ValueError("rebuildIntervalHours must be an integer from 1 to 168")
        model = raw.get("embeddingModel", "BAAI/bge-small-en-v1.5")
        if not isinstance(model, str) or not model.strip() or len(model) > 500:
            raise ValueError("embeddingModel must be 1-500 characters")
        return cls(index_root.resolve(), sources, tuple(tokens), model.strip(), interval)


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
