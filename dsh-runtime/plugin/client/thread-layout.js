import { h, React, createPortal, useEffect, useRef, useState } from './runtime.js';
import { THREAD_PAGES, defaultThreadLayout, normalizeThreadLayout, layoutGroups, updateLayoutNode, activateWidget, dockWidget } from '../lib/thread-layout.js';

const labels = new Map(THREAD_PAGES);
const PRIMARY_TABS = new Set(['conversation', 'files', 'kanban', 'discussion']);
const TAB_HELP = {
  conversation: 'Talk to Bees and ask it to do work. Answer its questions and approve requests here.\nExample: “Prepare my weekly report.”',
  files: 'The thread’s filing cabinet: files you added and results Bees created.\nExample: Upload a spreadsheet or open a finished report.',
  kanban: 'A board showing where the work is in its process, including work given to helper agents.\nExample: See what’s running, waiting for you, or finished.',
  discussion: 'Chat with the people sharing the thread. Messages here do not start Bees working.\nExample: “Can someone check these numbers?”',
  details: 'The thread’s information card: its name, creation date, and process steps.\nExample: Check which process this thread follows.',
  context: 'Read the guidance and saved context Bees uses for this work.\nExample: Check the rules Bees has been given.',
  schedule: 'An alarm clock that tells Bees to repeat this thread’s work automatically. Bees must be running on the thread owner’s computer.\nExample: Run this report every Monday.',
  memory: 'A notebook of facts Bees should remember. This tab edits team memory, shared across that team’s threads.\nExample: “Our reporting week starts on Monday.”',
  addons: 'Connect and manage outside tools available through the team.\nExample: Give Bees access to a connected service.',
  runs: 'A diary of previous attempts: what you asked, whether they finished, and their results.\nExample: Revisit yesterday’s report or a failed attempt.',
  traces: 'A more detailed diary showing tools used and recorded approvals or answers.\nExample: Investigate what Bees did during a task.',
  settings: 'Manage the thread itself: rename it, delete it, or transfer it to another computer.\nExample: Move ongoing work to another machine.',
};

export function ThreadWorkspace({ initialLayout, toolbar, navigation, renderWidget, onSave }) {
  const [layout, setLayout] = useState(() => normalizeThreadLayout(initialLayout) ?? defaultThreadLayout());
  const [editing, setEditing] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [moving, setMoving] = useState('files'), [target, setTarget] = useState('conversation'), [position, setPosition] = useState('right');
  const [dragging, setDragging] = useState(null);
  const hosts = useRef(new Map()), mounted = useRef(new Set());
  const scrollPositions = useRef(new Map()), restoreScroll = useRef(false);
  // Stable portal containers keep drafts, form state, and scroll positions when panels change parents.
  const [containers] = useState(() => new Map(THREAD_PAGES.map(([id]) => [id, document.createElement('div')])));
  const groups = layoutGroups(layout);
  for (const group of groups) mounted.current.add(group.active);
  function changeLayout(update) {
    for (const [id, container] of containers) if (container.parentElement && !container.hidden) {
      scrollPositions.current.set(id, [...container.querySelectorAll('*')]
        .filter(element => element.scrollTop || element.scrollLeft)
        .map(element => [element, element.scrollLeft, element.scrollTop]));
    }
    restoreScroll.current = true;
    setLayout(update);
  }
  useEffect(() => {
    for (const group of groups) for (const id of group.tabs) {
      const container = containers.get(id), host = hosts.current.get(group.id);
      container.className = 'bc-widget';
      container.hidden = group.active !== id;
      if (host && container.parentElement !== host) host.append(container);
    }
    if (restoreScroll.current) {
      for (const group of groups) for (const [element, left, top] of scrollPositions.current.get(group.active) ?? []) {
        if (containers.get(group.active).contains(element)) { element.scrollLeft = left; element.scrollTop = top; }
      }
      restoreScroll.current = false;
    }
  });
  useEffect(() => {
    if (navigation) changeLayout(layout => activateWidget(layout, navigation.id));
  }, [navigation]);
  const move = (widget, to, where) => {
    changeLayout(layout => dockWidget(layout, widget, to, where, crypto.randomUUID()));
    setDragging(null);
  };
  const finish = async () => {
    setSaving(true); setError('');
    try { await onSave(layout); setEditing(false); }
    catch (error) { setError(error.message); }
    finally { setSaving(false); }
  };
  const drop = (event, to, where) => {
    event.preventDefault(); event.stopPropagation();
    move(event.dataTransfer.getData('application/x-bees-widget'), to, where);
  };
  function tree(node) {
    if (node.type !== 'tabs') {
      const horizontal = node.type === 'row';
      const resize = (element, coordinate) => {
        const rect = element.parentElement.getBoundingClientRect();
        const ratio = (coordinate - (horizontal ? rect.left : rect.top)) / (horizontal ? rect.width : rect.height);
        setLayout(layout => updateLayoutNode(layout, node.id, split => ({ ...split, ratio: Math.max(0.15, Math.min(0.85, ratio)) })));
      };
      return h('div', { key: node.id, className: 'bc-layout-split ' + node.type },
        h('div', { className: 'bc-layout-branch', style: { flex: node.ratio } }, tree(node.first)),
        h('div', { className: 'bc-layout-divider', role: 'separator', tabIndex: editing ? 0 : -1,
          'aria-label': 'Resize panels', 'aria-orientation': horizontal ? 'vertical' : 'horizontal',
          'aria-valuenow': Math.round(node.ratio * 100), 'aria-valuemin': 15, 'aria-valuemax': 85,
          onPointerDown: event => { if (editing && !saving) { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); } },
          onPointerMove: event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resize(event.currentTarget, horizontal ? event.clientX : event.clientY); },
          onPointerUp: event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); },
          onKeyDown: event => {
            if (!editing || saving || !(horizontal ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']).includes(event.key)) return;
            event.preventDefault();
            setLayout(layout => updateLayoutNode(layout, node.id, split => ({ ...split, ratio: Math.max(0.15, Math.min(0.85, split.ratio + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -0.05 : 0.05))) })));
          } }),
        h('div', { className: 'bc-layout-branch', style: { flex: 1 - node.ratio } }, tree(node.second)));
    }
    const dockTarget = node.active === dragging ? node.tabs.find(id => id !== dragging) : node.active;
    return h('section', { key: node.id, className: 'bc-layout-group', 'aria-label': labels.get(node.active) + ' panel' },
      h('nav', { className: 'bc-page-tabs', role: 'tablist', 'aria-label': 'Panel views' }, node.tabs.map((id, index) => {
        const isPrimary = PRIMARY_TABS.has(id);
        const isFirstSecondary = !isPrimary && index > 0 && PRIMARY_TABS.has(node.tabs[index - 1]);
        return h(React.Fragment, { key: id },
          isFirstSecondary ? h('span', { className: 'bc-tab-separator', role: 'separator', 'aria-hidden': true }) : null,
          h('button', {
            id: 'widget-tab-' + id, role: 'tab', 'aria-selected': node.active === id, 'aria-controls': 'widget-panel-' + id,
            className: 'bc-tab-button ' + (isPrimary ? 'bc-tab-primary' : 'bc-tab-secondary'),
            title: TAB_HELP[id], 'aria-description': TAB_HELP[id],
            tabIndex: node.active === id ? 0 : -1, draggable: editing && !saving,
            onClick: () => changeLayout(layout => activateWidget(layout, id)),
            onKeyDown: event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next = node.tabs[event.key === 'Home' ? 0 : event.key === 'End' ? node.tabs.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + node.tabs.length) % node.tabs.length];
              changeLayout(layout => activateWidget(layout, next));
              document.getElementById('widget-tab-' + next)?.focus();
            },
            onDragStart: event => { event.dataTransfer.setData('application/x-bees-widget', id); event.dataTransfer.effectAllowed = 'move'; setDragging(id); },
            onDragEnd: () => setDragging(null),
            onDragOver: event => { if (editing && !saving && dragging) event.preventDefault(); },
            onDrop: event => { if (editing && !saving && dragging) drop(event, id, 'before'); },
          }, labels.get(id)));
      })),
      h('div', { className: 'bc-widget-host', ref: element => { if (element) hosts.current.set(node.id, element); else hosts.current.delete(node.id); } }),
      editing && !saving && dragging ? h('div', { className: 'bc-layout-dropzones' }, ['left', 'right', 'top', 'bottom', 'tab'].map(where => h('button', {
        key: where, className: 'bc-layout-drop ' + where, 'aria-label': `Dock as ${where} of ${labels.get(dockTarget ?? node.active)}`,
        disabled: !dockTarget, onDragOver: event => event.preventDefault(), onDrop: event => drop(event, dockTarget, where),
      }, where === 'tab' ? 'Group as tabs' : where))) : null);
  }
  return h(React.Fragment, null,
    toolbar ? createPortal(h('button', { className: 'bc-customize-layout', disabled: saving, 'aria-pressed': editing,
      title: editing ? 'Done customizing layout' : 'Customize panel layout (drag to split/group)',
      onClick: () => editing ? finish() : setEditing(true) }, saving ? 'Saving…' : editing ? 'Done customizing' : 'Customize layout'), toolbar) : null,
    editing ? h('section', { className: 'bc-layout-tools', 'aria-label': 'Customize layout' },
      h('p', null, 'Drag tabs onto a panel edge to split, or onto another tab to group. Drag dividers to resize. Your layout applies to all threads on this computer.'),
      h('div', { className: 'bc-actions' },
        h('select', { 'aria-label': 'Widget to move', value: moving, disabled: saving, onChange: event => setMoving(event.target.value) }, THREAD_PAGES.map(([id, label]) => h('option', { key: id, value: id }, label))),
        h('select', { 'aria-label': 'Widget position', value: position, disabled: saving, onChange: event => setPosition(event.target.value) },
          [['tab', 'As tabs with'], ['before', 'Tab before'], ['left', 'Left of'], ['right', 'Right of'], ['top', 'Above'], ['bottom', 'Below']].map(([id, label]) => h('option', { key: id, value: id }, label))),
        h('select', { 'aria-label': 'Destination widget', value: target, disabled: saving, onChange: event => setTarget(event.target.value) }, THREAD_PAGES.map(([id, label]) => h('option', { key: id, value: id }, label))),
        h('button', { disabled: saving || moving === target, onClick: () => move(moving, target, position) }, 'Move widget'),
        h('button', { disabled: saving, onClick: () => changeLayout(defaultThreadLayout()) }, 'Reset to tabs')),
      error ? h('p', { role: 'alert' }, error) : null) : null,
    h('div', { className: 'bc-workspace' + (editing ? ' editing' : '') }, tree(layout)),
    ...THREAD_PAGES.filter(([id]) => mounted.current.has(id)).map(([id]) => createPortal(
      h('div', { id: 'widget-panel-' + id, role: 'tabpanel', 'aria-labelledby': 'widget-tab-' + id, className: 'bc-widget-content' }, renderWidget(id)), containers.get(id), id)));
}
