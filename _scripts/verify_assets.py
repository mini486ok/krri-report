#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""hwpx-assets.js 에 인라인된 header.xml 이 제대로 패치되었는지 확인."""
import re, sys, os
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS_PATH = os.path.join(ROOT, 'assets', 'js', 'hwpx', 'hwpx-assets.js')

with open(JS_PATH, 'r', encoding='utf-8') as f:
    js = f.read()

m = re.search(r'const A_CONTENTS_HEADER_XML\s*=\s*`(.*?)`;', js, re.DOTALL)
if not m:
    print('A_CONTENTS_HEADER_XML not found')
    sys.exit(1)
hdr = m.group(1)
# template literal escapes: \\, \`, \${
hdr = hdr.replace('\\`', '`').replace('\\${', '${').replace('\\\\', '\\')

item_m = re.search(r'<hh:borderFills itemCnt="(\d+)"', hdr)
print('borderFills itemCnt =', item_m.group(1) if item_m else 'N/A')

for bid in ['10', '11']:
    bf_m = re.search(rf'<hh:borderFill id="{bid}"[^>]*>.*?</hh:borderFill>', hdr, re.DOTALL)
    if not bf_m:
        print(f'bf{bid}: NOT FOUND')
        continue
    bf = bf_m.group(0)
    sides = {}
    for side in ['leftBorder', 'rightBorder', 'topBorder', 'bottomBorder']:
        sm = re.search(rf'<hh:{side}[^/]*width="([^"]+)"', bf)
        sides[side] = sm.group(1) if sm else '?'
    print(f'bf{bid}: left={sides["leftBorder"]}, right={sides["rightBorder"]}, '
          f'top={sides["topBorder"]}, bottom={sides["bottomBorder"]}')

# SECTION_TEMPLATE_XML 에서 각 tc의 borderFillIDRef
sec_m = re.search(r'SECTION_TEMPLATE_XML\s*=\s*`(.*?)`;', js, re.DOTALL)
if sec_m:
    sec = sec_m.group(1).replace('\\`', '`').replace('\\${', '${').replace('\\\\', '\\')
    print()
    print('section template cell borders:')
    for m in re.finditer(
        r'<hp:tc\b[^>]*borderFillIDRef="(\d+)"[^>]*>.*?<hp:cellAddr colAddr="(\d+)" rowAddr="(\d+)"',
        sec, flags=re.DOTALL,
    ):
        print(f'  row={m.group(3)} col={m.group(2)}  borderFillIDRef={m.group(1)}')
