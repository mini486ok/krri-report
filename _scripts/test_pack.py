#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_build.mjs가 만든 _unpack_test/Contents/section0.xml을 사용하여
샘플.hwpx의 불변 파츠 + 새 section0.xml을 조립한 test-output.hwpx 를 생성.
생성 후 ZIP 엔트리 순서/무결성/well-formedness 검증.
"""
import os, sys, zipfile, shutil
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UNPACK = os.path.join(ROOT, '_unpack')
NEW_SEC = os.path.join(ROOT, '_unpack_test', 'Contents', 'section0.xml')
OUT = os.path.join(ROOT, '_unpack_test', 'test-output.hwpx')

MIME = 'application/hwp+zip'

entries = [
    ('mimetype', None, zipfile.ZIP_STORED),
    ('version.xml', os.path.join(UNPACK, 'version.xml'), zipfile.ZIP_DEFLATED),
    ('settings.xml', os.path.join(UNPACK, 'settings.xml'), zipfile.ZIP_DEFLATED),
    ('META-INF/container.xml', os.path.join(UNPACK, 'META-INF/container.xml'), zipfile.ZIP_DEFLATED),
    ('META-INF/container.rdf', os.path.join(UNPACK, 'META-INF/container.rdf'), zipfile.ZIP_DEFLATED),
    ('META-INF/manifest.xml', os.path.join(UNPACK, 'META-INF/manifest.xml'), zipfile.ZIP_DEFLATED),
    ('Contents/content.hpf', os.path.join(UNPACK, 'Contents/content.hpf'), zipfile.ZIP_DEFLATED),
    ('Contents/header.xml', os.path.join(UNPACK, 'Contents/header.xml'), zipfile.ZIP_DEFLATED),
    ('Preview/PrvText.txt', os.path.join(UNPACK, 'Preview/PrvText.txt'), zipfile.ZIP_DEFLATED),
    ('Preview/PrvImage.png', os.path.join(UNPACK, 'Preview/PrvImage.png'), zipfile.ZIP_STORED),
    ('Contents/section0.xml', NEW_SEC, zipfile.ZIP_DEFLATED),
]

with zipfile.ZipFile(OUT, 'w') as z:
    for name, src, comp in entries:
        if name == 'mimetype':
            z.writestr(zipfile.ZipInfo('mimetype'), MIME.encode('utf-8'), compress_type=comp)
        else:
            with open(src, 'rb') as f:
                data = f.read()
            zi = zipfile.ZipInfo(name)
            zi.compress_type = comp
            z.writestr(zi, data)

print(f'OK: {OUT}  ({os.path.getsize(OUT)} bytes)')

# --- 검증 ---
with zipfile.ZipFile(OUT, 'r') as z:
    names = z.namelist()
    print('entries:', names)
    assert names[0] == 'mimetype', 'mimetype must be first'
    info0 = z.getinfo('mimetype')
    assert info0.compress_type == zipfile.ZIP_STORED, 'mimetype must be STORED'
    mime_content = z.read('mimetype').decode('utf-8')
    assert mime_content == MIME, f'mimetype content mismatch: {mime_content!r}'
    # xml well-formedness
    import xml.etree.ElementTree as ET
    for n in ['Contents/section0.xml','Contents/header.xml','Contents/content.hpf',
              'META-INF/container.xml','META-INF/container.rdf','META-INF/manifest.xml',
              'settings.xml','version.xml']:
        try:
            ET.fromstring(z.read(n))
        except ET.ParseError as e:
            print(f'XML PARSE FAIL: {n}  {e}')
            raise
    print('OK: all XML well-formed')

# hwpx skill의 validate.py가 있으면 실행
validate = r'C:\Users\SMYU\.claude\skills\hwpx\scripts\validate.py'
if os.path.exists(validate):
    import subprocess
    r = subprocess.run([sys.executable, validate, OUT], capture_output=True, text=True, encoding='utf-8', errors='replace')
    print('---- validate.py ----')
    print(r.stdout)
    if r.stderr: print('STDERR:', r.stderr)
