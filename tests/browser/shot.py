# usage: python3 -I shot.py <url-or-file> <out.png> [wait_title] [width] [height]
import sys, time
from playwright.sync_api import sync_playwright
url, out = sys.argv[1], sys.argv[2]
wait_title = sys.argv[3] if len(sys.argv) > 3 else None
w = int(sys.argv[4]) if len(sys.argv) > 4 else 1400
h = int(sys.argv[5]) if len(sys.argv) > 5 else 900
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': w, 'height': h})
    logs = []
    pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}'))
    pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
    pg.goto(url if '://' in url else 'file://' + url)
    if wait_title:
        for _ in range(240):
            if pg.title() == wait_title: break
            time.sleep(0.5)
    pg.screenshot(path=out, full_page=True)
    print('\n'.join(logs[-30:]))
    b.close()
