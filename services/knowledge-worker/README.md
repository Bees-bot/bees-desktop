# Bees Knowledge Worker

One organization-controlled LlamaIndex service exposing the read-only MCP tool `knowledge_search`.

## Local development

Run these from `bees-desktop`:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -e services/knowledge-worker
cp services/knowledge-worker/config.example.json knowledge-config.json
bees-knowledge-worker hash-token
```

`hash-token` reads a token without echoing it and prints its SHA-256 digest. Put that digest
in `knowledge-config.json`'s `tokenSha256` and point each `sources[].path` at a folder that
exists on this machine; the example values are placeholders and the worker refuses to start on
them. Then:

```bash
bees-knowledge-worker serve --config knowledge-config.json
```

Keep the original token in Bees local credential storage, not in the config file.
Use a separately generated, high-entropy token for each team; token digests must also be unique.

## Organization server

Build the worker image from this directory, mount the config, every source folder, and a persistent index volume, then put `/mcp` behind the organization's HTTPS reverse proxy.

`compose.example.yaml` is the server-install template. Copy it to `compose.yaml`, adjust the read-only source mounts, and provide `config.json`.

```bash
docker build -t bees-knowledge-worker services/knowledge-worker
docker run --rm -p 127.0.0.1:8788:8788 \
  -v "$PWD/knowledge-config.json:/etc/bees-knowledge/config.json:ro" \
  -v "bees-knowledge-indexes:/var/lib/bees-knowledge/indexes" \
  -v "/srv/company-docs:/data/company-docs:ro" \
  bees-knowledge-worker
```

The remote Bees setting should contain the one external URL, such as `https://knowledge.example.com/mcp`. TLS termination, firewall policy, backups, and source mounts remain under the organization's control. Do not add this container to the Bees SaaS deployment.

## Operations

- `GET /health` reports only aggregate ready/indexing/error counts.
- Restart the container after changing source or token configuration.
- A background thread performs due full rebuilds and checks at least every five minutes.
- A rebuild writes beside `current` and swaps only after persistence succeeds.
- Search and build errors are written to the worker's local logs/status; source content is not sent to Bees SaaS.
