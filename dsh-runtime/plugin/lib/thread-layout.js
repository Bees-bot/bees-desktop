export const THREAD_PAGES = [
  ['conversation', 'Conversation'], ['files', 'Files'], ['kanban', 'Kanban'], ['discussion', 'Discussion'],
  ['details', 'Details'], ['context', 'Instructions'], ['schedule', 'Schedules'],
  ['memory', 'Memory'], ['addons', 'Add-ons'], ['runs', 'Run history'], ['traces', 'Activity'],
];

export const defaultThreadLayout = () => ({ type: 'tabs', id: 'main', tabs: THREAD_PAGES.map(([id]) => id), active: 'conversation' });

// Layouts are personal preferences; accept only known views, once each, in a bounded tree.
export function normalizeThreadLayout(value) {
  const widgets = new Set(), nodes = new Set();
  function visit(node, depth) {
    if (!node || depth > THREAD_PAGES.length || typeof node.id !== 'string' || !/^[\w-]{1,80}$/.test(node.id) || nodes.has(node.id)) throw Error();
    nodes.add(node.id);
    if (node.type === 'tabs') {
      if (!Array.isArray(node.tabs) || !node.tabs.length || node.tabs.length > THREAD_PAGES.length || !node.tabs.includes(node.active)) throw Error();
      for (const id of node.tabs) {
        if (!THREAD_PAGES.some(([known]) => known === id) || widgets.has(id)) throw Error();
        widgets.add(id);
      }
      return { type: 'tabs', id: node.id, tabs: [...node.tabs], active: node.active };
    }
    if (!['row', 'column'].includes(node.type) || !Number.isFinite(node.ratio) || node.ratio < 0.15 || node.ratio > 0.85) throw Error();
    return { type: node.type, id: node.id, ratio: node.ratio, first: visit(node.first, depth + 1), second: visit(node.second, depth + 1) };
  }
  try {
    const layout = visit(value, 0);
    return widgets.size === THREAD_PAGES.length ? layout : null;
  } catch { return null; }
}

export const layoutGroups = layout => layout.type === 'tabs' ? [layout] : [...layoutGroups(layout.first), ...layoutGroups(layout.second)];
export function updateLayoutNode(layout, id, update) {
  if (layout.id === id) return update(layout);
  return layout.type === 'tabs' ? layout : { ...layout, first: updateLayoutNode(layout.first, id, update), second: updateLayoutNode(layout.second, id, update) };
}
export const activateWidget = (layout, widget) => {
  const group = layoutGroups(layout).find(group => group.tabs.includes(widget));
  return group ? updateLayoutNode(layout, group.id, group => ({ ...group, active: widget })) : layout;
};

export function dockWidget(layout, widget, target, position, newId) {
  if (widget === target || !['tab', 'before', 'left', 'right', 'top', 'bottom'].includes(position)) return layout;
  const groups = layoutGroups(layout);
  if (!groups.some(group => group.tabs.includes(widget)) || !groups.some(group => group.tabs.includes(target))) return layout;
  function remove(node) {
    if (node.type === 'tabs') {
      const tabs = node.tabs.filter(id => id !== widget);
      return tabs.length ? { ...node, tabs, active: tabs.includes(node.active) ? node.active : tabs[0] } : null;
    }
    const first = remove(node.first), second = remove(node.second);
    return first && second ? { ...node, first, second } : first ?? second;
  }
  const next = remove(layout);
  const group = layoutGroups(next).find(group => group.tabs.includes(target));
  return updateLayoutNode(next, group.id, node => {
    if (position === 'tab' || position === 'before') {
      const tabs = [...node.tabs];
      tabs.splice(position === 'before' ? tabs.indexOf(target) : tabs.length, 0, widget);
      return { ...node, tabs, active: widget };
    }
    const panel = { type: 'tabs', id: newId, tabs: [widget], active: widget };
    const before = position === 'left' || position === 'top';
    return { type: ['left', 'right'].includes(position) ? 'row' : 'column', id: newId + '-split', ratio: 0.5,
      first: before ? panel : node, second: before ? node : panel };
  });
}
