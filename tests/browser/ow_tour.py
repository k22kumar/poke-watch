# Overworld visual tour: screenshots at several spots. usage: python3 -I ow_tour.py <html> <outdir>
import sys, time
from playwright.sync_api import sync_playwright
html, out = sys.argv[1], sys.argv[2]
spots = [('town', '?x=17&y=48&dir=1'), ('plaza', '?x=18&y=44&dir=1'), ('shrine', '?x=27&y=48&dir=1'), ('pond', '?x=9&y=46&dir=2'),
         ('route_s', '?x=17&y=28&dir=1'), ('bridge', '?x=17&y=15&dir=1'), ('grass', '?x=8&y=24&dir=1'), ('north', '?x=22&y=11&dir=1'),
         ('house', '?map=house&x=5&y=6'), ('lab', '?map=lab&x=6&y=7'), ('tatami', '?map=tatami&x=4&y=5'), ('shop', '?map=shop&x=4&y=5')]
only = sys.argv[3].split(',') if len(sys.argv) > 3 else None
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width': 960, 'height': 720})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    for name, q in spots:
        if only and name not in only: continue
        pg.goto('file://' + html + q)
        for _ in range(120):
            if pg.title() == 'Maplebrook': break
            time.sleep(0.3)
        time.sleep(2.5)
        pg.screenshot(path=f'{out}/{name}.png')
    print('errors:', errs or 'none')
    b.close()
