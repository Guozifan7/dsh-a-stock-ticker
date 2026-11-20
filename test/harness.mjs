/**
 * Self-contained test suite for the A-share ticker bundle.
 *
 * It loads the shipped `client.js` with an injected module table (a tiny React
 * runtime, a fake DOM and a fake `fetch`), exposes the module internals through
 * a temporary `__test` hook, and drives the real components end to end.
 *
 * Run from the package root:
 *
 *   node test/harness.mjs
 *
 * Exit code 0 means every assertion passed.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
const SOURCE = fs.readFileSync(PACKAGE_DIR + 'client.js', 'utf8');

const EXPOSE = 'return {\n      __test: {\n'
  + '        parseTarget, parseMany, normalizeSettings, readQuotes, toQuote, missingQuote,\n'
  + '        marketPhase, fmtPrice, fmtChange, fmtPercent, fmtMagnitude, directionOf,\n'
  + '        shownPrice, digitsOf, targetsOf, createSettingsStore, createQuoteFeed,\n'
  + '        Ticker, SettingsSection, readSettings, STORAGE_KEY, DICT_ZH, DICT_EN,\n'
  + '        readSectors, requestSectors, sectorUrl, SectorColumn, sectorRow,\n'
  + '        searchSymbols, symbolTableOf, createPreviewStore, suggestionRow, venueLabel, useSymbolSearch,\n'
  + '        readIntraday, bucketBars, klineUrl, candleSvg, IntradayChart, panelRow, sessionSlot, timeShareSeries,\n'
  + '        intradayViewFor, timeShareSvg\n'
  + '      },\n      inject: [\'slots\', \'locale\'],\n      apply: apply\n    };';

if (!SOURCE.includes("return {\n      inject: ['slots', 'locale'],")) {
  throw new Error('could not find the plugin return statement to instrument');
}
const instrumented = SOURCE.replace("return {\n      inject: ['slots', 'locale'],\n      apply: apply\n    };", EXPOSE);

//#region fake React
/** Minimal React replacement: hooks state + one-pass render with effect flushing. */
function createFakeReact() {
  let stack = { hooks: [], index: 0, effects: [] };

  function createElement(type, props, ...children) {
    const flat = [];
    const push = (value) => {
      if (Array.isArray(value)) {
        for (const entry of value) push(entry);
        return;
      }
      flat.push(value);
    };
    for (const child of children) push(child);
    return { type, props: props === null || props === undefined ? {} : props, children: flat };
  }

  function slot() {
    const index = stack.index++;
    if (stack.hooks[index] === undefined) stack.hooks[index] = {};
    return { index, cell: stack.hooks[index] };
  }

  function useState(initial) {
    const { cell } = slot();
    if (!('value' in cell)) cell.value = typeof initial === 'function' ? initial() : initial;
    return [cell.value, (next) => {
      cell.value = typeof next === 'function' ? next(cell.value) : next;
      cell.dirty = true;
    }];
  }

  function useEffect(effect, deps) {
    const { cell } = slot();
    const changed = !('deps' in cell) || !sameDeps(cell.deps, deps);
    if (!changed) return;
    cell.deps = deps;
    stack.effects.push(effect);
  }

  function useRef(initial) {
    const { cell } = slot();
    if (!('current' in cell)) cell.current = initial;
    return cell;
  }

  function useMemo(factory, deps) {
    const { cell } = slot();
    if (!('deps' in cell) || !sameDeps(cell.deps, deps)) {
      cell.value = factory();
      cell.deps = deps;
    }
    return cell.value;
  }

  function useCallback(callback, deps) {
    return useMemo(() => callback, deps);
  }

  function sameDeps(previous, next) {
    if (!Array.isArray(previous) || !Array.isArray(next) || previous.length !== next.length) return false;
    return previous.every((value, index) => Object.is(value, next[index]));
  }

  /** Run one component, returning the host tree and the pending effects. */
  function render(component, props) {
    stack = { hooks: [], index: 0, effects: [] };
    const tree = walk(createElement(component, props), undefined);
    return { tree, effects: stack.effects };
  }

  function walk(node, props) {
    if (node === null || node === undefined || node === false || node === true) return null;
    if (typeof node === 'string' || typeof node === 'number') return { text: String(node) };
    if (Array.isArray(node)) return { children: node.map((entry) => walk(entry)) };
    if (typeof node.type === 'function') return walk(node.type(node.props), undefined);
    return {
      tag: node.type,
      props: node.props,
      children: node.children.map((child) => walk(child)).filter((child) => child !== null)
    };
  }

  function collectText(tree) {
    const out = [];
    const visit = (node) => {
      if (node === null || node === undefined) return;
      if (node.text !== undefined) {
        out.push(node.text);
        return;
      }
      if (node.children !== undefined) {
        for (const child of node.children) visit(child);
        return;
      }
      if (node.tag !== undefined) {
        for (const child of node.children) visit(child);
      }
    };
    visit(tree);
    return out.join('');
  }

  /** Find the first host node whose className contains `needle`. */
  function findClass(tree, needle) {
    let found = null;
    const visit = (node) => {
      if (found !== null || node === null || node === undefined) return;
      if (node.tag !== undefined) {
        const className = typeof node.props.className === 'string' ? node.props.className : '';
        if (className.split(/\s+/).includes(needle)) {
          found = node;
          return;
        }
        for (const child of node.children) visit(child);
        return;
      }
      if (node.children !== undefined) for (const child of node.children) visit(child);
    };
    visit(tree);
    return found;
  }

  /** Count host nodes whose className contains `needle`. */
  function countClass(tree, needle) {
    let count = 0;
    const visit = (node) => {
      if (node === null || node === undefined) return;
      if (node.tag !== undefined) {
        const className = typeof node.props.className === 'string' ? node.props.className : '';
        if (className.split(/\s+/).includes(needle)) count += 1;
        for (const child of node.children) visit(child);
        return;
      }
      if (node.children !== undefined) for (const child of node.children) visit(child);
    };
    visit(tree);
    return count;
  }

  return {
    React: {
      createElement,
      useState,
      useEffect,
      useRef,
      useMemo,
      useCallback
    },
    render,
    collectText,
    findClass,
    countClass,
    resetStack() {
      stack = { hooks: [], index: 0, effects: [] };
    }
  };
}
//#endregion

//#region fake DOM and network
const styleElements = [];
const documentStub = {
  hidden: false,
  head: {
    appendChild(element) {
      styleElements.push(element);
      return element;
    },
    removeChild(element) {
      const index = styleElements.indexOf(element);
      if (index >= 0) styleElements.splice(index, 1);
    }
  },
  createElement(tag) {
    return {
      tag,
      attributes: {},
      textContent: '',
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      remove() {
        const index = styleElements.indexOf(this);
        if (index >= 0) styleElements.splice(index, 1);
      }
    };
  },
  addEventListener() {},
  removeEventListener() {}
};

const storage = new Map();
const localStorageStub = {
  getItem(key) {
    return storage.has(key) ? storage.get(key) : null;
  },
  setItem(key, value) {
    storage.set(key, String(value));
  }
};

const PAYLOAD = {
  rc: 0,
  data: {
    total: 4,
    diff: [
      { f1: 2, f2: '-', f3: '-', f4: '-', f5: '-', f6: '-', f7: '-', f8: 0.0, f9: 21.12, f12: '600519', f13: 1, f14: '\u8d35\u5dde\u8305\u53f0', f15: '-', f16: '-', f17: '-', f18: 1452.0, f20: 1815118484652, f21: 1815118484652, f23: 6.69 },
      { f1: 2, f2: 11.98, f3: 2.92, f4: 0.34, f5: 1234567, f6: 1478000000, f7: 3.11, f8: 1.24, f9: 4.32, f12: '000001', f13: 0, f14: '\u5e73\u5b89\u94f6\u884c', f15: 12.1, f16: 11.6, f17: 11.7, f18: 11.64, f20: 225884887825, f21: 225882173295 },
      { f1: 2, f2: 264.06, f3: -1.24, f4: -3.31, f5: 98765, f6: 2610000000, f7: 2.5, f8: 0.68, f9: 14.2, f12: '300750', f13: 0, f14: '\u5b81\u5fb7\u65f6\u4ee3', f15: 268.2, f16: 262.0, f17: 266.0, f18: 267.37 },
      { f1: 2, f2: 6.1, f3: 0.0, f4: 0.0, f5: 100, f6: 610000, f7: 0.0, f8: 0.0, f9: '-', f12: '601398', f13: 1, f14: '\u5de5\u5546\u94f6\u884c', f15: 6.1, f16: 6.1, f17: 6.1, f18: 6.1 }
    ]
  }
};

const requests = [];
let fetchImpl = async (url) => {
  requests.push(url);
  if (String(url).includes('stockTicker')) {
    return { ok: true, status: 200, json: async () => ({ ok: true, payload: PAYLOAD }) };
  }
  return { ok: true, status: 200, json: async () => PAYLOAD };
};

const windowStub = { __ModuleLoader__: { load(spec) { windowStub.spec = spec; } } };
//#endregion

//#region load the module
const fake = createFakeReact();
const requireStub = (name) => {
  if (name === 'react') return fake.React;
  throw new Error('unexpected require: ' + name);
};

const run = new Function(
  'window', 'document', 'localStorage', 'fetch', 'ResizeObserver', 'AbortController', 'console',
  instrumented
);
run(windowStub, documentStub, localStorageStub, (url, options) => fetchImpl(url, options), undefined, AbortController, console);
const plugin = windowStub.spec.factory(requireStub);
const internals = plugin.__test;

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log('  ok   ' + name);
    return;
  }
  failures += 1;
  console.log('  FAIL ' + name + (detail === undefined ? '' : ' -> ' + JSON.stringify(detail)));
}
function equal(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
}
//#endregion

//#region pure logic
console.log('\n[code parsing]');
equal('600519 -> sh', internals.parseTarget('600519').key, 'sh600519');
equal('000001 -> sz', internals.parseTarget('000001').key, 'sz000001');
equal('300750 -> sz', internals.parseTarget('300750').key, 'sz300750');
equal('430047 -> bj', internals.parseTarget('430047').key, 'bj430047');
equal('920002 -> bj', internals.parseTarget('920002').key, 'bj920002');
equal('900901 -> sh', internals.parseTarget('900901').key, 'sh900901');
equal('688981 -> sh', internals.parseTarget('688981').key, 'sh688981');
equal('sh000001 index -> sh', internals.parseTarget('sh000001').key, 'sh000001');
equal('600519.SH -> sh', internals.parseTarget('600519.SH').key, 'sh600519');
equal('bj prefix', internals.parseTarget('bj430047').secid, '0.430047');
equal('sh secid', internals.parseTarget('sh600519').secid, '1.600519');
check('garbage rejected', internals.parseTarget('hello') === null);
check('short code rejected', internals.parseTarget('60051') === null);
check('empty rejected', internals.parseTarget('  ') === null);
equal('bulk split', internals.parseMany('600519, 000001\uff1b300750\n430047 bad').targets.map((t) => t.key),
  ['sh600519', 'sz000001', 'sz300750', 'bj430047']);
equal('bulk invalid', internals.parseMany('600519 bad 1234567').invalid, ['bad', '1234567']);

console.log('\n[settings]');
const defaults = internals.normalizeSettings(null);
equal('default codes', defaults.codes, ['sh600519', 'sz000001', 'sz300750', 'sh601398']);
equal('default interval', defaults.intervalSec, 5);
equal('default corner', defaults.corner, 'top-left');
equal('interval clamped high', internals.normalizeSettings({ intervalSec: 999 }).intervalSec, 60);
equal('interval clamped low', internals.normalizeSettings({ intervalSec: 0 }).intervalSec, 2);
equal('rotate default', internals.normalizeSettings(null).rotateSec, 3);
equal('rotate clamped high', internals.normalizeSettings({ rotateSec: 99 }).rotateSec, 15);
equal('rotate clamped low', internals.normalizeSettings({ rotateSec: 0 }).rotateSec, 1);
equal('legacy scrollSec ignored', internals.normalizeSettings({ scrollSec: 12 }).rotateSec, 3);
equal('bad corner replaced', internals.normalizeSettings({ corner: 'middle' }).corner, 'top-left');
equal('codes dedupe + normalise', internals.normalizeSettings({ codes: ['600519', 'sh600519', 'bad'] }).codes, ['sh600519']);
equal('explicit empty codes kept', internals.normalizeSettings({ codes: [] }).codes, []);

console.log('\n[formatting]');
equal('price', internals.fmtPrice(11.9812, 2), '11.98');
equal('price dash', internals.fmtPrice(null, 2), '--');
equal('change up', internals.fmtChange(0.34, 2), '+0.34');
equal('change down', internals.fmtChange(-3.31, 2), '-3.31');
equal('change flat', internals.fmtChange(0, 2), '0.00');
equal('pct up', internals.fmtPercent(2.92), '+2.92%');
equal('pct dash', internals.fmtPercent(null), '--');
equal('magnitude yi', internals.fmtMagnitude(2610000000), '26.10\u4ebf');
equal('magnitude large', internals.fmtMagnitude(1478000000), '14.78\u4ebf');
equal('magnitude small', internals.fmtMagnitude(1200), '1200');
equal('direction up', internals.directionOf({ pct: 1, change: 1 }), 'up');
equal('direction down', internals.directionOf({ pct: -1, change: -1 }), 'down');
equal('direction flat', internals.directionOf({ pct: 0, change: 0 }), 'flat');
equal('shown price uses prev close pre-open', internals.shownPrice({ price: null, prevClose: 1452 }), 1452);

console.log('\n[payload parsing]');
const targets = internals.parseMany('600519 000001 300750 601398 999999').targets;
const quotes = internals.readQuotes(PAYLOAD, targets);
equal('quote count', quotes.length, 5);
equal('pre-open price falls back', [quotes[0].price, quotes[0].prevClose, quotes[0].preOpen], [null, 1452, true]);
equal('live price', quotes[1].price, 11.98);
equal('live pct', quotes[1].pct, 2.92);
equal('negative pct', quotes[2].pct, -1.24);
equal('missing code flagged', quotes[4].missing, true);
check('market phase string', ['open', 'closed', 'auction'].includes(internals.marketPhase()), internals.marketPhase());
equal('empty payload tolerated', internals.readQuotes(null, targets).length, 5);

console.log('\n[industry boards]');
const SECTOR_PAYLOAD = {
  rc: 0,
  data: {
    total: 496,
    diff: [
      { f2: 4255.3, f3: 5.71, f12: 'BK1518', f13: 90, f14: '\u79cd\u5b50' },
      { f2: 1662.5, f3: 4.91, f12: 'BK1296', f13: 90, f14: '\u89c6\u9891\u5a92\u4f53' },
      { f2: 900, f3: '-', f12: 'BK0001', f13: 90, f14: '\u505c\u724c\u677f' }
    ]
  }
};
const sectors = internals.readSectors(SECTOR_PAYLOAD);
equal('sector rows', sectors.map((row) => row.name), ['\u79cd\u5b50', '\u89c6\u9891\u5a92\u4f53', '\u505c\u724c\u677f']);
equal('sector pct', sectors[0].pct, 5.71);
equal('sector dash pct is null', sectors[2].pct, null);
equal('sector code', sectors[0].code, 'BK1518');
equal('sector payload without data', internals.readSectors(null).length, 0);
check('sector url keeps the literal plus', internals.sectorUrl('up').includes('fs=m:90+t:2'), internals.sectorUrl('up'));
check('sector url direction desc', internals.sectorUrl('up').includes('po=1'));
check('sector url direction asc', internals.sectorUrl('down').includes('po=0'));
//#endregion

//#region store and feed
console.log('\n[settings store]');
const store = internals.createSettingsStore();
equal('store reads defaults', store.get().codes.length, 4);
let notified = 0;
const unsubscribe = store.subscribe(() => { notified += 1; });
store.set({ intervalSec: 9 });
equal('store notifies', notified, 1);
equal('store updates', store.get().intervalSec, 9);
check('store persists', JSON.parse(localStorageStub.getItem(internals.STORAGE_KEY)).intervalSec === 9);
store.set({ codes: ['600519', '000001'] });
equal('store normalises codes', store.get().codes, ['sh600519', 'sz000001']);
unsubscribe();

console.log('\n[quote feed]');
async function feedTest() {
  requests.length = 0;
  const settings = internals.createSettingsStore();
  settings.set({ intervalSec: 5, codes: ['600519', '000001'] });
  const feed = internals.createQuoteFeed(settings);
  const unsubscribeFeed = feed.subscribe(() => {});
  await new Promise((resolve) => setTimeout(resolve, 30));
  const state = feed.getState();
  equal('feed requested through host route', requests[0].split('?')[0], 'api/stockTicker/quotes');
  equal('feed quotes', state.quotes.map((quote) => quote.key), ['sh600519', 'sz000001']);
  check('feed timestamp', typeof state.ts === 'number' && state.ts > 0, state.ts);
  equal('feed no error', state.error, null);
  check('feed not loading', state.loading === false);

  feed.refresh();
  await new Promise((resolve) => setTimeout(resolve, 20));
  check('refresh re-requested', requests.length >= 2, requests.length);

  settings.set({ codes: [] });
  await new Promise((resolve) => setTimeout(resolve, 20));
  equal('empty codes clear quotes', feed.getState().quotes.length, 0);

  unsubscribeFeed();

  // Fallback path: the host route fails, the public endpoint answers.
  requests.length = 0;
  fetchImpl = async (url) => {
    requests.push(url);
    if (String(url).includes('stockTicker')) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => PAYLOAD };
  };
  const settings2 = internals.createSettingsStore();
  settings2.set({ codes: ['600519'] });
  const feed2 = internals.createQuoteFeed(settings2);
  const unsubscribe2 = feed2.subscribe(() => {});
  await new Promise((resolve) => setTimeout(resolve, 30));
  equal('fallback used upstream', requests.length, 2);
  check('fallback reached eastmoney', String(requests[1]).startsWith('https://push2.eastmoney.com'));
  equal('fallback quotes', feed2.getState().quotes.length, 1);
  unsubscribe2();

  // Error path.
  fetchImpl = async () => { throw new Error('network down'); };
  const settings3 = internals.createSettingsStore();
  settings3.set({ codes: ['600519'] });
  const feed3 = internals.createQuoteFeed(settings3);
  const unsubscribe3 = feed3.subscribe(() => {});
  await new Promise((resolve) => setTimeout(resolve, 30));
  equal('error surfaced', feed3.getState().error, 'network down');
  equal('error keeps loading false', feed3.getState().loading, false);
  unsubscribe3();

  // Disabled settings must not poll.
  fetchImpl = async (url) => { requests.push(url); return { ok: true, status: 200, json: async () => ({ ok: true, payload: PAYLOAD }) }; };
  requests.length = 0;
  const settings4 = internals.createSettingsStore();
  settings4.set({ enabled: false, codes: ['600519'] });
  const feed4 = internals.createQuoteFeed(settings4);
  const unsubscribe4 = feed4.subscribe(() => {});
  await new Promise((resolve) => setTimeout(resolve, 20));
  equal('disabled does not poll', requests.length, 0);
  unsubscribe4();
}
//#endregion

//#region rendering
console.log('\n[rendering]');
function fakeCtx() {
  return {    locale: {
      bind: () => (key, vars) => {
        const dict = internals.DICT_ZH || {};
        const template = dict[key] === undefined ? key : dict[key];
        if (vars === undefined) return template;
        return template.replace(/\{(\w+)\}/g, (match, name) => (vars[name] === undefined ? match : vars[name]));
      }
    }
  };
}
function fakeFeed(state) {
  return {
    getState: () => state,
    subscribe: () => () => {},
    refresh: () => {}
  };
}
function fakeStore(values) {
  return {
    get: () => values,
    set: () => {},
    subscribe: () => () => {}
  };
}

const baseSettings = internals.normalizeSettings(null);
const previewStore = internals.createPreviewStore();
const renderQuotes = internals.readQuotes(PAYLOAD, internals.parseMany('600519 000001 300750 601398').targets);
const snapshot = { quotes: renderQuotes, previews: [], ts: Date.now(), error: null, loading: false, phase: 'open', wanted: 4 };

function renderComponent(component, props) {
  const first = fake.render(component, props);
  for (const effect of first.effects) {
    const cleanup = effect();
    if (typeof cleanup === 'function') cleanup();
  }
  return first.tree;
}

/** Translate against the shipped Chinese dictionary (with `{name}` substitution). */
const ZN = (key, vars) => {
  const template = internals.DICT_ZH[key] === undefined ? key : internals.DICT_ZH[key];
  if (vars === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => (vars[name] === undefined ? match : vars[name]));
};

const tickerTree = renderComponent(internals.Ticker, {
  store: fakeStore(baseSettings),
  feed: fakeFeed(snapshot),
  previewStore: previewStore,
  ctx: fakeCtx()
});
const tickerText = fake.collectText(tickerTree);
check('ticker renders name', tickerText.includes('\u8d35\u5dde\u8305\u53f0'), tickerText.slice(0, 160));
check('ticker renders percent', tickerText.includes('+2.92%'), tickerText.slice(0, 160));
check('ticker renders panel title', tickerText.includes('A\u80a1\u5b9e\u65f6\u884c\u60c5'));
check('ticker renders all metrics', ['\u4eca\u5f00', '\u6700\u9ad8', '\u6700\u4f4e', '\u6628\u6536', '\u6210\u4ea4\u91cf', '\u6210\u4ea4\u989d', '\u632f\u5e45', '\u6362\u624b'].every((label) => tickerText.includes(label)));
check('ticker pill exists', fake.findClass(tickerTree, 'ast-pill') !== null);
check('ticker panel exists', fake.findClass(tickerTree, 'ast-panel-card') !== null);
check('ticker has 4 rows', fake.countClass(tickerTree, 'ast-row') === 4, fake.countClass(tickerTree, 'ast-row'));
check('reel has one extra loop row', fake.countClass(tickerTree, 'ast-reel-item') === 5, fake.countClass(tickerTree, 'ast-reel-item'));
check('reel starts at row 0', (() => {
  const track = fake.findClass(tickerTree, 'ast-reel-track');
  return track !== null && track.props.style.transform === 'translateY(0px)';
})());
check('reel track is not instant at rest', (() => {
  const track = fake.findClass(tickerTree, 'ast-reel-track');
  return track !== null && track.props['data-instant'] === 'false';
})());

const emptyTree = renderComponent(internals.Ticker, {
  store: fakeStore(baseSettings),
  feed: fakeFeed({ quotes: [], previews: [], ts: 0, error: null, loading: false, phase: 'closed', wanted: 0 }),
  previewStore: previewStore,
  ctx: fakeCtx()
});
check('empty ticker shows hint', fake.collectText(emptyTree).includes('\u672a\u914d\u7f6e\u80a1\u7968'));

const errorTree = renderComponent(internals.Ticker, {
  store: fakeStore(baseSettings),
  feed: fakeFeed({ quotes: [], previews: [], ts: 0, error: 'network down', loading: false, phase: 'open', wanted: 4 }),
  previewStore: previewStore,
  ctx: fakeCtx()
});
check('error ticker shows failure', fake.collectText(errorTree).includes('\u884c\u60c5\u83b7\u53d6\u5931\u8d25'));

const disabledTree = renderComponent(internals.Ticker, {
  store: fakeStore(internals.normalizeSettings({ enabled: false })),
  feed: fakeFeed(snapshot),
  previewStore: previewStore,
  ctx: fakeCtx()
});
check('disabled ticker renders nothing', disabledTree === null);

const settingsTree = renderComponent(internals.SettingsSection, {
  store: fakeStore(baseSettings),
  feed: fakeFeed(snapshot),
  ctx: fakeCtx()
});
const settingsText = fake.collectText(settingsTree);
check('settings renders title', settingsText.includes('A\u80a1\u5b9e\u65f6\u884c\u60c5'), settingsText.slice(0, 160));
check('settings renders chips', settingsText.includes('\u8d35\u5dde\u8305\u53f0'));
check('settings renders refresh rate', settingsText.includes('5 \u79d2'));
check('settings renders rotation label', settingsText.includes('\u8f6e\u64ad\u95f4\u9694'), settingsText.slice(0, 400));
check('settings renders rotation value', settingsText.includes('3 \u79d2/\u652f'), settingsText.slice(0, 400));
check('settings renders corners', ['\u5de6\u4e0a', '\u53f3\u4e0a', '\u5de6\u4e0b', '\u53f3\u4e0b'].every((label) => settingsText.includes(label)));
check('settings switch present', fake.findClass(settingsTree, 'ast-switch') !== null);
check('settings input present', fake.findClass(settingsTree, 'ast-input') !== null);
check('settings input is a combobox', (() => {
  const input = fake.findClass(settingsTree, 'ast-input');
  return input !== null && input.props.role === 'combobox';
})());
check('settings renders search tip', settingsText.includes('\u2191\u2193 \u9009\u62e9'), settingsText.slice(0, 400));

console.log('\n[symbol search]');
const byCode = internals.searchSymbols('600519', 5);
equal('exact code first', byCode[0].key, 'sh600519');
equal('code search name', byCode[0].name, '\u8d35\u5dde\u8305\u53f0');
check('name search finds the stock', internals.searchSymbols('\u8305\u53f0', 5).some((entry) => entry.key === 'sh600519'));
equal('name search ranks exact first', internals.searchSymbols('\u8d35\u5dde\u8305\u53f0', 3)[0].key, 'sh600519');
check('index by name', internals.searchSymbols('\u6caa\u6df1300', 8).some((entry) => entry.key === 'sh000300'), internals.searchSymbols('\u6caa\u6df1300', 8).map((e) => e.key));
check('code prefix search', internals.searchSymbols('6005', 8).every((entry) => entry.code.startsWith('6005')));
check('etf by name', internals.searchSymbols('\u6caa\u6df1300ETF', 8).some((entry) => entry.code === '510300'));
equal('no match', internals.searchSymbols('zzzz', 5).length, 0);
equal('empty query', internals.searchSymbols('  ', 5).length, 0);
check('table non-trivial', internals.symbolTableOf().length > 5000, internals.symbolTableOf().length);
check('venue labels', internals.venueLabel('sh') === '\u6caa' && internals.venueLabel('sz') === '\u6df1' && internals.venueLabel('bj') === '\u4eac');

// Render one suggestion row directly (a plain function of props, no hooks).
const suggNode = fake.render(function SuggestionProp() {
  return internals.suggestionRow({ key: 'sh600519', code: '600519', name: '\u8d35\u5dde\u8305\u53f0', prefix: 'sh' }, true, false, () => {});
}, {});
const suggText = fake.collectText(suggNode.tree);
check('suggestion shows name', suggText.includes('\u8d35\u5dde\u8305\u53f0'), suggText);
check('suggestion shows code', suggText.includes('600519'), suggText);
check('suggestion shows venue', suggText.includes('\u6caa'), suggText);

console.log('\n[preview store]');
const previewForTest = internals.createPreviewStore();
let previewNotifications = 0;
const unsubscribePreview = previewForTest.subscribe(() => { previewNotifications += 1; });
previewForTest.add('sh600519');
previewForTest.add('sh600519');
equal('preview dedupes', previewForTest.get(), ['sh600519']);
equal('preview notifies once', previewNotifications, 1);
previewForTest.add('sz000001');
previewForTest.remove('sh600519');
equal('preview remove', previewForTest.get(), ['sz000001']);
previewForTest.clear();
equal('preview clear', previewForTest.get(), []);
unsubscribePreview();

const previewQuote = internals.toQuote(
  { f1: 2, f2: 11.98, f3: 2.92, f4: 0.34, f12: '000001', f13: 0, f14: '\u5e73\u5b89\u94f6\u884c', f18: 11.64 },
  { key: 'sz000001', code: '000001', prefix: 'sz', market: 0, secid: '0.000001', preview: true }
);
check('preview quote flagged', previewQuote.preview === true);
const previewTree = renderComponent(internals.Ticker, {
  store: fakeStore(baseSettings),
  feed: fakeFeed({
    quotes: renderQuotes,
    previews: [previewQuote],
    ts: Date.now(),
    error: null,
    loading: false,
    phase: 'open',
    wanted: 5
  }),
  previewStore: previewForTest,
  ctx: fakeCtx()
});
const previewText = fake.collectText(previewTree);
check('preview group title', previewText.includes('\u4e34\u65f6\u67e5\u770b'), previewText.slice(0, 200));
check('preview row tag', previewText.includes('\u67e5\u770b'), previewText.slice(0, 200));
check('preview remove button', fake.countClass(previewTree, 'ast-row-remove') === 1, fake.countClass(previewTree, 'ast-row-remove'));
check('panel search input', fake.findClass(previewTree, 'ast-search-input') !== null);
//#endregion

console.log('\n[apply wiring]');
const registrations = [];
const ctx = {
  effect(factory) {
    const cleanup = factory();
    return typeof cleanup === 'function' ? cleanup : () => {};
  },
  locale: {
    register: () => () => {},
    bind: () => (key) => key
  },
  slots: {
    inject(name, callback) {
      registrations.push(name);
      return callback();
    },
    register(options, component) {
      registrations.push(options.name + '#' + options.id + '@' + String(options.order));
      check('registered component is a function (' + options.id + ')', typeof component === 'function');
      return () => {};
    }
  }
};
plugin.apply(ctx);
equal('both slots injected', registrations, [
  'shell.overlay',
  'shell.overlay#a-stock-ticker@60',
  'settings.section',
  'settings.section#a-stock-ticker@26'
]);
check('style sheet mounted', styleElements.length === 1, styleElements.length);
check('style sheet tagged', styleElements[0].attributes['data-plugin'] === 'dsh-a-stock-ticker');
check('css has reel rules', styleElements[0].textContent.includes('.ast-reel-track'));
check('css has no marquee left', !styleElements[0].textContent.includes('ast-marquee'));
check('css has panel rule', styleElements[0].textContent.includes('.ast-panel-card'));
check('css has two-column panel body', styleElements[0].textContent.includes('.ast-panel-body'));
check('css has sector rows', styleElements[0].textContent.includes('.ast-sector-pct'));
check('css has chart rules', styleElements[0].textContent.includes('.ast-ch-svg'));

console.log('\n[intraday candles]');
const KLINE_PAYLOAD = {
  rc: 0,
  data: {
    code: '600519',
    market: 1,
    name: '\u8d35\u5dde\u8305\u53f0',
    preKPrice: 1457.7,
    klines: [
      '2026-11-17 14:59,1455.00,1457.70,1458.00,1454.00,900,1000000.00',
      '2026-11-18 09:31,1450.00,1444.72,1450.00,1440.03,1740,251714209.00',
      '2026-11-18 09:32,1445.77,1447.10,1448.55,1445.77,370,53540170.00',
      '2026-11-18 09:33,1448.65,1445.97,1449.01,1445.77,370,53556209.00',
      '2026-11-18 09:34,1446.29,1448.41,1448.41,1446.00,360,52000000.00',
      '2026-11-18 09:35,1448.50,1449.10,1449.50,1447.90,300,43000000.00'
    ]
  }
};
const intraday = internals.readIntraday(KLINE_PAYLOAD);
equal('only the latest session kept', intraday.bars.length, 5);
equal('previous close parsed', intraday.prevClose, 1457.7);
equal('bar times are hh:mm', intraday.bars[0].time, '09:31');
equal('bar ohlc', [intraday.bars[0].open, intraday.bars[0].close, intraday.bars[0].high, intraday.bars[0].low],
  [1450, 1444.72, 1450, 1440.03]);
equal('bar volume', intraday.bars[0].volume, 1740);
equal('empty payload tolerated', internals.readIntraday(null).bars.length, 0);
check('kline url secid', internals.klineUrl('1.600519').includes('secid=1.600519'));
check('kline url sends klt=1', internals.klineUrl('1.600519').includes('klt=1'));

const fiveMin = internals.bucketBars(intraday.bars, 5);
equal('5m buckets', fiveMin.length, 1);
equal('bucket open', fiveMin[0].open, 1450);
equal('bucket close', fiveMin[0].close, 1449.10);
equal('bucket high', fiveMin[0].high, 1450);
equal('bucket low', fiveMin[0].low, 1440.03);
equal('bucket volume summed', fiveMin[0].volume, 1740 + 370 + 370 + 360 + 300);
equal('1m passthrough', internals.bucketBars(intraday.bars, 1).length, 5);

const chartTree = renderComponent(internals.IntradayChart, {
  chart: { bars: intraday.bars, prevClose: intraday.prevClose, loading: false, error: null },
  mode: '1',
  onMode: () => {},
  t: ZN
});
const chartText = fake.collectText(chartTree);
check('chart title', chartText.includes('\u76d8\u4e2d\u8d70\u52bf'), chartText.slice(0, 120));
check('chart mode buttons', chartText.includes('\u5206\u65f6') && chartText.includes('1\u5206') && chartText.includes('5\u5206'), chartText);
check('chart shows last time', chartText.includes('09:35'), chartText);
const svgNode = fake.findClass(chartTree, 'ast-ch-svg');
check('chart svg present', svgNode !== null);
let rectCount = 0;
let lineCount = 0;
const walkSvg = (node) => {
  if (node === null || node === undefined) return;
  if (node.tag === 'rect') rectCount += 1;
  if (node.tag === 'line') lineCount += 1;
  if (node.children !== undefined) for (const child of node.children) walkSvg(child);
};
walkSvg(svgNode);
equal('one body + one volume rect per bar', rectCount, 10);
check('wick lines + prev close line', lineCount === 6, lineCount);

const chartLoading = renderComponent(internals.IntradayChart, {
  chart: { bars: [], prevClose: null, loading: true, error: null }, mode: '1', onMode: () => {}, t: ZN
});
check('chart loading state', fake.collectText(chartLoading).includes('\u52a0\u8f7dK\u7ebf'), fake.collectText(chartLoading));
const chartError = renderComponent(internals.IntradayChart, {
  chart: { bars: [], prevClose: null, loading: false, error: 'boom' }, mode: '1', onMode: () => {}, t: ZN
});
check('chart error state', fake.collectText(chartError).includes('K\u7ebf\u83b7\u53d6\u5931\u8d25'), fake.collectText(chartError));

// A sealed limit session: every bar at one price, 10% away from the previous
// close. The old range pulled in the previous close and squashed the whole
// session onto the pane edge; it must now be a centred flat line.
const sealedBars = [];
for (let minute = 0; minute < 33; minute += 1) {
  sealedBars.push({ time: '09:' + String(31 + minute).padStart(2, '0'), open: 3.03, close: 3.03, high: 3.03, low: 3.03, volume: minute === 0 ? 127036 : 6000 });
}
const sealedTree = renderComponent(internals.IntradayChart, {
  chart: { bars: sealedBars, prevClose: 3.37, loading: false, error: null },
  mode: '1',
  onMode: () => {},
  t: ZN
});
const sealedText = fake.collectText(sealedTree);
check('sealed session marked as flat', sealedText.includes('\u4e00\u5b57'), sealedText.slice(0, 120));
check('sealed session shows its price', sealedText.includes('3.03'), sealedText.slice(0, 120));
let sealedRects = 0;
let sealedLines = 0;
const walkSealed = (node) => {
  if (node === null || node === undefined) return;
  if (node.tag === 'rect') sealedRects += 1;
  if (node.tag === 'line') sealedLines += 1;
  if (node.children !== undefined) for (const child of node.children) walkSealed(child);
};
walkSealed(fake.findClass(sealedTree, 'ast-ch-svg'));
equal('sealed session draws volume bars only', sealedRects, sealedBars.length);
equal('sealed session draws one flat line, no distant prev close', sealedLines, 1);
check('sealed price axis is a narrow band around the price', sealedText.includes('3.021') && sealedText.includes('3.039'), sealedText.slice(0, 200));
check('sealed axis does not include the 10% gap', !sealedText.includes('3.370'), sealedText.slice(0, 200));

// THS-style intraday line: a symmetric percent grid around the previous close.
console.log('\n[time-share chart]');
equal('session slots', [
  internals.sessionSlot('09:30'),
  internals.sessionSlot('11:30'),
  internals.sessionSlot('13:00'),
  internals.sessionSlot('15:00')
], [0, 120, 121, 241]);

const series = internals.timeShareSeries(intraday.bars);
equal('series prepends the 09:30 open', series[0].time, '09:30');
equal('09:30 price is the open', series[0].price, 1450);
equal('series length', series.length, intraday.bars.length + 1);
equal('series slot of the first minute bar', series[1].slot, 1);
const firstVwap = series[1].avg;
check('avg price is a VWAP (below the close for a selling open)', firstVwap > 1444 && firstVwap < 1450, firstVwap);
check('avg moves towards the traded prices', series[series.length - 1].avg !== series[1].avg, [series[1].avg, series[series.length - 1].avg]);

const timeShareTree = renderComponent(internals.IntradayChart, {
  chart: { bars: sealedBars, prevClose: 3.37, loading: false, error: null },
  mode: 'time',
  onMode: () => {},
  t: ZN
});
const timeShareText = fake.collectText(timeShareTree);
check('time-share shows percent axis', timeShareText.includes('-11.00%') && timeShareText.includes('+11.00%'), timeShareText.slice(0, 300));
check('time-share shows the previous close line label', timeShareText.includes('3.370'), timeShareText.slice(0, 300));
check('time-share shows the price axis bounds', timeShareText.includes('3.741') && timeShareText.includes('2.999'), timeShareText.slice(0, 300));
check('time-share shows session ticks', timeShareText.includes('09:30') && timeShareText.includes('11:30/13:00') && timeShareText.includes('15:00'), timeShareText.slice(0, 400));
check('time-share keeps the sealed-session hint', timeShareText.includes('\u4e00\u5b57'), timeShareText.slice(0, 120));

let tsGrid = 0;
let tsBase = 0;
let tsPoly = 0;
let tsRect = 0;
let tsCircle = 0;
const walkTimeShare = (node) => {
  if (node === null || node === undefined) return;
  const cls = typeof node.props === 'object' && node.props !== null ? node.props.className : '';
  if (node.tag === 'line' && cls === 'ast-ch-grid') tsGrid += 1;
  if (node.tag === 'line' && cls === 'ast-ch-baseline') tsBase += 1;
  if (node.tag === 'polyline') tsPoly += 1;
  if (node.tag === 'rect') tsRect += 1;
  if (node.tag === 'circle') tsCircle += 1;
  if (node.children !== undefined) for (const child of node.children) walkTimeShare(child);
};
walkTimeShare(fake.findClass(timeShareTree, 'ast-ch-svg'));
equal('four solid grid lines + lunch divider', tsGrid, 5);
equal('one dashed previous-close baseline', tsBase, 1);
equal('price and average polylines', tsPoly, 2);
equal('volume bar per point', tsRect, sealedBars.length + 1);
equal('last price dot', tsCircle, 1);
check('price line is flat for a sealed session', (() => {
  let flat = true;
  let ys = null;
  const visit = (node) => {
    if (node === null || node === undefined) return;
    if (node.tag === 'polyline' && node.props.className === 'ast-ch-price') {
      ys = String(node.props.points).split(' ').map((pair) => Number(pair.split(',')[1]));
    }
    if (node.children !== undefined) for (const child of node.children) visit(child);
  };
  visit(fake.findClass(timeShareTree, 'ast-ch-svg'));
  if (ys === null || ys.length === 0) return false;
  for (const y of ys) if (Math.abs(y - ys[0]) > 0.001) flat = false;
  return flat;
})());

// A normal session keeps a tight grid and a moving line.
const normalTimeShare = renderComponent(internals.IntradayChart, {
  chart: { bars: intraday.bars, prevClose: 1457.7, loading: false, error: null },
  mode: 'time', onMode: () => {}, t: ZN
});
const normalShareText = fake.collectText(normalTimeShare);
check('normal session uses a tight percent grid', normalShareText.includes('-1.00%') && normalShareText.includes('+1.00%'), normalShareText.slice(0, 300));
check('normal session price axis around prev close', normalShareText.includes('1472.28') && normalShareText.includes('1443.12'), normalShareText.slice(0, 300));

// Index feeds carry their constituents' turnover, so the volume/amount ratio is
// not the index's VWAP (it computes to ~14 instead of ~3500). The average must
// fall back to the running mean instead of blowing up the percent grid.
const indexBars = [
  { time: '09:31', open: 3527.30, close: 3520.10, high: 3527.30, low: 3518.00, volume: 2.1e8, amount: 3.0e11 },
  { time: '09:32', open: 3520.10, close: 3510.00, high: 3520.10, low: 3508.00, volume: 1.8e8, amount: 2.6e11 },
  { time: '09:33', open: 3510.00, close: 3502.87, high: 3512.00, low: 3502.34, volume: 1.5e8, amount: 2.1e11 }
];
const indexSeries = internals.timeShareSeries(indexBars);
equal('index series prepends the open', indexSeries.length, 4);
check('index average stays inside the price range', indexSeries.every((point) => point.avg >= 3502 && point.avg <= 3528), indexSeries.map((p) => p.avg));
const indexChart = renderComponent(internals.IntradayChart, {
  chart: { bars: indexBars, prevClose: 3577.62, loading: false, error: null },
  mode: 'time',
  onMode: () => {},
  t: ZN
});
const indexText = fake.collectText(indexChart);
check('index grid uses the tight step, not the widest', indexText.includes('+2.50%') && indexText.includes('-2.50%'), indexText.slice(0, 320));
check('index grid never falls back to 20%', !indexText.includes('+20.00%') && !indexText.includes('-20.00%'), indexText.slice(0, 320));
check('index price axis around prev close', indexText.includes('3667.06') && indexText.includes('3488.18'), indexText.slice(0, 320));



// A normal day keeps the previous-close reference line.
const normalRange = renderComponent(internals.IntradayChart, {
  chart: { bars: intraday.bars, prevClose: 1457.7, loading: false, error: null },
  mode: '1', onMode: () => {}, t: ZN
});
let normalLines = 0;
const walkNormal = (node) => {
  if (node === null || node === undefined) return;
  if (node.tag === 'line') normalLines += 1;
  if (node.children !== undefined) for (const child of node.children) walkNormal(child);
};
walkNormal(fake.findClass(normalRange, 'ast-ch-svg'));
equal('normal day keeps the prev-close line', normalLines, intraday.bars.length + 1);
check('normal day axis includes the gap reference', fake.collectText(normalRange).includes('1457.70'), fake.collectText(normalRange).slice(0, 200));

// A 5m view over the same flat day stays flat too.
const sealedFive = renderComponent(internals.IntradayChart, {
  chart: { bars: sealedBars, prevClose: 3.37, loading: false, error: null }, mode: '5', onMode: () => {}, t: ZN
});
check('5m view of a flat day still flat', fake.collectText(sealedFive).includes('\u4e00\u5b57'), fake.collectText(sealedFive).slice(0, 120));


const toggleRowTree = fake.render(function ToggleRow() {
  return internals.panelRow(renderQuotes[0], ZN, { expanded: false, onToggle: () => {} });
}, {}).tree;
const toggleRow = fake.findClass(toggleRowTree, 'ast-row');
check('row is a toggle button', toggleRow.props.role === 'button' && toggleRow.props.tabIndex === 0);
check('row exposes aria-expanded', toggleRow.props['aria-expanded'] === 'false');
check('row has a click handler', typeof toggleRow.props.onClick === 'function');
check('row has a keyboard handler', typeof toggleRow.props.onKeyDown === 'function');
check('row shows a caret', fake.countClass(toggleRowTree, 'ast-row-caret') === 1);
const expandedRowTree = fake.render(function ExpandedRow() {
  return internals.panelRow(renderQuotes[0], ZN, { expanded: true, onToggle: () => {} });
}, {}).tree;
const expandedRow = fake.findClass(expandedRowTree, 'ast-row');
check('expanded row flagged', expandedRow.props['data-expanded'] === 'true' && expandedRow.props['aria-expanded'] === 'true');
const plainRowTree = fake.render(function PlainRow() {
  return internals.panelRow(renderQuotes[0], ZN, {});
}, {}).tree;
const plainRow = fake.findClass(plainRowTree, 'ast-row');
check('plain row is not a button', plainRow.props.role === undefined && plainRow.props.onClick === undefined);


console.log('\n[sector column]');
const board = {
  up: [{ code: 'BK1518', name: '\u79cd\u5b50', pct: 5.71 }, { code: 'BK1296', name: '\u89c6\u9891\u5a92\u4f53', pct: 4.91 }],
  down: [{ code: 'BK1550', name: '\u8d38\u6613', pct: -0.24 }, { code: 'BK1401', name: '\u94f6\u884c', pct: -1.23 }],
  ts: Date.now(),
  error: null,
  loading: false
};
const sectorTree = renderComponent(internals.SectorColumn, { board, t: ZN });
const sectorText = fake.collectText(sectorTree);
check('sector column title', sectorText.includes('\u884c\u4e1a\u6307\u6570'), sectorText.slice(0, 120));
check('sector column group labels', sectorText.includes('\u9886\u6da8') && sectorText.includes('\u9886\u8dcc'), sectorText.slice(0, 200));
check('sector column rows', sectorText.includes('\u79cd\u5b50') && sectorText.includes('+5.71%') && sectorText.includes('-1.23%'), sectorText.slice(0, 300));
equal('sector column row count', fake.countClass(sectorTree, 'ast-sector'), 4);

const sectorLoadingTree = renderComponent(internals.SectorColumn, {
  board: { up: [], down: [], ts: 0, error: null, loading: true }, t: ZN
});
check('sector column loading state', fake.collectText(sectorLoadingTree).includes('\u52a0\u8f7d\u677f\u5757'), fake.collectText(sectorLoadingTree));

const sectorErrorTree = renderComponent(internals.SectorColumn, {
  board: { up: [], down: [], ts: 0, error: 'boom', loading: false }, t: ZN
});
check('sector column error state', fake.collectText(sectorErrorTree).includes('\u677f\u5757\u83b7\u53d6\u5931\u8d25'), fake.collectText(sectorErrorTree));

async function sectorFetchTest() {
  requests.length = 0;
  fetchImpl = async (url) => {
    requests.push(url);
    if (String(url).includes('stockTicker/sectors')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, payload: SECTOR_PAYLOAD }) };
    }
    return { ok: true, status: 200, json: async () => SECTOR_PAYLOAD };
  };
  const up = await internals.requestSectors('up', undefined);
  equal('sectors prefer the host route', String(requests[0]).split('?')[0], 'api/stockTicker/sectors');
  equal('sectors host payload parsed', internals.readSectors(up).length, 3);

  requests.length = 0;
  fetchImpl = async (url) => {
    requests.push(url);
    if (String(url).includes('stockTicker/sectors')) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => SECTOR_PAYLOAD };
  };
  const down = await internals.requestSectors('down', undefined);
  check('sectors fall back to eastmoney', String(requests[1]).startsWith('https://push2.eastmoney.com/api/qt/clist/get'), requests[1]);
  check('sector fallback keeps the plus', String(requests[1]).includes('fs=m:90+t:2'));
  equal('sectors fallback payload parsed', internals.readSectors(down).length, 3);
}

async function previewFeedTest() {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  fetchImpl = async (url) => {
    requests.push(url);
    return { ok: true, status: 200, json: async () => ({ ok: true, payload: PAYLOAD }) };
  };
  const settings = internals.createSettingsStore();
  settings.set({ enabled: true, codes: ['600519'] });
  const preview = internals.createPreviewStore();
  const feed = internals.createQuoteFeed(settings, preview);
  const unsubscribe = feed.subscribe(() => {});
  await wait(30);
  equal('monitored feed starts alone', feed.getState().quotes.map((quote) => quote.key), ['sh600519']);
  equal('no previews initially', feed.getState().previews.length, 0);

  requests.length = 0;
  preview.add('000001');
  await wait(40);
  const state = feed.getState();
  equal('preview polled together, still split', state.quotes.map((quote) => quote.key), ['sh600519']);
  equal('preview separated from monitored', state.previews.map((quote) => quote.key), ['sz000001']);
  check('preview secid reached the request', decodeURIComponent(String(requests[0])).includes('0.000001'), requests[0]);

  preview.remove('000001');
  await wait(40);
  equal('preview removal clears it', feed.getState().previews.length, 0);
  unsubscribe();
}

//#region switching rows (mini React with persistent hooks)
/**
 * A very small React with persistent hook state and re-render-on-setState, used
 * to drive the real Ticker through hover -> click -> chart fetch.
 */
function createMiniReact() {
  const hookStore = new Map();
  let dirty = false;
  let effects = [];
  let owner = null;
  let cursor = 0;

  const slot = () => {
    let list = hookStore.get(owner);
    if (list === undefined) {
      list = [];
      hookStore.set(owner, list);
    }
    const index = cursor++;
    if (list[index] === undefined) list[index] = {};
    return list[index];
  };
  const depsChanged = (a, b) => !Array.isArray(a) || !Array.isArray(b)
    || a.length !== b.length || a.some((value, index) => !Object.is(value, b[index]));

  function useState(initial) {
    const cell = slot();
    if (!('value' in cell)) cell.value = typeof initial === 'function' ? initial() : initial;
    return [cell.value, (next) => {
      const value = typeof next === 'function' ? next(cell.value) : next;
      if (Object.is(value, cell.value)) return;
      cell.value = value;
      dirty = true;
    }];
  }
  function useEffect(fn, deps) {
    const cell = slot();
    if ('deps' in cell && !depsChanged(cell.deps, deps)) return;
    cell.deps = deps;
    cell.pending = fn;
    effects.push(cell);
  }
  function useRef(initial) {
    const cell = slot();
    if (!('current' in cell)) cell.current = initial;
    return cell;
  }
  function useMemo(fn, deps) {
    const cell = slot();
    if (!('deps' in cell) || depsChanged(cell.deps, deps)) {
      cell.memo = fn();
      cell.deps = deps;
    }
    return cell.memo;
  }
  function useCallback(fn, deps) {
    return useMemo(() => fn, deps);
  }

  function createElement(type, props, ...children) {
    const flat = [];
    const push = (value) => {
      if (Array.isArray(value)) value.forEach(push);
      else flat.push(value);
    };
    children.forEach(push);
    return { type, props: props || {}, children: flat };
  }

  function walk(node) {
    if (node === null || node === undefined || node === false || node === true) return null;
    if (typeof node === 'string' || typeof node === 'number') return { text: String(node) };
    if (Array.isArray(node)) return { children: node.map(walk).filter((child) => child !== null) };
    if (typeof node.type === 'function') {
      const previousOwner = owner;
      const previousCursor = cursor;
      owner = node.type;
      cursor = 0;
      const output = walk(node.type(node.props));
      owner = previousOwner;
      cursor = previousCursor;
      return output;
    }
    return { tag: node.type, props: node.props, children: node.children.map(walk).filter((child) => child !== null) };
  }

  function flush() {
    const pending = effects;
    effects = [];
    for (const cell of pending) {
      if (typeof cell.cleanup === 'function') cell.cleanup();
      cell.cleanup = cell.pending();
      cell.pending = null;
    }
  }

  function textOf(tree) {
    const out = [];
    const visit = (node) => {
      if (node === null || node === undefined) return;
      if (node.text !== undefined) {
        out.push(node.text);
        return;
      }
      if (node.children !== undefined) for (const child of node.children) visit(child);
    };
    visit(tree);
    return out.join('');
  }

  function byClass(tree, name) {
    const found = [];
    const visit = (node) => {
      if (node === null || node === undefined) return;
      if (node.tag !== undefined) {
        const className = typeof node.props.className === 'string' ? node.props.className : '';
        if (className.split(/\s+/).includes(name)) found.push(node);
        for (const child of node.children) visit(child);
        return;
      }
      if (node.children !== undefined) for (const child of node.children) visit(child);
    };
    visit(tree);
    return found;
  }

  async function settle(component, props) {
    let tree = null;
    for (let pass = 0; pass < 40; pass += 1) {
      dirty = false;
      effects = [];
      tree = walk(createElement(component, props));
      flush();
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!dirty) return tree;
    }
    return tree;
  }

  return {
    React: { createElement, useState, useEffect, useRef, useMemo, useCallback },
    settle,
    textOf,
    byClass,
    dispose() {
      for (const list of hookStore.values()) {
        for (const cell of list) {
          if (cell !== null && typeof cell === 'object' && typeof cell.cleanup === 'function') {
            cell.cleanup();
            cell.cleanup = null;
          }
        }
      }
      hookStore.clear();
    }
  };
}
//#endregion

console.log('\n[switching rows updates the chart]');
equal('view guard drops a stale snapshot', (() => {
  const stale = { key: '1.600519', bars: [{ time: '09:31' }], prevClose: 1457.7, ts: 1, error: null, loading: false };
  const view = internals.intradayViewFor(stale, '0.000001');
  return view.bars.length === 0 && view.loading === true && view.key === '0.000001';
})(), true);
check('view guard passes the matching snapshot', (() => {
  const fresh = { key: '1.600519', bars: [1], prevClose: 1, ts: 1, error: null, loading: false };
  return internals.intradayViewFor(fresh, '1.600519') === fresh;
})());

const mini = createMiniReact();
const miniRequire = (name) => {
  if (name === 'react') return mini.React;
  throw new Error('unexpected require: ' + name);
};
const miniSource = SOURCE.replace("return {\n      inject: ['slots', 'locale'],\n      apply: apply\n    };", EXPOSE);
const miniWindow = { __ModuleLoader__: { load(spec) { miniWindow.spec = spec; } } };
const miniRun = new Function(
  'window', 'document', 'localStorage', 'fetch', 'ResizeObserver', 'AbortController', 'console',
  miniSource
);
miniRun(miniWindow, documentStub, localStorageStub, (url, options) => fetchImpl(url, options), undefined, AbortController, console);
const miniPlugin = miniWindow.spec.factory(miniRequire);
const miniInternals = miniPlugin.__test;

/** Candles keyed by secid so a wrong secid is visible in the rendered axis. */
const klineFor = (secid) => {
  if (secid === '1.600519') {
    return { rc: 0, data: { name: '贵州茅台', preKPrice: 1457.7, klines: [
      '2026-11-18 09:31,1450.00,1444.72,1450.00,1440.03,1740,251714209.00',
      '2026-11-18 09:32,1445.77,1447.10,1448.55,1445.77,370,53540170.00'
    ] } };
  }
  return { rc: 0, data: { name: '平安银行', preKPrice: 11.64, klines: [
    '2026-11-18 09:31,11.70,11.90,11.92,11.68,1200,1428000.00',
    '2026-11-18 09:32,11.90,11.88,11.91,11.86,800,950000.00'
  ] } };
};

async function switchTest() {
  // Any request the real component makes is answered locally.
  fetchImpl = async (url) => {
    requests.push(url);
    const text = String(url);
    if (text.includes('kline') || text.includes('push2his')) {
      const match = /secid=([^&]+)/.exec(text);
      const secid = match === null ? '' : decodeURIComponent(match[1]);
      if (text.includes('stockTicker')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, payload: klineFor(secid) }) };
      }
      return { ok: true, status: 200, json: async () => klineFor(secid) };
    }
    if (text.includes('sectors')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, payload: { data: { diff: [] } } }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, payload: PAYLOAD }) };
  };

  const settings = miniInternals.createSettingsStore();
  settings.set({ enabled: true, codes: ['600519', '000001'] });
  const preview = miniInternals.createPreviewStore();
  const feed = miniInternals.createQuoteFeed(settings, preview);
  const props = {
    store: settings,
    feed: feed,
    previewStore: preview,
    ctx: { locale: { bind: () => (key, vars) => ZN(key, vars) } }
  };

  let tree = await mini.settle(miniInternals.Ticker, props);
  const hud = mini.byClass(tree, 'ast-hud')[0];
  check('HUD owns the hover handlers', hud !== null
    && typeof hud.props.onMouseEnter === 'function'
    && typeof hud.props.onMouseLeave === 'function');
  check('pill no longer owns hover', typeof mini.byClass(tree, 'ast-pill')[0].props.onMouseEnter === 'undefined');

  hud.props.onMouseEnter();
  tree = await mini.settle(miniInternals.Ticker, props);

  const rows = mini.byClass(tree, 'ast-row');
  equal('two rows rendered', rows.length, 2);
  const rowFor = (name) => rows.find((row) => mini.textOf(row).includes(name));
  const firstRow = rowFor('\u8d35\u5dde\u8305\u53f0');
  const secondRow = rowFor('\u5e73\u5b89\u94f6\u884c');
  check('both rows found', firstRow !== undefined && secondRow !== undefined);

  firstRow.props.onClick();
  tree = await mini.settle(miniInternals.Ticker, props);
  let chartText = mini.textOf(mini.byClass(tree, 'ast-chart')[0]);
  check('first click renders the first stock axis', chartText.includes('1472.28'), chartText.slice(0, 200));

  // The regression: clicking the other row in the panel must switch the chart.
  rowFor('\u5e73\u5b89\u94f6\u884c').props.onClick();
  tree = await mini.settle(miniInternals.Ticker, props);
  const charts = mini.byClass(tree, 'ast-chart');
  equal('exactly one chart is open', charts.length, 1);
  chartText = mini.textOf(charts[0]);
  check('chart switched to the second stock', chartText.includes('11.93') && chartText.includes('11.35'), chartText.slice(0, 240));
  check('chart no longer shows the first stock', !chartText.includes('1472.28'), chartText.slice(0, 240));
  const chartRow = mini.byClass(tree, 'ast-row-block').find((block) => block.props['data-expanded'] === 'true');
  check('the expanded block is the second stock', mini.textOf(chartRow).includes('\u5e73\u5b89\u94f6\u884c'));

  // Clicking the same row again closes it.
  rowFor('\u5e73\u5b89\u94f6\u884c').props.onClick();
  tree = await mini.settle(miniInternals.Ticker, props);
  equal('second click closes the chart', mini.byClass(tree, 'ast-chart').length, 0);

  mini.dispose();
}

Promise.resolve(feedTest())
  .then(() => sectorFetchTest())
  .then(() => previewFeedTest())
  .then(() => switchTest())
  .then(() => {
    console.log('\n[result] ' + (failures === 0 ? 'all checks passed' : failures + ' check(s) failed'));
    if (failures !== 0) process.exit(1);
  });

