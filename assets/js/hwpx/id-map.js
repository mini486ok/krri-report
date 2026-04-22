// 샘플.hwpx에서 실측한 paraPr / charPr ID 의미 맵.
// 이 값들은 샘플의 Contents/header.xml 정의를 기반으로 하므로, header.xml을 그대로
// 번들하여 사용하는 한 이 상수들을 section0.xml 안에서 그대로 재사용하면 서식이 보존된다.

export const PARA = {
  ROOT_P: 20,           // 최상위 p (secPr 포함)
  LABEL_TITLE: 14,      // 라벨 셀의 "지난 주 실적" / "이번 주 계획" / 날짜범위
  ORG_LINE: 12,         // "[철도AI융합연구실]" / "(1) 기본사업" / "(2) 수탁사업"
  ETC_KIND: 15,         // "(3) 기타" (샘플에서 유독 다른 paraPr 사용)
  PROJECT_LINE: 17,     // " - 과제명(담당자)"
  BULLET: 16,           // "• 세부 수행내용(메타)"
  BLANK: 18,            // 카테고리 구분용 빈 줄
  EMPTY_CELL: 13,       // 콜0/콜2 빈 셀 문단
};

export const CHAR = {
  LABEL_TEXT: 0,        // 라벨 셀의 검은 볼드 텍스트
  NOTE_TAIL: 4,         // "□ 일반 보고사항"
  ORG_AND_KIND: 6,      // 조직명, (1)(2) 대분류, " - " dash
  EMPTY_CELL: 8,        // 빈 셀 기본
  TOP_RUN: 9,           // 최상위 run
  TBL_RUN: 10,          // <hp:tbl>을 담은 run
  BULLET_TEXT: 11,      // 불릿 항목 본문
  ETC_KIND_TEXT: 12,    // "(3) 기타" 본문
  PROJECT_TITLE: 13,    // 과제명 텍스트
  BULLET_BOLD: 22,      // 불릿 항목 본문 (중요 표시, bold) — build_assets.py 가 동적 추가
};

// linesegarray 기본 속성 (paraPr별). 한글은 열 때 재계산하지만 초기값을 넣어둔다.
export const LINESEG_PRESET = {
  label: {
    vertsize: 1400, textheight: 1400, baseline: 1190, spacing: 840,
    horzpos: 200, horzsize: 6088, flags: 393216,
  },
  orgKindProject: {
    vertsize: 1300, textheight: 1300, baseline: 1105, spacing: 392,
    horzpos: 200, horzsize: 36372, flags: 393216,
  },
  bullet: {
    vertsize: 1300, textheight: 1300, baseline: 1105, spacing: 392,
    horzpos: 1500, horzsize: 35072, flags: 2490368,
  },
  blank: {
    vertsize: 1300, textheight: 1300, baseline: 1105, spacing: 392,
    horzpos: 1500, horzsize: 35072, flags: 393216,
  },
};
