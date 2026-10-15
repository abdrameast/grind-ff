"""Test scenarios (each takes page, out dir, width, height, logs)."""

FPS_JS = """() => new Promise(res => { let n = 0; const t0 = performance.now(); function f(){ n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / ((performance.now() - t0)/1000)); } requestAnimationFrame(f); })"""
STATE_JS = """() => { const g = window.__grindfm; if (!g) return 'no handle'; const P = g.Player; return { kind: P.kind, ready: P.ready, state: P.state, idx: P.index, count: P.count, t: Math.round(P.t*10)/10, dur: P.duration, playing: P.playing, title: document.getElementById('tTitle').textContent, artist: document.getElementById('tArtist').textContent, num: document.getElementById('tNum').textContent, mode: g.AudioFX.mode, dpr: g.view.dpr, perf: g.view.r }; }"""


async def snap(page, out, name):
    await page.screenshot(path=str(out / f"{name}.png"))


async def basic(page, out, w, h, logs):
    await page.wait_for_timeout(5000)
    await snap(page, out, f"basic_{w}x{h}")
    logs.append("STATE " + str(await page.evaluate(STATE_JS)))
    logs.append("FPS %.1f" % await page.evaluate(FPS_JS))


async def play(page, out, w, h, logs):
    await page.wait_for_timeout(3500)
    g = await page.evaluate("() => { const v = window.__grindfm.view; return [v.cx, v.cy, v.r]; }")
    cx, cy, r = g
    await page.mouse.click(cx + r * 0.6, cy - r * 0.1)
    await page.wait_for_timeout(1200)
    await snap(page, out, f"play_card_{w}x{h}")
    await page.wait_for_timeout(2600)
    await snap(page, out, f"play_{w}x{h}")
    logs.append("STATE " + str(await page.evaluate(STATE_JS)))
    # data side
    await page.evaluate("() => { const M = window.__grindfm.Motion; M.flipTarget = Math.round(M.flip / Math.PI) * Math.PI + Math.PI; M.nextFlip = 1e9; }")
    await page.wait_for_timeout(2500)
    await snap(page, out, f"play_dataside_{w}x{h}")
    # next track (blocked one at 5 is skipped)
    await page.evaluate("() => window.__grindfm.Player.playAt(4)")
    await page.wait_for_timeout(1500)
    await page.evaluate("() => window.__grindfm.Player.next()")
    await page.wait_for_timeout(2800)
    logs.append("AFTER SKIP " + str(await page.evaluate(STATE_JS)))
    await snap(page, out, f"play_skip_{w}x{h}")
    # station id (track index 8)
    await page.evaluate("() => window.__grindfm.Player.playAt(31)")
    await page.wait_for_timeout(1300)
    await snap(page, out, f"play_station_{w}x{h}")
    # tracklist
    await page.click("#btnTracks")
    await page.wait_for_timeout(1500)
    await snap(page, out, f"tracks_{w}x{h}")
    logs.append("FPS %.1f" % await page.evaluate(FPS_JS))


async def modals(page, out, w, h, logs):
    await page.wait_for_timeout(3000)
    await lowres(page)
    await page.click("#btnSync")
    await page.wait_for_timeout(700)
    await snap(page, out, f"sync_{w}x{h}")
    await page.keyboard.press("Escape")
    await page.click("#btnHelp")
    await page.wait_for_timeout(700)
    await snap(page, out, f"help_{w}x{h}")
    await page.keyboard.press("Escape")
    await page.keyboard.press("l")
    await page.wait_for_timeout(1500)
    await snap(page, out, f"silver_{w}x{h}")


async def demo(page, out, w, h, logs):
    await page.wait_for_timeout(3500)
    await lowres(page)
    await snap(page, out, f"demo_idle_{w}x{h}")
    g = await page.evaluate("() => { const v = window.__grindfm.view; return [v.cx, v.cy, v.r]; }")
    await page.mouse.click(g[0], g[1] + g[2] * 0.5)
    await page.wait_for_timeout(2500)
    await snap(page, out, f"demo_play_{w}x{h}")
    logs.append("STATE " + str(await page.evaluate(STATE_JS)))


async def drag(page, out, w, h, logs):
    await page.wait_for_timeout(3000)
    await lowres(page)
    g = await page.evaluate("() => { const v = window.__grindfm.view; return [v.cx, v.cy, v.r]; }")
    cx, cy, r = g
    await page.mouse.move(cx, cy + r * 0.5)
    await page.mouse.down()
    for i in range(12):
        await page.mouse.move(cx + i * 18, cy + r * 0.5 - i * 6)
        await page.wait_for_timeout(16)
    await page.mouse.up()
    await page.wait_for_timeout(300)
    await snap(page, out, f"drag_{w}x{h}")
    await page.mouse.click(40, h - 260)
    await page.mouse.click(w - 120, h * 0.55)
    await page.wait_for_timeout(1200)
    await snap(page, out, f"splat_{w}x{h}")


async def tap(page, out, w, h, logs):
    await page.evaluate("() => { window.__ytBlockAutoplay = true; }")
    await page.wait_for_timeout(3000)
    await lowres(page)
    g = await page.evaluate("() => { const v = window.__grindfm.view; return [v.cx, v.cy, v.r]; }")
    await page.mouse.click(g[0] + g[2] * 0.5, g[1])
    await page.wait_for_timeout(1500)
    await snap(page, out, f"tap_{w}x{h}")


async def closeup(page, out, w, h, logs):
    """Freeze motion to inspect the disc material from a few fixed angles."""
    await page.wait_for_timeout(3500)
    for name, js in [
        ("label", "M.flipTarget = 0; M.flip = 0;"),
        ("data", "M.flipTarget = Math.PI; M.flip = Math.PI;"),
        ("grazing", "M.flipTarget = Math.PI * 0.72; M.flip = Math.PI * 0.72;"),
    ]:
        await page.evaluate("() => { const M = window.__grindfm.Motion; M.nextFlip = 1e9; M.flipVel = 0; " + js + " }")
        await page.wait_for_timeout(1200)
        await snap(page, out, f"close_{name}_{w}x{h}")


async def lowres(page):
    await page.evaluate("() => { const g = window.__grindfm; g.Perf.dprCap = 0.5; g.Perf.warm = -1e9; g.layout(); }")


async def play_fast(page, out, w, h, logs):
    await page.wait_for_timeout(2500)
    await lowres(page)
    await play(page, out, w, h, logs)


async def modal_debug(page, out, w, h, logs):
    await page.wait_for_timeout(3000)
    await lowres(page)
    await page.click("#btnSync")
    await page.wait_for_timeout(2500)
    info = await page.evaluate("""() => { const c = document.querySelector('#syncModal .modal-card'); const cs = getComputedStyle(c); const r = c.getBoundingClientRect(); return { op: cs.opacity, disp: cs.display, vis: cs.visibility, tr: cs.transform, r: [r.x, r.y, r.width, r.height], anim: c.getAnimations().map(a => [a.playState, a.currentTime]) }; }""")
    logs.append("MODAL " + str(info))
    await snap(page, out, f"sync2_{w}x{h}")


async def disc_debug(page, out, w, h, logs):
    await page.wait_for_timeout(3000)
    await lowres(page)
    js = """() => { const g = window.__grindfm; const r = g.GL.discRoot; return { q: r.quaternion.toArray().map(v => +v.toFixed(3)), p: r.position.toArray(), cam: g.GL.camera.position.toArray().map(v=>+v.toFixed(2)), zoom: g.GL.camera.zoom, clock: +g.GL.clock.toFixed(2), flip: +g.Motion.flip.toFixed(3), tx: +g.Motion.tiltX.toFixed(3), ty: +g.Motion.tiltY.toFixed(3), qd: g.Motion.qDrag.toArray().map(v => +v.toFixed(3)) }; }"""
    logs.append("BEFORE " + str(await page.evaluate(js)))
    await page.click("#btnHelp")
    await page.wait_for_timeout(2500)
    logs.append("AFTER " + str(await page.evaluate(js)))
    await page.evaluate("() => { document.getElementById('helpModal').style.visibility = 'hidden'; }")
    await page.wait_for_timeout(1500)
    await snap(page, out, f"discdebug_{w}x{h}")


async def tracks_static(page, out, w, h, logs):
    await page.wait_for_timeout(2500)
    await lowres(page)
    await page.add_style_tag(content=".panel, .modal-card, .toast { animation: none !important; }")
    await page.click("#btnTracks")
    await page.wait_for_timeout(2500)
    r = await page.evaluate("() => { const p = document.getElementById('tracklist').getBoundingClientRect(); const b = document.querySelector('#tracks button').getBoundingClientRect(); return [p.x, p.y, p.width, p.height, b.x, b.width]; }")
    logs.append("PANEL " + str(r))
    await snap(page, out, f"tracks_static_{w}x{h}")


async def hero(page, out, w, h, logs):
    await page.wait_for_timeout(2500)
    await lowres(page)
    g = await page.evaluate("() => { const v = window.__grindfm.view; return [v.cx, v.cy, v.r]; }")
    await page.mouse.click(g[0] + g[2] * 0.4, g[1] + g[2] * 0.3)
    await page.wait_for_timeout(3000)
    await page.evaluate("() => { const g = window.__grindfm; g.Motion.spinRps = 2.0; g.Motion.nextFlip = 1e9; g.Perf.dprCap = 1; g.layout(); g.FX2D.resize(); }")
    await page.mouse.move(w * 0.3, h * 0.25)
    await page.wait_for_timeout(6000)
    await snap(page, out, f"hero_label_{w}x{h}")
    await page.evaluate("() => { const M = window.__grindfm.Motion; M.flipTarget = Math.PI; M.flip = Math.PI; M.flipVel = 0; }")
    await page.mouse.move(w * 0.7, h * 0.3)
    await page.wait_for_timeout(6000)
    await snap(page, out, f"hero_data_{w}x{h}")
    logs.append("STATE " + str(await page.evaluate(STATE_JS)))


async def keys(page, out, w, h, logs):
    await page.wait_for_timeout(2500)
    await lowres(page)
    await page.keyboard.press("Space")
    await page.wait_for_timeout(2500)
    logs.append("AFTER SPACE " + str(await page.evaluate(STATE_JS)))
    await page.keyboard.press("ArrowRight")
    await page.wait_for_timeout(2500)
    logs.append("AFTER RIGHT " + str(await page.evaluate(STATE_JS)))
    await page.keyboard.press("m")
    await page.keyboard.press("ArrowUp")
    await page.wait_for_timeout(800)
    logs.append("VOL " + str(await page.evaluate("() => [window.__grindfm.Player.volume, window.__grindfm.Player.muted, document.getElementById('volLed').textContent]")))
    await page.keyboard.press("t"); await page.wait_for_timeout(300)
    await page.keyboard.press("t"); await page.wait_for_timeout(300)
    await page.keyboard.press("t"); await page.wait_for_timeout(300)
    await page.keyboard.press("t")
    await page.wait_for_timeout(600)
    logs.append("TAP " + str(await page.evaluate("() => [window.__grindfm.AudioFX.tap.bpm, window.__grindfm.AudioFX.F.bpm]")))
    await page.keyboard.press("Space")
    await page.wait_for_timeout(2000)
    logs.append("AFTER PAUSE " + str(await page.evaluate(STATE_JS)))
    await snap(page, out, f"keys_{w}x{h}")



async def discs(page, out, w, h, logs):
    await page.wait_for_timeout(3000)
    await lowres(page)
    logs.append("INIT " + str(await page.evaluate(STATE_JS)) + " disc=" + await page.evaluate("() => window.__grindfm.Player.disc.id"))
    await snap(page, out, f"discs_idle_{w}x{h}")
    g = await page.evaluate("() => { const v = window.__grindfm.view; return [v.cx, v.cy, v.r]; }")
    await page.mouse.click(g[0] + g[2] * 0.4, g[1] + g[2] * 0.3)
    await page.wait_for_timeout(2500)
    logs.append("PLAYING " + str(await page.evaluate(STATE_JS)))
    rows = await page.evaluate("() => [...document.querySelectorAll('#tracks li')].map(li => li.querySelector('strong').textContent + ' / ' + li.querySelector('.t span').textContent)")
    logs.append("JSR ROWS (%d): " % len(rows) + " | ".join(rows[24:30]))
    # switch to JSRF with the banner button
    await page.click('.disc-btn[data-disc="1"]')
    await page.wait_for_timeout(350)
    await snap(page, out, f"discs_swap_out_{w}x{h}")
    await page.wait_for_timeout(500)
    await snap(page, out, f"discs_swap_in_{w}x{h}")
    await page.wait_for_timeout(2600)
    logs.append("AFTER SWITCH " + str(await page.evaluate(STATE_JS)) + " disc=" + await page.evaluate("() => window.__grindfm.Player.disc.id") + " recolor=" + str(await page.evaluate("() => window.__grindfm.Theme.recolor.toFixed(2)")))
    await snap(page, out, f"discs_jsrf_{w}x{h}")
    await page.click("#btnTracks")
    await page.wait_for_timeout(1200)
    await snap(page, out, f"discs_tracks_{w}x{h}")
    await page.click('.disc-tab[data-disc="0"]')
    await page.wait_for_timeout(3200)
    logs.append("BACK TO JSR " + str(await page.evaluate(STATE_JS)) + " disc=" + await page.evaluate("() => window.__grindfm.Player.disc.id"))
    await page.keyboard.press("Escape")
    await page.keyboard.press("c")
    await page.wait_for_timeout(3200)
    logs.append("KEY C " + str(await page.evaluate(STATE_JS)) + " disc=" + await page.evaluate("() => window.__grindfm.Player.disc.id"))
    await page.keyboard.press("1")
    await page.wait_for_timeout(3200)
    logs.append("KEY 1 " + str(await page.evaluate(STATE_JS)) + " disc=" + await page.evaluate("() => window.__grindfm.Player.disc.id"))


async def jsrf_final(page, out, w, h, logs):
    await page.wait_for_timeout(3000)
    await lowres(page)
    await page.evaluate("() => window.__grindfm.switchDisc(1)")
    await page.wait_for_timeout(150)
    await page.evaluate("() => document.getAnimations().forEach(a => { if (a.animationName === 'card-slam') { a.pause(); a.currentTime = 700; } })")
    await page.wait_for_timeout(2600)
    await page.evaluate("() => { const T = window.__grindfm.Theme; T.recolor = 1; T.line.copy(T.lineTarget); }")
    await page.wait_for_timeout(1500)
    await snap(page, out, f"jsrf_card_{w}x{h}")
    await page.evaluate("() => document.getAnimations().forEach(a => { if (a.animationName === 'card-slam') a.finish(); })")
    await page.evaluate("() => { const M = window.__grindfm.Motion; M.nextFlip = 1e9; }")
    await page.wait_for_timeout(1500)
    await snap(page, out, f"jsrf_final_{w}x{h}")
    logs.append("STATE " + str(await page.evaluate(STATE_JS)))


async def demo_discs(page, out, w, h, logs):
    await page.wait_for_timeout(3000)
    await lowres(page)
    logs.append("DEMO INIT " + str(await page.evaluate(STATE_JS)))
    await page.keyboard.press("Space")
    await page.wait_for_timeout(1500)
    logs.append("DEMO PLAY " + str(await page.evaluate(STATE_JS)))
    await page.keyboard.press("ArrowRight")
    await page.wait_for_timeout(800)
    logs.append("DEMO NEXT " + str(await page.evaluate(STATE_JS)))
    await page.keyboard.press("2")
    await page.wait_for_timeout(2500)
    logs.append("DEMO DISC2 " + str(await page.evaluate(STATE_JS)) + " disc=" + await page.evaluate("() => window.__grindfm.Player.disc.id"))
    await page.keyboard.press("c")
    await page.wait_for_timeout(2500)
    logs.append("DEMO DISC1 " + str(await page.evaluate(STATE_JS)) + " disc=" + await page.evaluate("() => window.__grindfm.Player.disc.id"))
    await snap(page, out, f"demo_discs_{w}x{h}")
