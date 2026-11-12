"""Draws the app icons (radar scope with an intercept) into public/. Run: python3 scripts/make-icons.py"""
import math
from PIL import Image, ImageDraw

BG = (6, 17, 31)
RING = (42, 61, 92)
CYAN = (56, 214, 245)
RED = (242, 84, 91)
GREEN = (52, 211, 153)


def draw(size: int, pad: float) -> Image.Image:
    s = size * 4  # draw large, then downsample for smooth edges
    im = Image.new('RGBA', (s, s), BG + (255,))
    d = ImageDraw.Draw(im)
    c = s / 2
    r = s / 2 * (1 - pad)
    w = max(2, int(s * 0.012))
    for k in (1.0, 0.68, 0.36):
        d.ellipse([c - r * k, c - r * k, c + r * k, c + r * k], outline=RING, width=w)
    d.line([c - r, c, c + r, c], fill=RING, width=w)
    d.line([c, c - r, c, c + r], fill=RING, width=w)
    # sweep wedge
    for i in range(40):
        a0 = -60 - i * 1.2
        alpha = int(150 * (1 - i / 40))
        d.pieslice([c - r, c - r, c + r, c + r], a0 - 1.2, a0, fill=CYAN + (alpha,))
    a = math.radians(-60)
    d.line([c, c, c + r * math.cos(a), c + r * math.sin(a)], fill=CYAN, width=w * 2)
    # inbound threat (red) and interceptor (green) meeting
    tx, ty = c + r * 0.55, c - r * 0.42
    d.ellipse([tx - s * 0.035, ty - s * 0.035, tx + s * 0.035, ty + s * 0.035], fill=RED)
    gx, gy = c - r * 0.1, c + r * 0.12
    d.line([gx, gy, tx - s * 0.03, ty + s * 0.03], fill=GREEN, width=w * 2)
    d.ellipse([c - s * 0.025, c - s * 0.025, c + s * 0.025, c + s * 0.025], fill=CYAN)
    return im.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    draw(192, 0.1).save('public/icon-192.png')
    draw(512, 0.1).save('public/icon-512.png')
    draw(512, 0.28).save('public/icon-maskable-512.png')  # safe zone for round/squircle masks
    draw(180, 0.12).convert('RGB').save('public/apple-touch-icon.png')
    draw(64, 0.04).save('public/favicon.png')
