"""Builds public/og-zoom-unbound.png (1200x630): vertical Unbound Mind logo, Joseph's photo,
JOIN JOSEPH ON ZOOM. Same layout as og-zoom.png. Run from the hana-calendar root."""
from PIL import Image, ImageDraw, ImageFont

FONT = "./fonts/Marcellus-Regular.ttf"
BG, FG = (10, 9, 8), (241, 236, 226)
hana = Image.open("public/og.png").convert("RGB")
out = Image.new("RGB", (1200, 630), BG)

# vertical logo (transparent white), cropped to its ink, fitted to 250px tall
logo = Image.open("public/unbound-mind-vertical-white.png").convert("RGBA")
logo = logo.crop(logo.getchannel("A").point(lambda v: 255 if v > 10 else 0).getbbox())
h = 250; logo = logo.resize((round(logo.width * h / logo.height), h), Image.LANCZOS)
out.alpha_composite = None  # (RGB canvas: paste with mask instead)
out.paste(logo, ((1200 - logo.width) // 2, 24), logo)

# photo circle + ring, lifted from the Hana card (same background colour, so it blends)
out.paste(hana.crop((495, 298, 705, 508)), (495, 298 + 4))

# headline: same Marcellus size/tracking as the Hana card
f = ImageFont.truetype(FONT, 50)
OLD = "SCHEDULE WITH JOSEPH"
track = (768 - sum(f.getlength(c) for c in OLD)) / (len(OLD) - 1)
NEW = "JOIN JOSEPH ON ZOOM"
w = sum(f.getlength(c) for c in NEW) + track * (len(NEW) - 1)
d = ImageDraw.Draw(out); x = (1200 - w) / 2; y = 554 - 12
for ch in NEW:
    d.text((x, y), ch, font=f, fill=FG); x += f.getlength(ch) + track
out.save("public/og-zoom-unbound.png", optimize=True)
