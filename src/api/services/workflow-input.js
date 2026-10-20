const { ValidationError } = require('../errors');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function uuid(value, field = 'id') {
  if (typeof value !== 'string' || !UUID.test(value)) throw new ValidationError(`${field} must be a UUID.`);
  return value.toLowerCase();
}
function text(value, field, max = 300, required = true) {
  if (!required && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ValidationError(`${field} is required, must be plain text and at most ${max} characters.`);
  }
  return value.trim();
}
function fields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('JSON object required.');
  for (const key of Object.keys(body)) if (!allowed.includes(key)) throw new ValidationError(`Unsupported field: ${key}.`);
}
function https(value) {
  if (!value) return null;
  const normalized = text(value, 'url', 2048);
  let url;
  try { url = new URL(normalized); } catch { throw new ValidationError('Document URL must be HTTPS.'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new ValidationError('Document URL must be HTTPS without embedded credentials.');
  return url.href;
}
function references(items) {
  if (!Array.isArray(items) || items.length > 30) throw new ValidationError('At most 30 document references are allowed.');
  const seen = new Set();
  return items.map(item => {
    fields(item, ['requirement_id','filename','format','reference','url']);
    const id = text(item.requirement_id, 'requirement_id', 80);
    if (seen.has(id)) throw new ValidationError('Duplicate document requirement.');
    seen.add(id);
    const reference = text(item.reference, 'reference', 300, false);
    const url = https(item.url);
    if (!reference && !url) throw new ValidationError('A document reference number or HTTPS URL is required.');
    return { requirement_id: id, filename: text(item.filename, 'filename', 255),
      format: text(item.format, 'format', 40).toLowerCase(), reference, url };
  });
}
function requirements(items) {
  if (!Array.isArray(items) || items.length > 30) throw new ValidationError('At most 30 requirements are allowed.');
  const seen = new Set();
  return items.map(item => {
    fields(item, ['id','title','required','filename_pattern','format']);
    const id = text(item.id, 'id', 80);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || seen.has(id)) throw new ValidationError('Requirement IDs must be unique simple identifiers.');
    seen.add(id);
    if (typeof item.required !== 'boolean') throw new ValidationError('required must be a boolean.');
    const format = text(item.format, 'format', 40, false)?.toLowerCase() || null;
    if (format && !/^[a-z0-9]+$/.test(format)) throw new ValidationError('format must be a filename extension.');
    // Literal filename template only; no user-controlled regular expression execution.
    return { id, title: text(item.title, 'title', 200), required: item.required,
      filename_pattern: text(item.filename_pattern, 'filename_pattern', 255, false), format };
  });
}
function validateReferences(policy, items, studentNumber) {
  for (const item of items) {
    const rule = policy.requirements.find(r => r.id === item.requirement_id);
    if (!rule) throw new ValidationError('Unknown document requirement.');
    if (rule.format && (item.format !== rule.format || !item.filename.toLowerCase().endsWith(`.${rule.format}`))) throw new ValidationError(`Document format does not match: ${rule.title}.`);
    if (rule.filename_pattern && item.filename !== rule.filename_pattern.replaceAll('{student_number}', studentNumber)) throw new ValidationError(`Filename does not match: ${rule.title}.`);
  }
  for (const rule of policy.requirements) if (rule.required && !items.some(i => i.requirement_id === rule.id)) throw new ValidationError(`Missing document reference: ${rule.title}.`);
}
function command(body) {
  uuid(body.operation_id, 'operation_id');
  if (!Number.isInteger(body.expected_version) || body.expected_version < 0) throw new ValidationError('expected_version must be a nonnegative integer.');
}
module.exports = { uuid, text, fields, https, references, requirements, validateReferences, command };
