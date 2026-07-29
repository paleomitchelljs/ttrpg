// Surgical serializers for the hand-authored data files, used by serve.mjs's
// entity-editor endpoints. Like rewriteZonesMap, they touch only the target
// entry/field and never partially write — the endpoints additionally import the
// result as a data: module before saving, so a bad rewrite never lands on disk.
// Pure (no fs) so they're unit-testable in isolation (test/data-edit.test.mjs).

// One value as a data-file JS literal: single-quoted strings, unquoted keys,
// shallow objects/arrays inlined (data nests no deeper than attacks:[{...}]).
export function jsVal(v) {
  if (v === null) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (Array.isArray(v)) return `[${v.map(jsVal).join(', ')}]`;
  if (typeof v === 'object')
    return `{ ${Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => `${k}: ${jsVal(x)}`).join(', ')} }`;
  return 'null';
}

// A monster/item as a multi-line object literal (fields at 4 spaces, closing
// brace at 2). Known keys lead in `order`; any extras keep their own order.
export function serializeEntry(obj, order = []) {
  const keys = [...order.filter((k) => k in obj), ...Object.keys(obj).filter((k) => !order.includes(k))];
  const lines = keys.filter((k) => obj[k] !== undefined).map((k) => `    ${k}: ${jsVal(obj[k])},`);
  return `{\n${lines.join('\n')}\n  }`;
}

export const MONSTER_ORDER = ['id', 'name', 'kind', 'ac', 'hpMax', 'abilities', 'attacks', 'castStat', 'cast',
  'sprite', 'emoji', 'anim', 'ability', 'resist', 'vulnerable', 'facesLeft', 'patrol',
  'faction', 'parley', 'goldValue', 'minDepth', 'maxDepth', 'packMax', 'weight', 'morale'];
export const ITEM_ORDER = ['id', 'name', 'slot', 'zone', 'mods', 'bane', 'blurb'];

// Index of the bracket matching the one at openIdx — skipping strings, template
// literals, and // and /* */ comments so stray quotes/brackets inside them (e.g.
// "the zones' boss pools" in a comment) don't miscount.
export function matchBracket(s, openIdx) {
  const open = s[openIdx];
  const close = open === '{' ? '}' : open === '[' ? ']' : null;
  if (!close) throw new Error(`matchBracket: '${open}' is not an opening bracket`);
  let depth = 0, str = null;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (str) { if (c === '\\') i++; else if (c === str) str = null; continue; }
    if (c === "'" || c === '"' || c === '`') { str = c; continue; }
    if (c === '/' && s[i + 1] === '/') { const n = s.indexOf('\n', i); i = n < 0 ? s.length : n; continue; }
    if (c === '/' && s[i + 1] === '*') { i = s.indexOf('*/', i + 2) + 1; continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return i;
  }
  throw new Error(`matchBracket: unbalanced '${open}'`);
}

// Replace one entry (matched by id) in `export const ARRAY = [ … ]`, or append
// it if that id isn't present. Everything else stays byte-for-byte.
export function upsertEntry(source, arrayName, obj, order) {
  if (!obj?.id || typeof obj.id !== 'string') throw new Error('entry needs a string id');
  const decl = new RegExp(`export const ${arrayName}\\s*=\\s*\\[`).exec(source);
  if (!decl) throw new Error(`${arrayName} array not found`);
  const arrOpen = decl.index + decl[0].length - 1; // the '['
  const arrClose = matchBracket(source, arrOpen); // its ']'
  const body = source.slice(arrOpen + 1, arrClose);
  const literal = serializeEntry(obj, order);
  const esc = obj.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const im = new RegExp(`id:\\s*['"]${esc}['"]`).exec(body);
  if (im) {
    const s0 = body.lastIndexOf('{', im.index);
    const s1 = matchBracket(body, s0);
    return source.slice(0, arrOpen + 1) + body.slice(0, s0) + literal + body.slice(s1 + 1) + source.slice(arrClose);
  }
  const trimmed = body.replace(/\s+$/, '');
  const sep = trimmed === '' || trimmed.endsWith(',') || trimmed.endsWith('[') ? '' : ',';
  return source.slice(0, arrOpen + 1) + trimmed + sep + `\n  ${literal},\n` + source.slice(arrClose);
}

// Bounds of one subregion block in zones.js: from its `id: '<sub>'` to the end
// of that sub's `map: [ … ]` (map is every sub's last field).
export function subBlock(source, esc) {
  const im = new RegExp(`id:\\s*['"]${esc}['"]`).exec(source);
  if (!im) throw new Error(`subregion ${esc} not found`);
  const mapRe = /\bmap:\s*\[/g; mapRe.lastIndex = im.index;
  const mm = mapRe.exec(source);
  if (!mm) throw new Error(`${esc}: no map[] to bound its block`);
  return { start: im.index, end: matchBracket(source, mm.index + mm[0].length - 1) + 1 };
}

// Replace (or insert, before `map:`) a subregion's table[] / boss{} / miniboss{}.
export function rewriteZonesField(source, subId, field, value) {
  const esc = subId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const { start, end } = subBlock(source, esc);
  let block = source.slice(start, end);
  if (field === 'table') {
    if (!Array.isArray(value)) throw new Error('table must be an array');
    const rows = '\n' + value.map((r) => `          ${jsVal(r)},`).join('\n') + '\n        ';
    const re = /(\btable:\s*\[)[\s\S]*?(\])/;
    block = re.test(block) ? block.replace(re, (_, o, c) => o + rows + c) : insertBeforeMap(block, `table: [${rows}]`);
  } else if (field === 'boss' || field === 'miniboss') {
    const lit = jsVal(value);
    const re = new RegExp(`(\\b${field}:\\s*)\\{[\\s\\S]*?\\}`);
    block = re.test(block) ? block.replace(re, (_, pre) => pre + lit) : insertBeforeMap(block, `${field}: ${lit}`);
  } else {
    throw new Error(`unknown zone field: ${field}`);
  }
  return source.slice(0, start) + block + source.slice(end);
}

function insertBeforeMap(block, fieldText) {
  return block.replace(/(\n(\s*))(map:\s*\[)/, (_, nl, indent, map) => `${nl}${fieldText},${nl}${map}`);
}
