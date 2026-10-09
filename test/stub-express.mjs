// Мини-реализация express для тестов без установленных пакетов: маршруты, Router, middleware, JSON-тело, sendFile.
function compile(p) {
  const keys = [];
  const re = new RegExp('^' + p.replace(/\/:([A-Za-z_]+)/g, (_m, k) => { keys.push(k); return '/([^/]+)'; }) + '$');
  return { re, keys };
}
function makeRouter() {
  const layers = [];
  const add = (method, p, fns) => { for (const fn of fns) layers.push({ method, p, fn, c: typeof p === 'string' && method ? compile(p) : null }); };
  function router(req, res, out) {
    let i = 0, err = null;
    const base = req.baseUrl || '', origUrl = req.url;
    const next = (e) => {
      if (e) err = e;
      req.url = origUrl; req.baseUrl = base;
      const l = layers[i++];
      if (!l) return out ? out(err) : finish(res, err);
      const url = origUrl.split('?')[0];
      if (l.method) {
        if (l.method !== req.method && !(l.method === 'GET' && req.method === 'HEAD')) return next();
        const m = l.c.re.exec(url);
        if (!m) return next();
        req.params = Object.fromEntries(l.c.keys.map((k, n) => [k, decodeURIComponent(m[n + 1])]));
      } else if (l.p) {
        if (url !== l.p && !url.startsWith(l.p + '/')) return next();
        req.url = origUrl.slice(l.p.length) || '/'; req.baseUrl = base + l.p;
      }
      const isErr = l.fn.length === 4;
      if (!!err !== isErr) return next();
      const cont = (e2) => { if (isErr) err = e2 || null; next(e2); };
      try {
        const r = isErr ? l.fn(err, req, res, cont) : l.fn(req, res, cont, cont);
        if (r && r.catch) r.catch((x) => next(x));
      } catch (x) { next(x); }
    };
    next();
  }
  router.use = (a, ...rest) => { if (typeof a === 'function') add(null, null, [a, ...rest]); else add(null, a, rest); return router; };
  router.get = (p, ...f) => { add('GET', p, f); return router; };
  router.post = (p, ...f) => { add('POST', p, f); return router; };
  return router;
}
function finish(res, err) {
  if (res.done) return;
  res.status(err ? 500 : 404).json({ error: err ? String(err.message || err) : 'not found' });
}
export const created = [];
function express() {
  const app = makeRouter();
  const handler = (req, res) => app(req, res);
  Object.assign(handler, { use: app.use, get: app.get, post: app.post, disable() {}, set() {}, router: app });
  created.push(handler);
  return handler;
}
express.Router = makeRouter;
express.static = () => (_req, _res, next) => next();
express.json = () => (req, res, next) => {
  if (!req.is('json') || req.rawBody === undefined) return next();
  if (req.rawBody.length > 10240) return next({ type: 'entity.too.large' });
  try { req.body = req.rawBody ? JSON.parse(req.rawBody) : {}; next(); } catch { next({ type: 'entity.parse.failed' }); }
};

// Вызов приложения без сети: inject(app, { method, url, headers, body }) -> { status, headers, body }
export function inject(app, { method = 'GET', url = '/', headers = {}, body, raw } = {}) {
  return new Promise((resolve) => {
    const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    if (body !== undefined && !h['content-type']) h['content-type'] = 'application/json';
    const req = {
      query: Object.fromEntries(new URL(url, 'http://x').searchParams), method, url, headers: { host: 'localhost', ...h }, ip: '1.2.3.4', secure: false, body: {},
      rawBody: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
      is(t) { return (this.headers['content-type'] || '').includes(t); },
    };
    const out = { status: 200, headers: {}, body: undefined, file: null };
    const res = {
      done: false,
      status(c) { out.status = c; return res; },
      setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
      json(o) { out.body = o; res.done = true; resolve(out); },
      sendFile(f) { out.file = f; res.done = true; resolve(out); },
    };
    app.router(req, res);
  });
}
export default express;
