// 전역 상태 + 간단한 pub/sub
const state = {
  uid: null,
  authors: [],
  categories: [],
  current: { roundId: null },
  round: null,           // 활성 회차 문서
  submissions: [],       // 활성 회차의 전체 submissions
  roundList: [],         // 아카이브 목록 포함 전체
  activeAuthorId: null,  // 작성자 페이지 본인 선택
};

const subs = new Set();

export function getState() { return state; }
export function subscribe(fn) {
  subs.add(fn);
  fn(state);
  return () => subs.delete(fn);
}

// 구독자 콜백이 patchState를 다시 호출할 때 재귀 발생 방지
let _emitting = false;
let _dirty = false;
export function patchState(patch) {
  Object.assign(state, patch);
  if (_emitting) { _dirty = true; return; }
  _emitting = true;
  try {
    do {
      _dirty = false;
      // subs는 이터레이션 중 변경될 수 있으니 스냅샷
      for (const fn of Array.from(subs)) fn(state);
    } while (_dirty);
  } finally {
    _emitting = false;
  }
}
