"""Discover fillable blanks in uploaded Word templates and yellow-highlight them.

Handles:
- Existing [brackets] / {{mustache}} / [[keys]]
- Underscore blanks (____, $____)
- Underlined whitespace / tab form blanks (common in free Word templates)
- AI analysis for labels + additional fill points (party names used as samples, 20xx, etc.)
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from docx import Document
from docx.enum.text import WD_COLOR_INDEX
from docx.oxml.ns import qn
from loguru import logger

from app.services.ai import copilot
from app.services.yellow_fields import (
    YELLOW,
    PLACEHOLDER_FIND,
    _iter_paragraphs,
    ensure_placeholder_highlights,
    scan_docx,
    slugify_key,
)

# Underscore / currency blanks common in free contract templates
BLANK_FIND = re.compile(
    r"\$_{3,}|_{3,}|\b20xx\b|\bXXXX\b|\bxx/xx/xxxx\b|\bMM/DD/YYYY\b",
    re.IGNORECASE,
)

CONTEXT_LABELS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"day of", re.I), "Day of Month"),
    (re.compile(r"per hour", re.I), "Hourly Rate"),
    (re.compile(r"flat fee", re.I), "Flat Fee"),
    (re.compile(r"due before|before work", re.I), "Deposit Amount"),
    (re.compile(r"final deliverable|upon receipt", re.I), "Final Payment"),
    (re.compile(r"effective|commenc", re.I), "Effective Date"),
    (re.compile(r"govern|jurisdiction|laws of", re.I), "Governing Law"),
    (re.compile(r"client", re.I), "Client Name"),
    (re.compile(r"consultant|contractor|vendor", re.I), "Consultant Name"),
    (re.compile(r"address", re.I), "Address"),
    (re.compile(r"email", re.I), "Email"),
    (re.compile(r"term|duration|period", re.I), "Term"),
]


def _plain_text(path: Path) -> str:
    document = Document(str(path))
    parts: list[str] = []
    for i, paragraph in enumerate(_iter_paragraphs(document)):
        text = paragraph.text or ""
        if text.strip():
            parts.append(f"[P{i}] {text}")
    return "\n".join(parts)


def _label_from_context(paragraph: str, blank: str) -> str:
    if re.match(r"(?i)^(20xx|xxxx|xx/xx/xxxx|mm/dd/yyyy)$", blank):
        return "Date"
    is_money = blank.startswith("$") or blank.startswith("$_") or bool(re.match(r"^\$", blank))
    if is_money:
        for pattern, label in CONTEXT_LABELS:
            if pattern.search(paragraph) and label in {
                "Hourly Rate",
                "Flat Fee",
                "Deposit Amount",
                "Final Payment",
                "Amount",
            }:
                return label
        return "Amount"
    # Non-money blanks: prefer nearest contextual label, but not payment labels
    for pattern, label in CONTEXT_LABELS:
        if label in {"Hourly Rate", "Flat Fee", "Deposit Amount", "Final Payment"}:
            continue
        if pattern.search(paragraph):
            return label
    return "Fill In"


def _has_underline(run) -> bool:
    try:
        if run.font.underline:
            return True
    except Exception:
        pass
    rpr = run._element.find(qn("w:rPr"))
    if rpr is None:
        return False
    return rpr.find(qn("w:u")) is not None


def _is_form_blank_run(run) -> bool:
    """Underlined spaces/tabs, underscore chars, or empty fill slots."""
    text = run.text or ""
    if re.fullmatch(r"[_\uFF3F]+", text or ""):
        return True
    if not text:
        return False
    if text.strip(" \t") != "":
        return False
    # whitespace/tabs only
    return _has_underline(run) or ("\t" in text)


def highlight_underlined_form_blanks(path: Path) -> int:
    """Highlight Word form blanks made of underlined spaces/tabs (not underscore glyphs).

    Free templates often look like ``this ____ day`` but store a tab with underline
    instead of underscore characters.
    """
    document = Document(str(path))
    highlighted = 0
    used_labels: dict[str, int] = {}

    for paragraph in _iter_paragraphs(document):
        runs = list(paragraph.runs)
        if not runs:
            continue
        text = paragraph.text or ""
        # Map run index → char offsets in paragraph.text
        offsets: list[tuple[int, int]] = []
        cursor = 0
        for run in runs:
            piece = run.text or ""
            offsets.append((cursor, cursor + len(piece)))
            cursor += len(piece)

        groups: list[tuple[int, int]] = []  # run start/end exclusive
        i = 0
        while i < len(runs):
            if _is_form_blank_run(runs[i]):
                start = i
                while i < len(runs) and _is_form_blank_run(runs[i]):
                    i += 1
                # Include leading "$" as part of a money blank
                if start > 0 and (runs[start - 1].text or "").strip() == "$":
                    start -= 1
                groups.append((start, i))
            else:
                i += 1

        spans: list[tuple[int, int, str]] = []
        for start, end in groups:
            char_start = offsets[start][0]
            char_end = offsets[end - 1][1]
            blank_text = text[char_start:char_end]
            # Skip bare separator tabs between two ALLCAPS labels (signature headers)
            left = text[:char_start].strip()
            right = text[char_end:].strip()
            if (
                left.isupper()
                and right.isupper()
                and len(left) <= 20
                and len(right) <= 20
                and "\t" in blank_text
                and "$" not in blank_text
            ):
                continue
            money = "$" in blank_text or (start > 0 and (runs[start].text or "").strip() == "$")
            # Leading option blank (checkbox-like) before a sentence
            if char_start <= 1 and right.lower().startswith("client shall"):
                base = "Select Payment Option"
            elif money:
                base = _label_from_context(text, "$____")
            elif "day of" in text.lower():
                base = "Day of Month"
            else:
                base = _label_from_context(text, blank_text or "____")
            used_labels[base] = used_labels.get(base, 0) + 1
            label = base if used_labels[base] == 1 else f"{base} {used_labels[base]}"
            ph = f"[{label}]"
            if char_start > 0 and text[char_start - 1].isalnum():
                ph = " " + ph
            if char_end < len(text) and text[char_end].isalnum():
                ph = ph + " "
            spans.append((char_start, char_end, ph))

        # Date tokens like 20xx
        for match in re.finditer(r"\b20xx\b|\bXXXX\b|\bMM/DD/YYYY\b", text, re.I):
            base = "Date"
            used_labels[base] = used_labels.get(base, 0) + 1
            label = base if used_labels[base] == 1 else f"{base} {used_labels[base]}"
            spans.append((match.start(), match.end(), f"[{label}]"))

        highlighted += _rebuild_paragraph_with_highlights(paragraph, spans)

    if highlighted:
        document.save(str(path))
        logger.info("highlighted {} underlined form blanks in {}", highlighted, path.name)
    return highlighted


def _rebuild_paragraph_with_highlights(
    paragraph,
    replacements: list[tuple[int, int, str]],
) -> int:
    """Replace character spans in a paragraph with yellow-highlighted placeholder text."""
    text = paragraph.text or ""
    if not replacements:
        return 0
    replacements = sorted(replacements, key=lambda r: r[0])
    # Drop overlaps
    cleaned: list[tuple[int, int, str]] = []
    last_end = -1
    for start, end, repl in replacements:
        if start < last_end or start < 0 or end > len(text) or start >= end:
            continue
        cleaned.append((start, end, repl))
        last_end = end
    if not cleaned:
        return 0

    p_el = paragraph._p
    for child in list(p_el):
        if child.tag == qn("w:r"):
            p_el.remove(child)

    cursor = 0
    count = 0
    for start, end, repl in cleaned:
        if start > cursor:
            paragraph.add_run(text[cursor:start])
        run = paragraph.add_run(repl)
        run.font.highlight_color = YELLOW
        count += 1
        cursor = end
    if cursor < len(text):
        paragraph.add_run(text[cursor:])
    return count


def highlight_underscore_blanks(path: Path) -> int:
    """Turn ____ / $____ / 20xx style blanks into yellow [Label] fields."""
    document = Document(str(path))
    highlighted = 0
    used_labels: dict[str, int] = {}

    for paragraph in _iter_paragraphs(document):
        text = paragraph.text or ""
        matches = list(BLANK_FIND.finditer(text))
        if not matches:
            continue
        # Skip if already heavily yellow
        yellow_runs = sum(
            1
            for r in paragraph.runs
            if getattr(r.font, "highlight_color", None) == WD_COLOR_INDEX.YELLOW
        )
        if yellow_runs >= len(matches):
            continue

        spans: list[tuple[int, int, str]] = []
        for match in matches:
            blank = match.group(0)
            base = _label_from_context(text, blank)
            used_labels[base] = used_labels.get(base, 0) + 1
            label = base if used_labels[base] == 1 else f"{base} {used_labels[base]}"
            placeholder = f"[{label}]"
            spans.append((match.start(), match.end(), placeholder))
        highlighted += _rebuild_paragraph_with_highlights(paragraph, spans)

    if highlighted:
        document.save(str(path))
        logger.info("highlighted {} underscore/blank fields in {}", highlighted, path.name)
    return highlighted


def apply_find_replace_highlights(path: Path, fields: list[dict[str, Any]]) -> int:
    """Apply AI (or heuristic) find→placeholder replacements with yellow highlight."""
    if not fields:
        return 0
    document = Document(str(path))
    highlighted = 0

    # Process per-paragraph occurrence-aware replacements
    for paragraph in _iter_paragraphs(document):
        text = paragraph.text or ""
        if not text:
            continue
        spans: list[tuple[int, int, str]] = []
        for field in fields:
            find = (field.get("find") or "").strip()
            placeholder = (field.get("placeholder") or "").strip()
            if not find or not placeholder or find == placeholder:
                continue
            if find not in text:
                continue
            # Only replace first unused occurrence in this paragraph pass
            start = text.find(find)
            # Avoid replacing inside already-bracketed yellow-looking text if identical
            if start < 0:
                continue
            # Skip if this span already queued
            if any(s <= start < e or s < start + len(find) <= e for s, e, _ in spans):
                continue
            spans.append((start, start + len(find), placeholder))
            # Mark field as consumed for subsequent paragraphs by clearing find uniqueness
            field["_used"] = field.get("_used", 0) + 1
            # Prefer one replace per field entry per document unless occurrence allows more
            occ = int(field.get("occurrence") or 1)
            if field["_used"] >= occ:
                field["find"] = ""  # consume
        if spans:
            highlighted += _rebuild_paragraph_with_highlights(paragraph, spans)

    if highlighted:
        document.save(str(path))
        logger.info("applied {} AI/heuristic field highlights in {}", highlighted, path.name)
    return highlighted


def heuristic_blank_candidates(plain: str) -> list[dict[str, Any]]:
    """Build candidate blanks from plain text when AI is offline."""
    fields: list[dict[str, Any]] = []
    used: dict[str, int] = {}
    for line in plain.splitlines():
        body = re.sub(r"^\[P\d+\]\s*", "", line)
        for match in BLANK_FIND.finditer(body):
            blank = match.group(0)
            base = _label_from_context(body, blank)
            used[base] = used.get(base, 0) + 1
            label = base if used[base] == 1 else f"{base} {used[base]}"
            fields.append(
                {
                    "find": blank,
                    "occurrence": 1,
                    "key": slugify_key(label),
                    "label": label,
                    "placeholder": f"[{label}]",
                    "context": body[:180],
                }
            )
        for match in PLACEHOLDER_FIND.finditer(body):
            # already bracketed — ensure highlighted later
            continue
    return fields


async def ai_identify_fillable_fields(plain_text: str) -> list[dict[str, Any]]:
    """Ask Capco Wayne to list fillable blanks as JSON."""
    if not plain_text.strip():
        return []
    if not copilot.settings.ai_configured:
        return heuristic_blank_candidates(plain_text)

    system = (
        "You analyze contract Word templates and identify every place a user must fill in data. "
        "Find underscore blanks (____), currency blanks ($____), dates (20xx), sample party names "
        "that should be variables, and bracket placeholders. "
        "Return ONLY valid JSON (no markdown) with this shape:\n"
        '{"fields":[{"find":"exact substring to replace","occurrence":1,'
        '"key":"snake_case","label":"Human Label","placeholder":"[Human Label]",'
        '"context":"short surrounding quote"}]}\n'
        "Rules:\n"
        "- `find` must be copied EXACTLY from the document (including underscores).\n"
        "- Prefer replacing the blank token itself (____ or $____), not whole sentences.\n"
        "- Use unique labels when the same blank appears multiple times.\n"
        "- placeholder must be [Label] form.\n"
        "- Max 40 fields. Skip signature lines that are only ornamental underscores under a name line "
        "if they are clearly signature underlines (optional). Prefer payment/date/party blanks."
    )
    user = (
        "Identify fillable fields in this contract template text. "
        "Paragraph markers look like [P12].\n\n"
        f"{plain_text[:14000]}"
    )
    try:
        raw = await copilot._chat(
            system=system,
            context="Mode: template_field_discovery",
            messages=[{"role": "user", "content": user}],
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("AI field discovery failed: {}", exc)
        return heuristic_blank_candidates(plain_text)

    payload = _extract_json(raw)
    fields = payload.get("fields") if isinstance(payload, dict) else None
    if not isinstance(fields, list):
        logger.warning("AI field discovery returned no fields array; using heuristics")
        return heuristic_blank_candidates(plain_text)

    cleaned: list[dict[str, Any]] = []
    for item in fields[:40]:
        if not isinstance(item, dict):
            continue
        find = str(item.get("find") or "").strip()
        label = str(item.get("label") or item.get("key") or "Fill In").strip()
        key = slugify_key(str(item.get("key") or label))
        placeholder = str(item.get("placeholder") or f"[{label}]").strip()
        if not placeholder.startswith("["):
            placeholder = f"[{label}]"
        if not find:
            continue
        cleaned.append(
            {
                "find": find,
                "occurrence": int(item.get("occurrence") or 1),
                "key": key,
                "label": label,
                "placeholder": placeholder,
                "context": str(item.get("context") or "")[:240],
            }
        )
    return cleaned or heuristic_blank_candidates(plain_text)


def _extract_json(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else {"fields": data}
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", text)
        if not match:
            return {}
        try:
            data = json.loads(match.group(0))
            return data if isinstance(data, dict) else {}
        except json.JSONDecodeError:
            return {}


async def prepare_template_fields(path: Path, *, use_ai: bool = True) -> dict[str, Any]:
    """Full pipeline: brackets → underlined tabs/spaces → AI → leftover underscores."""
    bracketed = ensure_placeholder_highlights(path)
    # Free Word templates often use underlined tabs instead of ____ glyphs
    form_blanks = highlight_underlined_form_blanks(path)

    ai_applied = 0
    if use_ai:
        plain = _plain_text(path)
        ai_fields = await ai_identify_fillable_fields(plain)
        live = plain
        pending = [f for f in ai_fields if f.get("find") and f["find"] in live]
        # Don't re-replace already yellow [Label] tokens
        pending = [
            f
            for f in pending
            if not str(f.get("find", "")).startswith("[")
            and f["find"] in live
        ]
        if pending:
            ai_applied = apply_find_replace_highlights(path, pending)

    # Catch leftover ____ / $____ glyphs the earlier passes missed
    underscore = highlight_underscore_blanks(path)

    # python-docx saves strip theme/settings — EigenPal needs a full package shell
    from app.services.docx_package import enrich_docx_for_editor

    enrich_docx_for_editor(path)

    scanned = scan_docx(path)
    return {
        "bracket_highlights": bracketed,
        "form_blank_highlights": form_blanks,
        "underscore_highlights": underscore,
        "ai_highlights": ai_applied,
        "field_count": len(scanned.fields),
        "fields": list(scanned.fields.values()),
    }
