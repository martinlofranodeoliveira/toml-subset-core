// SPDX-License-Identifier: MIT
// TOML v1.0 subset parser and canonical serializer: tables, dotted keys,
// arrays of tables, strings (basic+literal, multiline), integers
// (dec/hex/oct/bin), floats, booleans, arrays, inline tables. Datetimes
// are rejected (documented subset boundary). No network, no I/O.

export const MAX_CHARS = 1000000;
export const MAX_DEPTH = 32;

export class TomlError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'TomlError';
    this.code = code;
  }
}

function fail(code, detail, line) {
  throw new TomlError(code, line === undefined ? detail : `line ${line}: ${detail}`);
}

function unescapeBasic(s, line) {
  return s.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (m, e) => {
    if (e === 'n') return '\n';
    if (e === 't') return '\t';
    if (e === 'r') return '\r';
    if (e === 'b') return '\b';
    if (e === 'f') return '\f';
    if (e === '\\') return '\\';
    if (e === '"') return '"';
    if (e[0] === 'u' || e[0] === 'U') {
      const cp = Number.parseInt(e.slice(1), 16);
      if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) fail('BAD_ESCAPE', e, line);
      return String.fromCodePoint(cp);
    }
    fail('BAD_ESCAPE', e, line);
    return '';
  });
}

function parseNumber(token, line) {
  const t = token.replace(/_/g, '');
  if (/^[+-]?\d+$/.test(t)) {
    const v = Number(t);
    if (!Number.isSafeInteger(v)) fail('BIG_INT', token, line);
    return v;
  }
  if (/^0x[0-9a-fA-F]+$/.test(t)) return Number.parseInt(t, 16);
  if (/^0o[0-7]+$/.test(t)) return Number.parseInt(t.slice(2), 8);
  if (/^0b[01]+$/.test(t)) return Number.parseInt(t.slice(2), 2);
  if (/^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(t) || /^[+-]?(inf|nan)$/.test(t)) {
    const v = Number(t);
    if (Number.isNaN(v)) return { $toml: 'nan' };
    return v;
  }
  return undefined;
}

function isDateLike(t) {
  return /^\d{4}-\d{2}-\d{2}/.test(t) || /^\d{2}:\d{2}:\d{2}/.test(t);
}

function splitTopLevel(s, line) {
  // Split on commas at depth 0, respecting strings/brackets/braces.
  const parts = [];
  let depth = 0;
  let cur = '';
  let str = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (str) {
      cur += c;
      if (c === str && s[i - 1] !== '\\') str = null;
      continue;
    }
    if (c === '"' || c === "'") { str = c; cur += c; continue; }
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
    if (depth < 0) fail('BAD_BRACKET', s, line);
    if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (str) fail('UNTERMINATED_STRING', s, line);
  if (depth !== 0) fail('BAD_BRACKET', s, line);
  parts.push(cur);
  return parts;
}

class Parser {
  constructor(text) {
    this.lines = text.replace(/\r\n?/g, '\n').split('\n');
    this.i = 0;
    this.root = {};
  }

  parse() {
    if (this.lines.join('\n').length > MAX_CHARS) fail('TOO_BIG');
    let current = this.root;
    let currentPath = [];
    while (this.i < this.lines.length) {
      const no = this.i + 1;
      let line = this.lines[this.i++].trim();
      if (line === '' || line.startsWith('#')) continue;
      // Strip trailing comment (outside strings).
      line = stripComment(line);
      if (line === '') continue;
      let m;
      if ((m = /^\[\[([^\]]+)\]\]$/.exec(line))) {
        const path = dotted(m[1], no);
        current = this.arrayTable(path, no);
        currentPath = path;
        continue;
      }
      if ((m = /^\[([^\]]+)\]$/.exec(line))) {
        const path = dotted(m[1], no);
        current = this.table(path, no);
        currentPath = path;
        continue;
      }
      const eq = findEquals(line);
      if (eq === -1) fail('BAD_LINE', line, no);
      const keyRaw = line.slice(0, eq).trim();
      const valRaw = line.slice(eq + 1).trim();
      const keys = dottedKey(keyRaw, no);
      const value = this.value(valRaw, no);
      this.assign(current, currentPath, keys, value, no);
    }
    return deepFreeze(this.root);
  }

  table(path, no) {
    const name = path.join('.');
    let node = this.root;
    for (const k of path.slice(0, -1)) {
      if (node[k] === undefined) node[k] = {};
      else if (Array.isArray(node[k])) {
        if (!node[k].length) fail('DUP_TABLE', name, no);
        node = node[k][node[k].length - 1];
        continue;
      } else if (typeof node[k] !== 'object' || node[k] === null) {
        fail('DUP_TABLE', name, no);
      }
      node = node[k];
    }
    const last = path[path.length - 1];
    if (node[last] === undefined) node[last] = {};
    else if (Array.isArray(node[last])) fail('DUP_TABLE', name, no);
    else if (typeof node[last] !== 'object' || node[last] === null) fail('DUP_TABLE', name, no);
    node = node[last];
    if ((node.$dotted || node.$defined) && !node.$arrayParent) fail('DUP_TABLE', name, no);
    Object.defineProperty(node, '$defined', { value: true, enumerable: false, configurable: true });
    return node;
  }

  arrayTable(path, no) {
    const name = path.join('.');
    let node = this.root;
    for (const k of path.slice(0, -1)) {
      if (node[k] === undefined) node[k] = {};
      else if (Array.isArray(node[k])) {
        if (!node[k].length) fail('DUP_TABLE', name, no);
        node = node[k][node[k].length - 1];
        continue;
      } else if (typeof node[k] !== 'object' || node[k] === null) {
        fail('DUP_TABLE', name, no);
      }
      node = node[k];
    }
    const last = path[path.length - 1];
    if (node[last] === undefined) node[last] = [];
    if (!Array.isArray(node[last])) fail('DUP_TABLE', path.join('.'), no);
    const entry = {};
    Object.defineProperty(entry, '$arrayParent', { value: true, enumerable: false, configurable: true });
    node[last].push(entry);
    return entry;
  }

  assign(current, currentPath, keys, value, no) {
    let node = current;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (node[k] === undefined) {
        node[k] = {};
        Object.defineProperty(node[k], '$dotted', { value: true, enumerable: false, configurable: true });
      } else if (typeof node[k] !== 'object' || node[k] === null || Array.isArray(node[k])) {
        fail('DUP_KEY', keys.join('.'), no);
      }
      node = node[k];
    }
    const last = keys[keys.length - 1];
    if (Object.prototype.hasOwnProperty.call(node, last)) fail('DUP_KEY', keys.join('.'), no);
    if (currentPath.length && keys.length > 1) void 0;
    node[last] = value;
  }

  value(raw, no) {
    // Multiline basic / literal strings.
    if (raw.startsWith('"""')) return this.multiline(raw, no, '"', false);
    if (raw.startsWith("'''")) return this.multiline(raw, no, "'", true);
    if (raw.startsWith('"')) {
      const m = /^"((?:[^"\\\r\n]|\\.)*)"(.*)$/.exec(raw);
      if (!m) fail('BAD_STRING', raw, no);
      if (m[2].trim() !== '' && !m[2].trim().startsWith('#')) fail('TRAILING', raw, no);
      return unescapeBasic(m[1], no);
    }
    if (raw.startsWith("'")) {
      const m = /^'([^'\r\n]*)'(.*)$/.exec(raw);
      if (!m) fail('BAD_STRING', raw, no);
      if (m[2].trim() !== '' && !m[2].trim().startsWith('#')) fail('TRAILING', raw, no);
      return m[1];
    }
    if (raw.startsWith('[')) return this.array(raw, no);
    if (raw.startsWith('{')) return this.inlineTable(raw, no);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (isDateLike(raw.split(/[,\s#]/)[0])) fail('UNSUPPORTED_DATETIME', raw, no);
    const trailing = raw.match(/^(.*?)(?:\s+#.*)?$/)[1].trim();
    const num = parseNumber(trailing, no);
    if (num === undefined) fail('BAD_VALUE', raw, no);
    if (typeof num === 'object') return num;
    return num;
  }

  multiline(raw, no, quote, literal) {
    const q = quote.repeat(3);
    let text = raw.slice(3);
    const lines = [text];
    while (!lines[lines.length - 1].includes(q)) {
      if (this.i >= this.lines.length) fail('UNTERMINATED_STRING', raw, no);
      lines[lines.length - 1] += '\n' + this.lines[this.i++];
    }
    const joined = lines.join('');
    const end = joined.indexOf(q);
    const body = joined.slice(0, end);
    const rest = joined.slice(end + 3).trim();
    if (rest !== '' && !rest.startsWith('#')) fail('TRAILING', raw, no);
    const content = body.startsWith('\n') ? body.slice(1) : body;
    return literal ? content : unescapeBasic(content.replace(/\\\s*\n\s*/g, ''), no);
  }

  array(raw, no) {
    let text = raw;
    while (brackets(text) > 0) {
      if (this.i >= this.lines.length) fail('BAD_BRACKET', raw, no);
      text += '\n' + this.lines[this.i++];
    }
    const inner = text.trim();
    if (!inner.endsWith(']')) fail('BAD_BRACKET', raw, no);
    const body = inner.slice(1, -1).trim();
    if (body === '') return [];
    const parts = splitTopLevel(body, no).map((p) => p.trim()).filter((p) => p !== '');
    const vals = parts.map((p) => this.value(p, no));
    const types = new Set(vals.map((v) => (v && typeof v === 'object' ? (Array.isArray(v) ? 'array' : v.$toml === 'nan' ? 'float' : 'table') : typeof v)));
    if (types.size > 1) fail('MIXED_ARRAY', raw, no);
    return vals;
  }

  inlineTable(raw, no) {
    const t = raw.trim();
    if (!t.endsWith('}')) fail('BAD_BRACKET', raw, no);
    const body = t.slice(1, -1).trim();
    const out = {};
    if (body === '') return out;
    for (const part of splitTopLevel(body, no)) {
      const eq = findEquals(part);
      if (eq === -1) fail('BAD_LINE', part, no);
      const keys = dottedKey(part.slice(0, eq).trim(), no);
      if (keys.length > 1) fail('BAD_INLINE_DOT', part, no);
      if (Object.prototype.hasOwnProperty.call(out, keys[0])) fail('DUP_KEY', part, no);
      out[keys[0]] = this.value(part.slice(eq + 1).trim(), no);
    }
    return out;
  }
}

function brackets(s) {
  let depth = 0;
  let str = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (str) {
      if (c === str && s[i - 1] !== '\\') str = null;
      continue;
    }
    if (c === '"' || c === "'") str = c;
    else if (c === '[') depth++;
    else if (c === ']') depth--;
  }
  return depth;
}

function stripComment(line) {
  let str = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (str) {
      if (c === str && line[i - 1] !== '\\') str = null;
      continue;
    }
    if (c === '"' || c === "'") { str = c; continue; }
    if (c === '#') return line.slice(0, i).trimEnd();
  }
  return line;
}

function findEquals(s) {
  let str = null;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (str) {
      if (c === str && s[i - 1] !== '\\') str = null;
      continue;
    }
    if (c === '"' || c === "'") { str = c; continue; }
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
    if ((c === '=' || c === ':') && depth === 0) return i;
  }
  return -1;
}

function splitKey(s, no) {
  const parts = [];
  let cur = '';
  let str = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (str) {
      cur += c;
      if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'") { str = c; cur += c; continue; }
    if (c === '.') { parts.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur.trim());
  if (parts.some((p) => p === '')) fail('BAD_KEY', s, no);
  return parts;
}

function unquoteKey(p, no) {
  if (p.startsWith('"') && p.endsWith('"') && p.length >= 2) return unescapeBasic(p.slice(1, -1), no);
  if (p.startsWith("'") && p.endsWith("'") && p.length >= 2) return p.slice(1, -1);
  if (!/^[A-Za-z0-9_-]+$/.test(p)) fail('BAD_KEY', p, no);
  return p;
}

function dottedKey(s, no) {
  return splitKey(s, no).map((p) => unquoteKey(p, no));
}

function dotted(s, no) {
  return splitKey(s.trim(), no).map((p) => unquoteKey(p, no));
}

/** Parse TOML text -> frozen nested object. */
export function parse(input) {
  if (typeof input !== 'string') throw new TomlError('NOT_STRING');
  const doc = new Parser(input).parse();
  return deepFreeze(doc);
}

function deepFreeze(o) {
  if (o && typeof o === 'object') {
    for (const k of Object.keys(o)) deepFreeze(o[k]);
    Object.freeze(o);
  }
  return o;
}

function escStr(s) {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r')}"`;
}

function bareKey(k) {
  return /^[A-Za-z0-9_-]+$/.test(k) ? k : escStr(k);
}

function fmtValue(v) {
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return String(v);
    if (v === Infinity) return 'inf';
    if (v === -Infinity) return '-inf';
    return String(v);
  }
  if (typeof v === 'string') return escStr(v);
  if (Array.isArray(v)) return `[${v.map(fmtValue).join(', ')}]`;
  if (v && typeof v === 'object') {
    if (v.$toml === 'nan') return 'nan';
    return `{ ${Object.entries(v).map(([k, x]) => `${bareKey(k)} = ${fmtValue(x)}`).join(', ')} }`;
  }
  throw new TomlError('BAD_VALUE');
}

/** Serialize back to canonical TOML (tables in order, primitives first). */
export function stringify(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new TomlError('BAD_DOC');
  const lines = [];
  const tables = [];
  for (const [k, v] of Object.entries(doc)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) tables.push([k, v]);
    else if (Array.isArray(v) && v.length && typeof v[0] === 'object' && !Array.isArray(v[0])) tables.push([k, v]);
    else lines.push(`${bareKey(k)} = ${fmtValue(v)}`);
  }
  const emit = (path, node, isArray) => {
    if (isArray) {
      for (const entry of node) {
        lines.push(`[[${path}]]`);
        for (const [k, v] of Object.entries(entry)) {
          if (v && typeof v === 'object' && !Array.isArray(v)) { emitTable(`${path}.${k}`, v); continue; }
          if (Array.isArray(v) && v.length && typeof v[0] === 'object' && !Array.isArray(v[0])) { emitArray(`${path}.${k}`, v); continue; }
          lines.push(`${bareKey(k)} = ${fmtValue(v)}`);
        }
      }
      return;
    }
    emitTable(path, node);
  };
  const emitTable = (path, node) => {
    lines.push(`[${path}]`);
    for (const [k, v] of Object.entries(node)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) { emitTable(`${path}.${k}`, v); continue; }
      if (Array.isArray(v) && v.length && typeof v[0] === 'object' && !Array.isArray(v[0])) { emitArray(`${path}.${k}`, v); continue; }
      lines.push(`${bareKey(k)} = ${fmtValue(v)}`);
    }
  };
  const emitArray = (path, arr) => {
    for (const entry of arr) {
      lines.push(`[[${path}]]`);
      for (const [k, v] of Object.entries(entry)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) { emitTable(`${path}.${k}`, v); continue; }
        lines.push(`${bareKey(k)} = ${fmtValue(v)}`);
      }
    }
  };
  for (const [k, v] of tables) emit(k, v, Array.isArray(v));
  return (lines.length ? lines.join('\n') + '\n' : '');
}
