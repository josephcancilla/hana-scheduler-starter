"""Builds public/og-zoom.png (1200x630) from public/og.png: same Hana mark + photo,
bottom line swapped to JOIN JOSEPH ON ZOOM. Re-run: python3 zoom-landing/make-og-zoom.py"""
from PIL import Image, ImageDraw, ImageFont
import numpy as np, sys

FONT = "./fonts/Marcellus-Regular.ttf"
src = Image.open("public/og.png").convert("RGB")
BG, FG = (10, 9, 8), (241, 236, 226)

def draw_spaced(d, text, font, x0, y0, track, fill=FG):
    x = x0
    for ch in text:
        d.text((x, y0), ch, font=font, fill=fill)
        x += font.getlength(ch) + track
    return x - track

def width(text, font, track):
    return sum(font.getlength(c) for c in text) + track * (len(text) - 1)

def fit(size, track, target_text, target_w):
    f = ImageFont.truetype(FONT, size)
    return f, width(target_text, f, track)

# calibrate against the original line: SCHEDULE WITH JOSEPH spans x 215..983 (768px)
OLD, OLD_W = "SCHEDULE WITH JOSEPH", 768
size = 50
f = ImageFont.truetype(FONT, size)
track = (OLD_W - sum(f.getlength(c) for c in OLD)) / (len(OLD) - 1)

NEW = "JOIN JOSEPH ON ZOOM"
out = src.copy()
d = ImageDraw.Draw(out)
d.rectangle([0, 520, 1200, 630], fill=BG)          # wipe old line
w = width(NEW, f, track)
# baseline-match: render old text to find its cap top, reuse same y
probe = Image.new("L", (1200, 200), 0); pd = ImageDraw.Draw(probe)
draw_spaced(pd, OLD, f, 215, 0, track, fill=255)
bbox = np.array(probe).nonzero()
cap_top = bbox[0].min()
y = 554 - cap_top
draw_spaced(d, NEW, f, (1200 - w) / 2, y, track)
out.save("public/og-zoom.png", optimize=True)
print("track", round(track, 2), "new width", round(w), "x0", round((1200 - w) / 2))
