import { createWorkspaceIcon } from '../ui/workspace-presentation.js';

export function studentElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

export function studentLink(label, href, { onNavigate, className = 'student-link', icon } = {}) {
  const link = studentElement('a', className, label);
  link.href = href;
  if (icon) link.prepend(createWorkspaceIcon(icon));
  link.addEventListener('click', event => {
    if (onNavigate && href.startsWith('#/') && event.button === 0 &&
        !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      onNavigate(href);
    }
  });
  return link;
}

export function renderStudentPageHeader({ title, description, back, meta } = {}) {
  const header = studentElement('header', 'student-page-header');
  const art = studentElement('img', 'student-campus-backdrop student-page-header__art');
  art.src = 'resources/images/student-campus-banner.png';
  art.alt = '';
  art.width = 2172;
  art.height = 724;
  art.decoding = 'async';
  art.setAttribute('aria-hidden', 'true');
  const inner = studentElement('div', 'student-page-header__inner');
  if (back) inner.append(back);
  inner.append(studentElement('h1', 'student-page-header__title', title));
  if (description) inner.append(studentElement('p', 'student-page-header__description', description));
  if (meta) inner.append(meta);
  header.append(art, inner);
  return header;
}

export function formatStudentDate(value, { time = false } = {}) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return null;
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium', ...(time ? { timeStyle: 'short' } : {}), timeZone: 'Asia/Bangkok'
  }).format(new Date(value));
}

export function renderStudentCard(title, { icon, className = '' } = {}) {
  const section = studentElement('section', `student-record-card ${className}`.trim());
  const heading = studentElement('div', 'student-record-card__heading');
  if (icon) heading.append(createWorkspaceIcon(icon));
  heading.append(studentElement('h2', '', title));
  section.append(heading);
  return section;
}
