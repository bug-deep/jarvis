#!/usr/bin/env python3
"""Рисует иконку Джарвиса: build/icon.png (1024) и build/icon.ico."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
SIZE = 1024
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def main() -> None:
    BUILD.mkdir(exist_ok=True)

    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    for y in range(SIZE):
        t = y / SIZE
        draw.line([(0, y), (SIZE, y)], fill=(int(8 + 6 * t), int(12 + 8 * t), int(22 + 26 * t), 255))

    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=230, fill=255)
    img.putalpha(mask)

    draw = ImageDraw.Draw(img)
    cx = cy = SIZE // 2
    for radius, alpha, width in [(360, 30, 10), (315, 55, 10), (270, 90, 8)]:
        draw.ellipse(
            [cx - radius, cy - radius, cx + radius, cy + radius],
            outline=(110, 231, 255, alpha),
            width=width,
        )
    draw.arc([cx - 395, cy - 395, cx + 395, cy + 395], start=200, end=340, fill=(139, 92, 246, 220), width=16)

    font = ImageFont.truetype(FONT, 520)
    box = draw.textbbox((0, 0), "J", font=font)
    width = box[2] - box[0]
    height = box[3] - box[1]
    draw.text(
        (cx - width / 2 - box[0], cy - height / 2 - box[1] - 10),
        "J",
        font=font,
        fill=(234, 242, 255, 255),
    )
    draw.ellipse([cx + 180, cy - 250, cx + 250, cy - 180], fill=(110, 231, 255, 255))

    img.save(BUILD / "icon.png")
    img.save(
        BUILD / "icon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(f"готово: {BUILD / 'icon.png'} и {BUILD / 'icon.ico'}")


if __name__ == "__main__":
    main()
