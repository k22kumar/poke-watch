# Scripted overworld playthrough with screenshots + state log.
import sys, time, json
from playwright.sync_api import sync_playwright
html, out, script = sys.argv[1], sys.argv[2], sys.argv[3]
shots = [float(x) for x in sys.argv[4].split(',')]
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width': 960, 'height': 720})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('file://' + html + '?script=' + script)
    for _ in range(120):
        if pg.title() == 'Maplebrook': break
        time.sleep(0.3)
    t0 = time.time()
    for i, t in enumerate(shots):
        while time.time() - t0 < t: time.sleep(0.1)
        pg.screenshot(path=f'{out}/play{i}.png')
        st = pg.evaluate("() => { const o = window.ow; return { map: o.map.id, x: o.player.tx, y: o.player.ty, dir: o.player.dir, f: [o.follower.tx, o.follower.ty], dialog: o.dialog ? o.dialog.lines[o.dialog.idx] : null, t: +o.time.toFixed(1) }; }")
        print(json.dumps(st))
    print('errors:', errs or 'none')
    b.close()
