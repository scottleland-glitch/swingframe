"""Draw the Swingframe home-screen icons. Run from the repo root."""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
BG = (16, 22, 18)
FAIRWAY = (28, 61, 48)
CREAM = (246, 243, 236)
LIME = (228, 255, 106)


def icon(size: int, maskable: bool) -> Image.Image:
    image = Image.new("RGB", (size, size), BG)
    draw = ImageDraw.Draw(image)
    inset = int(size * (0.2 if maskable else 0.14))
    draw.ellipse([inset, inset, size - inset - 1, size - inset - 1], fill=FAIRWAY)
    ring = max(2, size // 48)
    draw.ellipse(
        [inset, inset, size - inset - 1, size - inset - 1],
        outline=CREAM,
        width=ring,
    )
    start = (int(size * 0.36), int(size * 0.66))
    end = (int(size * 0.66), int(size * 0.34))
    width = max(3, size // 26)
    draw.line([start, end], fill=LIME, width=width)
    ball = max(4, size // 22)
    draw.ellipse(
        [start[0] - ball, start[1] - ball, start[0] + ball, start[1] + ball],
        fill=CREAM,
    )
    return image


def main() -> None:
    icons = PUBLIC / "icons"
    icons.mkdir(parents=True, exist_ok=True)
    icon(192, False).save(icons / "icon-192.png")
    icon(512, False).save(icons / "icon-512.png")
    icon(512, True).save(icons / "icon-512-maskable.png")
    icon(180, False).save(PUBLIC / "apple-touch-icon.png")


if __name__ == "__main__":
    main()
