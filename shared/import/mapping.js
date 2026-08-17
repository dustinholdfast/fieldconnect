export const MAX_IMPORT_ROWS = 2000;
export const EMAIL_RE = /^\S+@\S+\.\S+$/;

export const PERSON_FIELDS = [
  { value: 'first_name', label: 'Contact · first name' },
  { value: 'last_name', label: 'Contact · last name' },
  { value: 'email', label: 'Contact · email (match key)' },
  { value: 'phone', label: 'Contact · phone' },
  { value: 'postal_code', label: 'Contact · postal code' },
  { value: 'source_notes', label: 'Contact · source notes' },
  { value: 'tag', label: 'Tag' },
  { value: 'ignore', label: 'Ignore' },
];

export const PERSON_FIELD_VALUES = new Set(PERSON_FIELDS.map((f) => f.value));

const HEADER_ALIASES = [
  [/^e-?mails?$/i, 'email'],
  [/^email[_\s-]?address$/i, 'email'],
  [/^first[_\s-]?name$/i, 'first_name'],
  [/^last[_\s-]?name$/i, 'last_name'],
  [/^given[_\s-]?name$/i, 'first_name'],
  [/^surname|family[_\s-]?name$/i, 'last_name'],
  [/^(mobile|phone|cell|telephone|tel)$/i, 'phone'],
  [/^(zip|zip[_\s-]?code|postal|postal[_\s-]?code)$/i, 'postal_code'],
  [/^(notes?|source[_\s-]?notes?|comments?)$/i, 'source_notes'],
  [/^(tag|tags|interest|interests)$/i, 'ignore'],
];

export function suggestField(header) {
  const raw = String(header ?? '').trim();
  if (!raw) return 'ignore';
  if (PERSON_FIELD_VALUES.has(raw) && raw !== 'ignore') return raw;
  for (const [re, field] of HEADER_ALIASES) {
    if (re.test(raw)) return field;
  }
  return 'ignore';
}

export function suggestMapping(columns) {
  const mapping = {};
  for (const col of columns || []) mapping[col] = suggestField(col);
  return mapping;
}

export function mappingHasEmail(mapping) {
  return Object.values(mapping || {}).includes('email');
}

export function normalizeMapping(input, columns) {
  const mapping = {};
  const cols = columns || Object.keys(input || {});
  for (const col of cols) {
    const raw = input && input[col];
    mapping[col] = PERSON_FIELD_VALUES.has(raw) ? raw : 'ignore';
  }
  return mapping;
}

export function applyMapping(raw, mapping) {
  const out = {
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    postal_code: '',
    source_notes: '',
    tag: '',
  };
  for (const [col, field] of Object.entries(mapping || {})) {
    if (!field || field === 'ignore' || !Object.prototype.hasOwnProperty.call(out, field)) continue;
    const val = raw ? raw[col] : '';
    if (val == null || String(val).trim() === '') continue;
    const text = String(val).trim();
    if (field === 'source_notes' || field === 'tag') {
      out[field] = out[field] ? `${out[field]}; ${text}` : text;
    } else {
      out[field] = text;
    }
  }
  return out;
}

export function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '');
}

export function phoneKey(value) {
  const digits = digitsOnly(value);
  if (digits.length < 10) return '';
  return digits.slice(-10);
}
