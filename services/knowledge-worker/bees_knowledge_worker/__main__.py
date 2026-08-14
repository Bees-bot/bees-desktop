from __future__ import annotations

import argparse
import getpass
import os

from .config import WorkerConfig, token_digest
from .indexes import DailyRebuilder, IndexManager, LlamaIndexBackend
from .server import KnowledgeServer, KnowledgeService


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(prog="bees-knowledge-worker")
    subcommands = result.add_subparsers(dest="command")
    serve = subcommands.add_parser("serve", help="run the MCP worker")
    serve.add_argument("--config", default=os.environ.get("BEES_KNOWLEDGE_CONFIG"))
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8788)
    subcommands.add_parser("hash-token", help="read a token without echo and print its SHA-256 digest")
    return result


def load(path: str | None) -> tuple[WorkerConfig, IndexManager]:
    if not path:
        raise SystemExit("--config or BEES_KNOWLEDGE_CONFIG is required")
    try:
        config = WorkerConfig.from_file(path)
    except (OSError, ValueError) as error:
        # a traceback buries the one line saying which field is wrong
        raise SystemExit(f"{path}: {error}") from error
    return config, IndexManager(config, LlamaIndexBackend(config.embedding_model))


def main() -> None:
    argument_parser = parser()
    args = argument_parser.parse_args()
    if args.command is None:
        argument_parser.print_help()
        return
    if args.command == "hash-token":
        print(token_digest(getpass.getpass("Token: ")))
        return
    config, indexes = load(getattr(args, "config", None))
    if args.command != "serve":
        raise SystemExit(2)
    scheduler = DailyRebuilder(indexes)
    server = KnowledgeServer((args.host, args.port), KnowledgeService(config, indexes))
    scheduler.start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        scheduler.stop()
        server.server_close()


if __name__ == "__main__":
    main()
