# Browser smoke/play test. usage: python3 -I play.py <html> <outdir> <query> <seconds> [shots]
import sys, time, json
from playwright.sync_api import sync_playwright
html, outdir, query, secs = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])
shots = int(sys.argv[5]) if len(sys.argv) > 5 else 4
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    W, H = (int(x) for x in (sys.argv[6] if len(sys.argv) > 6 else '1280x760').split('x'))
    pg = b.new_page(viewport={'width': W, 'height': H})
    logs = []
    pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') and 'GPU stall' not in m.text else None)
    pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
    pg.goto('file://' + html + '?' + query)
    for _ in range(120):
        if pg.title() == 'Poke-Watch': break
        time.sleep(0.5)
    t0 = time.time()
    for k in range(shots):
        time.sleep(secs / shots)
        pg.screenshot(path=f'{outdir}/shot{k}.png')
        st = pg.evaluate("""() => { const c = window.pokewatch.ctx; if (!c) return null; return { state: c.state, t: +c.time.toFixed(1), stage: c.stage, lvl: c.player.level, hp: Math.round(c.player.hp), kills: c.stats.kills, live: c.enemies.count, species: c.player.species.id, moves: c.player.moves.map(m => m.key + ':' + m.level).join(','), simMs: +window.pokewatch.perf.sim.toFixed(1), renderMs: +window.pokewatch.perf.render.toFixed(1) }; }""")
        print(json.dumps(st))
    print('\n'.join(logs[-30:]) or 'no console errors')
    b.close()
