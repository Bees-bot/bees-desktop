# Token usage investigation — September 9, 2026

The saved runs confirm excessive real model usage. This is primarily execution
amplification, not a counter multiplying each response. A small task carries
roughly 10,000–12,000 tokens of instructions, tool definitions, and initial
context on its first request. Every subsequent model step processes that context
again, along with accumulated messages and tool results. Reviews, coordination,
failed tools, and repeated delegation multiply the number of steps.

The following measurements come from local persisted DSH session logs. They sum
provider-reported usage once per unique response, removing history copied into
recovery sessions. Session counts include those recovery sessions. These are
processed tokens, including cache reads; they are not dollar costs.

| Saved work item (ID prefix) | Sessions | Model responses | Uncached input | Cached input | Output | Total tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Three random numbers (`404c8449`) | 9 | 35 | 331,266 | 90,144 | 8,541 | 429,951 |
| Earlier numbers.txt task (`ede2651b`) | 23 | 127 | 347,286 | 1,307,576 | 48,051 | 1,702,913 |
| Three-source news summary (`05edb170`) | 8 | 51 | 693,625 | 366,368 | 16,873 | 1,076,866 |
| Earlier three-source news task (`c8f48f8f`) | 15 | 234 | 2,394,749 | 8,391,552 | 152,788 | 10,939,089 |

What accounts for these totals:

1. **Large fixed prompts on every step.** The recent news lead had 5,277
   characters of system instructions and 33,749 characters of tool definitions
   across 40 tools, before conversation history. Its first request used 11,768
   input tokens. Random-number workers had the same 40-tool set. Even reviewers
   received 37 tools and roughly 9,500 initial input tokens. No input files are
   necessary to incur this overhead. DSH constructs each request from the system
   prompt, tools, and conversation in its agent loop; Bees mounts the full saved
   preset in `dsh-runtime/plugin/lib/agent-runtime.js` (`setup`).

2. **Delegation launches a complete process per child.**
   `dsh-runtime/plugin/lib/product.js` (`createSubitems`) creates normal child work
   items in the same process. Each number-writing task therefore runs Work and
   fresh Review. In the successful three-number example, three requested workers
   became nine sessions: lead, planning reviewer, three workers, three child
   reviewers, and final reviewer. Thirty-five responses at approximately 12,000
   tokens each explains the 430,000-token total.

3. **Coordination and verification can cost more than the delegated work.** In
   the recent news example, the three raw research subagents together used
   51,454 tokens. The final reviewer used 407,693, the lead including its recovery
   used 465,066, and two planning-review sessions used 152,653. One planning
   reviewer spent ten responses largely listing agents/tasks and waiting. Bees
   starts planning participants before sending the lead its task, while the
   participant prompt tells it to wait for a proposal (`prepareDiscussion` in
   `agent-runtime.js`, discussion prompts in `product.js`). By contrast,
   `waitForPeers` is a host-side wait and makes no model calls itself.

4. **Failure and repetition inflate small tasks.** The earlier numbers.txt task
   created 15 direct child work items, not three. Its first batch left only one
   number in the shared output. Subsequent batches were cancelled or failed.
   Across its logs there were 11 `FS_NOT_OBSERVED` and 19 `FS_STALE_VERSION`
   errors. One child made 15 write calls in 18 responses, repeatedly ignoring the
   instruction to re-read a changed file. The current delegation instructions
   already require distinct output paths; the later successful example used
   three part files and merged them. This is evidence of actual repeated work,
   not token accounting duplication.

5. **Large tool results keep growing later requests.** The recent news reviewer
   returned a roughly 53,000-character tool-result event while checking raw HTML.
   Its later requests reached approximately 49,000 input tokens each. The earlier
   news task recorded 198 shell calls and 47 MCP fetch calls. Its largest child
   alone used 4,142,923 tokens in 29 responses: four web-fetch results inserted
   about 202,000 characters early in the session, input grew from 11,649 tokens
   to 117,665 by response six, and reached 197,881 by response 29. The model kept
   processing that material during subsequent shell calls. This directly
   explains millions of tokens without attached files.

The exact prompt mentioning **Google News, Yahoo News, MSNBC, and parallel
subagents** belongs to `05edb170`, the 1,076,866-token workflow. Its three raw
research subagents used 10,001, 21,352, and 20,101 tokens respectively. The
4,142,923-token Google child belongs to the earlier `c8f48f8f` prompt mentioning
**Google, Yahoo, Microsoft, and serial subagents**. These are different runs.

The 4.14-million-token child's trace explains the failure more precisely:

- Responses 4–5 fetched the top Google News RSS feed and three proposed section
  feeds. All four tool results reported the same final top-stories RSS URL and
  each returned 49,912 characters of raw XML/text, including opaque article URLs.
- Response 6 generated a roughly 33,000-character fetch argument and was rejected
  because the URL exceeded the tool's 2,048-character limit.
- Responses 7–24 made 18 successive shell calls fetching/parsing feeds and trying
  alternate Finance RSS URLs. The original feed content remained in the model
  history throughout those attempts.
- The child finally wrote its summary at response 25 and finished at response 29.
  Its 4,142,923 tokens comprised 3,838,464 cached input, 253,701 uncached input,
  and 50,758 output. Cache reads were approximately 93% of that processed total.

Breakdown of that child's **cumulative 4,142,923 tokens**, not a single context
window (its largest input was 197,881 tokens):

| Component | Approximate cumulative tokens | Share |
| --- | ---: | ---: |
| All 40 tool definitions: coding, workflow, delegation, etc. | 242,000 | 5.9% |
| System and Work-stage instructions | 46,000 | 1.1% |
| Available-skills catalog | 32,000 | 0.8% |
| Execution-agent roster | 10,000 | 0.2% |
| Actual assignment, runtime snapshot, message framing | 8,000 | 0.2% |
| Tool results repeatedly carried into subsequent inputs | 2,819,000 | 68.0% |
| Earlier model responses/code/tool arguments carried into subsequent inputs | 935,000 | 22.6% |
| Newly generated output | 50,758 (provider-reported) | 1.2% |

Method and precision: the provider reports totals for whole requests, not tokens
by section. The log has one unchanged request header, three initial user/context
messages, no subsequent user messages, and no compaction. Its initial input was
11,649 tokens. Repeating that initial envelope across 29 calls accounts for
337,821 tokens (8.15%). Later input growth accounts for 3,754,344 (90.62%), and
new output for 50,758 (1.23%). The five fixed-context rows divide the initial
envelope using the runtime's character-based estimator, calibrated to the
provider's initial count; they are approximate, not exact tokenizer readings.
The two growing-history rows estimate replayed output as each response's output
tokens times the number of later requests, with the remainder attributed to tool
results and their framing. This assumes output is replayed comparably to its
generation token count. Rounded rows need not sum exactly.

Actual parent planning or separate review execution contributes **zero** to this
worker's 4,142,923 tokens. Its own review was a separate 541,890-token session.
The parent's two lead attempts used 389,442 tokens, and its two planning reviewers
used 109,679; those parent costs were shared across the larger news workflow.
The worker received the child assignment and workflow instructions, not the
parent's conversation transcript. Thus the dominant cause inside this particular
4.14-million-token session was repeated growing history; fixed agent setup
accounted for approximately 8%.

Two independently verified runtime defects were addressed first:

- The Work-to-Review transition reset the review-rejection count for each new
  candidate. With `maxAttempts >= 2`, repeated review revisions could never hit
  the configured limit. `process-workflow.js` now preserves that count until a
  review passes, with a Temporal patch marker for historical replay. Behavioral
  regression coverage is in `tests/dsh-process-workflow.test.ts`. This is a
  separate runaway risk: the database contains **zero review rejections in all
  four sampled workflow families**, so this bug did not cause their measured
  totals.
- The intended suppression of raw `subagent` tools was ineffective for tools
  registered directly on an agent after setup. DSH's `restrict()` only filters
  inherited registrations; its own-layer registrations remain visible. The
  runtime now filters these schemas when assembling a request and guards their
  execution as well. The news run actually invoked raw `subagent` three times,
  bypassing the tracked Bees delegation path. The regression in
  `tests/dsh-delegation-visibility.test.ts` uses real DSH scopes, prompt assembly,
  and tool execution, including registration after setup. It also verifies that
  unrelated agents retain their tools. This correction does not make tracked
  child workflows lightweight; they still run their configured stages.

The upstream token meter replaces streaming usage for each turn/step rather than
adding the same usage again at the final assistant message. Its persisted totals
matched the final response usage in the examined logs. Aggregating raw session
files naively would still double-count recovery history: 79,742 tokens in the
recent news example and 228,295 in the earlier numbers example. The table above
removes those copies. This was not demonstrated to be a bug in the session UI.

Reproduce the measurements without launching agents:

```sh
node scripts/inspect-token-usage.mjs --help
node scripts/inspect-token-usage.mjs "/path/to/Bees/app-data/dsh/sessions"
```

The diagnostic prints usage and size/count metadata, not prompt contents,
credentials, or tool-result text. It needs the `zstd` CLI for compressed logs.
`tests/dsh-token-usage.test.ts` verifies cumulative streaming usage and recovery
deduplication.

## General runtime changes implemented

- **Tool history is bounded before the next model request.** New results keep
  at most 2,000 text characters; results older than two assistant responses keep
  256-character receipts. The immutable session log retains the complete result.
  `bees_read_tool_result` retrieves 1,500-character pages or finds an exact phrase.
  Error flags, call IDs, images and other rich blocks survive. Surface changes
  flush before requests and preserve their references through recovery.
- **Native tool schemas load on demand.** Managed agents start with discovery,
  result submission/recall, and applicable human-interaction tools. Discovery
  loads four matching tools per call and retains at most eight optional schemas.
  Scoped permissions remain authoritative. Apps keep their existing small
  allowlist; explicitly selected PTC presets keep their existing presentation.
- **The execution-agent roster is paginated.** It is no longer copied into
  every stage brief. Delegation inherits the caller unless a specific assignment
  is needed. Connected-source hints include only granted servers.
- **Text answers need no intermediate files.** Their complete answer goes into
  the stage-result summary and directly into the reviewer's brief. Requested
  file deliverables and publication requirements still apply.
- **Runaway use has a durable shared ceiling.** A root work item, its children,
  discussion participants, reviews, recovery sessions and provider retries share
  a SQLite admission ledger: 250 model requests or 250,000 processed tokens.
  Planning sessions without a work item have their own shared execution budget.
  Compaction calls carrying that session identity are included. Cached tokens
  count because the metric is processed tokens, not billing. Concurrent requests
  reserve allowance atomically; completed provider usage settles each receipt
  once, and missing usage retains the reservation. Preflight estimates use text
  bytes plus an image allowance and may stop early; provider usage can exceed an
  estimate, in which case subsequent requests are blocked. These are runaway
  ceilings, **not** the desired cost of a trivial task.
- **Repeated failures terminate.** Three identical failed tool calls stop the
  run; a successful tool or new human input resets this detector. Internal
  context notices do not. Budget refusals bypass even an `always` provider retry
  policy and are not retried by the stage driver. Normal agent responses have a
  4,096-token output cap (a lower configured cap is preserved); long answers and
  reasoning-heavy calls can therefore be truncated.

The constants live in `context-policy.js`, `tool-discovery.js`, and
`run-limits.js`; there is no new settings UI. Saved agent instructions, skill
catalogs, and explicitly configured discussion/review stages remain. Tracked
children still run their process lifecycle. Thus a universal 1,000-token
workflow or 100-fold **end-to-end** improvement has not been established.

Validation: desktop `npm run check` passed all 233 Vitest tests, both release
checks, TypeScript, and the production build. Real DSH scope/session tests cover
parent/child/grandchild policies, independent tool selection, error-loop stops,
retry-policy bypass prevention, durable flushing, full-result recall, and
recovery after event positions change. A synthetic 29-request replay with four
roughly 52 KB feeds reduced estimated cumulative **tool-result history** from
1,514,965 to 23,993 tokens: **98.42% less**. This excludes fixed prompts, schemas,
new model output, and any extra recall calls; it is not a paid model benchmark
or a measured total-workflow saving.

The local runtime plugin is staged for the next development-app launch. The
active app has not been restarted; packaged releases need rebuilding to include
the change. No paid workflow replay, commit, or deployment was performed.
