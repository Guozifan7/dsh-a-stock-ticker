/**
 * Host half of the A-share ticker bundle.
 *
 * It owns exactly one operation the browser half cannot rely on: reading the
 * public Eastmoney endpoints from the Host process. The routes are registered on
 * Connection's exact Fetch registry, so they live under the `/api` prefix and are
 * already behind `connection.admit(request)` (the Host/Origin fence plus the
 * signed browser-session cookie) before a handler runs.
 *
 * Each handler is a thin proxy: it validates its parameters, forwards one
 * upstream request with a short timeout, and returns the upstream JSON payload
 * verbatim. Normalising that payload stays in the Client half, which also keeps
 * a direct-to-upstream fallback, so there is exactly one parser per payload.
 *
 * @module dsh-a-stock-ticker
 */

/** Exact Fetch route for the monitored quotes. */
const ROUTE_PATH = '/api/stockTicker/quotes';

/** Exact Fetch route for the industry board ranking. */
const SECTOR_PATH = '/api/stockTicker/sectors';

/** Exact Fetch route for the intraday candles. */
const KLINE_PATH = '/api/stockTicker/kline';

/** Public intraday candle endpoint (Eastmoney push2his). */
const KLINE_UPSTREAM = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';

/** Intraday candle fields: time, open, close, high, low, volume, amount. */
const KLINE_FIELDS1 = 'f1,f2,f3,f4,f5,f6';
const KLINE_FIELDS2 = 'f51,f52,f53,f54,f55,f56,f57';

/** One day of 1-minute bars, which is all the panel chart draws. */
const KLINE_LIMIT = 300;

/** Public quote endpoint (Eastmoney push2). */
const UPSTREAM = 'https://push2.eastmoney.com/api/qt/ulist.np/get';

/** Public industry board list endpoint (Eastmoney push2). */
const SECTOR_UPSTREAM = 'https://push2.eastmoney.com/api/qt/clist/get';

/** Upstream selector for the industry boards: `m:90 t:2`. */
const SECTOR_UNIVERSE = 'm:90+t:2';

/** Board fields: index value, change %, code, market, name. */
const SECTOR_FIELDS = 'f2,f3,f12,f13,f14';

/** Upper bound on the board rows one request may ask for. */
const MAX_SECTOR_ROWS = 30;

/**
 * Quote fields, matching the Client half: name, price, change, change %,
 * volume, amount, amplitude, turnover, PE, code, market, high, low, open,
 * previous close, market caps and the price precision.
 */
const FIELDS = 'f1,f2,f3,f4,f5,f6,f7,f8,f9,f12,f13,f14,f15,f16,f17,f18,f20,f21';

/** Upper bound on one request's codes, so a single call stays small. */
const MAX_CODES = 60;

/** Upstream budget per request, in milliseconds. */
const UPSTREAM_TIMEOUT_MS = 8000;

/** The Host service this route cannot work without. */
export const inject = ['connection'];

/**
 * Build a JSON response with caching disabled.
 * @param status - HTTP status code.
 * @param payload - JSON-serialisable body.
 * @returns the Fetch response.
 */
function jsonResponse(status, payload) {
  return Response.json(payload, { status, headers: { 'cache-control': 'no-store' } });
}

/**
 * Validate one requested security id.
 *
 * Only the market prefix and a six digit code are accepted, so the value that
 * reaches the upstream URL is always one of the two shapes the endpoint uses.
 *
 * @param value - raw `secids` member, e.g. `1.600519`.
 * @returns whether the value may be forwarded.
 */
function isSecid(value) {
  return typeof value === 'string' && /^[01]\.\d{6}$/.test(value);
}

/**
 * Read and validate the requested security ids.
 * @param url - the incoming request URL.
 * @returns the accepted ids, or `undefined` when the request is malformed.
 */
function parseSecids(url) {
  const raw = url.searchParams.get('secids');
  if (typeof raw !== 'string' || raw === '') return undefined;
  const parts = raw.split(',').map((part) => part.trim()).filter((part) => part !== '');
  if (parts.length === 0 || parts.length > MAX_CODES) return undefined;
  const accepted = [];
  for (const part of parts) {
    if (!isSecid(part)) return undefined;
    if (!accepted.includes(part)) accepted.push(part);
  }
  return accepted;
}

/**
 * Forward one GET to an upstream endpoint and return its JSON body.
 * @param target - absolute upstream URL.
 * @returns `{ ok: true, payload }` or a failure descriptor.
 */
async function fetchUpstream(target) {
  try {
    const response = await fetch(target, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
        : undefined,
    });
    if (!response.ok) {
      return { ok: false, status: 502, body: { ok: false, error: 'upstream-status', status: response.status } };
    }
    return { ok: true, payload: await response.json() };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      body: {
        ok: false,
        error: 'upstream-failed',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Answer one quote request by proxying the public endpoint.
 * @param request - the admitted Fetch request.
 * @returns the Fetch response carrying `{ ok, payload }` or `{ ok: false, error }`.
 */
async function handleQuotes(request) {
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return jsonResponse(400, { ok: false, error: 'bad-request' });
  }
  const secids = parseSecids(url);
  if (secids === undefined) return jsonResponse(400, { ok: false, error: 'bad-secids' });

  const upstream = new URL(UPSTREAM);
  upstream.searchParams.set('fltt', '2');
  upstream.searchParams.set('invt', '2');
  upstream.searchParams.set('fields', FIELDS);
  upstream.searchParams.set('secids', secids.join(','));

  const result = await fetchUpstream(upstream);
  return result.ok
    ? jsonResponse(200, { ok: true, payload: result.payload })
    : jsonResponse(result.status, result.body);
}

/**
 * Answer one industry board request.
 *
 * `dir=up` returns the strongest boards first, `dir=down` the weakest, so the
 * Client can show a leaders and a laggards column from two small responses
 * instead of paging through every board.
 *
 * @param request - the admitted Fetch request.
 * @returns the Fetch response carrying `{ ok, payload }` or `{ ok: false, error }`.
 */
async function handleSectors(request) {
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return jsonResponse(400, { ok: false, error: 'bad-request' });
  }
  const dir = url.searchParams.get('dir') === 'down' ? 'down' : 'up';
  const rawLimit = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(rawLimit) && rawLimit >= 1 && rawLimit <= MAX_SECTOR_ROWS
    ? Math.round(rawLimit)
    : MAX_SECTOR_ROWS;

  const params = new URLSearchParams({
    pn: '1',
    pz: String(limit),
    po: dir === 'down' ? '0' : '1',
    np: '1',
    fltt: '2',
    invt: '2',
    fid: 'f3',
    fields: SECTOR_FIELDS,
  });
  // `fs` is appended verbatim: the upstream selector needs a literal `+`, which
  // URLSearchParams would percent-encode.
  const target = SECTOR_UPSTREAM + '?' + params.toString() + '&fs=' + SECTOR_UNIVERSE;

  const result = await fetchUpstream(target);
  return result.ok
    ? jsonResponse(200, { ok: true, payload: result.payload })
    : jsonResponse(result.status, result.body);
}

/**
 * Answer one intraday candle request.
 *
 * Only the market-prefixed security id is accepted, so the forwarded URL can
 * only ever name a security the upstream understands.
 *
 * @param request - the admitted Fetch request.
 * @returns the Fetch response carrying `{ ok, payload }` or `{ ok: false, error }`.
 */
async function handleKline(request) {
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return jsonResponse(400, { ok: false, error: 'bad-request' });
  }
  const secid = url.searchParams.get('secid');
  if (!isSecid(secid)) return jsonResponse(400, { ok: false, error: 'bad-secid' });

  const target = KLINE_UPSTREAM
    + '?secid=' + encodeURIComponent(secid)
    + '&klt=1&fqt=1&lmt=' + KLINE_LIMIT + '&end=20500101'
    + '&fields1=' + KLINE_FIELDS1
    + '&fields2=' + KLINE_FIELDS2;

  const result = await fetchUpstream(target);
  return result.ok
    ? jsonResponse(200, { ok: true, payload: result.payload })
    : jsonResponse(result.status, result.body);
}

/**
 * Mount every route for as long as this plugin is active.
 * @param ctx - owning Host plugin context.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTE_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: (request) => handleQuotes(request),
  }), 'a-stock-ticker: quote route');

  ctx.effect(() => ctx.connection.fetch.register({
    path: SECTOR_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: (request) => handleSectors(request),
  }), 'a-stock-ticker: sector route');

  ctx.effect(() => ctx.connection.fetch.register({
    path: KLINE_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: (request) => handleKline(request),
  }), 'a-stock-ticker: kline route');
}
