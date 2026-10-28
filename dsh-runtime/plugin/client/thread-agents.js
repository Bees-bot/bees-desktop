import { h, useState } from './runtime.js';
import { REASONING_EFFORTS } from '../lib/thread-agents.js';
import { confirmAction } from './common.js';

export function TeamAgents({ team, models = [], presets = [], canManage, busy, onSave }) {
  const [editing, setEditing] = useState(null);
  const agents = team.agents ?? [];
  const change = (key, value) => setEditing({ ...editing, [key]: value });
  const field = (label, child) => h('label', { className: 'bc-field' }, h('span', null, label), child);
  const availablePresets = presets.length ? presets : [{ id: 'standard', name: 'Standard' }];
  return h('section', { className: 'bc-form' }, h('h3', null, 'Team agents'),
    h('p', { className: 'bc-muted' }, 'Create agents with their own instructions, AI model and add-ons. Assign them to stages in Processes.'),
    agents.map(agent => h('article', { key: agent.id, className: 'bc-card bc-form' },
      h('strong', null, agent.name), h('small', null, `${agent.enabled ? 'Enabled' : 'Disabled'} · ${agent.model || 'Default AI'} · ${agent.presetId}`),
      agent.instructions ? h('p', null, agent.instructions) : null,
      canManage ? h('div', { className: 'bc-actions' },
        h('button', { disabled: busy, onClick: () => setEditing({ ...agent }) }, 'Edit'),
        h('button', { disabled: busy, onClick: async () => {
          if (await confirmAction(`Delete ${agent.name}? Existing execution history stays. Processes using this agent will need another agent before they can run.`)) {
            if (await onSave(agents.filter(row => row.id !== agent.id))) setEditing(null);
          }
        } }, 'Delete')) : null)),
    canManage ? h('button', { disabled: busy, onClick: () => setEditing({ id: crypto.randomUUID(), name: '', presetId: 'standard', instructions: '', model: '', reasoningEffort: '', enabled: true, mcpAccess: 'all', mcpServers: [] }) }, 'Create agent') : null,
    editing ? h('form', { className: 'bc-form', onSubmit: async event => {
      event.preventDefault(); if (busy || !canManage) return;
      const next = { ...editing, name: editing.name.trim() };
      if (await onSave(agents.some(row => row.id === next.id) ? agents.map(row => row.id === next.id ? next : row) : [...agents, next])) setEditing(null);
    } }, h('fieldset', { disabled: busy || !canManage, className: 'bc-fieldset bc-form' },
      field('Agent name', h('input', { value: editing.name, required: true, maxLength: 120, onChange: event => change('name', event.target.value) })),
      field('Preset', h('select', { value: editing.presetId, onChange: event => change('presetId', event.target.value) },
        !availablePresets.some(row => row.id === editing.presetId) ? h('option', { value: editing.presetId }, editing.presetId + ' (unavailable here)') : null,
        availablePresets.map(preset => h('option', { key: preset.id, value: preset.id }, preset.name ?? preset.id)))),
      field('AI model', h('select', { value: editing.model, onChange: event => change('model', event.target.value) },
        h('option', { value: '' }, 'Use default AI'),
        editing.model && !models.some(row => row.id === editing.model) ? h('option', { value: editing.model }, editing.model + ' (not connected)') : null,
        models.map(model => h('option', { key: model.id, value: model.id }, model.name)))),
      field('Reasoning effort', h('select', { value: editing.reasoningEffort, onChange: event => change('reasoningEffort', event.target.value) }, REASONING_EFFORTS.map(value => h('option', { key: value, value }, value || 'Model default')))),
      field('Instructions', h('textarea', { rows: 5, maxLength: 20000, value: editing.instructions, onChange: event => change('instructions', event.target.value) })),
      field('Add-on access', h('select', { value: editing.mcpAccess, onChange: event => change('mcpAccess', event.target.value) }, ['all','none','selected'].map(value => h('option', { key: value, value }, ({ all: 'All team add-ons', none: 'No add-ons', selected: 'Selected add-ons' })[value])))),
      editing.mcpAccess === 'selected' ? field('Server names, separated by commas', h('input', { key: editing.id, defaultValue: editing.mcpServers.join(', '), onChange: event => change('mcpServers', event.target.value.split(',').map(name => name.trim()).filter(Boolean)) })) : null,
      h('label', { className: 'bc-check' }, h('input', { type: 'checkbox', checked: editing.enabled, onChange: event => change('enabled', event.target.checked) }), 'Enabled'),
      h('div', { className: 'bc-actions' }, h('button', { type: 'submit', className: 'bc-primary' }, 'Save agent'), h('button', { type: 'button', onClick: () => setEditing(null) }, 'Cancel')))) : null);
}
