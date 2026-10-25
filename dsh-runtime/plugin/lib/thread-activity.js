import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DEFAULT_WORKFLOW } from './thread-workflow.js';
import { validId } from './thread-store.js';

const messageText = message => (message?.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n');

export function threadAgentSnapshot(session, status = 'idle', model, fromSeq = 0, toSeq = Infinity) {
  const ownEvents = session.snapshotEvents().filter(event => event.seq >= (session.inheritedEventCount ?? 0));
  const events = ownEvents.filter(event => event.seq >= fromSeq && event.seq < toSeq);
  const end = events.findLast(event => event.type === 'turn/end');
  const start = events.findLast(event => event.type === 'turn/start');
  const reason = end?.data.reason?.kind;
  const state = status === 'running' ? 'running' : start && (!end || start.seq > end.seq) ? 'uncertain'
    : reason === 'completed' ? 'completed' : reason === 'aborted' ? 'cancelled' : reason ? 'failed' : 'idle';
  const descriptor = ownEvents.find(event => event.type === 'subagent/descriptor')?.data;
  const results = new Map(events.filter(event => event.type === 'tool/result').map(event => [event.data.message.toolCallId, event]));
  const tools = events.filter(event => event.type === 'tool/call').map(({ data, time }) => {
    const result = results.get(data.callId);
    return { id: data.callId, name: data.name, arguments: String(data.arguments ?? '').slice(0, 2000),
      status: result ? result.data.message.isError ? 'failed' : 'succeeded' : 'pending',
      result: result ? messageText(result.data.message).slice(0, 1000) : '',
      startedAt: new Date(time).toISOString(), ...(result ? { completedAt: new Date(result.time).toISOString() } : {}) };
  });
  return { status: state, model: events.findLast(event => event.type === 'request/context')?.data.model ?? descriptor?.agentModel ?? model,
    tools,
    title: descriptor?.label,
    // an approval switch injects a notice ahead of a helper's real task
    task: (events.find(event => event.type === 'user/message' && event.data.source?.kind !== 'user-approval')?.data.content.find(block => block.type === 'text')?.text ?? '').slice(0, 8000),
    summary: messageText(events.findLast(event => event.type === 'assistant/message')?.data.message).slice(0, 8000),
    ...(session.header?.createdAt !== undefined ? { createdAt: new Date(session.header.createdAt).toISOString() } : {}),
    completedAt: end && !['running', 'idle', 'uncertain'].includes(state) ? new Date(end.time).toISOString() : undefined };
}

export async function recoverThreadActivity(ctx, store, thread) {
  if (thread.ownerClientId !== store.clientId || thread.staged || store.preference(`frozen:${thread.id}`)) return;
  for (const run of thread.runs) {
    if (run.status === 'running' || run.activityVersion === 2) continue;
    validId(run.id);
    const agents = new Map((run.agents ?? []).map(agent => [agent.id, agent]));
    const errors = [];
    const cwd = store.preference('executionFolder:' + run.id) ?? join(store.root, 'runs', thread.id, run.id);
    const queue = store.preference('executionSessions:' + run.id) ?? (run.workflow ?? DEFAULT_WORKFLOW).flatMap((stage, stageIndex) => stage.kind === 'approval' ? [] : [{ id: `${run.id}-${stageIndex}`, stageIndex }]);
    const visited = new Set();
    for (let position = 0; position < queue.length; position++) {
      const entry = queue[position];
      if (visited.has(entry.id)) continue;
      visited.add(entry.id);
      let handle;
      try {
        const live = ctx.sessions.get(entry.id);
        handle = live ? undefined : await ctx.sessionPersistence.open(entry.id, 'read');
        const header = live?.header ?? handle.header;
        if (header.cwd !== cwd || header.parentSession !== entry.parentId) throw Error('Session does not belong to this thread execution');
        const events = live ? live.snapshotEvents() : (await handle.read()).events;
        const inheritedEventCount = live?.inheritedEventCount ?? handle.inheritedEventCount ?? 0;
        const snapshot = threadAgentSnapshot({ header, inheritedEventCount, snapshotEvents: () => events }, ctx.agents.get(entry.id)?.status, undefined, entry.fromSeq, entry.toSeq);
        agents.set(entry.id, { ...agents.get(entry.id), ...entry, ...snapshot });
        for (const event of events) if (event.seq >= Math.max(inheritedEventCount, entry.fromSeq ?? 0) && event.seq < (entry.toSeq ?? Infinity) && event.type === 'subagent/catalog') {
          queue.push({ id: event.data.childId, parentId: entry.id, stageIndex: entry.stageIndex });
        }
      } catch (error) {
        // Later stages may never have started; a missing child is missing evidence.
        if (entry.parentId || run.status === 'completed' || error.name !== 'SessionPersistenceNotFoundError') errors.push(`${entry.id}: ${error.message}`);
      } finally { await handle?.close(); }
    }
    store.mutate(thread.id, randomUUID(), doc => {
      const current = doc.runs.find(entry => entry.id === run.id);
      current.agents = [...agents.values()];
      current.activityVersion = 2;
      if (errors.length) current.activityError = 'Some agent history could not be recovered. ' + errors.join('\n');
      else delete current.activityError;
    });
  }
}

export function trackThreadAgent(ctx, { agent, store, threadId, runId, stageIndex, parentId, fromSeq = 0, title }) {
  const key = 'executionSessions:' + runId;
  fromSeq = Math.min(fromSeq, store.preference(key)?.find(entry => entry.id === agent.id)?.fromSeq ?? fromSeq);
  const update = status => {
    const snapshot = threadAgentSnapshot(agent.session, status, agent.options.model, fromSeq);
    if (title) snapshot.title = title;
    const sessions = store.preference(key) ?? [];
    let recorded = sessions.find(entry => entry.id === agent.id);
    if (!recorded) { recorded = { id: agent.id, stageIndex, ...(parentId ? { parentId } : {}), fromSeq }; sessions.push(recorded); }
    recorded.toSeq = status === 'running' ? undefined : agent.session.snapshotEvents().length;
    store.preference(key, sessions);
    store.mutate(threadId, randomUUID(), doc => {
      const run = doc.runs.find(run => run.id === runId);
      run.activityVersion = 2;
      run.agents ??= [];
      let entry = run.agents.find(entry => entry.id === agent.id);
      if (!entry) {
        entry = { id: agent.id, stageIndex, ...(parentId ? { parentId } : {}),
          model: agent.options.model, createdAt: new Date().toISOString() };
        run.agents.push(entry);
      }
      Object.assign(entry, snapshot);
    });
  };
  update(agent.status);
  ctx.effect(() => ctx.on('agent/status', event => {
    if (event.agent === agent) update(event.status);
  }), 'Thread agent activity');
}
