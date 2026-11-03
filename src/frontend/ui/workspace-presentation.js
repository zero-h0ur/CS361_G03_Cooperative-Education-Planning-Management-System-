/** Decorative code-native icons; permissions and page data remain in their existing layers. */
const ICON_PATHS = Object.freeze({
  return: ['M9 7 4 12l5 5','M4 12h10a6 6 0 0 1 0 12'],
  user: ['M20 21v-2a7 7 0 0 0-14 0v2', 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0'],
  file: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M8 13h8M8 17h6'],
  building: ['M3 21h18M5 21V7l7-4 7 4v14M9 21v-4h6v4', 'M9 9h.01M15 9h.01M9 13h.01M15 13h.01'],
  check: ['M20 6 9 17l-5-5'],
  copy: ['M9 9h12v12H9z', 'M5 15H3V3h12v2'],
  arrow: ['M4 12h16', 'm14 6 6 6-6 6'],
  plus: ['M12 4v16M4 12h16'],
  logout: ['M9 4H4v16h5', 'M10 12h11m-5-5 5 5-5 5'],
  help: ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', 'M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4M12 17h.01'],
  mail: ['M3 5h18v14H3z', 'm3 5 9 7 9-7'],
  phone: ['M5 3h4l2 5-3 2a15 15 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A18 18 0 0 1 3 5a2 2 0 0 1 2-2'],
  image: ['M3 3h18v18H3z', 'm3 17 6-6 4 4 3-3 5 5', 'M16 7h.01'],
  save: ['M19 21H5a2 2 0 0 1-2-2V3h16l2 2v14a2 2 0 0 1-2 2z', 'M7 3v6h10V3M7 21v-8h10v8'],
  clipboard: ['M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3', 'M9 2h6v4H9z', 'M8 14l3 3 5-6'],
  send: ['m22 2-7 20-4-9-9-4z', 'M22 2 11 13'],
  clock: ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', 'M12 6v6l4 2'],
  edit: ['m16 3 5 5-12 12-6 1 1-6z', 'm14 5 5 5'],
  lock: ['M5 10h14v11H5z', 'M8 10V6a4 4 0 0 1 8 0v4', 'M12 14v3'],
  refresh: ['M20 7a9 9 0 1 0 1 9', 'M20 2v5h-5'],
  warning: ['m12 3 10 18H2z', 'M12 9v4M12 17h.01']
});

export function createWorkspaceIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'workspace-icon');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const data of ICON_PATHS[name] || ICON_PATHS.file) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', data);
    svg.append(path);
  }
  return svg;
}

/** Wrap existing content without replacing inputs, handlers or accessibility hooks. */
export function decorateStudentCard(card, icon) {
  const content = document.createElement('div');
  content.className = 'student-card__body';
  content.append(...Array.from(card.childNodes));
  const badge = document.createElement('span');
  badge.className = 'student-card__icon';
  badge.setAttribute('aria-hidden', 'true');
  badge.append(createWorkspaceIcon(icon));
  card.classList.add('student-card--illustrated');
  card.append(badge, content);
  return card;
}
