import { h, useEffect, useRef, useState, MarkdownText } from './runtime.js';
import { droppedFiles, when } from './common.js';

const mediaTypes = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon',
  pdf: 'application/pdf', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
};

export async function readFilePreview(file, signal) {
  const response = await fetch(file.url, { signal });
  if (!response.ok) throw Error('File has not arrived yet');
  const bytes = await response.arrayBuffer();
  const extension = file.name.split('.').pop().toLowerCase(), type = mediaTypes[extension];
  if (type) return { type, blob: new Blob([bytes], { type }) };
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (/[\x00-\x08\x0e-\x1f]/.test(text)) return {};
    return { type: /^(html?|md|markdown)$/.test(extension) ? extension : 'text', text };
  } catch { return {}; }
}

function FilePreview({ file }) {
  const [content, setContent] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let url;
    readFilePreview(file, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      if (value.blob) url = URL.createObjectURL(value.blob);
      setContent({ ...value, url });
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [file.url]);
  if (error) return h('p', { role: 'alert' }, error);
  if (!content) return h('p', { role: 'status' }, 'Loading preview…');
  if (content.text === '') return h('p', { className: 'bc-muted' }, 'This file is empty.');
  // a damaged file or a codec chrome cannot play would show a broken icon or a dead player
  const failed = () => setContent({});
  if (content.type?.startsWith('image/')) return h('img', { src: content.url, alt: file.name, onError: failed });
  if (content.type?.startsWith('audio/')) return h('audio', { src: content.url, controls: true, 'aria-label': file.name, onError: failed });
  if (content.type?.startsWith('video/')) return h('video', { src: content.url, controls: true, 'aria-label': file.name, onError: failed });
  if (content.type === 'application/pdf') return h('iframe', { src: content.url, title: file.name });
  if (/^html?$/.test(content.type)) return h('iframe', { srcDoc: content.text, sandbox: '', referrerPolicy: 'no-referrer', title: file.name });
  if (['md', 'markdown'].includes(content.type)) return h(MarkdownText, { text: content.text, content: content.text });
  if (content.type === 'text') return h('pre', { className: 'bc-preview' }, content.text);
  return h('p', { className: 'bc-muted' }, 'This file can\'t be previewed here. Download it to open it in its application.');
}

const outputNote = file => [file.path, file.createdAt && when(file.createdAt)].filter(part => part && part !== file.name).join(' · ');

export function ThreadFiles({ thread, canWrite, busy, onAttach, onPreview, preview, onClosePreview }) {
  const [folder, setFolder] = useState('');
  const fileInput = useRef(), folderInput = useRef();
  const prefix = folder ? folder + '/' : '';
  const inputs = thread.artifacts.filter(file => file.authorId !== 'bees');
  const outputs = thread.artifacts.filter(file => file.authorId === 'bees');
  const directories = new Set();
  for (const path of thread.folders ?? []) {
    if (path.startsWith(prefix) && path !== folder) directories.add(path.slice(prefix.length).split('/')[0]);
  }
  for (const file of inputs) {
    const path = file.path ?? file.name;
    if (path.startsWith(prefix) && path.slice(prefix.length).includes('/')) directories.add(path.slice(prefix.length).split('/')[0]);
  }
  const files = inputs.filter(file => {
    const path = file.path ?? file.name;
    return path.startsWith(prefix) && !path.slice(prefix.length).includes('/');
  });
  const upload = event => { const files = [...event.target.files]; event.target.value = ''; void onAttach(files, prefix); };
  const fileButton = file => h('button', { className: 'bc-file' + (file.authorId === 'bees' ? ' bc-file-output' : ''), key: file.id, 'aria-pressed': preview?.id === file.id, onClick: () => onPreview(file) },
    h('span', null, h('strong', null, file.name), h('small', null, file.size < 1024 ? `${file.size} B` : file.size < 1048576 ? `${(file.size / 1024).toFixed(1)} KB` : `${(file.size / 1048576).toFixed(1)} MB`),
      file.authorId === 'bees' && outputNote(file) ? h('small', null, outputNote(file)) : null));
  return h('section', { className: 'bc-files' },
    h('div', { className: 'bc-form bc-files-list' },
    h('div', { className: 'bc-file-groups' },
      h('section', { className: 'bc-form', 'aria-label': 'Input files',
        onDragOver: event => { if (canWrite && !busy && event.dataTransfer.types.includes('Files')) event.preventDefault(); },
        onDrop: event => { const dropped = canWrite && !busy ? droppedFiles(event) : []; if (dropped.length) { event.preventDefault(); void onAttach(dropped, prefix); } } },
        h('div', { className: 'bc-actions bc-files-toolbar' },
          h('h3', null, 'Input files'),
          h('nav', { className: 'bc-actions bc-breadcrumbs', 'aria-label': 'Folder path' },
            h('button', { onClick: () => setFolder('') }, 'All files'),
            ...(folder ? folder.split('/') : []).map((part, i, all) => h('button', { key: i, onClick: () => setFolder(all.slice(0, i + 1).join('/')) }, part))),
          h('input', { ref: fileInput, type: 'file', multiple: true, hidden: true, onChange: upload }),
          h('input', { ref: folderInput, type: 'file', multiple: true, webkitdirectory: '', hidden: true, onChange: upload }),
          h('button', { disabled: !canWrite || busy, onClick: () => fileInput.current.click() }, 'Add files'),
          h('button', { disabled: !canWrite || busy, onClick: () => folderInput.current.click() }, 'Add folder')),
        ...[...directories].sort().map(name => h('button', { className: 'bc-file bc-folder-entry', key: name, onClick: () => setFolder(prefix + name) },
          h('svg', { className: 'bc-folder-icon', width: 16, height: 16, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true }, h('path', { d: 'M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z' })),
          h('strong', null, name))),
        ...files.map(fileButton),
        !directories.size && !files.length ? h('p', { className: 'bc-muted' }, canWrite ? 'This folder is empty. Add files or a folder to give Bees context.' : 'This folder is empty.') : null),
      h('section', { className: 'bc-form', 'aria-label': 'Output files' },
        h('h3', null, 'Output files'),
        ...outputs.map(fileButton),
        !outputs.length ? h('p', { className: 'bc-muted' }, 'No output files yet. Files Bees creates will appear here.') : null))),
    h('section', { className: 'bc-file-preview', 'aria-label': 'File preview' },
      h('div', { className: 'bc-preview-heading' }, h('h3', null, preview?.name ?? 'File preview'),
        preview ? h('div', { className: 'bc-actions' },
          h('a', { className: 'bc-download', href: preview.url, download: preview.name }, 'Download file'),
          h('button', { type: 'button', onClick: onClosePreview }, 'Close preview')) : null),
      h('div', { className: 'bc-preview-body', tabIndex: 0, 'aria-label': 'File contents' },
        preview ? h(FilePreview, { key: preview.url, file: preview }) : h('p', { className: 'bc-muted' }, 'Select a file above to preview it here.'))));
}
