#!/usr/bin/env python3
"""Build the fonts the PDF export embeds: static Inter weights, cut down to the
scripts and OpenType features a service record needs.

WeasyPrint subsets every font for every PDF it writes. From the variable font
that took over three seconds a PDF, nearly all of it reading Inter's kerning
tables; from these it takes under one. Run at image build time (see the
Dockerfile); app.py falls back to the variable font when they are missing.

    python3 tools/build-pdf-fonts.py   # writes static/fonts/pdf/Inter-<weight>.ttf
"""
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'static', 'fonts')
SOURCE = os.path.join(ROOT, 'InterVariable.woff2')
OUT = os.path.join(ROOT, 'pdf')
WEIGHTS = (400, 600, 700, 800)   # keep in step with the @font-face rules in templates/pdf.html

# Latin with its extensions, Greek, Cyrillic, punctuation, currency, arrows,
# math, box drawing and dingbats: anything a note is likely to hold.
RANGES = [(0x20, 0x24F), (0x1E00, 0x1EFF), (0x370, 0x3FF), (0x400, 0x4FF),
          (0x2000, 0x206F), (0x20A0, 0x20CF), (0x2100, 0x214F), (0x2190, 0x21FF),
          (0x2200, 0x22FF), (0x2500, 0x25FF), (0x2700, 0x27BF)]
FEATURES = ['kern', 'mark', 'mkmk', 'liga', 'calt', 'ccmp', 'locl', 'tnum', 'case']


def main():
    os.makedirs(OUT, exist_ok=True)
    options = subset.Options()
    options.layout_features = FEATURES
    options.name_IDs = ['*']
    options.notdef_outline = True
    options.hinting = False
    unicodes = [c for lo, hi in RANGES for c in range(lo, hi + 1)]
    for weight in WEIGHTS:
        font = TTFont(SOURCE)
        axes = {a.axisTag for a in font['fvar'].axes}
        # Pin the weight; the optical size stays at its default, the text cut.
        font = instancer.instantiateVariableFont(font, {'wght': weight, **({'opsz': None} if 'opsz' in axes else {})})
        font.flavor = None
        subsetter = subset.Subsetter(options)
        subsetter.populate(unicodes=unicodes)
        subsetter.subset(font)
        path = os.path.join(OUT, f'Inter-{weight}.ttf')
        font.save(path)
        print(f'{path}: {os.path.getsize(path) // 1024} KB')


if __name__ == '__main__':
    sys.exit(main())
