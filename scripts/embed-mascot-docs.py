"""Embed a small copy of the original mascot in self-contained SVG previews."""

import base64
import io
import re
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "allcode-mascot.png"
PREVIEWS = [
    ROOT / "docs" / "images" / "command-palette.svg",
    ROOT / "docs" / "images" / "working-state.svg",
]

image = Image.open(SOURCE).convert("RGBA")
image.thumbnail((210, 210), Image.Resampling.LANCZOS)
buffer = io.BytesIO()
image.save(buffer, format="PNG", optimize=True)
data_uri = "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")

for preview in PREVIEWS:
    content = preview.read_text(encoding="utf8")
    updated, count = re.subn(r'href="(?:__ALLCODE_MASCOT__|data:image/png;base64,[^"]*)"',
                             f'href="{data_uri}"', content, count=1)
    if count != 1:
        raise ValueError(f"Mascot image slot missing: {preview}")
    preview.write_text(updated, encoding="utf8")
    print(f"Embedded mascot in {preview.relative_to(ROOT)}")
