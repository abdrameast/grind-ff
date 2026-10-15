"""Headless test harness for GRIND//FM.

Serves dist/ locally, maps the CDN / Google Fonts / YouTube requests to local copies or
mocks, runs a scenario and saves screenshots + console logs.

usage: python3 harness.py <scenario> [width height] [--mobile] [--block-yt]
(run `npm install` in this folder first; needs Python Playwright with Chromium)
"""
import asyncio
import json
import os
import pathlib
import re
import subprocess
import sys
import time

os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.async_api import async_playwright  # noqa: E402

HERE = pathlib.Path(__file__).parent
ROOT = HERE.parent
NM = HERE / "node_modules"
OUT = HERE / "shots"
OUT.mkdir(exist_ok=True)
PORT = 8765

MOCK_YT = (HERE / "mock_yt.js").read_text()
JSR_TITLES = ['Let Mom Sleep', 'Humming the Bassline', 'O.K.!? House!!!!!?????', "That's Enough", 'Everybody Jump Around',
    'Dunny Boy Williamson Show', 'Sneakman', "'Bout the City", 'Mischievous Boy', 'Sweet Soul Brother', 'Rock It On',
    'Super Brothers', 'Magical Girl', 'Yellow Bream', 'Miller Ball Breakers', 'Up-Set Attack', 'On the Bowl (A. Fargus Mix)',
    'Funky Radio', 'Yappie Feet', 'Electric Tooth Brush', 'Dragula (Si Non Oscillas, Noli Tintinnare Mix)', 'Slow',
    'Just Got Wicked', 'Patrol Knob', 'Improvise', 'Recipe for the Perfect Afro',
    'Funky Plucker!', 'Improvise (Instrumental)', "Moody's Shuffle", 'Grace & Glory', 'Jet Set Medley', 'Jet Set Station',
    'Jet Set Groove #1', 'Jet Set Groove #2']


def fonts_css():
    out = []
    for pkg in ["bungee", "dela-gothic-one", "dotgothic16"]:
        css = (NM / "@fontsource" / pkg / "index.css").read_text()
        css = css.replace("url(./files/", f"url(https://fonts.gstatic.com/local/{pkg}/")
        out.append(css)
    return "\n".join(out)


FONTS_CSS = fonts_css()


async def route_all(route):
    url = route.request.url
    if url.startswith("https://cdn.jsdelivr.net/npm/three@0.170.0/"):
        rel = url.split("three@0.170.0/", 1)[1].split("?")[0]
        p = NM / "three" / rel
        if p.exists():
            return await route.fulfill(path=str(p), content_type="application/javascript")
        return await route.fulfill(status=404, body="nf")
    if url.startswith("https://cdn.jsdelivr.net/npm/lil-gui@0.19.2/"):
        rel = url.split("lil-gui@0.19.2/", 1)[1]
        return await route.fulfill(path=str(NM / "lil-gui" / rel), content_type="application/javascript")
    if url.startswith("https://fonts.googleapis.com/"):
        return await route.fulfill(body=FONTS_CSS, content_type="text/css")
    if url.startswith("https://fonts.gstatic.com/local/"):
        rel = url.split("/local/", 1)[1]
        pkg, fname = rel.split("/", 1)
        p = NM / "@fontsource" / pkg / "files" / fname
        ct = "font/woff2" if fname.endswith("woff2") else "font/woff"
        return await route.fulfill(path=str(p), content_type=ct)
    if url.startswith("https://www.youtube.com/iframe_api"):
        if os.environ.get("BLOCK_YT"):
            return await route.abort()
        return await route.fulfill(body=MOCK_YT, content_type="application/javascript")
    if url.startswith("https://www.youtube.com/oembed"):
        m = re.search(r"v%3D(jsrf?)(\d+)", url)
        if not m:
            return await route.fulfill(status=404, body="nf")
        kind, n = m.group(1), int(m.group(2))
        if kind == "jsr":
            title = "Jet Set Radio OST - " + JSR_TITLES[n] if n < len(JSR_TITLES) else "x"
        else:
            title = "Hideki Naganuma - The Concept of Love" if n == 0 else ("Hideki Naganuma - Jet Set Station #2" if n == 8 else f"JSRF Artist {n} - Future Track {n}")
        body = json.dumps({"title": title, "author_name": "Mock Channel"})
        return await route.fulfill(body=body, content_type="application/json", headers={"access-control-allow-origin": "*"})
    if url.startswith("http://127.0.0.1") or url.startswith("data:") or url.startswith("blob:"):
        return await route.continue_()
    return await route.abort()


async def main():
    args = sys.argv[1:]
    scen = args[0] if args else "basic"
    w, h = 1440, 900
    nums = [a for a in args[1:] if a.isdigit()]
    if len(nums) >= 2:
        w, h = int(nums[0]), int(nums[1])
    mobile = "--mobile" in args
    page_name = "index.html"
    if "--block-yt" in args:
        os.environ["BLOCK_YT"] = "1"
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1", "--directory", str(ROOT)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.6)
    logs = []
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
                                              "--autoplay-policy=no-user-gesture-required"])
            ctx = await b.new_context(viewport={"width": w, "height": h}, device_scale_factor=1 if not mobile else 2,
                                      is_mobile=mobile, has_touch=mobile)
            page = await ctx.new_page()
            page.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"))
            page.on("pageerror", lambda e: logs.append(f"[pageerror] {e}"))
            await page.route("**/*", route_all)
            await page.goto(f"http://127.0.0.1:{PORT}/{page_name}")
            mod = __import__("scenarios")
            await getattr(mod, scen)(page, OUT, w, h, logs)
            await b.close()
    finally:
        srv.terminate()
    print("\n".join(logs[-80:]))


if __name__ == "__main__":
    sys.path.insert(0, str(HERE))
    asyncio.run(main())
