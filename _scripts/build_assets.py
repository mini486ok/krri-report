#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
샘플.hwpx에서 추출한 파일들을 JS 모듈(hwpx-assets.js)로 변환한다.
동시에 section0.xml을 템플릿화한 버전도 함께 저장한다.

실행:
  python _scripts/build_assets.py
"""
import os, re, sys, io
# Windows stdout utf-8
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UNPACK = os.path.join(ROOT, '_unpack')
OUT_JS = os.path.join(ROOT, 'assets', 'js', 'hwpx', 'hwpx-assets.js')

FILES = [
    ('mimetype',                 'mimetype',                 'text'),
    ('version.xml',              'version.xml',              'xml'),
    ('settings.xml',             'settings.xml',             'xml'),
    ('META-INF/container.xml',   'META-INF/container.xml',   'xml'),
    ('META-INF/container.rdf',   'META-INF/container.rdf',   'xml'),
    ('META-INF/manifest.xml',    'META-INF/manifest.xml',    'xml'),
    ('Contents/content.hpf',     'Contents/content.hpf',     'xml'),
    ('Contents/header.xml',      'Contents/header.xml',      'xml'),
    ('Preview/PrvText.txt',      'Preview/PrvText.txt',      'text'),
]


def read_file(rel):
    with open(os.path.join(UNPACK, rel), 'r', encoding='utf-8') as f:
        return f.read()


def js_escape_backtick(s: str) -> str:
    # template literal escaping: `, \, ${
    return s.replace('\\', '\\\\').replace('`', '\\`').replace('${', '\\${')


def build_section_template(section_xml: str) -> str:
    """section0.xml을 슬롯 마커가 있는 템플릿으로 변환한다.

    슬롯:
      {{PAST_LABEL_SUBLIST}}  — 지난주 라벨 셀 subList 내부
      {{PAST_BODY_SUBLIST}}   — 지난주 본문 셀 subList 내부
      {{NEXT_LABEL_SUBLIST}}  — 이번주 라벨 셀 subList 내부
      {{NEXT_BODY_SUBLIST}}   — 이번주 본문 셀 subList 내부
    """
    s = section_xml
    # 각 <hp:tc ...><hp:subList ...>...</hp:subList> 내부를 찾는다.
    # 접근 방식: <hp:tc ... borderFillIDRef="..." 다음의 <hp:subList ...>를 찾고
    # 그 닫기태그 전까지를 치환.
    # 안전을 위해 tr 경계를 사용해 두 행으로 분리 후 각 행에서 처음 두 tc의 subList를 슬롯화.

    # find tr blocks
    tr_matches = [m.start() for m in re.finditer(r'<hp:tr>', s)]
    tr_close = [m.start() for m in re.finditer(r'</hp:tr>', s)]
    if len(tr_matches) != 2 or len(tr_close) != 2:
        raise SystemExit('예상과 다른 tr 구조')

    row0 = (tr_matches[0], tr_close[0])
    row1 = (tr_matches[1], tr_close[1])

    # For each row, find first two <hp:subList ...>...</hp:subList> occurrences and replace content
    def replace_sublist_content(text, inner_start, inner_end, new_inner):
        return text[:inner_start] + new_inner + text[inner_end:]

    # Process row1 first (later in string) to keep indices valid for row0
    new_s = s
    for (row_start, row_end), (label_slot, body_slot) in [
        (row1, ('{{NEXT_LABEL_SUBLIST}}', '{{NEXT_BODY_SUBLIST}}')),
        (row0, ('{{PAST_LABEL_SUBLIST}}', '{{PAST_BODY_SUBLIST}}')),
    ]:
        # within [row_start, row_end], find the first two <hp:subList ...>...</hp:subList>
        scan_pos = row_start
        replacements = []
        for slot in (label_slot, body_slot):
            sub_open_m = re.search(r'<hp:subList [^>]*>', new_s[scan_pos:row_end])
            if not sub_open_m:
                raise SystemExit('subList open not found')
            sub_open_start = scan_pos + sub_open_m.start()
            sub_open_end = scan_pos + sub_open_m.end()
            sub_close_idx = new_s.find('</hp:subList>', sub_open_end, row_end)
            if sub_close_idx < 0:
                raise SystemExit('subList close not found')
            replacements.append((sub_open_end, sub_close_idx, slot))
            scan_pos = sub_close_idx + len('</hp:subList>')
        # apply from last to first
        for inner_start, inner_end, slot in reversed(replacements):
            new_s = new_s[:inner_start] + slot + new_s[inner_end:]
        # Note: after replacing row1, indices for row0 are unchanged
        # because we replace content inside cells, but overall length changed.
        # We handle row1 first then row0, so row0 indices still refer to original string;
        # however new_s has changed length only after row1 edits. Since we only USED
        # row0 indices for scanning inside original ranges, and re-derive indices each loop
        # via re.search against new_s[scan_pos:row_end], row_end of row0 is stale.
        pass

    # The above approach mutates new_s but row0 indices may be stale.
    # Safer: compute slot replacements on original s, collect ranges, sort desc, replace once.
    # Re-implement cleanly:
    orig = s
    tr_opens = [m.start() for m in re.finditer(r'<hp:tr>', orig)]
    tr_closes = [m.start() for m in re.finditer(r'</hp:tr>', orig)]
    rows = list(zip(tr_opens, tr_closes))
    slots_for = [
        ('{{PAST_LABEL_SUBLIST}}', '{{PAST_BODY_SUBLIST}}'),
        ('{{NEXT_LABEL_SUBLIST}}', '{{NEXT_BODY_SUBLIST}}'),
    ]
    ranges = []  # (inner_start, inner_end, slot)
    for (row_start, row_end), (label_slot, body_slot) in zip(rows, slots_for):
        scan_pos = row_start
        for slot in (label_slot, body_slot):
            sub_open_m = re.search(r'<hp:subList [^>]*>', orig[scan_pos:row_end])
            if not sub_open_m:
                raise SystemExit('subList open not found')
            sub_open_start = scan_pos + sub_open_m.start()
            sub_open_end = scan_pos + sub_open_m.end()
            sub_close_idx = orig.find('</hp:subList>', sub_open_end, row_end)
            if sub_close_idx < 0:
                raise SystemExit('subList close not found')
            ranges.append((sub_open_end, sub_close_idx, slot))
            scan_pos = sub_close_idx + len('</hp:subList>')
    # sort desc by inner_start
    ranges.sort(key=lambda t: t[0], reverse=True)
    result = orig
    for inner_start, inner_end, slot in ranges:
        result = result[:inner_start] + slot + result[inner_end:]
    result = patch_outer_borders(result)
    return result


def patch_outer_borders(section_tpl: str) -> str:
    """표 외곽 테두리(좌/우/상/하)가 모두 굵은 선으로 나오도록 row 1 의 좌·우
    코너 셀 borderFillIDRef 를 교체한다.

    샘플 원본은 row 1 tc0 (좌하 코너)에 borderFill 5 (하단 0.12mm),
    row 1 tc2 (우하 코너)에 borderFill 7 (하단 NONE)을 사용해 표 하단 외곽선이
    얇거나 비어있는 상태였음. borderFill 4 (좌·하 굵음), 8 (우·하 굵음)로
    교체하면 표 바깥쪽 사면이 모두 0.4mm 굵은 선으로 출력된다.
    borderFill 4, 8 은 이미 header.xml 에 정의되어 있어 추가 스타일 불필요.
    """
    def replace_cell(m):
        tc_full = m.group(0)
        am = re.search(r'<hp:cellAddr colAddr="(\d+)" rowAddr="(\d+)"', tc_full)
        if not am:
            return tc_full
        col, row = am.group(1), am.group(2)
        if row != '1':
            return tc_full
        if col == '0':
            return re.sub(r'borderFillIDRef="5"', 'borderFillIDRef="4"', tc_full, count=1)
        if col == '2':
            return re.sub(r'borderFillIDRef="7"', 'borderFillIDRef="8"', tc_full, count=1)
        return tc_full
    return re.sub(r'<hp:tc\b[^>]*>.*?</hp:tc>', replace_cell, section_tpl, flags=re.DOTALL)


def main():
    parts = {}
    for zip_name, rel, kind in FILES:
        text = read_file(rel)
        parts[zip_name] = text

    section_xml = read_file('Contents/section0.xml')
    section_tpl = build_section_template(section_xml)

    # sanity: ensure all 4 slots present
    for slot in ['{{PAST_LABEL_SUBLIST}}', '{{PAST_BODY_SUBLIST}}',
                 '{{NEXT_LABEL_SUBLIST}}', '{{NEXT_BODY_SUBLIST}}']:
        if section_tpl.count(slot) != 1:
            raise SystemExit(f'슬롯 주입 실패: {slot} count={section_tpl.count(slot)}')

    # Generate JS module
    lines = [
        '// 이 파일은 _scripts/build_assets.py 로부터 자동 생성됨.',
        '// 샘플.hwpx에서 추출한 불변 파츠와 section0.xml 템플릿을 JS 문자열 상수로 담는다.',
        '',
    ]

    # parts as ASSETS map; section0.xml은 별도 SECTION_TEMPLATE_XML 로 내보냄
    for zip_name, rel, _k in FILES:
        varname = 'A_' + re.sub(r'[^A-Za-z0-9]', '_', zip_name.upper())
        text = parts[zip_name]
        esc = js_escape_backtick(text)
        lines.append(f'const {varname} = `{esc}`;')
    lines.append('')

    section_esc = js_escape_backtick(section_tpl)
    lines.append('export const SECTION_TEMPLATE_XML = `' + section_esc + '`;')
    lines.append('')
    lines.append('export const PREV_IMAGE_URL = "./assets/bin/PrvImage.png";')
    lines.append('')
    lines.append('// ZIP 패키징 순서를 보장하기 위해 배열로 export')
    lines.append('export const ASSETS = [')
    for zip_name, rel, _k in FILES:
        varname = 'A_' + re.sub(r'[^A-Za-z0-9]', '_', zip_name.upper())
        store = 'true' if zip_name == 'mimetype' else 'false'
        lines.append(f'  {{ path: {zip_name!r}, content: {varname}, store: {store} }},')
    lines.append('];')
    lines.append('')

    os.makedirs(os.path.dirname(OUT_JS), exist_ok=True)
    with open(OUT_JS, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    print(f'OK: wrote {OUT_JS}  ({os.path.getsize(OUT_JS)} bytes)')


if __name__ == '__main__':
    main()
