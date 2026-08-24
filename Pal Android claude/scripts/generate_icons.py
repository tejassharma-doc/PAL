#!/usr/bin/env python3
"""
Generate PAL Health Android launcher PNG icons for API 24-25 devices.

API 26+ already works via mipmap-anydpi-v26/ adaptive icon XML.
This script generates the PNG fallbacks for the remaining ~2% of
devices on Android 7.x (API 24-25).

Usage:
    pip install Pillow
    python scripts/generate_icons.py

Run once from the project root (not from scripts/).
"""
import os
import sys
import math

try:
    from PIL import Image, ImageDraw
except ImportError:
    print("Pillow not found. Install it with: pip install Pillow")
    sys.exit(1)

# PAL brand colours
JADE  = (55, 181, 155)   # #37b59b
WHITE = (255, 255, 255)

# Required mipmap densities and their icon sizes
SIZES = {
    "mipmap-mdpi":    48,
    "mipmap-hdpi":    72,
    "mipmap-xhdpi":   96,
    "mipmap-xxhdpi":  144,
    "mipmap-xxxhdpi": 192,
}

RES_DIR = os.path.join("android", "app", "src", "main", "res")


def rounded_rectangle(draw, xy, radius, fill):
    """Draw a rounded rectangle (Pillow < 8.2 compat)."""
    x0, y0, x1, y1 = xy
    draw.rectangle([x0 + radius, y0, x1 - radius, y1], fill=fill)
    draw.rectangle([x0, y0 + radius, x1, y1 - radius], fill=fill)
    draw.ellipse([x0, y0, x0 + radius * 2, y0 + radius * 2], fill=fill)
    draw.ellipse([x1 - radius * 2, y0, x1, y0 + radius * 2], fill=fill)
    draw.ellipse([x0, y1 - radius * 2, x0 + radius * 2, y1], fill=fill)
    draw.ellipse([x1 - radius * 2, y1 - radius * 2, x1, y1], fill=fill)


def draw_icon(size, circle=False):
    """
    Render a PAL launcher icon at the given pixel size.
    circle=True → round icon; circle=False → rounded-square icon.
    """
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Background
    if circle:
        draw.ellipse([0, 0, size - 1, size - 1], fill=JADE)
    else:
        r = max(4, size // 5)
        try:
            # Pillow 8.2+ native rounded_rectangle
            draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=JADE)
        except AttributeError:
            rounded_rectangle(draw, (0, 0, size - 1, size - 1), r, JADE)

    # Scale factor: the vector is drawn in a 108×108 viewport
    s = size / 108.0

    # P letter — stem (rectangle)
    stem = [int(35 * s), int(24 * s), int(50 * s), int(84 * s)]
    draw.rectangle(stem, fill=WHITE)

    # Bowl (filled ellipse covering the right half of the top stem)
    bowl_outer = [int(38 * s), int(24 * s), int(76 * s), int(54 * s)]
    draw.ellipse(bowl_outer, fill=WHITE)

    # Counter — cut the inner oval back to jade so the bowl looks hollow
    bowl_inner = [int(50 * s), int(32 * s), int(70 * s), int(46 * s)]
    draw.ellipse(bowl_inner, fill=JADE)

    return img


def main():
    if not os.path.isdir(RES_DIR):
        print(f"ERROR: Cannot find res/ directory at {RES_DIR!r}")
        print("Run this script from the project root (Pal Android claude/).")
        sys.exit(1)

    for folder, size in SIZES.items():
        dir_path = os.path.join(RES_DIR, folder)
        os.makedirs(dir_path, exist_ok=True)

        icon = draw_icon(size, circle=False)
        icon.save(os.path.join(dir_path, "ic_launcher.png"))
        print(f"  {folder}/ic_launcher.png  ({size}×{size})")

        icon_round = draw_icon(size, circle=True)
        icon_round.save(os.path.join(dir_path, "ic_launcher_round.png"))
        print(f"  {folder}/ic_launcher_round.png  ({size}×{size})")

    print("\nDone — PNG fallback icons generated for API 24-25 devices.")
    print("API 26+ uses the adaptive icon in mipmap-anydpi-v26/ automatically.")


if __name__ == "__main__":
    main()
