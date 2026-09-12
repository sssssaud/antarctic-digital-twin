#!/usr/bin/env python3
"""Build presentation/deck.html from deck.src.html.

Inlines the subsetted fonts and the dashboard screenshots as base64 data URIs so the
deck is a single file that renders with no network. Edit deck.src.html, never deck.html.

    python3 presentation/src/build.py        # run from the repo root
"""
import base64
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "presentation" / "src"
OUT = ROOT / "presentation" / "deck.html"

ASSETS = {
    "__SANS400__": (ROOT / "public/fonts/f-sans-400.woff2", "font/woff2"),
    "__SANS500__": (ROOT / "public/fonts/f-sans-500.woff2", "font/woff2"),
    "__SANS700__": (ROOT / "public/fonts/f-sans-700.woff2", "font/woff2"),
    "__SANS800__": (ROOT / "public/fonts/f-sans-800.woff2", "font/woff2"),
    "__MONO400__": (ROOT / "public/fonts/f-mono-400.woff2", "font/woff2"),
    "__MONO700__": (ROOT / "public/fonts/f-mono-700.woff2", "font/woff2"),
    "__IMG_MAITRI__": (ROOT / "presentation/assets/maitri.jpg", "image/jpeg"),
    "__IMG_BHARATI__": (ROOT / "presentation/assets/bharati.jpg", "image/jpeg"),
}


def data_uri(path: pathlib.Path, mime: str) -> str:
    if not path.is_file():
        sys.exit(f"missing asset: {path}")
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"


def main() -> None:
    src_file = SRC / "deck.src.html"
    if not src_file.is_file():
        sys.exit(f"missing source: {src_file}")
    html = src_file.read_text(encoding="utf-8")

    for token, (path, mime) in ASSETS.items():
        if token not in html:
            sys.exit(f"token {token} not found in deck.src.html")
        html = html.replace(token, data_uri(path, mime))

    OUT.write_text(html, encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}  {len(html.encode()) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
