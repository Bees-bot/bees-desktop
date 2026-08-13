# API bridge

Serves an API's OpenAPI endpoints as MCP tools, for services that ship no MCP server of their own.

`bridge.mjs` is not in the repo. `npm run prepare:bridge` builds it from
[`@ivotoby/openapi-mcp-server`][upstream] (MIT), the same way the binaries are prepared.

Run it by hand with the bundled node, no `node_modules` needed:

```
API_HEADERS="Authorization:Bearer $TOKEN" bees-node bridge.mjs \
  --api-base-url https://api.example.com --openapi-spec https://api.example.com/openapi.json \
  --transport http --host 127.0.0.1 --port 8790 --path /mcp --tools all
```

Credentials go in `API_HEADERS`, not `--headers`. Arguments show up in `ps`.

`--tools all` is one tool per endpoint, and every schema sits in the model's context, so use
`--tools explicit --tool <id>` on anything sizeable. `--tools dynamic` swaps them for three
meta-tools the model looks endpoints up with: cheap on context, a round trip per call.

Responses come back exactly as the API sent them. For anything used constantly a hand written tool
still wins, on the same Freelancer request this returned 4,727 tokens against 473 for ours.

[upstream]: https://github.com/ivo-toby/mcp-openapi-server
