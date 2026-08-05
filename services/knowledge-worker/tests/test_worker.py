from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from typing import Any

from bees_knowledge_worker.config import Source, WorkerConfig, token_digest
from bees_knowledge_worker.indexes import IndexManager, KnowledgeError
from bees_knowledge_worker.server import KnowledgeService


class FakeBackend:
    def __init__(self) -> None:
        self.fail = False

    def build(self, source: Source, destination: Path) -> int:
        if self.fail:
            raise RuntimeError("broken input")
        (destination / "fake-index.json").write_text(json.dumps({"source": source.id}), encoding="utf-8")
        return 3

    def search(self, source: Source, index_path: Path, question: str, limit: int) -> list[dict[str, Any]]:
        marker = json.loads((index_path / "fake-index.json").read_text(encoding="utf-8"))
        return [{"sourceId": marker["source"], "snippet": question, "score": 0.5}]

    def invalidate(self, source_id: str) -> None:
        pass


def config(root: Path) -> WorkerConfig:
    return WorkerConfig.from_dict(
        {
            "indexRoot": str(root / "indexes"),
            "sources": [
                {
                    "id": "org-docs",
                    "organizationId": "org-1",
                    "teamId": None,
                    "name": "Org docs",
                    "path": str(root / "org-docs"),
                },
                {
                    "id": "team-a-docs",
                    "organizationId": "org-1",
                    "teamId": "team-a",
                    "name": "Team A docs",
                    "path": str(root / "team-a-docs"),
                },
                {
                    "id": "team-b-docs",
                    "organizationId": "org-1",
                    "teamId": "team-b",
                    "name": "Team B docs",
                    "path": str(root / "team-b-docs"),
                },
            ],
            "tokens": [
                {
                    "tokenSha256": token_digest("team-a-secret"),
                    "organizationId": "org-1",
                    "teamId": "team-a",
                    "sourceIds": ["org-docs", "team-a-docs"],
                }
            ],
        }
    )


class WorkerTests(unittest.TestCase):
    def test_token_can_only_select_its_team_and_org_sources(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            settings = config(Path(directory))
            service = KnowledgeService(settings, IndexManager(settings, FakeBackend()))
            scope = service.authenticate("Bearer team-a-secret")
            self.assertIsNotNone(scope)
            self.assertEqual(service.authorized_sources(scope, None), ["org-docs", "team-a-docs"])
            with self.assertRaisesRegex(KnowledgeError, "FORBIDDEN"):
                service.authorized_sources(scope, ["team-b-docs"])
            self.assertIsNone(service.authenticate("Bearer wrong"))

    def test_config_rejects_a_cross_team_token(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            raw = {
                "indexRoot": str(Path(directory) / "indexes"),
                "sources": [{
                    "id": "private", "organizationId": "org", "teamId": "team-b",
                    "name": "Private", "path": directory,
                }],
                "tokens": [{
                    "tokenSha256": token_digest("secret"), "organizationId": "org",
                    "teamId": "team-a", "sourceIds": ["private"],
                }],
            }
            with self.assertRaisesRegex(ValueError, "cannot cross teams"):
                WorkerConfig.from_dict(raw)

    def test_config_rejects_ambiguous_duplicate_token_digests(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            raw = {
                "indexRoot": str(Path(directory) / "indexes"),
                "sources": [{
                    "id": "shared", "organizationId": "org", "teamId": None,
                    "name": "Shared", "path": directory,
                }],
                "tokens": [
                    {
                        "tokenSha256": token_digest("secret"), "organizationId": "org",
                        "teamId": team, "sourceIds": ["shared"],
                    }
                    for team in ("team-a", "team-b")
                ],
            }
            with self.assertRaisesRegex(ValueError, "must be unique"):
                WorkerConfig.from_dict(raw)

    def test_failed_rebuild_keeps_the_previous_index_searchable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            settings = config(Path(directory))
            backend = FakeBackend()
            indexes = IndexManager(settings, backend)
            indexes.rebuild("org-docs")
            backend.fail = True
            with self.assertRaisesRegex(KnowledgeError, "broken input"):
                indexes.rebuild("org-docs")
            self.assertEqual(indexes.search(["org-docs"], "answer", 1)[0]["snippet"], "answer")
            self.assertEqual(indexes.status("org-docs").status, "error")
            self.assertEqual(indexes.status("org-docs").documentCount, 3)

    def test_source_identifier_cannot_escape_the_index_root(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            raw = {
                "indexRoot": str(Path(directory) / "indexes"),
                "sources": [{
                    "id": "..", "organizationId": "org", "teamId": None,
                    "name": "Escape", "path": directory,
                }],
                "tokens": [],
            }
            with self.assertRaisesRegex(ValueError, "identifier"):
                WorkerConfig.from_dict(raw)

    def test_search_returns_only_the_authenticated_teams_sources(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            settings = config(Path(directory))
            indexes = IndexManager(settings, FakeBackend())
            indexes.rebuild("org-docs")
            indexes.rebuild("team-a-docs")
            service = KnowledgeService(settings, indexes)
            scope = service.authenticate("Bearer team-a-secret")
            self.assertIsNotNone(scope)
            result = service.call_search(scope, {"question": "answer"})
            self.assertEqual(result["searchedSourceIds"], ["org-docs", "team-a-docs"])
            self.assertEqual(
                {item["sourceId"] for item in result["evidence"]},
                {"org-docs", "team-a-docs"},
            )


if __name__ == "__main__":
    unittest.main()
