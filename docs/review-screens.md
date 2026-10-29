# Agent review screens

Agents use `bees_request_review` to present one decision with all its related
fields. Screens are composed from Bees components; no generated code, HTML,
credentials or callbacks execute in a screen. Data can come from APIs, MCP,
search, files or earlier work. Sources are displayed as captured text and links;
the screen does not fetch external data itself.

The tool's `screen` argument is a JSON string with `title`, optional
`description`, `effect` (what approval permits), `values` and `view`.

```json
{
  "title": "Review customer update",
  "effect": "Use these corrected values to prepare the customer update.",
  "values": { "name": "Acme", "limit": 500 },
  "view": {
    "type": "split",
    "children": [
      {
        "type": "sources",
        "label": "API evidence",
        "items": [{ "label": "Customer API", "text": "Existing credit limit: 250" }]
      },
      {
        "type": "stack",
        "label": "Proposed values",
        "children": [
          { "type": "field", "key": "name", "label": "Customer", "kind": "text", "required": true },
          { "type": "field", "key": "limit", "label": "Credit limit", "kind": "number", "min": 0 }
        ]
      }
    ]
  }
}
```

## Components

- `stack`, `columns`, `split`, `tabs`: `children` and optional `label`.
  A split has two children; each tab child has a label. Split panes stack on phones.
- `field`: unique `key`, `label`, `kind` (`text`, `textarea`, `number`, `date`,
  `boolean`, `select`), optional `required`, `readOnly`, `hint`. Selects require
  distinct string `options`; numbers support `min` and `max`. A required boolean
  must be supplied but may be false. Dates use `YYYY-MM-DD`.
- `table`: unique `key`, `label`, `columns` (field definitions), optional
  `editable` (default false). Its value is an array of rows. Row count is fixed;
  use an editable boolean column for selection. Individual columns may be read-only.
- `text`: `text`, optional `label`.
- `diff`: `before`, `after` (captured text), optional `label`.
- `sources`: `items` of `{label,url?,text?}`, optional `label`. Links must be
  HTTP(S) without embedded credentials and open only on the user's click.

All fields/table keys bind directly to the top-level `values` object. Unknown
values and duplicate bindings are rejected. Missing field values may be null.
Limits are 64,000 JSON characters, 120 components, six layout levels,
100 table rows and 20 columns per table. Unsupported interactions need a normal
component implementation; screens cannot register their own code.

## Decisions and execution

The reviewer can save an incomplete draft, approve all fields together, reject,
or request changes with optional feedback. Approval validates every field,
including fields in hidden tabs, in both UI and runtime. Read-only fields,
unknown values and changed table rows are rejected even when saving drafts.
Shared-thread reviews require the thread owner. Version checks reject stale
submissions, and operation IDs make retries idempotent.

The tool returns `reviewId`, `decision` (`approve`, `reject`, `request_changes`),
the final `values`, `note`, `actorId` and `digest`. A data review grants no tool
permissions. To review a specific MCP action, also supply
`"action":{"toolName":"mcp__mail__send"}` and put the **complete tool arguments**
in `values`. Bees always displays the tool identity and complete final arguments
outside the agent-composed layout. The existing MCP action check accepts this
approval once, only within the same run and for exactly matching arguments.
Other sandbox and integration permissions still apply. Changed arguments need
fresh approval. Claims are consumed before execution, so a failed/uncertain
action cannot silently retry on the same approval.

Original data, corrected data, decision, reviewer, timestamps and approval
digest remain in run history. Pending reviews and saved drafts survive closing
or restarting Bees. After interruption the user may finish the review, then
choose **Continue** in Conversation or send a message. Failed runs offer
**Retry**. These buttons preserve any draft in the composer. Bees never automatically replays the old
run; new runs need fresh action approval. Explicitly stopping work cancels its
pending reviews while retaining their drafts in history.
