import { h, useEffect, useRef, useState } from './runtime.js';
import { openExternal } from './common.js';
import { validateReview, reviewFields, reviewValueErrors, reviewUrl } from '../lib/thread-review.js';

function ReviewField({ field, value, path, prefix, error, onChange }) {
  const id = prefix + '-' + path, hint = field.hint;
  const props = { id, name: path, 'aria-label': field.label, 'aria-invalid': !!error,
    'aria-describedby': [hint && id + '-hint', error && id + '-error'].filter(Boolean).join(' ') || undefined,
    required: field.required, disabled: field.readOnly, maxLength: 16000,
    onChange: event => onChange(field.kind === 'boolean' ? event.target.checked : field.kind === 'number'
      ? event.target.value === '' || !Number.isFinite(event.target.valueAsNumber) ? null : event.target.valueAsNumber : event.target.value) };
  const input = field.kind === 'select' ? h('select', { ...props, value: value ?? '' },
    h('option', { value: '' }, 'Select…'), field.options.map(option => h('option', { key: option, value: option }, option)))
    : field.kind === 'textarea' ? h('textarea', { ...props, value: value ?? '', rows: 5 })
    : h('input', { ...props, type: { boolean: 'checkbox', number: 'number', date: 'date' }[field.kind] ?? 'text',
      ...(field.kind === 'boolean' ? { checked: value === true } : { value: value ?? '' }),
      ...(field.kind === 'number' ? { step: 'any', min: field.min, max: field.max } : {}) });
  return h('div', { className: 'bc-field bc-review-field' },
    h('label', { htmlFor: id }, field.label, field.required ? ' *' : ''), input,
    hint ? h('small', { id: id + '-hint', className: 'bc-muted' }, hint) : null,
    error ? h('small', { id: id + '-error', className: 'bc-review-invalid', role: 'alert' }, error) : null);
}

function ReviewTabs({ node, render, prefix, errors, reveal }) {
  const [selected, setSelected] = useState(0);
  const counts = node.children.map(child => {
    const keys = reviewFields(child).map(field => field.key);
    return Object.keys(errors).filter(path => keys.some(key => path === key || path.startsWith(key + '.'))).length;
  });
  useEffect(() => { const index = counts.findIndex(count => count > 0); if (index >= 0) setSelected(index); }, [reveal]);
  return h('section', { className: 'bc-review-tabs' },
    h('div', { role: 'tablist', 'aria-label': node.label ?? 'Review sections' }, node.children.map((child, index) =>
      h('button', { key: index, id: prefix + '-tab-' + index, type: 'button', role: 'tab', 'aria-selected': selected === index,
        'aria-controls': prefix + '-panel-' + index, tabIndex: selected === index ? 0 : -1,
        onClick: () => setSelected(index), onKeyDown: event => {
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? node.children.length - 1
            : event.key === 'ArrowRight' ? (index + 1) % node.children.length : event.key === 'ArrowLeft' ? (index + node.children.length - 1) % node.children.length : null;
          if (next === null) return; event.preventDefault(); setSelected(next);
          document.getElementById(prefix + '-tab-' + next)?.focus();
        } }, child.label, counts[index] ? ` (${counts[index]})` : ''))),
    node.children.map((child, index) => h('div', { key: index, id: prefix + '-panel-' + index, role: 'tabpanel',
      'aria-labelledby': prefix + '-tab-' + index, hidden: selected !== index }, render(child, prefix + '-' + index, true))));
}

export function ReviewScreen({ review, runId, act, readOnly = false, interrupted = false }) {
  const [values, setValues] = useState(() => structuredClone(review.values));
  const [revision, setRevision] = useState(review.revision), [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState({}), [reveal, setReveal] = useState(0);
  const [note, setNote] = useState(review.note ?? ''), [notice, setNotice] = useState(''), [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState(false), dialog = useRef(null), expandButton = useRef(null);
  useEffect(() => {
    if (!dirty) { setValues(structuredClone(review.values)); setRevision(review.revision); setNote(review.note ?? ''); }
  }, [review.revision, dirty]);
  useEffect(() => {
    if (!expanded) return;
    dialog.current.showModal();
    return () => expandButton.current?.focus();
  }, [expanded]);
  let invalid;
  try { validateReview(review.request); reviewValueErrors(review.request, review.values, false); } catch (error) { invalid = error.message; }
  if (invalid) return h('p', { role: 'alert' }, 'This review cannot be displayed: ', invalid);
  const request = review.request, closed = review.state !== 'open';
  const update = (key, value) => {
    setValues(current => ({ ...current, [key]: value })); setDirty(true); setNotice('');
    if (Object.keys(errors).length) {
      try { setErrors(reviewValueErrors(request, { ...values, [key]: value })); }
      catch (error) { setNotice(error.message); }
    }
  };
  const submit = async decision => {
    if (submitting || readOnly || closed) return;
    let nextErrors;
    try { nextErrors = reviewValueErrors(request, values, decision === 'approve'); }
    catch (error) { setNotice(error.message); return; }
    setErrors(nextErrors); setReveal(value => value + 1); setNotice('');
    if (Object.keys(nextErrors).length) return;
    setSubmitting(true);
    try {
      const result = await act('review', { runId, reviewId: review.id, revision, values, decision, note });
      if (!result) return;
      const saved = result.runs?.find(run => run.id === runId)?.reviews?.find(item => item.id === review.id);
      if (saved) { setValues(structuredClone(saved.values)); setRevision(saved.revision); }
      setDirty(false); setNotice(decision === 'save' ? 'Draft saved.' : 'Decision saved.');
    } catch (error) { setNotice(error.message); }
    finally { setSubmitting(false); }
  };
  const render = (node, prefix, hideLabel = false) => {
    const label = !hideLabel && node.label ? h('h4', null, node.label) : null;
    if (['stack', 'split', 'columns'].includes(node.type)) return h('section', { key: prefix, className: 'bc-review-group bc-review-' + node.type },
      label, h('div', null, node.children.map((child, index) => render(child, prefix + '-' + index))));
    if (node.type === 'tabs') return h(ReviewTabs, { key: prefix, node, render, prefix, errors, reveal });
    if (node.type === 'field') return h(ReviewField, { key: prefix, field: { ...node, readOnly: node.readOnly || readOnly || closed || submitting }, value: values[node.key], path: node.key,
      prefix: review.id, error: errors[node.key], onChange: value => update(node.key, value) });
    if (node.type === 'table') return h('section', { key: prefix, className: 'bc-review-table' }, label,
      h('div', { className: 'bc-review-table-scroll', tabIndex: 0, role: 'region', 'aria-label': node.label || 'Review table' },
        h('table', null, h('thead', null, h('tr', null, node.columns.map(column => h('th', { key: column.key, scope: 'col' }, column.label)))),
          h('tbody', null, values[node.key].map((row, index) => h('tr', { key: index }, node.columns.map(column => {
            const path = `${node.key}.${index}.${column.key}`;
            return h('td', { key: column.key }, node.editable ? h(ReviewField, { field: { ...column, readOnly: column.readOnly || readOnly || closed || submitting }, value: row[column.key], path,
              prefix: review.id, error: errors[path], onChange: value => update(node.key, values[node.key].map((item, i) => i === index ? { ...item, [column.key]: value } : item)) })
              : String(row[column.key] ?? '—'));
          })))))));
    if (node.type === 'diff') return h('section', { key: prefix }, label, h('div', { className: 'bc-review-diff' },
      h('div', null, h('strong', null, 'Before'), h('pre', null, node.before)), h('div', null, h('strong', null, 'Proposed'), h('pre', null, node.after))));
    if (node.type === 'sources') return h('section', { key: prefix }, label, node.items.map((item, index) =>
      h('article', { key: index, className: 'bc-review-source' }, item.url ? h('a', { href: reviewUrl(item.url), target: '_blank', rel: 'noopener noreferrer',
        onClick: event => { event.preventDefault(); void openExternal(reviewUrl(item.url)); } }, item.label) : h('strong', null, item.label),
        item.text ? h('p', null, item.text) : null)));
    return h('section', { key: prefix }, label, h('p', { className: 'bc-preserve' }, node.text));
  };
  const body = h('form', { className: 'bc-review', noValidate: true, 'aria-label': request.title, onSubmit: event => { event.preventDefault(); void submit('approve'); } },
    h('header', null, h('div', null, h('small', { className: 'bc-muted' }, closed ? review.state.replaceAll('_', ' ') : 'Your review'), h('h3', null, request.title)),
      h('button', { ref: expandButton, type: 'button', onClick: () => setExpanded(value => !value) }, expanded ? 'Close expanded view' : 'Expand review')),
    request.description ? h('p', { className: 'bc-preserve' }, request.description) : null,
    interrupted && !closed ? h('p', { role: 'status', className: 'bc-review-effect' }, 'This run was interrupted. Your edits and decision will be saved. After resolving the review, choose Continue or send a message below; external actions need fresh approval.') : null,
    dirty && revision !== review.revision ? h('p', { role: 'alert' }, 'Another saved version is available. ',
      h('button', { type: 'button', onClick: () => { setDirty(false); setErrors({}); } }, 'Reload saved values')) : null,
    render(request.view, review.id + '-view'),
    h('p', { className: 'bc-review-effect' }, h('strong', null, 'Approval permits: '), request.effect),
    request.action ? h('section', { className: 'bc-review-action' }, h('strong', null, 'External action: ', request.action.toolName),
      h('p', null, 'Approval applies once to this exact tool and these complete arguments.'), h('pre', null, JSON.stringify(values, null, 2))) : null,
    closed ? h('p', { role: 'status' }, `Decision: ${review.state.replaceAll('_', ' ')}${review.answeredAt ? ' · ' + new Date(review.answeredAt).toLocaleString() : ''}`, review.note ? ' · ' + review.note : '',
      review.resumeRequired ? ' · Choose Continue in Conversation or send a message to continue with fresh action checks.' : '') : readOnly ? h('p', { className: 'bc-muted' }, 'Only the thread owner can edit or decide this review.') : h('div', { className: 'bc-review-footer' },
      h('label', { className: 'bc-field' }, 'Feedback (optional)', h('textarea', { value: note, maxLength: 4000, rows: 2, disabled: submitting, onChange: event => { setNote(event.target.value); setDirty(true); setNotice(''); } })),
      Object.keys(errors).length ? h('p', { role: 'alert', className: 'bc-review-invalid' }, 'Correct the highlighted fields before approving.') : null,
      h('div', { className: 'bc-actions' },
        h('button', { type: 'button', disabled: submitting, onClick: () => void submit('save') }, 'Save draft'),
        h('button', { type: 'button', disabled: submitting, onClick: () => void submit('request_changes') }, 'Request changes'),
        h('button', { type: 'button', disabled: submitting, onClick: () => void submit('reject') }, 'Reject'),
        h('button', { type: 'submit', className: 'bc-primary', disabled: submitting || dirty && revision !== review.revision }, submitting ? 'Saving…' : 'Save and approve'))),
    notice ? h('p', { role: 'status' }, notice) : null);
  return expanded ? h('dialog', { ref: dialog, className: 'bc-review-dialog', 'aria-label': request.title, onCancel: event => { event.preventDefault(); setExpanded(false); } }, body)
    : h('section', { className: 'bc-review-card' }, body);
}
