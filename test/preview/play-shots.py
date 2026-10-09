# Скриншоты экрана выбора и боевого интерфейса. Использование: python3 play-shots.py outdir [port]
import sys
from playwright.sync_api import sync_playwright
out = sys.argv[1]; port = sys.argv[2] if len(sys.argv) > 2 else '8099'
base = f'http://localhost:{port}'
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
    for dev, ctxargs in (('m', dict(viewport={'width': 844, 'height': 390}, has_touch=True, is_mobile=True, device_scale_factor=2)),
                         ('d', dict(viewport={'width': 1280, 'height': 720}))):
        ctx = b.new_context(**ctxargs)
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(('pageerror', str(e))))
        pg.on('console', lambda m: errors.append(('console', m.text)) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        pg.goto(base + '/play?gm=hill'); pg.wait_for_timeout(900)
        pg.screenshot(path=f'{out}/pl-menu-{dev}.png')
        for tab in ('rooms', 'create', 'code'):
            pg.click(f'#tabs button[data-tab="{tab}"]'); pg.wait_for_timeout(400)
            pg.screenshot(path=f'{out}/pl-{tab}-{dev}.png')
        pg.click('#tabs button[data-tab="quick"]')
        # выбираем другой набор оружия
        pg.click('#loadout button[data-w="6"]'); pg.click('#loadout button[data-w="9"]'); pg.click('#loadout button[data-w="7"]')
        pg.wait_for_timeout(200)
        pg.screenshot(path=f'{out}/pl-loadout-{dev}.png')
        pg.click('#playBtn'); pg.wait_for_timeout(2500)
        pg.screenshot(path=f'{out}/pl-hud-{dev}.png')
        # пауза
        if dev == 'm': pg.click('#bMenu')
        else: pg.evaluate('document.exitPointerLock && 0'); pg.keyboard.press('Escape')
        pg.wait_for_timeout(600)
        if pg.is_visible('#menu') is False: pg.evaluate("document.getElementById('menu').classList.remove('hidden')")
        pg.screenshot(path=f'{out}/pl-pause-{dev}.png')
        ctx.close()
    b.close()
print('ОШИБКИ:' if errors else 'ошибок нет')
for e in errors: print(' ', e)
