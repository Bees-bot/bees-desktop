from __future__ import annotations

import hashlib
import json
import math
import os
import shutil
import threading
import uuid
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Protocol

from .config import Source, WorkerConfig


class KnowledgeError(RuntimeError):
    pass


class IndexBackend(Protocol):
    def build(self, source: Source, destination: Path) -> int: ...

    def search(self, source: Source, index_path: Path, question: str, limit: int) -> list[dict[str, Any]]: ...

    def invalidate(self, source_id: str) -> None: ...


class LlamaIndexBackend:
    """The only LlamaIndex-specific code in Bees."""

    def __init__(self, embedding_model: str):
        self.embedding_model = embedding_model
        self._initialization_lock = threading.Lock()
        self._initialized = False
        self._cache: dict[str, tuple[str, Any]] = {}

    def build(self, source: Source, destination: Path) -> int:
        self._initialize()
        from llama_index.core import SimpleDirectoryReader, VectorStoreIndex

        if not source.path.is_dir():
            raise KnowledgeError(f"source directory is unavailable: {source.name}")
        files: list[str] = []
        for directory, directory_names, file_names in os.walk(source.path, followlinks=False):
            directory_path = Path(directory)
            directory_names[:] = [
                name for name in directory_names if not (directory_path / name).is_symlink()
            ]
            files.extend(
                str(directory_path / name)
                for name in file_names
                if not (directory_path / name).is_symlink()
            )
        if not files:
            raise KnowledgeError(f"source contains no files: {source.name}")
        files.sort()
        documents = SimpleDirectoryReader(input_files=files, filename_as_id=True).load_data()
        if not documents:
            raise KnowledgeError(f"source contains no indexable documents: {source.name}")
        index = VectorStoreIndex.from_documents(documents, show_progress=False)
        index.storage_context.persist(persist_dir=str(destination))
        return len(documents)

    def search(self, source: Source, index_path: Path, question: str, limit: int) -> list[dict[str, Any]]:
        self._initialize()
        from llama_index.core import StorageContext, load_index_from_storage
        from llama_index.core.schema import MetadataMode

        generation = (index_path / "manifest.json").read_text(encoding="utf-8")
        cached = self._cache.get(source.id)
        if cached is None or cached[0] != generation:
            context = StorageContext.from_defaults(persist_dir=str(index_path))
            cached = (generation, load_index_from_storage(context))
            self._cache[source.id] = cached
        nodes = cached[1].as_retriever(similarity_top_k=limit).retrieve(question)
        evidence: list[dict[str, Any]] = []
        for result in nodes:
            node = result.node
            metadata = node.metadata if isinstance(node.metadata, dict) else {}
            raw_path = metadata.get("file_path") or metadata.get("filename") or metadata.get("file_name")
            relative_path = _relative_path(source.path, raw_path)
            title = (Path(str(metadata.get("file_name") or relative_path or source.name)).name or source.name)[:500]
            identity = relative_path or str(getattr(node, "ref_doc_id", None) or node.node_id)
            score = float(result.score) if result.score is not None else None
            evidence.append(
                {
                    "sourceId": source.id,
                    "documentId": hashlib.sha256(f"{source.id}:{identity}".encode()).hexdigest(),
                    "title": title,
                    "snippet": str(node.get_content(metadata_mode=MetadataMode.NONE)).strip(),
                    "citation": f"{source.name}: {relative_path or title}"[:1_500],
                    "score": score if score is None or math.isfinite(score) else None,
                }
            )
        return evidence

    def invalidate(self, source_id: str) -> None:
        self._cache.pop(source_id, None)

    def _initialize(self) -> None:
        if self._initialized:
            return
        with self._initialization_lock:
            if self._initialized:
                return
            try:
                from llama_index.core import Settings
                from llama_index.embeddings.huggingface import HuggingFaceEmbedding
            except ImportError as error:
                # a broken torch or transformers lands here too, and "not installed" sends
                # whoever reads status.json looking for the wrong problem
                raise KnowledgeError(
                    f"The embedding backend failed to load: {error}. "
                    "Install bees-knowledge-worker in a clean environment."
                ) from error
            Settings.embed_model = HuggingFaceEmbedding(model_name=self.embedding_model)
            Settings.llm = None
            self._initialized = True


def _relative_path(root: Path, raw_path: Any) -> str | None:
    if not isinstance(raw_path, str) or not raw_path:
        return None
    candidate = Path(raw_path)
    try:
        return candidate.resolve().relative_to(root.resolve()).as_posix()
    except (OSError, ValueError):
        return candidate.name or None


@dataclass
class IndexStatus:
    sourceId: str
    status: str
    indexedAt: str | None = None
    attemptedAt: str | None = None
    documentCount: int = 0
    error: str | None = None


def _now() -> datetime:
    return datetime.now(UTC)


def _indexed_at(value: str | None) -> datetime | None:
    """We write these aware; a hand-edited one may be naive, and comparing raises."""
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


class IndexManager:
    def __init__(self, config: WorkerConfig, backend: IndexBackend):
        self.config = config
        self.backend = backend
        self.config.index_root.mkdir(parents=True, exist_ok=True)
        self._swap_locks = {source_id: threading.RLock() for source_id in config.sources}
        self._build_locks = {source_id: threading.Lock() for source_id in config.sources}

    def source_root(self, source: Source) -> Path:
        return self.config.index_root / source.organization_id / source.id

    def status(self, source_id: str) -> IndexStatus:
        source = self._source(source_id)
        path = self.source_root(source) / "status.json"
        try:
            return IndexStatus(**json.loads(path.read_text(encoding="utf-8")))
        except (OSError, TypeError, ValueError):
            return IndexStatus(sourceId=source_id, status="unconfigured" if not source.enabled else "not_ready")

    def rebuild(self, source_id: str) -> IndexStatus:
        source = self._source(source_id)
        if not source.enabled:
            raise KnowledgeError(f"knowledge source is disabled: {source_id}")
        build_lock = self._build_locks[source_id]
        if not build_lock.acquire(blocking=False):
            return self.status(source_id)
        root = self.source_root(source)
        staging = root / f"build-{uuid.uuid4().hex}"
        attempted = _now().isoformat()
        previous = self.status(source_id)
        try:
            root.mkdir(parents=True, exist_ok=True)
            self._write_status(
                root,
                IndexStatus(
                    source_id,
                    "indexing",
                    previous.indexedAt,
                    attempted,
                    previous.documentCount,
                ),
            )
            staging.mkdir()
            count = self.backend.build(source, staging)
            indexed = _now().isoformat()
            (staging / "manifest.json").write_text(
                json.dumps({"sourceId": source_id, "indexedAt": indexed, "documentCount": count}),
                encoding="utf-8",
            )
            self._swap(source, staging)
            status = IndexStatus(source_id, "ready", indexed, attempted, count)
            self._write_status(root, status)
            self.backend.invalidate(source_id)
            return status
        except Exception as error:
            shutil.rmtree(staging, ignore_errors=True)
            status = IndexStatus(
                source_id,
                "error",
                previous.indexedAt,
                attempted,
                previous.documentCount,
                str(error)[:1_000],
            )
            self._write_status(root, status)
            raise KnowledgeError(str(error)) from error
        finally:
            build_lock.release()

    def rebuild_due(self) -> None:
        cutoff = _now() - timedelta(hours=self.config.rebuild_interval_hours)
        for source in self.config.sources.values():
            if not source.enabled:
                continue
            indexed_at = _indexed_at(self.status(source.id).indexedAt)
            if indexed_at is None or indexed_at <= cutoff:
                try:
                    self.rebuild(source.id)
                except KnowledgeError:
                    pass

    def search(self, source_ids: list[str], question: str, limit: int) -> tuple[list[dict[str, Any]], list[str]]:
        # One folder that is missing, unmounted or still building must not take the readable ones
        # down with it: skip it, name it in the reply, and only fail when nothing can be searched.
        evidence: list[dict[str, Any]] = []
        unavailable: list[str] = []
        for source_id in source_ids:
            source = self._source(source_id)
            current = self.source_root(source) / "current"
            with self._swap_locks[source_id]:
                if not current.is_dir():
                    unavailable.append(source_id)
                    continue
                evidence.extend(self.backend.search(source, current, question, limit))
        if source_ids and len(unavailable) == len(source_ids):
            raise KnowledgeError(f"KNOWLEDGE_SOURCE_NOT_READY: {', '.join(unavailable)}")
        evidence.sort(key=lambda item: item.get("score") if item.get("score") is not None else -1, reverse=True)
        return evidence[:limit], unavailable

    def _swap(self, source: Source, staging: Path) -> None:
        root = self.source_root(source)
        current = root / "current"
        previous = root / "previous"
        with self._swap_locks[source.id]:
            shutil.rmtree(previous, ignore_errors=True)
            if current.exists():
                os.replace(current, previous)
            try:
                os.replace(staging, current)
            except Exception:
                if previous.exists() and not current.exists():
                    os.replace(previous, current)
                raise
            shutil.rmtree(previous, ignore_errors=True)

    def _write_status(self, root: Path, status: IndexStatus) -> None:
        root.mkdir(parents=True, exist_ok=True)
        temporary = root / f"status-{uuid.uuid4().hex}.json"
        temporary.write_text(json.dumps(asdict(status), indent=2), encoding="utf-8")
        os.replace(temporary, root / "status.json")

    def _source(self, source_id: str) -> Source:
        source = self.config.sources.get(source_id)
        if source is None:
            raise KnowledgeError(f"unknown knowledge source: {source_id}")
        return source


class DailyRebuilder:
    def __init__(self, indexes: IndexManager):
        self.indexes = indexes
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="knowledge-rebuild", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._thread.join(timeout=5)

    def _run(self) -> None:
        while not self._stop.is_set():
            self.indexes.rebuild_due()
            self._stop.wait(min(self.indexes.config.rebuild_interval_hours * 3_600, 300))
