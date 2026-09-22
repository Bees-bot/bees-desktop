# Team process continuity

## Scope and existing behavior

Files, transcripts, tool results, model sessions, credentials, and generated outputs stay on the device that produced them. Team sync already shares process and agent definitions, work-item status, and a short run summary. Same-device restart already resumes from local checkpoints. The server already provides 60-second execution claims, renewed every 20 seconds, but ordinary claims are scoped to one account and Temporal history is local. A different member cannot safely take over an active stage or answer a live question today.

## Minimal behavior to implement

1. **Shared input, local execution.** Publish a pending process question or work review as a small team coordination record. An authorized member answers it once. Store the responder user ID, device ID, and server timestamp with the answer. The executor polls the record and feeds the answer into its *local* session. Never copy its transcript or files. A personal credential approval stays with the account that owns that credential.
2. **One runner per work item.** Make the existing work-item claim team-wide. Record the running user and device, plus the time each stage starts and ends. A peer can claim only if their device is ready and the current lease expired or was released. A stale runner must stop before more side effects when its lease is lost.
3. **Do not move an active run.** A machine coming online does not interrupt work on another machine. Once a device starts a run, every stage in that run stays there because later stages may depend on its local files, results, or session. The owner is preferred again for the next run. After a crash, only the same device resumes its local checkpoint; the team starts a separate retry after reviewing possible side effects.
4. **Local readiness check.** Before claiming, verify the assigned agent is enabled, the model works, required MCP servers are connected, needed file mappings exist, and the required network access works. If any check fails, leave the run waiting with a reason. Never copy credentials or substitute a different model/tool silently.

With no shared results or files, a stage that depends on prior local output cannot move. This is a deliberate limit, not a reason to sync the output. A one-stage task can start on any eligible member's device while its owner is offline; its output remains there. Multi-stage work can switch only when the next stage is independent of earlier local output.

## Cases to handle

| Event | Behavior |
| --- | --- |
| Owner online at start | Owner gets first chance to run. |
| Owner offline before start | Eligible online peer gets the team-wide lease and runs locally. |
| Owner returns during peer run | Peer finishes the run; owner is preferred for the next run. |
| Peer lacks agent/model/MCP/network/file mapping | Peer is skipped; show the missing requirement. |
| Nobody eligible | Wait without claiming or changing stage. |
| Device disappears mid-stage | Let lease expire; do not automatically repeat a possibly side-effecting stage elsewhere. |
| Original device returns | Resume its local checkpoint if still authoritative; otherwise reconcile with the shared stage state. |
| Two members answer | First server-accepted answer wins; show who answered and when. |
| Membership revoked | Reject new answers and lease claims; stop the runner at its next lease check. |
| Server unreachable | Continue local computation only until lease safety requires a pause; do not start another stage. |

## Implemented minimal version

1. Process work items use a team-wide claim. The creator publishes the ready item before claiming, so its device gets the first chance. A peer with team access can claim a ready item when the creator is offline. Schedule occurrence claims remain account-scoped.
2. The runtime checks local agents, MCP configuration, and mapped inputs before attempting the claim. A device missing those resources does not claim the work.
3. The first running device is recorded with member ID, device ID/name, start time, heartbeat time, and end time. Another device cannot take over that work automatically, even after lease expiry. The same device can recover its local run.
4. `bees_ask_team` publishes an ordinary process question without a transcript or file. One team member can answer atomically. The answer records member ID, device ID, and server time and is returned to the local agent.
5. The work conversation shows where the process ran and who answered team questions. Files, outputs, transcripts, credentials, and model sessions remain local.

The hard boundary is intentional: automatic mid-stage recovery or moving a later stage that needs earlier local output would require sharing session or result state and is outside this feature.
