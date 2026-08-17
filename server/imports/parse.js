import { parse } from 'csv-parse/sync';
import { MAX_IMPORT_ROWS } from '../../shared/import/mapping.js';

export class ImportRowLimitError extends Error {
  constructor() {
    super('import_row_limit');
    this.code = 'import_row_limit';
  }
}

export function isXlsx(filename, mimetype, buffer) {
  const name = String(filename || '').toLowerCase();
  if (/\.xlsx?$/.test(name)) return true;
  // Windows often sends application/vnd.ms-excel for a real .csv.
  if (name.endsWith('.csv')) return false;
  const mime = String(mimetype || '').toLowerCase();
  if (mime.includes('spreadsheet') || mime.includes('excel')) return true;
  if (buffer && buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
    return true;
  }
  return false;
}

export function parseCsv(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer ?? '');
  const records = parse(text, {
    columns: false,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
    bom: true,
    relax_quotes: true,
  });
  if (!records.length) return { columns: [], rows: [] };
  const columns = records[0].map((c) => String(c ?? ''));
  const data = records.slice(1);
  if (data.length > MAX_IMPORT_ROWS) throw new ImportRowLimitError();
  return { columns, rows: data };
}

export function rowObject(columns, values) {
  const obj = {};
  for (let i = 0; i < columns.length; i += 1) {
    obj[columns[i]] = values[i] == null ? '' : String(values[i]);
  }
  return obj;
}

export function sampleRows(rows, n = 5) {
  return (rows || []).slice(0, n).map((r) => (Array.isArray(r) ? r.map((v) => (v == null ? '' : String(v))) : r));
}
