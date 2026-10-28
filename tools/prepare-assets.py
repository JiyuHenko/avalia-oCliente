"""Build the static review catalog from the previously approved delivery.

Only format/size optimization is performed. No new artwork is created.
Usage: python tools/prepare-assets.py --manifest /path/to/manifest.json
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
from collections import Counter
from pathlib import Path

from PIL import Image, ImageOps


REPO = Path(__file__).resolve().parents[1]
WORKSPACE = REPO.parent


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare_image(source: Path, output: Path, limit: int, quality: int) -> tuple[int, int]:
    with Image.open(source) as original:
        image = ImageOps.exif_transpose(original)
        if image.mode == "RGBA":
            if image.getchannel("A").getextrema() == (255, 255):
                image = image.convert("RGB")
            else:
                image = image.copy()
        elif image.mode not in ("RGB", "RGBA"):
            image = image.convert("RGBA" if "transparency" in image.info else "RGB")
        image.thumbnail((limit, limit), Image.Resampling.LANCZOS)
        output.parent.mkdir(parents=True, exist_ok=True)
        image.save(output, "WEBP", quality=quality, method=6, exact=True)
        dimensions = image.size
    with Image.open(output) as check:
        check.verify()
    return dimensions


def video_info(path: Path) -> tuple[int, int, float]:
    result = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height:format=duration", "-of", "json", str(path),
    ]))
    stream = result["streams"][0]
    return int(stream["width"]), int(stream["height"]), float(result["format"]["duration"])


def category_for(entry: dict) -> tuple[str, str]:
    original = entry["category"]
    if original == "Videos_Direcao_A":
        return "videos", "Vídeos"
    if original == "01_Identidade":
        return "identidade", "Identidade"
    if original == "02_Embalagens":
        return "embalagens", "Embalagens"
    if original == "04_Redes_Sociais":
        return "digital", "Redes sociais"
    return "papelaria", "Papelaria"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=WORKSPACE / "work/jl/review_delivery/manifest.json")
    parser.add_argument("--brand-root", type=Path, default=WORKSPACE / "outputs/JOIAS_LEOPOLDINA_BRAND")
    parser.add_argument("--review-root", type=Path, help="Override the curated delivery root in the source manifest.")
    parser.add_argument("--report", type=Path, default=WORKSPACE / "work/jl/review_site/asset_report.json")
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    delivery = args.review_root or Path(manifest["root"])
    site = REPO / "site"
    media = site / "media"
    media.mkdir(parents=True, exist_ok=True)

    items: list[dict] = []
    report: list[dict] = []
    for entry in manifest["entries"]:
        source = delivery / entry["path"]
        identifier = entry["id"]
        category, category_label = category_for(entry)
        title = entry["title"].replace("Visao geral", "Visão geral")
        note = "Simulação conceitual de aplicação da marca." if category == "embalagens" else ""
        item = {
            "id": identifier,
            "title": title,
            "direction": entry["direction"],
            "category": category,
            "categoryLabel": category_label,
            "type": "video" if source.suffix.lower() == ".mp4" else "image",
        }
        record = {"id": identifier, "source_bytes": source.stat().st_size}
        if item["type"] == "video":
            target = media / "video" / f"{identifier}.mp4"
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            if sha256(source) != sha256(target):
                raise ValueError(f"Video copy mismatch: {identifier}")
            width, height, duration = video_info(target)
            item.update({
                "src": f"./media/video/{identifier}.mp4",
                "width": width,
                "height": height,
                "duration": duration,
            })
            record.update({"copied_sha256": sha256(target), "bytes": target.stat().st_size, "width": width, "height": height, "duration": duration})
        else:
            full = media / "full" / f"{identifier}.webp"
            thumb = media / "thumb" / f"{identifier}.webp"
            # Logo previews already include the correct opaque background.
            limit = 1800 if identifier.startswith("A") and 4 <= int(identifier[1:]) <= 24 else 2200
            width, height = prepare_image(source, full, limit, 90)
            thumb_width, thumb_height = prepare_image(source, thumb, 560, 84)
            item.update({
                "src": f"./media/full/{identifier}.webp",
                "thumbnail": f"./media/thumb/{identifier}.webp",
                "width": width,
                "height": height,
            })
            record.update({
                "full_bytes": full.stat().st_size,
                "thumbnail_bytes": thumb.stat().st_size,
                "width": width,
                "height": height,
                "thumbnail_width": thumb_width,
                "thumbnail_height": thumb_height,
            })
        item["notes"] = note
        items.append(item)
        report.append(record)

    expected = {*(f"A{n:02}" for n in range(1, 66)), *(f"B{n:02}" for n in range(1, 10)), "V01", "V02", "V03"}
    actual = [item["id"] for item in items]
    if len(actual) != 77 or len(set(actual)) != 77 or set(actual) != expected:
        raise ValueError("Catalog differs from the curated 77 review items.")
    counts = Counter(item["type"] for item in items)
    if counts != {"image": 74, "video": 3}:
        raise ValueError(f"Unexpected catalog types: {counts}")

    font_folder = media / "fonts"
    font_folder.mkdir(exist_ok=True)
    font_source = args.brand_root / "10_Fontes_Licencas"
    for name in [
        "EBGaramond-400.ttf", "EBGaramond-500.ttf", "EBGaramond-Italic-500.ttf",
        "Inter-400.ttf", "Inter-500.ttf", "EBGaramond-OFL.txt", "Inter-OFL.txt",
    ]:
        shutil.copy2(font_source / name, font_folder / name)
    shutil.copy2(args.brand_root / "01_Logos/wordmark/onix/JL_wordmark_onix.svg", media / "wordmark.svg")
    shutil.copy2(args.brand_root / "01_Logos/Digital/JL_favicon_512.png", media / "favicon.png")

    project = {"id": "joias-leopoldina", "title": "Joias Leopoldina", "catalogVersion": 1}
    (site / "catalog.js").write_text(
        "// Existing artwork catalog. IDs are stable across visual review and JSON exports.\n"
        "export const PROJECT = " + json.dumps(project, ensure_ascii=False, indent=2) + ";\n\n"
        "export const ITEMS = " + json.dumps(items, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )
    all_media = [path for path in media.rglob("*") if path.is_file()]
    summary = {
        "items": len(items), "types": dict(counts),
        "directions": dict(Counter(item["direction"] for item in items)),
        "categories": dict(Counter(item["category"] for item in items)),
        "media_file_count": len(all_media),
        "media_bytes": sum(path.stat().st_size for path in all_media),
        "full_image_bytes": sum(record.get("full_bytes", 0) for record in report),
        "thumbnail_bytes": sum(record.get("thumbnail_bytes", 0) for record in report),
        "video_bytes": sum(record.get("bytes", 0) for record in report),
        "records": report,
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in summary.items() if key != "records"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
