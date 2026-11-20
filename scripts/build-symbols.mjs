/**
 * Regenerate the embedded symbol catalog in `client.js`.
 *
 * The catalogue is shipped inside the bundle so name search is instant and
 * offline: none of the public suggestion endpoints allow cross-origin reads, and
 * a Host route would only exist after the next DSH restart.
 *
 * Run: node scripts/build-symbols.mjs
 *
 * It rewrites the block between `//#region symbol-index` and the next
 * `//#endregion` in `client.js`, keeping the rest of the file untouched.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, '..', 'client.js');
const LIST = 'https://push2.eastmoney.com/api/qt/clist/get';

/** Universes to fold into the catalogue, in priority order. */
const UNIVERSES = [
  // Shanghai, Shenzhen and Beijing A-shares.
  'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048',
  // CSI / broad indices served from the Shanghai market namespace.
  'm:1+s:2',
  // Exchange-traded funds.
  'b:MK0021,b:MK0022,b:MK0023,b:MK0024'
];

/** Indices that matter but are not part of any of the universes above. */
const EXTRA = [
  ['sh000001', '上证指数'],
  ['sz399001', '深证成指'],
  ['sz399006', '创业板指'],
  ['sz399005', '中小100'],
  ['sh000300', '沪深300'],
  ['sh000016', '上证50'],
  ['sh000905', '中证500'],
  ['sh000852', '中证1000'],
  ['sh000688', '科创50'],
  ['bj899050', '北证50']
];

/** @returns the market prefix for one row. */
function prefixOf(code, market) {
  if (market === 1) return 'sh';
  if (code.startsWith('900')) return 'sh';
  if (code.startsWith('92')) return 'bj';
  const head = code.charAt(0);
  if (head === '6' || head === '7') return 'sh';
  if (head === '4' || head === '8') return 'bj';
  return 'sz';
}

/** Fetch one page of a universe. */
async function page(fs, pn) {
  const url = LIST
    + '?pn=' + pn
    + '&pz=100&po=1&np=1&fltt=2&invt=2&fid=f12'
    + '&fields=f12,f13,f14'
    + '&fs=' + fs;
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + fs);
  const body = await response.json();
  const data = body === null || body === undefined ? null : body.data;
  if (data === null || data === undefined) return { total: 0, rows: [] };
  return { total: Number(data.total) || 0, rows: Array.isArray(data.diff) ? data.diff : [] };
}

/** Fetch a whole universe. */
async function universe(fs) {
  const first = await page(fs, 1);
  const rows = first.rows.slice();
  const pages = Math.min(80, Math.ceil(first.total / 100));
  for (let pn = 2; pn <= pages; pn += 1) {
    const next = await page(fs, pn);
    rows.push(...next.rows);
    if (next.rows.length === 0) break;
  }
  return rows;
}

const catalogue = new Map();

/** Add one entry, first writer wins. */
function add(key, name) {
  if (catalogue.has(key)) return;
  const clean = String(name === undefined || name === null ? '' : name).replace(/\s+/g, ' ').trim();
  if (clean === '') return;
  catalogue.set(key, clean);
}

for (const [key, name] of EXTRA) add(key, name);

let universeIndex = 0;
for (const fs of UNIVERSES) {
  const rows = await universe(fs);
  universeIndex += 1;
  const before = catalogue.size;
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue;
    const code = String(row.f12 === undefined ? '' : row.f12);
    if (!/^\d{6}$/.test(code)) continue;
    add(prefixOf(code, Number(row.f13)) + code, row.f14);
  }
  console.log('universe', universeIndex, 'rows', rows.length, 'added', catalogue.size - before);
}

const lines = Array.from(catalogue.entries())
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([key, name]) => key + ' ' + name.replace(/`/g, '\''));

const literal = '    const SYMBOL_INDEX = `\n' + lines.join('\n') + '\n`;\n';

const source = fs.readFileSync(CLIENT, 'utf8');
const BEGIN = '    //#region symbol-index\n';
const END = '    //#endregion\n';
const start = source.indexOf(BEGIN);
if (start < 0) throw new Error('symbol-index region not found in client.js');
const bodyStart = start + BEGIN.length;
const bodyEnd = source.indexOf(END, bodyStart);
if (bodyEnd < 0) throw new Error('symbol-index region is not closed');

const next = source.slice(0, bodyStart) + literal + source.slice(bodyEnd);
fs.writeFileSync(CLIENT, next, 'utf8');

console.log('symbols', lines.length);
console.log('literal bytes', Buffer.byteLength(literal, 'utf8'));
console.log('client.js bytes', Buffer.byteLength(next, 'utf8'));
