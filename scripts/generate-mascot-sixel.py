"""Generate the small Windows Terminal image from the original mascot PNG.

Run with `python scripts/generate-mascot-sixel.py` after installing Pillow.
The generated SIXEL file is committed so AllCode users need no image tools.
"""

from pathlib import Path
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "allcode-mascot.png"
TARGET = ROOT / "assets" / "allcode-mascot.sixel"
SIZE = 84
SHADES = 16


def repeat_runs(characters: str) -> str:
    output = []
    start = 0
    while start < len(characters):
        end = start + 1
        while end < len(characters) and characters[end] == characters[start]:
            end += 1
        count = end - start
        output.append(f"!{count}{characters[start]}" if count >= 4 else characters[start] * count)
        start = end
    return "".join(output)


image = Image.open(SOURCE).convert("RGBA").resize((SIZE, SIZE), Image.Resampling.LANCZOS)
pixels = image.load()
bands = []
for band_y in range(0, SIZE, 6):
    colors = []
    for shade in range(SHADES):
        sixels = []
        for x in range(SIZE):
            bits = 0
            for bit in range(6):
                y = band_y + bit
                if y >= SIZE:
                    continue
                red, green, blue, alpha = pixels[x, y]
                gray = round((red + green + blue) / 3)
                index = min(SHADES - 1, round(gray * (SHADES - 1) / 255))
                if alpha >= 80 and index == shade:
                    bits |= 1 << bit
            sixels.append(chr(63 + bits))
        if any(char != "?" for char in sixels):
            colors.append(f"#{shade}{repeat_runs(''.join(sixels))}")
    bands.append("$".join(colors))

palette = "".join(
    f"#{shade};2;{round(shade * 100 / (SHADES - 1))};"
    f"{round(shade * 100 / (SHADES - 1))};{round(shade * 100 / (SHADES - 1))}"
    for shade in range(SHADES)
)
sequence = f"\x1bP0;1q\"1;1;{SIZE};{SIZE}{palette}{'-'.join(bands)}\x1b\\"
TARGET.write_bytes(sequence.encode("ascii"))
print(f"Generated {TARGET.relative_to(ROOT)} ({len(sequence)} bytes)")
