"""Assemble the site into a single self-contained index.html at the repository root.
Everything is inlined: CSS, the JS modules from src/js (in file order), and the images
(labels, thumbnails, background, character) as data: URIs from build/assets.json.

    python3 build.py              -> index.html
    python3 build.py --artifact   -> also dist/artifact.html (page body only, for Claude artifacts)
"""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).parent
SRC = ROOT / "src"

THREE_VER = "0.170.0"
FONTS = "https://fonts.googleapis.com/css2?family=Bungee&family=Dela+Gothic+One&family=DotGothic16&display=swap"

css = (SRC / "style.css").read_text()
body = (SRC / "body.html").read_text()
js_parts = sorted((SRC / "js").glob("*.js"))
js = "\n".join(p.read_text() for p in js_parts)

assets = json.loads((ROOT / "build" / "assets.json").read_text())
assert js.count("'__ASSETS__'") == 1
js = js.replace("'__ASSETS__'", json.dumps(assets, separators=(",", ":")))

# syntax check of the module
check = ROOT / "build" / "_check.mjs"
check.write_text(js)
r = subprocess.run(["node", "--check", str(check)], capture_output=True, text=True)
if r.returncode != 0:
    print(r.stderr)
    sys.exit(1)

importmap = (
    '<script type="importmap">{"imports":{'
    f'"three":"https://cdn.jsdelivr.net/npm/three@{THREE_VER}/build/three.module.js",'
    f'"three/addons/":"https://cdn.jsdelivr.net/npm/three@{THREE_VER}/examples/jsm/"'
    "}}</script>"
)
desc = "GRIND//FM : un CD 3D irisé qui joue les bandes-son de Jet Set Radio et Jet Set Radio Future, avec des visuels qui réagissent au son."
fonts = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    f'<link rel="stylesheet" href="{FONTS}">'
)

full = f"""<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="strict-origin-when-cross-origin">
<meta name="description" content="{desc}">
<meta name="theme-color" content="#F8F1E1">
<title>GRIND//FM</title>
{fonts}
<style>
{css}
</style>
</head>
<body>
{body}
{importmap}
<script type="module">
{js}
</script>
</body>
</html>
"""

artifact = f"""<title>GRIND//FM</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="{desc}">
{fonts}
<style>
{css}
</style>
{body}
{importmap}
<script type="module">
{js}
</script>
"""

(ROOT / "index.html").write_text(full)
print("index.html", len(full.encode()), "bytes")
if "--artifact" in sys.argv:
    (ROOT / "dist").mkdir(exist_ok=True)
    (ROOT / "dist" / "artifact.html").write_text(artifact)
    print("dist/artifact.html", len(artifact.encode()), "bytes")
