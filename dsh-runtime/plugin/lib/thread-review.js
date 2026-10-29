// This contract is shared by the renderer and the runtime; screens contain data, never code.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keyPattern = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const string = (value, max = 4000) => typeof value === 'string' && value.length <= max;
const fail = message => { throw new Error(message); };
const keys = (value, allowed) => {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('Unsupported review property.');
};
export const reviewUrl = value => {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
};

export function reviewFields(view) {
  if (view.type === 'field' || view.type === 'table') return [view];
  return (view.children ?? []).flatMap(reviewFields);
}

export function validateReview(request) {
  keys(request, ['title', 'description', 'effect', 'view', 'values', 'action']);
  if (!string(request.title, 180) || !request.title.trim() || !string(request.effect) || !request.effect.trim()
    || request.description !== undefined && !string(request.description)) fail('Give the review a title and explain what approval permits.');
  if (JSON.stringify(request).length > 64000) fail('Keep the review under 64 KB.');
  if (request.action !== undefined) {
    keys(request.action, ['toolName']);
    if (!/^mcp__[\w-]+__[\w-]+$/.test(request.action.toolName ?? '')) fail('Choose an exact MCP action tool.');
  }
  let count = 0;
  const fields = new Set();
  const field = (node, column = false) => {
    keys(node, ['type', 'key', 'label', 'kind', 'hint', 'required', 'readOnly', 'options', 'min', 'max']);
    if (!keyPattern.test(node.key) || forbidden.has(node.key) || !string(node.label, 180) || !node.label.trim()
      || !['text', 'textarea', 'number', 'date', 'boolean', 'select'].includes(node.kind)) fail('Invalid review field.');
    if (node.hint !== undefined && !string(node.hint)) fail('Invalid field hint.');
    for (const flag of ['required', 'readOnly']) if (node[flag] !== undefined && typeof node[flag] !== 'boolean') fail('Invalid field setting.');
    for (const bound of ['min', 'max']) if (node[bound] !== undefined && (node.kind !== 'number' || !Number.isFinite(node[bound]))) fail('Invalid numeric bound.');
    if (node.min !== undefined && node.max !== undefined && node.min > node.max) fail('Invalid numeric bounds.');
    if (node.kind === 'select' && (!Array.isArray(node.options) || !node.options.length || node.options.length > 100
      || node.options.some(option => !string(option, 200) || !option) || new Set(node.options).size !== node.options.length)) fail('Give each select field distinct choices.');
    if (node.kind !== 'select' && node.options !== undefined) fail('Only select fields accept choices.');
    if (!column) {
      if (fields.has(node.key)) fail('Review field keys must be unique.');
      fields.add(node.key);
    }
  };
  const visit = (node, depth = 0) => {
    if (!object(node) || ++count > 120 || depth > 6) fail('The review screen is too large or deeply nested.');
    if (['stack', 'columns', 'split', 'tabs'].includes(node.type)) {
      keys(node, ['type', 'label', 'children']);
      if (node.label !== undefined && !string(node.label, 180)) fail('Invalid section label.');
      if (!Array.isArray(node.children) || !node.children.length || node.children.length > 12
        || node.type === 'split' && node.children.length !== 2) fail('Invalid review layout.');
      if (node.type === 'tabs' && node.children.some(child => !string(child?.label, 180) || !child.label.trim())) fail('Give every tab a label.');
      node.children.forEach(child => visit(child, depth + 1));
    } else if (node.type === 'field') field(node);
    else if (node.type === 'table') {
      keys(node, ['type', 'key', 'label', 'columns', 'editable']);
      if (!keyPattern.test(node.key) || forbidden.has(node.key) || fields.has(node.key) || !string(node.label, 180)
        || !Array.isArray(node.columns) || !node.columns.length || node.columns.length > 20
        || node.editable !== undefined && typeof node.editable !== 'boolean') fail('Invalid review table.');
      fields.add(node.key);
      node.columns.forEach(column => field(column, true));
      if (new Set(node.columns.map(column => column.key)).size !== node.columns.length) fail('Table columns must be unique.');
    } else if (node.type === 'text') {
      keys(node, ['type', 'label', 'text']);
      if (!string(node.text, 16000)) fail('Invalid review text.');
    } else if (node.type === 'diff') {
      keys(node, ['type', 'label', 'before', 'after']);
      if (!string(node.before, 16000) || !string(node.after, 16000)) fail('Invalid comparison.');
    } else if (node.type === 'sources') {
      keys(node, ['type', 'label', 'items']);
      if (!Array.isArray(node.items) || node.items.length > 30) fail('Invalid review sources.');
      for (const item of node.items) {
        keys(item, ['label', 'url', 'text']);
        if (!string(item.label, 180) || !item.label.trim() || item.text !== undefined && !string(item.text, 8000)
          || item.url !== undefined && !reviewUrl(item.url)) fail('Use a source label and an HTTP or HTTPS link.');
      }
    } else fail('Unsupported review component.');
    if (node.label !== undefined && !string(node.label, 180)) fail('Invalid component label.');
  };
  visit(request.view);
  reviewValueErrors(request, request.values, false);
  return request;
}

// Drafts may be incomplete. Shape, types and read-only values are always enforced.
export function reviewValueErrors(request, values, complete = true) {
  if (!object(values) || JSON.stringify(values).length > 64000) fail('Invalid review values.');
  const fields = reviewFields(request.view), known = new Set(fields.map(field => field.key));
  if (Object.keys(values).some(key => !known.has(key))) fail('The review contains unknown fields.');
  const errors = {};
  const check = (field, value, path, original, readOnly = false) => {
    if ((field.readOnly || readOnly) && JSON.stringify(value) !== JSON.stringify(original)) fail('Read-only review values cannot change.');
    const empty = value === undefined || value === null || value === '';
    if (empty) { if (complete && field.required) errors[path] = 'This field is required.'; return; }
    if (field.kind === 'number' ? typeof value !== 'number' || !Number.isFinite(value)
      : field.kind === 'boolean' ? typeof value !== 'boolean' : !string(value, 16000)) fail('Invalid value for ' + field.label + '.');
    if (!complete) return;
    if (field.kind === 'select' && !field.options.includes(value)) errors[path] = 'Choose one of the listed options.';
    if (field.kind === 'date') {
      const parsed = Date.parse(value + 'T00:00:00Z');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) errors[path] = 'Enter a valid date.';
    }
    if (field.kind === 'number' && (field.min !== undefined && value < field.min || field.max !== undefined && value > field.max)) errors[path] = 'Enter a number within the allowed range.';
    if (field.required && typeof value === 'string' && !value.trim()) errors[path] = 'This field is required.';
  };
  for (const field of fields) {
    const value = values[field.key], original = request.values[field.key];
    if (field.type !== 'table') { check(field, value, field.key, original); continue; }
    if (!Array.isArray(value) || value.length > 100 || value.length !== original?.length) fail('Keep the original review table rows.');
    if (!field.editable && JSON.stringify(value) !== JSON.stringify(original)) fail('Read-only tables cannot change.');
    value.forEach((row, index) => {
      if (!object(row) || Object.keys(row).some(key => !field.columns.some(column => column.key === key))) fail('Invalid table row.');
      for (const column of field.columns) check(column, row[column.key], `${field.key}.${index}.${column.key}`, original[index]?.[column.key], !field.editable);
    });
  }
  return errors;
}
