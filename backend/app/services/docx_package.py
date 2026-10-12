"""Ensure .docx packages open in EigenPal (python-docx saves strip theme/settings)."""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

from loguru import logger

SEED_PATH = Path(__file__).resolve().parent.parent / "assets" / "docx_seed.docx"

REQUIRED_PARTS = (
    "word/theme/theme1.xml",
    "word/settings.xml",
    "word/fontTable.xml",
    "docProps/core.xml",
)


def is_editor_ready(path: Path) -> bool:
    try:
        with zipfile.ZipFile(path) as zf:
            names = set(zf.namelist())
        return all(part in names for part in REQUIRED_PARTS)
    except zipfile.BadZipFile:
        return False


def enrich_docx_for_editor(path: Path, *, seed: Path | None = None) -> bool:
    """
    Graft a full Word shell (theme, settings, fonts, styles) around document.xml.

    Returns True when the file was rewritten. Safe to call repeatedly.
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(path)
    if is_editor_ready(path):
        return False

    seed_path = Path(seed) if seed else SEED_PATH
    if not seed_path.exists():
        logger.warning("docx seed missing at {} — cannot enrich {}", seed_path, path.name)
        return False

    with zipfile.ZipFile(path) as src:
        try:
            document_xml = src.read("word/document.xml")
        except KeyError as exc:
            raise ValueError(f"{path.name} has no word/document.xml") from exc

    with zipfile.ZipFile(seed_path) as seed_zf:
        seed_names = [n for n in seed_zf.namelist() if not n.endswith("/")]
        seed_parts = {name: seed_zf.read(name) for name in seed_names}

    # Content_Types from seed already lists theme/settings/etc.
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as dst:
        for name, data in seed_parts.items():
            if name == "word/document.xml":
                dst.writestr(name, document_xml)
            else:
                dst.writestr(name, data)

    path.write_bytes(buf.getvalue())
    logger.info("enriched {} for EigenPal editor ({} bytes)", path.name, path.stat().st_size)
    return True
