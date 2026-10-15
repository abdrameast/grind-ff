"""Build every image asset the page embeds.

- labels: each disc scan -> centred, un-skewed ink mask (255 = ink), disc fills the square
- thumbs: small round previews of each disc for the disc switcher
- background: the city illustration with the character knocked out (filled with paper)
- character: the cut-out character, cropped to its bounding box (RGBA)

Writes build/assets.json with data URIs + metadata, consumed by build.py.
"""
import base64
import io
import json
import pathlib

import cv2
import numpy as np
from PIL import Image

HERE = pathlib.Path(__file__).parent
SRC = HERE.parent / "assets_src"
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)


def data_uri(img: Image.Image, fmt="WEBP", **kw) -> str:
    buf = io.BytesIO()
    img.save(buf, fmt, **kw)
    mime = {"WEBP": "image/webp", "PNG": "image/png", "JPEG": "image/jpeg"}[fmt]
    return f"data:{mime};base64," + base64.b64encode(buf.getvalue()).decode()


# ----------------------------------------------------------------------------- labels
def make_label(src: pathlib.Path, n: int, r_in: float, r_out: float, name: str):
    im = Image.open(src).convert("RGBA")
    a = np.asarray(im).astype(np.float32) / 255.0
    alpha = a[:, :, 3]
    rgb = a[:, :, :3] * alpha[..., None] + (1.0 - alpha[..., None])
    lum = 0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]

    mask = (alpha > 0.5).astype(np.uint8)
    cnts, _ = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    cnts = sorted(cnts, key=cv2.contourArea, reverse=True)
    (cx, cy), (ax0, ax1), ang = cv2.fitEllipse(cnts[0])
    radius = (ax0 + ax1) / 4

    # paper level: a closing removes the ink strokes and keeps the slow shading
    k = int(round(radius * 0.058)) | 1
    lum8 = (np.clip(lum, 0, 1) * 255).astype(np.uint8)
    bg = cv2.morphologyEx(lum8, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    bg = cv2.GaussianBlur(bg.astype(np.float32) / 255.0, (0, 0), radius * 0.011)
    ratio = np.clip(lum / np.maximum(bg, 0.25), 0, 1.2)

    t = np.deg2rad(ang)
    c, s = np.cos(t), np.sin(t)
    R = np.array([[c, -s], [s, c]])
    M = R @ np.diag([ax0 / 2.0, ax1 / 2.0]) @ R.T
    u = (np.arange(n) + 0.5) / n
    PX, PY = np.meshgrid(u * 2 - 1, 1 - u * 2)
    img_xy = np.stack([PX, -PY], axis=-1) @ M.T
    hi = cv2.remap(ratio.astype(np.float32), (img_xy[..., 0] + cx).astype(np.float32),
                   (img_xy[..., 1] + cy).astype(np.float32), cv2.INTER_CUBIC,
                   borderMode=cv2.BORDER_CONSTANT, borderValue=1.0)
    ink = np.clip((0.80 - hi) / (0.80 - 0.42), 0, 1)
    ink = ink * ink * (3 - 2 * ink)
    r = np.sqrt(PX ** 2 + PY ** 2)
    ink *= np.clip((r - r_in) / 0.006, 0, 1) * np.clip((r_out - r) / 0.006, 0, 1)
    binm = (ink > 0.5).astype(np.uint8)
    nlab, lab, stats, _ = cv2.connectedComponentsWithStats(binm, 8)
    small = np.zeros(nlab, bool)
    small[1:] = stats[1:, cv2.CC_STAT_AREA] < 6
    ink[small[lab]] = 0
    out = (np.clip(ink, 0, 1) * 255).astype(np.uint8)
    img = Image.fromarray(out, "L")
    img.save(OUT / f"label_{name}.png")
    Image.fromarray(255 - out, "L").resize((768, 768), Image.LANCZOS).save(OUT / f"label_{name}_preview.png")
    print(f"label {name}: ellipse c=({cx:.1f},{cy:.1f}) R={radius:.1f} kernel={k}")
    return img


def make_thumb(ink: Image.Image, size=144):
    """Paper disc + ink, clear hub, transparent hole: used by the disc switcher."""
    ss = size * 4
    inkl = np.asarray(ink.resize((ss, ss), Image.LANCZOS)).astype(np.float32) / 255.0
    yy, xx = np.mgrid[0:ss, 0:ss]
    r = np.hypot((xx + 0.5) / ss * 2 - 1, (yy + 0.5) / ss * 2 - 1)
    paper = np.array([246, 243, 236], np.float32)
    inkc = np.array([18, 18, 20], np.float32)
    hub = np.array([214, 222, 230], np.float32)
    col = paper[None, None, :] * (1 - inkl[..., None]) + inkc[None, None, :] * inkl[..., None]
    col = np.where((r < 0.2)[..., None], hub[None, None, :], col)
    # rainbow sheen on the outer rim
    ang = np.arctan2(yy - ss / 2, xx - ss / 2)
    hue = (ang / (2 * np.pi) + 0.5) * 3 % 1
    rim = ((r > 0.93) & (r < 0.985)).astype(np.float32)
    rainbow = np.stack([np.clip(np.abs(hue * 6 - 3) - 1, 0, 1), np.clip(2 - np.abs(hue * 6 - 2), 0, 1),
                        np.clip(2 - np.abs(hue * 6 - 4), 0, 1)], -1) * 255
    col = col * (1 - 0.35 * rim[..., None]) + rainbow * 0.35 * rim[..., None]
    a = ((r < 0.985) & (r > 0.125)).astype(np.float32)
    outline = ((r > 0.955) & (r < 0.985)) | ((r > 0.125) & (r < 0.15))
    col[outline] = inkc
    rgba = np.dstack([np.clip(col, 0, 255), a * 255]).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA").resize((size, size), Image.LANCZOS)


# ----------------------------------------------------------------------------- background + character
def make_scene():
    bg = np.asarray(Image.open(SRC / "bg_src.jpg").convert("RGB")).astype(np.float32)
    gum = Image.open(SRC / "gum_src.png").convert("RGBA")
    g = np.asarray(gum).astype(np.float32)
    alpha = g[:, :, 3] / 255.0
    H, W = alpha.shape

    # paper colour: the brightest, low-saturation pixels outside the character
    outside = alpha < 0.01
    px = bg[outside]
    lumv = px @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    paper = px[lumv > np.percentile(lumv, 60)].mean(axis=0)
    dist = np.abs(px - paper).sum(axis=1)
    line = np.median(px[dist > 250], axis=0)

    # knock the character out of the background, with a small margin
    hole = (alpha > 0.02).astype(np.uint8)
    hole = cv2.dilate(hole, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))
    soft = cv2.GaussianBlur(hole.astype(np.float32), (0, 0), 1.6)
    soft = np.maximum(soft, hole.astype(np.float32))
    filled = bg * (1 - soft[..., None]) + paper[None, None, :] * soft[..., None]
    bg_img = Image.fromarray(np.clip(filled, 0, 255).astype(np.uint8), "RGB")
    bg_img.save(OUT / "bg_knockout.png")

    ys, xs = np.nonzero(alpha > 0.004)
    x0, x1 = max(0, xs.min() - 2), min(W, xs.max() + 3)
    y0, y1 = max(0, ys.min() - 2), min(H, ys.max() + 3)
    crop = np.asarray(gum.crop((x0, y0, x1, y1))).copy()
    # bleed the edge colours into the transparent pixels so texture filtering
    # never mixes in black (no dark fringe when the layer is scaled)
    ca = crop[:, :, 3]
    transparent = (ca < 200).astype(np.uint8)
    _, labels = cv2.distanceTransformWithLabels(transparent, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    zy, zx = np.nonzero(transparent == 0)
    order = np.lexsort((zx, zy))
    zy, zx = zy[order], zx[order]
    lab = labels[transparent == 1] - 1
    src = crop[zy[lab], zx[lab], :3]
    rgb = crop[:, :, :3]
    rgb[transparent == 1] = src
    crop[:, :, :3] = rgb
    crop = Image.fromarray(crop, "RGBA")
    crop.save(OUT / "gum_crop.png")
    return bg_img, crop, {"w": W, "h": H, "gumRect": [int(x0), int(y0), int(x1 - x0), int(y1 - y0)],
                          "paper": [round(float(v), 1) for v in paper], "line": [round(float(v), 1) for v in line]}


def main():
    assets = {}
    ink_jsr = make_label(SRC / "label_jsr_src.png", 2048, 0.207, 0.966, "jsr")
    ink_jsrf = make_label(SRC / "label_jsrf_src.png", 2048, 0.199, 0.972, "jsrf")
    for name, ink in (("jsr", ink_jsr), ("jsrf", ink_jsrf)):
        assets[f"label_{name}"] = data_uri(ink, "WEBP", lossless=True, quality=100, method=6)
        th = make_thumb(ink)
        th.save(OUT / f"thumb_{name}.png")
        assets[f"thumb_{name}"] = data_uri(th, "WEBP", quality=90, method=6)

    bg_img, gum_crop, meta = make_scene()
    assets["bg"] = data_uri(bg_img, "WEBP", quality=88, method=6)
    assets["gum"] = data_uri(gum_crop, "WEBP", quality=90, alpha_quality=100, method=6, exact=True)
    assets["meta"] = meta
    (HERE / "assets.json").write_text(json.dumps(assets))
    for k, v in assets.items():
        if isinstance(v, str):
            print(f"{k:12s} {len(v) / 1024:8.1f} KB (base64)")
    print("meta", meta)


if __name__ == "__main__":
    main()
