// 빌더 단위 테스트. Node에서 mock 데이터를 주입해 section0.xml을 뽑고,
// JSZip 대신 Python으로 ZIP 패키징하여 실제 HWPX 파일이 생성되는지까지 확인.
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
import { buildSection0Xml } from '../assets/js/hwpx/section-builder.js';

const mockRound = {
  form: 'weekly',
  baseDate: '2026-04-21',
  rangeStart: '04.20.', rangeEnd: '04.24.',
  nextRangeStart: '04.27.', nextRangeEnd: '05.01.',
  orgName: '[철도AI융합연구실]',
  authorsSnapshot: [
    { id: 'a1', name: '박정준' }, { id: 'a2', name: '이상근' }, { id: 'a3', name: '유승민' },
  ],
  categoriesSnapshot: [
    // 의도적으로 order 값을 뒤섞어 정렬 반영 여부를 확인
    { id: 'c3', kind: 'basic', title: 'AI 및 디지털 대전환을 위한 첨단 모빌리티 허브 핵심기술 개발', owner: '유승민', order: 2 },
    { id: 'c1', kind: 'basic', title: '철도 운영 및 유지관리 고도화를 위한 디지털 트윈 플랫폼 핵심 기술 개발', owner: '박정준', order: 0 },
    { id: 'c2', kind: 'basic', title: 'AX 기반 철도교통 현안 분석 지원 기술 개발', owner: '이상근', order: 1 },
    { id: 'c6', kind: 'natl_rnd', title: '국가R&D 테스트 과제 A', owner: '홍길동', order: 0 },
    { id: 'c4', kind: 'consign', title: '(국가철도공단)철도 유지관리 단계 BIM 시범적용 연구용역', owner: '김현기', order: 3 },
    { id: 'c5', kind: 'etc', title: '기타', owner: '', order: 4 },
  ],
};

const mockSubmissions = [
  {
    _id: 'a1', authorId: 'a1', authorName: '박정준', status: 'submitted',
    entries: {
      past: [
        { categoryId: 'c1', items: [
          { text: '오송시험선로 디지털화를 위한 시험선 답사', date: '4/13', org: 'ESNT', person: '박정준' },
          { text: 'CAD 파일 자동 추출 기술 개발 방안 협의', date: '4/15', org: '', person: '박정준' },
        ]},
        { categoryId: 'c6', items: [
          { text: '국가R&D 관련 미팅 참석', date: '4/16', org: '과기부', person: '홍길동' },
        ]},
      ],
      next: [
        { categoryId: 'c1', items: [
          { text: '디지털 트윈 컨셉 모델의 UI 개선 방안 도출', date: '~4/24', org: '', person: '박정준' },
        ]},
      ],
    },
  },
  {
    _id: 'a2', authorId: 'a2', authorName: '이상근', status: 'draft',
    entries: {
      past: [
        { categoryId: 'c2', items: [
          { text: '통신량 국민행사 집객 데이터 입수 및 분석 추진', date: '4/15~', org: '', person: '이상근,홍석범' },
        ]},
        { categoryId: 'c5', items: [
          { text: "27년 전략연구사업 후보과제 사전컨설팅 의견 반영 제안서 수정본 제출", date: '4/15', org: '', person: '이상근' },
        ]},
      ],
      next: [],
    },
  },
  {
    _id: 'a3', authorId: 'a3', authorName: '유승민', status: 'idle',
    entries: { past: [], next: [] },
  },
];

const xml = buildSection0Xml(mockRound, mockSubmissions);
const outPath = path.join(root, '_unpack_test', 'Contents', 'section0.xml');
await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, xml, 'utf8');
console.log('section0.xml written, length=', xml.length);

// 슬롯이 모두 제거되었는지 확인
for (const slot of ['{{PAST_LABEL_SUBLIST}}', '{{PAST_BODY_SUBLIST}}', '{{NEXT_LABEL_SUBLIST}}', '{{NEXT_BODY_SUBLIST}}']) {
  if (xml.includes(slot)) {
    console.error('SLOT NOT REPLACED:', slot);
    process.exit(1);
  }
}
console.log('OK: all slots replaced');
