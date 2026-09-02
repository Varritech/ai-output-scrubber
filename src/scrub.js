'use strict';

// Extract the largest fenced code block (```lang ... ```), or null.
// Tolerates an unclosed fence (truncated AI output) by taking the rest.
function extractFencedBlock(text) {
  const open = /```([A-Za-z0-9_-]*)[ \t]*\r?\n/g;
  let best = null;
  let m;
  while ((m = open.exec(text)) !== null) {
    const contentStart = m.index + m[0].length;
    const close = text.indexOf('```', contentStart);
    const content = close === -1 ? text.slice(contentStart) : text.slice(contentStart, close);
    if (!best || content.length > best.content.length) {
      best = { content: content.trim(), lang: m[1].toLowerCase() };
    }
    if (close === -1) break;
    open.lastIndex = close + 3;
  }
  return best;
}

// Locate a balanced {...} / [...] span and verify it parses as JSON.
function extractJsonSpan(text) {
  const start = text.search(/[[{]/);
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        try {
          JSON.parse(slice);
          return { start, end: i + 1, slice };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const LEADING_FILLER = /^(sure|certainly|absolutely|of course|great question|good question|here\b|here's|below\b|as requested|as promised|the following|this is|i'?ve (prepared|created|put together))\b/i;
const TRAILING_FILLER = /^(let me know|hope this|i hope|feel free|if you (need|have|want)|is there anything|any other|would you like|does this|note:|p\.s\.)/i;

// Split one markdown table row into trimmed cells, honouring \| escapes.
function splitTableRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  let esc = false;
  for (const ch of s) {
    if (esc) {
      cur += ch === '|' ? '|' : '\\' + ch;
      esc = false;
    } else if (ch === '\\') esc = true;
    else if (ch === '|') { cells.push(cur); cur = ''; }
    else cur += ch;
  }
  if (esc) cur += '\\';
  cells.push(cur);
  return cells.map((c) => c.trim());
}

// Find the first pipe table (header row + --- separator + data rows).
// Ragged rows are padded with empty cells and clipped to the header width.
function extractMarkdownTable(text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].includes('|')) continue;
    const sep = lines[i + 1];
    if (!sep.includes('|')) continue;
    const sepCells = splitTableRow(sep);
    if (sepCells.length === 0 || !sepCells.every((c) => /^:?-+:?$/.test(c))) continue;
    const headers = splitTableRow(lines[i]);
    const width = headers.length;
    const rows = [];
    let j = i + 2;
    for (; j < lines.length; j++) {
      const t = lines[j].trim();
      if (!t || !t.includes('|')) break;
      const cells = splitTableRow(lines[j]);
      while (cells.length < width) cells.push('');
      rows.push(cells.slice(0, Math.max(width, 1)));
    }
    return { startLine: i, endLine: j, headers, rows };
  }
  return null;
}

// Minimal RFC-4180-ish CSV parser: quoted fields, doubled quotes, \r\n or \n.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQ = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field === '') { inQ = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// Find the longest run of consecutive non-empty lines with a consistent
// field count >= 2; that run is the CSV block.
function extractCsvBlock(text) {
  const lines = text.split('\n');
  let best = null;
  let runStart = -1;
  let runFields = 0;
  const flush = (endIdx) => {
    if (runStart !== -1 && endIdx - runStart >= 2) {
      if (!best || endIdx - runStart > best.endLine - best.startLine) {
        best = { startLine: runStart, endLine: endIdx };
      }
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const fields = t ? parseCsv(t)[0].length : 0;
    if (fields >= 2 && (runStart === -1 || fields === runFields)) {
      if (runStart === -1) { runStart = i; runFields = fields; }
    } else {
      flush(i);
      runStart = -1;
      runFields = 0;
    }
  }
  flush(lines.length);
  if (!best) return null;
  const records = parseCsv(lines.slice(best.startLine, best.endLine).join('\n'));
  return { ...best, headers: records[0], rows: records.slice(1) };
}

function coerceCell(cell) {
  if (cell === 'true') return true;
  if (cell === 'false') return false;
  if (cell !== '' && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(cell)) return Number(cell);
  return cell;
}

function csvEscape(value) {
  const s = String(value);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function rowsToCsv(headers, rows) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const r of rows) lines.push(r.map(csvEscape).join(','));
  return lines.join('\n');
}

function rowsToMarkdown(headers, rows) {
  const esc = (s) => String(s).replace(/\|/g, '\\|');
  const lines = [
    '| ' + headers.map(esc).join(' | ') + ' |',
    '| ' + headers.map(() => '---').join(' | ') + ' |',
  ];
  for (const r of rows) lines.push('| ' + r.map(esc).join(' | ') + ' |');
  return lines.join('\n');
}

function tableObjects(headers, rows) {
  return rows.map((r) =>
    Object.fromEntries(headers.map((h, i) => [h || `col${i + 1}`, coerceCell(r[i] ?? '')])),
  );
}

function jsonCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// Normalize any JSON value into { headers, rows } of cell strings.
function jsonRows(value, titleCaseObjectHeaders) {
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every((v) => v !== null && typeof v === 'object' && !Array.isArray(v))) {
      const headers = [];
      for (const obj of value) {
        for (const k of Object.keys(obj)) if (!headers.includes(k)) headers.push(k);
      }
      return { headers, rows: value.map((o) => headers.map((h) => jsonCell(o[h]))) };
    }
    return { headers: ['value'], rows: value.map((v) => [jsonCell(v)]) };
  }
  if (value !== null && typeof value === 'object') {
    const headers = titleCaseObjectHeaders ? ['Key', 'Value'] : ['key', 'value'];
    return { headers, rows: Object.entries(value).map(([k, v]) => [k, jsonCell(v)]) };
  }
  return { headers: ['value'], rows: [[jsonCell(value)]] };
}

function jsonToCsv(value) {
  const { headers, rows } = jsonRows(value, false);
  return rowsToCsv(headers, rows);
}

function jsonToMarkdown(value) {
  const { headers, rows } = jsonRows(value, true);
  return rowsToMarkdown(headers, rows);
}

function countLines(section, fillerRe) {
  let filler = 0;
  let other = 0;
  for (const line of section.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    if (fillerRe.test(t)) filler++;
    else other++;
  }
  return { filler, other };
}

function locatePayload(text) {
  const span = extractJsonSpan(text);
  if (span) {
    return { detected: 'json', json: span.slice, lead: text.slice(0, span.start), trail: text.slice(span.end) };
  }
  const table = extractMarkdownTable(text);
  if (table) {
    const lines = text.split('\n');
    return {
      detected: 'markdown-table',
      table,
      lead: lines.slice(0, table.startLine).join('\n'),
      trail: lines.slice(table.endLine).join('\n'),
    };
  }
  const csv = extractCsvBlock(text);
  if (csv) {
    const lines = text.split('\n');
    return {
      detected: 'csv',
      csv,
      lead: lines.slice(0, csv.startLine).join('\n'),
      trail: lines.slice(csv.endLine).join('\n'),
    };
  }
  return null;
}

function render(model, format) {
  const f = format === 'auto' ? model.kind : format;
  if (model.kind === 'json') {
    if (f === 'json' || f === 'text') return JSON.stringify(model.value, null, 2);
    if (f === 'csv') return jsonToCsv(model.value);
    if (f === 'markdown') return jsonToMarkdown(model.value);
    throw new Error(`cannot convert JSON to ${format}`);
  }
  if (model.kind === 'table') {
    if (f === 'json') return JSON.stringify(tableObjects(model.headers, model.rows), null, 2);
    if (f === 'csv') return rowsToCsv(model.headers, model.rows);
    return rowsToMarkdown(model.headers, model.rows);
  }
  if (model.kind === 'csv') {
    if (f === 'json') return JSON.stringify(tableObjects(model.headers, model.rows), null, 2);
    if (f === 'markdown') return rowsToMarkdown(model.headers, model.rows);
    return rowsToCsv(model.headers, model.rows);
  }
  if (f === 'json' || f === 'csv') {
    throw new Error(`cannot convert plain text to ${f.toUpperCase()} — no JSON, table, or CSV found in the input`);
  }
  return model.text;
}

function scrub(input, options) {
  const opts = options || {};
  const format = opts.format || 'auto';
  const warnings = [];
  let fillerRemoved = 0;

  const fenced = extractFencedBlock(input);
  const fenceStripped = fenced !== null;
  const body = fenced ? fenced.content : input;

  const located = locatePayload(body);
  let model;
  let detected = 'text';
  if (located) {
    const lead = countLines(located.lead, LEADING_FILLER);
    const trail = countLines(located.trail, TRAILING_FILLER);
    fillerRemoved = lead.filler + trail.filler;
    const dropped = lead.other + trail.other;
    if (dropped > 0) {
      const label = located.detected === 'json' ? 'JSON' : located.detected === 'csv' ? 'CSV' : 'table';
      warnings.push(`dropped ${dropped} non-data line(s) surrounding the ${label}`);
    }
    detected = located.detected;
    if (detected === 'json') {
      model = { kind: 'json', value: JSON.parse(located.json) };
    } else if (detected === 'markdown-table') {
      model = { kind: 'table', headers: located.table.headers, rows: located.table.rows };
    } else {
      model = { kind: 'csv', headers: located.csv.headers, rows: located.csv.rows };
    }
  } else {
    const lines = body.split('\n');
    let a = 0;
    let b = lines.length;
    while (a < b && (!lines[a].trim() || LEADING_FILLER.test(lines[a].trim()))) {
      if (lines[a].trim()) fillerRemoved++;
      a++;
    }
    while (b > a && (!lines[b - 1].trim() || TRAILING_FILLER.test(lines[b - 1].trim()))) {
      if (lines[b - 1].trim()) fillerRemoved++;
      b--;
    }
    model = { kind: 'text', text: lines.slice(a, b).join('\n').trim() };
  }

  const output = render(model, format);
  return { output, detected, fenceStripped, fillerRemoved, warnings };
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { scrub, extractFencedBlock };
}
