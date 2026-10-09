# Скриншоты страниц сайта и перехват ошибок JS. Использование: python3 site-shots.py outdir [port]
import sys, json
from playwright.sync_api import sync_playwright
out = sys.argv[1]; port = sys.argv[2] if len(sys.argv) > 2 else '8099'
base = f'http://localhost:{port}'
pages = [('home', '/', None), ('register', '/register', None), ('login', '/login', None), ('lobby', '/lobby', 'Viking'), ('profile', '/profile', 'Viking'),
         ('shop', '/shop', 'Viking'), ('clans', '/clans', 'Viking'), ('clan', '/clan/1', 'Shadow'), ('leaders', '/leaders', 'Viking'), ('settings', '/settings', 'Viking'), ('p404', '/zzz', None)]
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
    for dev, vp in (('m', {'width': 390, 'height': 844}), ('d', {'width': 1200, 'height': 800})):
        ctxs = {}
        for name, path, user in pages:
            ctx = ctxs.get(user)
            if ctx is None:
                ctx = b.new_context(viewport=vp)
                if user:
                    r = ctx.request.post(base + '/api/login', data=json.dumps({'login': user, 'password': 'password1'}), headers={'Content-Type': 'application/json'})
                    assert r.ok, r.text()
                ctxs[user] = ctx
            pg = ctx.new_page(); pg.set_viewport_size(vp)
            pg.on('pageerror', lambda e, n=name: errors.append((n, str(e))))
            pg.on('console', lambda m, n=name: errors.append((n, m.text)) if m.type == 'error' and 'socket.io' not in m.text and 'Failed to load resource' not in m.text else None)
            pg.goto(base + path); pg.wait_for_timeout(500)
            hs = pg.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
            if hs > 0: errors.append((name + '/' + dev, f'горизонтальный скролл {hs}px'))
            pg.screenshot(path=f'{out}/{name}-{dev}.png', full_page=True)
            pg.close()
    b.close()
print('ОШИБКИ:' if errors else 'ошибок нет')
for e in errors: print(' ', e)
