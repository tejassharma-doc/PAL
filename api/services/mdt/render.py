"""Render a transcription into a clean, printed PDF.

The point is narrow: turn Gemini's verbatim transcription of a handwritten
document into a *printed* PDF so that when it is re-fed to MDT, MDT classifies it
as printed text (handwritten_content_percent ~ 0) and structures it normally
instead of discarding it.

Uses reportlab (pure-Python). Kept dependency-light and defensive: if rendering
ever fails, the caller falls back to the structured medication list from Gemini.
"""
from __future__ import annotations

import io
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from services.mdt.transcriber import TranscriptionResult


def render_text_to_pdf(transcription: "TranscriptionResult") -> bytes:
    """Render the verbatim transcription to a single-column A4 PDF, returned as bytes."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    width, height = A4

    left = 20 * mm
    top = height - 20 * mm
    bottom = 20 * mm
    line_height = 6 * mm
    y = top

    def _line(text: str, *, font: str = "Helvetica", size: int = 10) -> None:
        nonlocal y
        if y <= bottom:
            c.showPage()
            y = top
        c.setFont(font, size)
        # reportlab's drawString doesn't wrap; hard-wrap long lines by char count.
        max_chars = 95
        chunk = text if len(text) <= max_chars else text[:max_chars]
        c.drawString(left, y, chunk)
        y -= line_height
        if len(text) > max_chars:
            _line("    " + text[max_chars:], font=font, size=size)

    # Header lines from structured fields (when present).
    header_bits = [b for b in (transcription.clinic_name, transcription.doctor_name) if b]
    if header_bits:
        _line(" · ".join(header_bits), font="Helvetica-Bold", size=12)
    meta_bits = []
    if transcription.patient_name:
        meta_bits.append(f"Patient: {transcription.patient_name}")
    if transcription.report_date:
        meta_bits.append(f"Date: {transcription.report_date}")
    if meta_bits:
        _line("   ".join(meta_bits))
    if header_bits or meta_bits:
        _line("")

    # Body: the verbatim transcription, line by line.
    for raw_line in (transcription.text or "").splitlines():
        _line(raw_line.rstrip())

    c.showPage()
    c.save()
    return buf.getvalue()
