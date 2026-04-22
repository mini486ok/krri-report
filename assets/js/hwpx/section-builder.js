// section0.xml 슬롯 치환 + 본문/라벨 subList 생성
import { SECTION_TEMPLATE_XML } from './hwpx-assets.js';
import { PARA, CHAR, LINESEG_PRESET } from './id-map.js';

function xmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function lineseg(preset) {
  const p = LINESEG_PRESET[preset];
  return `<hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="${p.vertsize}" textheight="${p.textheight}" baseline="${p.baseline}" spacing="${p.spacing}" horzpos="${p.horzpos}" horzsize="${p.horzsize}" flags="${p.flags}"/></hp:linesegarray>`;
}

// 단일 run 문단
function P(paraId, charId, text, { preset = 'orgKindProject' } = {}) {
  const t = text === '' || text == null
    ? '<hp:t/>'
    : `<hp:t>${xmlEscape(text)}</hp:t>`;
  return `<hp:p id="2147483648" paraPrIDRef="${paraId}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">`
    + `<hp:run charPrIDRef="${charId}">${t}</hp:run>`
    + lineseg(preset)
    + `</hp:p>`;
}

// 다중 run 문단
function Pmulti(paraId, runs, { preset = 'orgKindProject' } = {}) {
  const runsXml = runs.map(([cid, text]) => {
    const t = text === '' || text == null
      ? '<hp:t/>'
      : `<hp:t>${xmlEscape(text)}</hp:t>`;
    return `<hp:run charPrIDRef="${cid}">${t}</hp:run>`;
  }).join('');
  return `<hp:p id="2147483648" paraPrIDRef="${paraId}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">`
    + runsXml
    + lineseg(preset)
    + `</hp:p>`;
}

// 라벨 셀 첫 문단 (colPr ctrl + 타이틀)
// linesegarray 는 의도적으로 포함하지 않음 — 짧은 셀 너비에 긴 텍스트가 들어갈 때
// 캐시된 lineseg 1개가 한글 렌더러에 "한 줄에 다 넣어라" 힌트로 작용해 자간이 압축되는
// 문제를 피하기 위해, 라벨 셀 문단만 캐시를 비워 한글이 전적으로 재계산하도록 맡긴다.
function labelHead(text) {
  return `<hp:p id="2147483648" paraPrIDRef="${PARA.LABEL_TITLE}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">`
    + `<hp:run charPrIDRef="${CHAR.LABEL_TEXT}">`
    + `<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl>`
    + `</hp:run>`
    + `<hp:run charPrIDRef="${CHAR.LABEL_TEXT}"><hp:t>${xmlEscape(text)}</hp:t></hp:run>`
    + `</hp:p>`;
}

// 라벨 셀 두번째 문단 (날짜 범위) — linesegarray 생략 (위와 동일 이유)
function labelRange(text) {
  const t = text === '' || text == null
    ? '<hp:t/>'
    : `<hp:t>${xmlEscape(text)}</hp:t>`;
  return `<hp:p id="2147483648" paraPrIDRef="${PARA.LABEL_TITLE}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">`
    + `<hp:run charPrIDRef="${CHAR.LABEL_TEXT}">${t}</hp:run>`
    + `</hp:p>`;
}

// 라벨 셀 subList 내용 생성
export function buildLabelSubList(title, range) {
  return labelHead(title) + labelRange(range);
}

// 포맷: "오송시험선로 디지털화를 위한 시험선 답사(4/13, ESNT, 박정준)"
export function formatItem(item) {
  const meta = [item.date, item.org, item.person].filter(x => x && String(x).trim()).join(', ');
  const text = (item.text ?? '').trim();
  if (!meta) return text;
  return `${text}(${meta})`;
}

// 본문 셀 — kind별 헤더 구성 헬퍼
// 대분류 그룹의 순서 (샘플 양식 기준). 존재하는 kind만 필터하여 연속 번호 매김.
const KIND_ORDER = ['basic', 'natl_rnd', 'consign', 'etc'];
const KIND_NAMES = {
  basic: '기본사업',
  natl_rnd: '국가R&D',
  consign: '수탁사업',
  etc: '기타',
};
function kindLabel(kind, idx) {
  return `(${idx}) ${KIND_NAMES[kind] ?? kind}`;
}

// 집계: submissions에서 side("past"|"next") 한 쪽의 모든 카테고리별 항목을 모은다.
// 입력 entry 구조 유효성은 store 측에서 보장한다고 가정.
export function aggregateItems(submissions, side) {
  /** @returns {Object<string, Array>}  categoryId → items[] */
  const out = {};
  for (const sub of submissions) {
    const entries = sub?.entries?.[side] ?? [];
    for (const ce of entries) {
      if (!ce?.categoryId) continue;
      if (!out[ce.categoryId]) out[ce.categoryId] = [];
      for (const it of (ce.items ?? [])) {
        if (!it) continue;
        const text = (it.text ?? '').trim();
        if (!text) continue;
        out[ce.categoryId].push({
          text,
          date: (it.date ?? '').trim(),
          org: (it.org ?? '').trim(),
          person: (it.person ?? sub.authorName ?? '').trim(),
          important: !!it.important,
        });
      }
    }
  }
  return out;
}

// 본문 셀 subList 내용 생성
export function buildBodySubList(round, submissions, side, { orgName = '[철도AI융합연구실]' } = {}) {
  const categories = round.categoriesSnapshot ?? [];
  const itemsByCat = aggregateItems(submissions, side);

  // 존재하는 kind 만 필터하여 연속 번호 매김 ((1), (2), ...)
  const existingKinds = KIND_ORDER.filter(k => categories.some(c => c.kind === k));

  const parts = [];
  // 조직명 라인 (항상 선두)
  parts.push(P(PARA.ORG_LINE, CHAR.ORG_AND_KIND, orgName));

  existingKinds.forEach((kind, idx) => {
    // 카테고리 관리 탭에서 조정한 order 값 기준으로 정렬
    const kindsCats = categories
      .filter(c => c.kind === kind)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    // 대분류 라인
    if (kind === 'etc') {
      parts.push(P(PARA.ETC_KIND, CHAR.ETC_KIND_TEXT, kindLabel(kind, idx + 1)));
    } else {
      parts.push(P(PARA.ORG_LINE, CHAR.ORG_AND_KIND, kindLabel(kind, idx + 1)));
    }

    for (const cat of kindsCats) {
      const items = itemsByCat[cat.id] ?? [];
      // 과제 라인은 항상 출력 (항목이 없어도 "- 과제명(담당자)" 라인 표시)
      // 단, '기타' kind 에서는 과제 라인 대신 바로 불릿 항목만 나열.
      if (kind !== 'etc') {
        const ownerSuffix = cat.owner ? `(${cat.owner})` : '';
        parts.push(Pmulti(PARA.PROJECT_LINE, [
          [CHAR.ORG_AND_KIND, ' - '],
          [CHAR.PROJECT_TITLE, `${cat.title}${ownerSuffix}`],
        ]));
      }
      for (const it of items) {
        const charId = it.important ? CHAR.BULLET_BOLD : CHAR.BULLET_TEXT;
        parts.push(P(PARA.BULLET, charId, formatItem(it), { preset: 'bullet' }));
      }
    }
    // 카테고리 섹션 끝에 빈 줄
    parts.push(P(PARA.BLANK, CHAR.BULLET_TEXT, '', { preset: 'blank' }));
  });

  return parts.join('');
}

// 메인: section0.xml 전체 문자열 생성
export function buildSection0Xml(round, submissions) {
  const orgName = round.orgName || '[철도AI융합연구실]';
  const pastLabelTitle = round.form === 'monthly' ? '지난 달 실적' : '지난 주 실적';
  const nextLabelTitle = round.form === 'monthly' ? '이번 달 계획' : '이번 주 계획';
  const pastRange = `(${round.rangeStart} ~ ${round.rangeEnd})`;
  const nextRange = `(${round.nextRangeStart} ~ ${round.nextRangeEnd})`;

  const pastLabel = buildLabelSubList(pastLabelTitle, pastRange);
  const nextLabel = buildLabelSubList(nextLabelTitle, nextRange);
  const pastBody = buildBodySubList(round, submissions, 'past', { orgName });
  const nextBody = buildBodySubList(round, submissions, 'next', { orgName });

  return SECTION_TEMPLATE_XML
    .replace('{{PAST_LABEL_SUBLIST}}', pastLabel)
    .replace('{{PAST_BODY_SUBLIST}}', pastBody)
    .replace('{{NEXT_LABEL_SUBLIST}}', nextLabel)
    .replace('{{NEXT_BODY_SUBLIST}}', nextBody);
}
