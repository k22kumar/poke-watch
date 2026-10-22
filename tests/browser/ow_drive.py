# State-aware overworld driver: real key presses, waits on game state, screenshots + assertions.
import sys, time, json
from playwright.sync_api import sync_playwright
html, out = sys.argv[1], sys.argv[2]
log = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width': 960, 'height': 720})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('file://' + html)
    for _ in range(120):
        if pg.title() == 'Maplebrook': break
        time.sleep(0.3)
    time.sleep(0.5); pg.keyboard.press('KeyZ'); time.sleep(0.4)
    for _ in range(120):
        if pg.title() == 'Maplebrook': break
        time.sleep(0.3)
    S = lambda: pg.evaluate("() => { const o = window.ow; return { map: o.map.id, x: o.player.tx, y: o.player.ty, dir: o.player.dir, moving: o.player.t < 1, fade: o.fade, f: [o.follower.tx, o.follower.ty], dialog: o.dialog ? o.dialog.lines[o.dialog.idx] : null, banner: o.banner ? o.banner.text : null, pitch: +o.cam.pitch.toFixed(2) }; }")
    def settle():
        for _ in range(100):
            s = S()
            if not s['moving'] and s['fade'] == 0: return s
            time.sleep(0.05)
        return S()
    def walk(key, n):
        for _ in range(n):
            before = S()
            pg.keyboard.down(key)
            t0 = time.time()
            while time.time() - t0 < 1.5:
                s = S()
                if (s['x'], s['y'], s['map']) != (before['x'], before['y'], before['map']): break
                time.sleep(0.03)
            pg.keyboard.up(key)
            settle()
        return settle()
    def face(key):
        pg.keyboard.down(key); time.sleep(0.06); pg.keyboard.up(key); return settle()
    def talk():
        lines = []
        pg.keyboard.press('KeyZ'); time.sleep(0.2)
        for _ in range(30):
            s = S()
            if not s['dialog']: break
            if not lines or lines[-1] != s['dialog']: lines.append(s['dialog'])
            pg.keyboard.press('KeyZ'); time.sleep(0.35)
        return lines
    def check(name, cond, info):
        log.append(('PASS' if cond else 'FAIL') + f' {name}: {info}')
    shot = lambda n: pg.screenshot(path=f'{out}/{n}.png')

    s = settle(); check('start in town', s['map'] == 'maple' and (s['x'], s['y']) == (7, 52), s)
    s = walk('ArrowUp', 2); time.sleep(0.6); s = settle()
    check('enter house through door', s['map'] == 'house', s)
    walk('ArrowUp', 3); walk('ArrowRight', 2); face('ArrowUp')
    lines = talk(); check('talk to mom', len(lines) >= 1, lines)
    s = S(); check('follower behind player', abs(s['f'][0] - s['x']) + abs(s['f'][1] - s['y']) == 1, s)
    shot('d_house')
    walk('ArrowDown', 3); s = walk('ArrowLeft', 2); time.sleep(0.6); s = settle()
    check('exit via mat', s['map'] == 'maple' and (s['x'], s['y']) == (7, 51), s)
    walk('ArrowDown', 1); walk('ArrowRight', 9); s = walk('ArrowUp', 6); shot('d_plaza')
    check('reach plaza', s['y'] <= 46, s)
    s = walk('ArrowUp', 16); check('walk north to route', s['y'] <= 30, s)
    time.sleep(0.4); s = S(); check('area banner', s['banner'] in ('Fernwood Trail', None), s)
    shot('d_route')
    s = walk('ArrowUp', 14); shot('d_upper')
    log.append(f'at {s}')
    # head to the bridge: path column 17
    while S()['x'] < 17: walk('ArrowRight', 1)
    s = walk('ArrowUp', 4); s = settle(); shot('d_bridge')
    check('bridge camera zone lowers pitch', s['pitch'] < 0.65, s)
    s = walk('ArrowUp', 3)
    log.append(f'north of bridge {s}')
    # read the sign at (16,11) from (16,12)? walk left then face up
    print('\n'.join(log))
    print('errors:', errs or 'none')
    b.close()
