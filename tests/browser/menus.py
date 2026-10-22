# Screens test: title -> select -> start -> level-up cards -> pause. usage: python3 -I menus.py <html> <outdir>
import sys, time
from playwright.sync_api import sync_playwright
html, out = sys.argv[1], sys.argv[2]
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 760})
    logs = []
    pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
    pg.goto('file://' + html)
    for _ in range(120):
        if pg.title() == 'Poke-Watch': break
        time.sleep(0.5)
    time.sleep(1.5)
    pg.screenshot(path=f'{out}/title.png')
    pg.click('text=Play ▶')
    time.sleep(1)
    pg.click('text=Hootz')
    pg.screenshot(path=f'{out}/select.png')
    pg.click('text=Start run ▶')
    time.sleep(2)
    # force a level up through the debug handle
    pg.evaluate("() => window.pokewatch.addLevel()")
    time.sleep(5)
    pg.screenshot(path=f'{out}/cards.png')
    pg.keyboard.press('Digit2')
    time.sleep(5)
    st = pg.evaluate("() => ({ state: window.pokewatch.ctx.state, moves: window.pokewatch.ctx.player.moves.map(m => m.key + ':' + m.level), vit: window.pokewatch.ctx.player.vitamins })")
    print('after pick:', st)
    pg.keyboard.press('Escape')
    time.sleep(1)
    pg.screenshot(path=f'{out}/pause.png')
    pg.click('text=Tuning panel')
    time.sleep(0.5)
    pg.screenshot(path=f'{out}/tuning.png')
    print('\n'.join(logs) or 'no errors')
    b.close()
