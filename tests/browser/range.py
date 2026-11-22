# The merge check (docs/hero-shooter-pivot.md Q45): title -> Training range -> a featured hero -> spawn -> fire at a
# dummy and see its health drop -> quit -> Caterpie -> hold F for a Breakthrough, in capture mode, with screenshots.
# Run by hand at merge time, not in `npm run check` (setup once: tools/README.md "Python checks"):
#   python3 -m venv .venv && .venv/bin/pip install -r tests/browser/requirements.txt
#   npx playwright install chromium         (only if the Chromium build is not downloaded yet)
#   .venv/bin/python -I tests/browser/range.py <path/to/index.html> <outdir> [WxH]
# Exits 1 when a step fails, printing what it saw. Console errors and page errors are listed at the end and fail it too.
import sys, time, json, os
from playwright.sync_api import sync_playwright

html, out = sys.argv[1], sys.argv[2]
W, H = (int(x) for x in (sys.argv[3] if len(sys.argv) > 3 else '1280x720').split('x'))
os.makedirs(out, exist_ok=True)
BTN_BASIC, BTN_TOUCH = 16, 32  # src/sim/types.ts BTN
fails = []

def check(ok, what):
    print(('ok   ' if ok else 'FAIL ') + what)
    if not ok: fails.append(what)

with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': W, 'height': H})
    logs = []
    pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}') if m.type == 'error' and 'GPU stall' not in m.text else None)
    pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
    pg.goto('file://' + os.path.abspath(html) + '?capture=1')
    for _ in range(120):
        if pg.evaluate("() => !!(window.pokewatch && document.querySelector('.title-actions'))"): break
        time.sleep(0.5)
    # capture mode: nothing steps on its own; advance(s, {frames: s * 60}) runs one tick per drawn frame (CLAUDE.md)
    # the page fetches a match's Pokémon art before the match starts (docs/ROADMAP.md "Item 3: A1 plan")
    settle = lambda: pg.wait_for_function("() => window.pokewatch && !window.pokewatch.loading", timeout=60000)
    adv = lambda s, inp=None: pg.evaluate("([s, inp]) => window.pokewatch.advance(s, { frames: Math.round(s * 60), input: inp || undefined })", [s, inp])
    # the crosshair on enemy i: a ray from 4.5 m behind the hero's chest through the enemy's centre, and the ground point
    # under it, as the browser sends them (src/main.ts sampleInput); held for `s` seconds with `btn` down
    def fire_at(i, s, btn):
        pg.evaluate("""([i, s, btn]) => { const pw = window.pokewatch, n = Math.round(s * 60);
          for (let k = 0; k < n; k++) { const c = pw.ctx, P = c.player, E = c.enemies;
            const tx = E.x[i], ty = E.y[i] + E.tall[i] / 2, tz = E.z[i], ox = P.x, oy = P.y + 1.2, oz = P.z;
            let dx = tx - ox, dy = ty - oy, dz = tz - oz; const L = Math.hypot(dx, dy, dz); dx /= L; dy /= L; dz /= L;
            const aim = { ox: Math.fround(ox - dx * 4.5), oy: Math.fround(oy - dy * 4.5), oz: Math.fround(oz - dz * 4.5), dx: Math.fround(dx), dy: Math.fround(dy), dz: Math.fround(dz) };
            pw.advance(1 / 60, { frames: 1, input: { btn, aim, aimX: tx, aimZ: tz, aimDev: 'mouse' } }); } }""", [i, s, btn])
    state = lambda: pg.evaluate("""() => { const c = window.pokewatch.ctx; if (!c) return null; const E = c.enemies, d = [];
      for (let i = 0; i < E.hi; i++) if (E.alive[i]) d.push({ i, id: c.speciesIndex[E.species[i]].id, hp: +E.hp[i].toFixed(1), max: +E.maxHp[i].toFixed(1), x: +E.x[i].toFixed(1), z: +E.z[i].toFixed(1) });
      return { state: c.state, t: +c.time.toFixed(2), species: c.player.species.id, hp: Math.round(c.player.hp), x: +c.player.x.toFixed(1), z: +c.player.z.toFixed(1), breakT: +(c.player.breakT ?? 0).toFixed(2), map: c.world.map.id, enemies: d }; }""")

    def pick(hero):
        pg.locator('.mode', has_text='Training range').first.click()
        pg.locator('.title-actions button', has_text='Play').first.click()
        time.sleep(0.5)
        pg.locator(f'.mon.hero[aria-label^="{hero},"]').first.click()
        time.sleep(0.3)

    time.sleep(1)
    pg.screenshot(path=f'{out}/1-title.png')
    check(pg.locator('.tagline', has_text='A Pokémon hero shooter fan game').count() == 1, 'title: the hero-shooter tagline')
    check(pg.locator('.mode').count() == 1, 'title: one mode, the Training range (Hold is URL-only until T2)')

    # a featured hero: Charmander
    pick('Charmander')
    pg.screenshot(path=f'{out}/2-hero-pick.png')
    check(pg.locator('.mon.hero.featured').count() >= 4, 'hero pick: the featured lines are listed first')
    pg.locator('.select-actions button', has_text='Start').first.click()
    time.sleep(0.5)
    settle()
    adv(1.0)
    s0 = state()
    pg.screenshot(path=f'{out}/3-spawn.png')
    print('spawn', json.dumps({k: v for k, v in (s0 or {}).items() if k != 'enemies'}))
    check(bool(s0) and s0['state'] == 'play' and s0['species'] == 'charmander' and s0['map'] == 'range', 'spawn: Charmander playing on the range')
    # the Snorlax dummy (6 m right, 12 m out: a clear line; the Geodude dummy stands behind a cover rock)
    dummy = next((e for e in (s0 or {}).get('enemies', []) if e['id'] == 'snorlax'), None)
    check(dummy is not None, 'spawn: the Snorlax dummy stands on the firing field')

    # fire: hold the primary for 3 s with the crosshair on the dummy
    for k in range(6):
        if dummy: fire_at(dummy['i'], 0.5, BTN_BASIC)
        if k == 1: pg.screenshot(path=f'{out}/4-firing.png')
    adv(0.3)
    s1 = state()
    d1 = next((e for e in s1['enemies'] if e['i'] == dummy['i']), None) if dummy else None
    pg.screenshot(path=f'{out}/5-dummy-hit.png')
    print('dummy before', json.dumps(dummy), 'after', json.dumps(d1))
    check(bool(d1) and d1['hp'] < d1['max'], 'fire: the dummy\'s health dropped')

    # quit to the title, then Caterpie: hold F (Touch) for a Breakthrough into Metapod
    pg.evaluate("() => window.pokewatch.ui.hooks.quit()")
    time.sleep(0.5)
    pick('Caterpie')
    pg.locator('.select-actions button', has_text='Start').first.click()
    time.sleep(0.5)
    settle()
    adv(1.0)
    c0 = state()
    check(bool(c0) and c0['species'] == 'caterpie', 'Caterpie playing')
    adv(0.6, {'btn': BTN_TOUCH})
    c1 = state()
    pg.screenshot(path=f'{out}/6-breakthrough.png')
    print('holding F', json.dumps({k: v for k, v in (c1 or {}).items() if k != 'enemies'}))
    check(bool(c1) and c1['breakT'] > 0, 'hold F: the Breakthrough has started (breakT > 0)')
    adv(2.6)
    c2 = state()
    pg.screenshot(path=f'{out}/7-metapod.png')
    print('after', json.dumps({k: v for k, v in (c2 or {}).items() if k != 'enemies'}))
    check(bool(c2) and c2['species'] == 'metapod', 'Breakthrough: Caterpie became Metapod')

    print('\n'.join(logs[-30:]) or 'no console errors')
    if logs: fails.append(f'{len(logs)} console / page errors')
    b.close()

print('PASS' if not fails else 'FAILED: ' + '; '.join(fails))
sys.exit(1 if fails else 0)
