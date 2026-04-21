#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_build.mjs가 만든 _unpack_test/Contents/section0.xml을 사용하여
hwpx-assets.js의 패치된 header.xml + 새 section0.xml 을 조립한
test-output.hwpx 를 생성. 생성 후 무결성 검증.
"""
import os, re, sys, zipfile
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UNPACK = os.path.join(ROOT, '_unpack')
NEW_SEC = os.path.join(ROOT, '_unpack_test', 'Contents', 'section0.xml')
JS_ASSETS = os.path.join(ROOT, 'assets', 'js', 'hwpx', 'hwpx-assets.js')
OUT = os.path.join(ROOT, '_unpack_test', 'test-output.hwpx')

MIME = 'application/hwp+zip'


def extract_from_assets(const_name: str) -> str:
    """hwpx-assets.js 에서 template literal 상수 값을 디코딩."""
    with open(JS_ASSETS, 'r', encoding='utf-8') as f:
        js = f.read()
    m = re.search(rf'const {re.escape(const_name)}\s*=\s*`(.*?)`;', js, re.DOTALL)
    if not m:
        raise SystemExit(f'{const_name} not found in hwpx-assets.js')
    return m.group(1).replace('\\`', '`').replace('\\${', '${').replace('\\\\', '\\')


# header.xml 은 patched 버전(hwpx-assets.js)에서, 나머지 불변 파츠는 _unpack 그대로
def entry_src(zip_name: str):
    """(source, compression) 튜플 반환. source 는 bytes 이거나 파일 경로."""
    if zip_name == 'Contents/header.xml':
        return extract_from_assets('A_CONTENTS_HEADER_XML').encode('utf-8'), zipfile.ZIP_DEFLATED
    if zip_name == 'mimetype':
        return MIME.encode('utf-8'), zipfile.ZIP_STORED
    if zip_name == 'Contents/section0.xml':
        return NEW_SEC, zipfile.ZIP_DEFLATED
    rel = zip_name
    comp = zipfile.ZIP_STORED if zip_name == 'Preview/PrvImage.png' else zipfile.ZIP_DEFLATED
    return os.path.join(UNPACK, rel), comp


entries = [
    'mimetype',
    'version.xml',
    'settings.xml',
    'META-INF/container.xml',
    'META-INF/container.rdf',
    'META-INF/manifest.xml',
    'Contents/content.hpf',
    'Contents/header.xml',
    'Preview/PrvText.txt',
    'Preview/PrvImage.png',
    'Contents/section0.xml',
]

with zipfile.ZipFile(OUT, 'w') as z:
    for name in entries:
        src, comp = entry_src(name)
        if isinstance(src, bytes):
            data = src
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
