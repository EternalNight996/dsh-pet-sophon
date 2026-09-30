"""生成桌面宠物的图标资源（纯 Pillow，可重复运行）。

产出：
  assets/tray.png     32x32  托盘图标（智子瞳：银灰六边形 + 环）
  assets/icon-256.png 256x256 应用/关于面板图标
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "assets"
OUT.mkdir(parents=True, exist_ok=True)

# 智子（sophon）瞳色，与 core/skins.mjs 的 EYE_THEMES.sophon 对齐
IRIS = ((203, 213, 225), (100, 116, 139), (15, 23, 42))
SCLERA = (241, 245, 249)
PUPIL = (5, 7, 11)
GLOW = (100, 116, 139)


def draw_eye(size: int, *, glow: bool) -> Image.Image:
    """画一只智子眼。"""
    scale = 8  # 超采样后缩小，边缘更干净
    w = size * scale
    img = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx = cy = w / 2

    # 外光晕
    if glow:
        halo = Image.new("RGBA", (w, w), (0, 0, 0, 0))
        hd = ImageDraw.Draw(halo)
        hd.ellipse(
            [cx - w * 0.46, cy - w * 0.46, cx + w * 0.46, cy + w * 0.46],
            fill=(*GLOW, 90),
        )
        halo = halo.filter(ImageFilter.GaussianBlur(w * 0.055))
        img = Image.alpha_composite(img, halo)
        d = ImageDraw.Draw(img)

    # 眼白
    rx, ry = w * 0.40, w * 0.29
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=(*SCLERA, 255))

    # 虹膜（径向渐变用同心圆近似）
    ir = w * 0.185
    steps = 26
    for i in range(steps, 0, -1):
        t = i / steps
        col = tuple(
            int(IRIS[0][k] + (IRIS[2][k] - IRIS[0][k]) * (1 - t)) for k in range(3)
        )
        mid = tuple(int(IRIS[0][k] + (IRIS[1][k] - IRIS[0][k]) * (1 - t)) for k in range(3))
        c = col if t > 0.55 else mid
        r = ir * t
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(*c, 255))

    # 瞳孔：智子 = 六边形 + 一环
    hexr = ir * 0.42
    pts = [
        (cx + hexr * math.cos(math.radians(60 * k - 90)), cy + hexr * math.sin(math.radians(60 * k - 90)))
        for k in range(6)
    ]
    d.polygon(pts, fill=(*PUPIL, 255))
    ring_r = ir * 0.68
    d.ellipse(
        [cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r],
        outline=(*PUPIL, 220),
        width=max(1, int(w * 0.012)),
    )

    # 高光
    hl = ir * 0.26
    d.ellipse(
        [cx - ir * 0.42 - hl, cy - ir * 0.48 - hl, cx - ir * 0.42 + hl, cy - ir * 0.48 + hl],
        fill=(255, 255, 255, 235),
    )

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    tray = draw_eye(32, glow=False)
    tray.save(OUT / "tray.png")
    icon = draw_eye(256, glow=True)
    icon.save(OUT / "icon-256.png")
    print(f"written: {OUT / 'tray.png'} ({tray.size})")
    print(f"written: {OUT / 'icon-256.png'} ({icon.size})")


if __name__ == "__main__":
    main()
