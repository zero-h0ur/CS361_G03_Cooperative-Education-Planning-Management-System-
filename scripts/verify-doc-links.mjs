import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = fileURLToPath(new URL('../', import.meta.url));

// Intentionally offline. Validate local files/Markdown fragments recursively,
// not HTTP availability, authentication, deployed state or arbitrary HTML IDs.
function visibleMarkdown(text) {
  let fence = null;
  return text.replace(/<!--[\s\S]*?-->/g, value => value.replace(/[^\n]/g, ' '))
    .split('\n').map(line => {
      const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (match) {
        if (!fence) fence = match[1];
        else if (match[1][0] === fence[0] && match[1].length >= fence.length) fence = null;
        return '';
      }
      return fence ? '' : line;
    });
}

export function markdownAnchors(text) {
  const used = new Set();
  for (const line of visibleMarkdown(text)) {
    const match = /^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
    if (!match) continue;
    const base = match[1].replace(/<[^>]*>/g, '').replace(/[`*~]/g, '').toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
    let anchor = base, suffix = 0;
    while (used.has(anchor)) anchor = `${base}-${++suffix}`;
    used.add(anchor);
  }
  return used;
}

export function markdownLinks(text) {
  const lines = visibleMarkdown(text).map(line => line.replace(/(`+).*?\1/g, ''));
  const definitions = new Map(), links = [];
  const key = value => value.trim().replace(/\s+/g, ' ').toLowerCase();
  for (const line of lines) {
    const match = /^ {0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/.exec(line);
    if (match) definitions.set(key(match[1]), match[2] || match[3]);
  }
  lines.forEach((line, index) => {
    if (/^ {0,3}\[[^\]]+\]:/.test(line)) return;
    for (const match of line.matchAll(/!?\[[^\]\n]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/g)) {
      links.push({ target: match[1] || match[2], line: index + 1 });
    }
    for (const match of line.matchAll(/!?\[([^\]\n]+)\]\[([^\]\n]*)\]/g)) {
      const id = key(match[2] || match[1]);
      links.push({ target: definitions.get(id), line: index + 1, reference: id });
    }
    for (const match of line.matchAll(/<(https?:\/\/[^\s>]+)>/g)) {
      links.push({ target: match[1], line: index + 1 });
    }
  });
  return links;
}

function contained(root, path) {
  const location = relative(root, path);
  return location !== '..' && !location.startsWith(`..${sep}`) && !isAbsolute(location);
}

export async function checkDocuments({ root = workspace,
  entries = ['README.md', 'CONTRIBUTING.md', '.github/pull_request_template.md'] } = {}) {
  root = await realpath(root);
  const queue = entries.map(path => resolve(root, path));
  const visited = new Set(), errors = [];
  let localLinks = 0, externalLinks = 0;
  while (queue.length) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    const label = relative(root, file);
    if (!contained(root, file)) { errors.push(`${label}: document outside repository`); continue; }
    let text;
    try {
      if (!contained(root, await realpath(file))) throw new Error('outside root');
      text = await readFile(file, 'utf8');
    } catch { errors.push(`${label}: missing/unreadable document`); continue; }
    for (const link of markdownLinks(text)) {
      const fail = reason => errors.push(`${label}:${link.line}: ${reason}`);
      if (!link.target) { fail(`undefined link reference ${link.reference}`); continue; }
      const target = link.target;
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
        try {
          const url = new URL(target);
          if (!['https:', 'http:', 'mailto:'].includes(url.protocol) || url.username || url.password) throw new Error('unsafe');
          externalLinks++;
        } catch { fail('invalid/unsafe external URL (value withheld)'); }
        continue;
      }
      if (target.startsWith('//') || isAbsolute(target)) { fail('absolute/protocol-relative link is not a repository path'); continue; }
      let path, anchor;
      try {
        const hash = target.indexOf('#');
        const resource = hash < 0 ? target : target.slice(0, hash);
        anchor = hash < 0 ? '' : decodeURIComponent(target.slice(hash + 1));
        path = resolve(dirname(file), decodeURIComponent(resource.split('?')[0]) || '');
        if (!resource) path = file;
      } catch { fail('malformed URL encoding'); continue; }
      if (!contained(root, path)) { fail('link escapes repository'); continue; }
      try {
        if (!contained(root, await realpath(path))) { fail('link resolves outside repository'); continue; }
        const info = await stat(path);
        if (info.isFile() && extname(path).toLowerCase() === '.md') {
          if (anchor && !markdownAnchors(await readFile(path, 'utf8')).has(anchor)) {
            fail(`missing Markdown anchor #${anchor} in ${relative(root, path)}`);
          }
          queue.push(path);
        }
        localLinks++;
      } catch { fail(`missing local target ${relative(root, path)}`); }
    }
  }
  return { documents: visited.size, localLinks, externalLinks, errors };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkDocuments();
  for (const error of result.errors) console.error(error);
  console.log(JSON.stringify({ documents: result.documents, localLinks: result.localLinks,
    externalLinksSyntaxOnly: result.externalLinks, failures: result.errors.length,
    networkRequests: 0 }, null, 2));
  if (result.errors.length) process.exitCode = 1;
}
