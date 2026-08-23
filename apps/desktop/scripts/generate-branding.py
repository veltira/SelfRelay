from __future__ import annotations

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "assets" / "branding" / "selfrelay-logo.png"
ICONS = ROOT / "apps" / "desktop" / "src-tauri" / "icons"
QA = ROOT / "artifacts" / "desktop-branding-qa"
SIZES = (16, 24, 32, 48, 64, 128, 256)
QA_SIZES = (16, 32, 48, 256)


def build_square() -> Image.Image:
    source = Image.open(SOURCE).convert("RGBA")
    bbox = source.getbbox()
    if bbox:
        source = source.crop(bbox)
    canvas = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    # Reserve enough transparent breathing room to prevent taskbar/tray clipping.
    available = (388, 388)
    source.thumbnail(available, Image.Resampling.LANCZOS)
    x = (canvas.width - source.width) // 2
    y = (canvas.height - source.height) // 2
    canvas.alpha_composite(source, (x, y))
    return canvas


def validate(image: Image.Image, size: int) -> None:
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    bbox = alpha.getbbox()
    if bbox is None:
        raise RuntimeError(f"{size}px branding frame is fully transparent")
    left, top, right, bottom = bbox
    if left <= 0 or top <= 0 or right >= size or bottom >= size:
        raise RuntimeError(f"{size}px branding frame touches canvas edge: {bbox}")
    visible = sum(1 for value in alpha.getdata() if value > 12)
    if visible < max(8, size * size // 45):
        raise RuntimeError(f"{size}px branding frame contains too little visible artwork")


def main() -> None:
    if not SOURCE.is_file():
        raise SystemExit(f"Canonical SelfRelay logo missing: {SOURCE}")
    ICONS.mkdir(parents=True, exist_ok=True)
    QA.mkdir(parents=True, exist_ok=True)
    base = build_square()

    frames: dict[int, Image.Image] = {}
    for size in SIZES:
        frame = base.resize((size, size), Image.Resampling.LANCZOS)
        validate(frame, size)
        frames[size] = frame
        frame.save(ICONS / f"{size}x{size}.png", optimize=True)

    frames[128].save(ICONS / "128x128@2x.png", optimize=True)
    frames[32].save(ICONS / "tray.png", optimize=True)
    frames[48].save(ICONS / "window.png", optimize=True)
    frames[48].save(ICONS / "taskbar.png", optimize=True)
    frames[256].save(ICONS / "installer.png", optimize=True)
    frames[256].save(ICONS / "start-menu.png", optimize=True)

    base.save(
        ICONS / "icon.ico",
        format="ICO",
        sizes=[(size, size) for size in SIZES],
        bitmap_format="png",
    )

    ico = Image.open(ICONS / "icon.ico")
    embedded = set(getattr(ico, "ico").sizes())
    missing = set((size, size) for size in SIZES) - embedded
    if missing:
        raise RuntimeError(f"ICO is missing required frames: {sorted(missing)}")

    for size in QA_SIZES:
        extracted = getattr(ico, "ico").getimage((size, size)).convert("RGBA")
        validate(extracted, size)
        extracted.save(QA / f"selfrelay-icon-{size}.png", optimize=True)

    (QA / "branding-qa.txt").write_text(
        "canonical=assets/branding/selfrelay-logo.png\n"
        f"ico_frames={','.join(str(size) for size in SIZES)}\n"
        "aspect_ratio=preserved\ncanvas=transparent\nvalidation=PASS\n",
        encoding="utf-8",
    )
    print("SelfRelay branding QA PASS")
    print(f"ICO frames: {sorted(embedded)}")


if __name__ == "__main__":
    main()
