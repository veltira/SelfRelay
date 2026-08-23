from __future__ import annotations

import hashlib
import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "apps" / "desktop" / "assets" / "selfrelay-logo.png"
ICONS = ROOT / "apps" / "desktop" / "src-tauri" / "icons"
QA = ROOT / "artifacts" / "desktop-branding-qa"
SIZES = (16, 24, 32, 48, 64, 128, 256)
QA_SIZES = (16, 32, 48, 128, 256)


def validate_pixels(image: Image.Image, label: str, *, require_inner_margin: bool = False) -> Image.Image:
    rgba = image.convert("RGBA")
    if rgba.width != rgba.height:
        raise RuntimeError(f"{label} must be square, got {rgba.width}x{rgba.height}")
    if rgba.width <= 0:
        raise RuntimeError(f"{label} has invalid dimensions")

    alpha = rgba.getchannel("A")
    minimum, maximum = alpha.getextrema()
    if maximum == 0:
        raise RuntimeError(f"{label} is fully transparent")
    if minimum == 255:
        raise RuntimeError(f"{label} has no real transparency")

    bbox = alpha.getbbox()
    if bbox is None:
        raise RuntimeError(f"{label} contains no visible artwork")
    if require_inner_margin:
        left, top, right, bottom = bbox
        if left <= 0 or top <= 0 or right >= rgba.width or bottom >= rgba.height:
            raise RuntimeError(f"{label} source artwork is clipped at the canvas edge: {bbox}")

    visible = sum(1 for value in alpha.getdata() if value > 12)
    if visible < max(8, rgba.width * rgba.height // 45):
        raise RuntimeError(f"{label} contains too little visible artwork")
    return rgba


def open_verified_png(
    path: Path,
    expected_size: int | None = None,
    *,
    require_inner_margin: bool = False,
) -> Image.Image:
    if not path.is_file():
        raise RuntimeError(f"PNG missing: {path}")

    with Image.open(path) as probe:
        if probe.format != "PNG":
            raise RuntimeError(f"Expected PNG at {path}, got {probe.format}")
        probe.verify()

    with Image.open(path) as reopened:
        reopened.load()
        rgba = validate_pixels(reopened, str(path), require_inner_margin=require_inner_margin)

    if expected_size is not None and rgba.size != (expected_size, expected_size):
        raise RuntimeError(f"{path} expected {expected_size}x{expected_size}, got {rgba.size}")
    return rgba


def save_verified_png(image: Image.Image, path: Path, expected_size: int) -> Image.Image:
    image.save(path, format="PNG", optimize=True)
    return open_verified_png(path, expected_size)


def verify_ico(path: Path) -> set[tuple[int, int]]:
    with Image.open(path) as probe:
        if probe.format != "ICO":
            raise RuntimeError(f"Expected ICO at {path}, got {probe.format}")
        probe.verify()

    with Image.open(path) as ico:
        decoder = getattr(ico, "ico", None)
        if decoder is None:
            raise RuntimeError("Pillow could not expose ICO frames")
        embedded = set(decoder.sizes())
        required = {(size, size) for size in SIZES}
        missing = required - embedded
        if missing:
            raise RuntimeError(f"ICO is missing required frames: {sorted(missing)}")
        for size in SIZES:
            extracted = decoder.getimage((size, size))
            validate_pixels(extracted, f"ICO {size}x{size} frame")
    return embedded


def main() -> None:
    source = open_verified_png(SOURCE, require_inner_margin=True)
    if source.width < 128:
        raise RuntimeError(f"Desktop branding master is unexpectedly small: {source.size}")

    ICONS.mkdir(parents=True, exist_ok=True)
    if QA.exists():
        shutil.rmtree(QA)
    QA.mkdir(parents=True, exist_ok=True)

    frames: dict[int, Image.Image] = {}
    for size in SIZES:
        frame = source.resize((size, size), Image.Resampling.LANCZOS)
        frames[size] = save_verified_png(frame, ICONS / f"{size}x{size}.png", size)

    save_verified_png(frames[256], ICONS / "128x128@2x.png", 256)
    save_verified_png(frames[32], ICONS / "tray.png", 32)
    save_verified_png(frames[48], ICONS / "window.png", 48)
    save_verified_png(frames[48], ICONS / "taskbar.png", 48)
    save_verified_png(frames[256], ICONS / "installer.png", 256)
    save_verified_png(frames[256], ICONS / "start-menu.png", 256)

    ico_path = ICONS / "icon.ico"
    frames[256].save(
        ico_path,
        format="ICO",
        sizes=[(size, size) for size in SIZES],
        bitmap_format="png",
    )
    embedded = verify_ico(ico_path)

    with Image.open(ico_path) as ico:
        decoder = getattr(ico, "ico")
        for size in QA_SIZES:
            extracted = decoder.getimage((size, size)).convert("RGBA")
            save_verified_png(extracted, QA / f"selfrelay-icon-{size}.png", size)

    preview = source.resize((512, 512), Image.Resampling.LANCZOS)
    save_verified_png(preview, QA / "selfrelay-logo-interface-512.png", 512)

    source_sha256 = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    (QA / "branding-qa.txt").write_text(
        "source=apps/desktop/assets/selfrelay-logo.png\n"
        f"source_sha256={source_sha256}\n"
        f"source_dimensions={source.width}x{source.height}\n"
        "source_verify=PASS\n"
        "source_rgba=PASS\n"
        "source_transparency=PASS\n"
        "source_inner_margin=PASS\n"
        f"png_frames={','.join(str(size) for size in SIZES)}\n"
        f"ico_frames={','.join(str(size) for size in SIZES)}\n"
        "ico_decode_all_frames=PASS\n"
        "aspect_ratio=preserved\n"
        "cropping=none\n"
        "validation=PASS\n",
        encoding="utf-8",
    )

    print("SelfRelay branding QA PASS")
    print(f"Source: {SOURCE} ({source.size}) sha256={source_sha256}")
    print(f"ICO frames: {sorted(embedded)}")


if __name__ == "__main__":
    main()
