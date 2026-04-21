// 작성자 페이지 로직
import { ensureSignedIn, isConfigPlaceholder } from '../firebase-init.js';
import {
  subscribeAuthors, subscribeCategories, subscribeCurrent,
  subscribeRound, subscribeSubmissions,
  saveDraft, finalSubmit, submissionRef, kindLabelKor,
} from '../store.js';
import { getDoc } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { getState, patchState, subscribe } from '../state.js';
import { renderPreview } from './preview-render.js';
import { relativeTimeLabel } from '../util/date.js';
import { uuid } from '../util/download.js';

const BUILD_TAG = 'author-v4-2026-04-21';
if (typeof window !== 'undefined') {
  window.__authorViewEntered = true;
  console.log('[author-view.js] module entered, build=', BUILD_TAG);
}

const ACTIVE_AUTHOR_KEY = 'activeAuthorId';

// 기본 입력 본체 구조
function emptyItem(person) {
  return { id: uuid(), text: '', date: '', org: '', person: person || '' };
}
function emptyEntry(categoryId, person) {
  return { categoryId, items: [emptyItem(person)] };
}

// 내 submission 문서 데이터 캐시
let mySubmission = null;
let saveTimer = null;
let skipNextLocal = false;

function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

function renderShellMessage(text, mode = 'banner') {
  const root = $('#main-area');
  root.innerHTML = `<div class="${mode}">${text}</div>`;
}

function statusText(s) {
  return { idle: '작성전', draft: '작성중 (임시저장)', submitted: '작성완료 (제출됨)' }[s] || '';
}

async function mountApp() {
  if (isConfigPlaceholder()) {
    renderShellMessage(
      'Firebase 설정이 아직 비어 있습니다. <code>assets/js/firebase-config.js</code> 파일에 프로젝트 config 객체를 넣어주세요. 자세한 방법은 README.md 참고.',
      'banner danger',
    );
    return;
  }

  renderShellMessage('Firebase 연결 중…', 'banner');

  try {
    await ensureSignedIn();
  } catch (e) {
    console.error('익명 로그인 실패', e);
    const code = e?.code || e?.name || 'Error';
    const msg = e?.message || String(e);
    renderShellMessage(
      `<strong>Firebase 익명 로그인 실패</strong><br/><code>${escapeHtml(code)}</code>: ${escapeHtml(msg)}<br/><br/>`
      + `Firebase 콘솔 → Authentication → Sign-in method 에서 <strong>익명(Anonymous)</strong> 로그인을 사용 설정했는지 확인하세요.`,
      'banner danger',
    );
    return;
  }

  // 구독 등록
  subscribeAuthors((authors) => patchState({ authors }));
  subscribeCategories((categories) => patchState({ categories }));
  subscribeCurrent((current) => patchState({ current }));

  let unsubRound = null;
  let unsubSubs = null;

  subscribe((s) => {
    const rid = s.current.roundId || null;
    if (!rid) {
      if (unsubRound) { unsubRound(); unsubRound = null; }
      if (unsubSubs) { unsubSubs(); unsubSubs = null; }
      if (s.round !== null || (s.submissions && s.submissions.length > 0)) {
        patchState({ round: null, submissions: [] });
      }
      return;
    }
    if (!unsubRound || s.round?.__rid !== rid) {
      if (unsubRound) unsubRound();
      unsubRound = subscribeRound(rid, (r) => {
        patchState({ round: r ? { ...r, __rid: rid } : null });
      });
      if (unsubSubs) unsubSubs();
      unsubSubs = subscribeSubmissions(rid, (subs2) => {
        patchState({ submissions: subs2 });
        // 내 submission 갱신 (원격 변경 반영)
        const myId = getState().activeAuthorId;
        if (myId) {
          const mine = subs2.find(x => x._id === myId);
          if (mine && !skipNextLocal) mySubmission = mine;
          skipNextLocal = false;
          render();
        }
      });
    }
  });

  // 본인 복원
  const saved = localStorage.getItem(ACTIVE_AUTHOR_KEY);
  if (saved) patchState({ activeAuthorId: saved });

  subscribe(() => render());
}

function render() {
  const s = getState();
  const main = $('#main-area');

  // 헤더 갱신
  renderTopStatus(s);

  // 활성 회차 없음
  if (!s.current.roundId || !s.round) {
    main.innerHTML = '';
    main.appendChild(elMsg('현재 작성 가능한 회차가 없습니다. 관리자의 확정을 기다려 주세요.', 'banner warn'));
    $('#preview-area').innerHTML = '';
    return;
  }

  // 본인 선택 필요
  if (!s.activeAuthorId) {
    main.innerHTML = '';
    main.appendChild(renderAuthorPicker(s));
    $('#preview-area').innerHTML = '';
    return;
  }

  // 명단에서 본인이 사라진 경우
  if (!s.round.authorsSnapshot?.some(a => a.id === s.activeAuthorId)) {
    main.innerHTML = '';
    main.appendChild(elMsg(
      `선택된 본인(${s.activeAuthorId})이 이번 회차 명단에 없습니다. 다른 이름을 선택하세요.`,
      'banner warn',
    ));
    main.appendChild(renderAuthorPicker(s));
    return;
  }

  // 내 submission 로드 (구독으로 들어온 것 사용)
  const mine = s.submissions.find(x => x._id === s.activeAuthorId);
  if (!mySubmission || mySubmission._id !== s.activeAuthorId) {
    mySubmission = mine ? JSON.parse(JSON.stringify(mine)) : {
      _id: s.activeAuthorId,
      authorId: s.activeAuthorId,
      authorName: (s.authors.find(a => a.id === s.activeAuthorId) || {}).name || '',
      entries: { past: [], next: [] },
      status: 'idle',
    };
  }

  main.innerHTML = '';
  main.appendChild(renderSubmissionEditor(s, mySubmission));

  // 미리보기 업데이트 (내 기여 + 다른 사람 기여 모두)
  const previewEl = $('#preview-area');
  previewEl.innerHTML = '';
  // 내 로컬 편집을 반영한 병합 submissions 생성
  const merged = s.submissions.map(x => x._id === s.activeAuthorId ? mySubmission : x);
  if (!merged.some(x => x._id === s.activeAuthorId)) merged.push(mySubmission);
  previewEl.appendChild(renderPreview(s.round, merged));
}

function renderTopStatus(s) {
  const top = $('#round-info');
  if (!s.current.roundId || !s.round) {
    top.textContent = '활성 회차 없음';
    return;
  }
  const form = s.round.form === 'monthly' ? '월례' : '주례';
  const range = `${s.round.rangeStart} ~ ${s.round.rangeEnd}`;
  const rangeNext = `${s.round.nextRangeStart} ~ ${s.round.nextRangeEnd}`;
  const name = s.activeAuthorId
    ? (s.round.authorsSnapshot?.find(a => a.id === s.activeAuthorId)?.name || '(알 수 없음)')
    : '';
  top.innerHTML = `<strong>${form}</strong> · 기준일 ${s.round.baseDate} · 지난주 ${range} · 이번주 ${rangeNext}`
    + (name ? ` · 본인: <strong>${escapeHtml(name)}</strong> <button class="btn ghost small" id="change-author">변경</button>` : '');
  const change = $('#change-author');
  if (change) change.addEventListener('click', () => {
    localStorage.removeItem(ACTIVE_AUTHOR_KEY);
    mySubmission = null;
    patchState({ activeAuthorId: null });
  });
}

function elMsg(text, cls) {
  const d = document.createElement('div');
  d.className = cls;
  d.innerHTML = text;
  return d;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderAuthorPicker(s) {
  const box = document.createElement('div');
  box.className = 'panel';
  box.innerHTML = '<h2>본인을 선택하세요</h2>';
  const authors = s.round?.authorsSnapshot ?? s.authors ?? [];
  if (authors.length === 0) {
    box.appendChild(elMsg('이번 회차 작성자 명단이 비어 있습니다. 관리자에게 문의하세요.', 'banner warn'));
    return box;
  }
  const wrap = document.createElement('div');
  wrap.className = 'row';
  for (const a of authors) {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = a.name;
    btn.addEventListener('click', () => {
      localStorage.setItem(ACTIVE_AUTHOR_KEY, a.id);
      mySubmission = null;
      patchState({ activeAuthorId: a.id });
    });
    wrap.appendChild(btn);
  }
  box.appendChild(wrap);
  return box;
}

function renderSubmissionEditor(s, sub) {
  const locked = sub.status === 'submitted';
  const wrap = document.createElement('div');
  wrap.className = 'panel' + (locked ? ' author-block locked' : '');

  const header = document.createElement('h2');
  header.innerHTML = `수행 내용 입력 <span class="status-chip ${sub.status}">${statusText(sub.status)}</span>`;
  wrap.appendChild(header);

  if (locked) {
    wrap.appendChild(elMsg('이미 최종 제출되었습니다. 관리자에게 해제를 요청해야 수정할 수 있습니다.', 'banner'));
  }

  // 두 섹션 렌더
  wrap.appendChild(renderSection(s, sub, 'past', locked));
  wrap.appendChild(renderSection(s, sub, 'next', locked));

  // 액션 바
  const bar = document.createElement('div');
  bar.className = 'action-bar';
  bar.innerHTML = `
    <div class="save-status" id="save-status"></div>
    <div>
      <button class="btn" id="btn-save" ${locked ? 'disabled' : ''}>임시저장</button>
      <button class="btn primary" id="btn-submit" ${locked ? 'disabled' : ''}>최종 제출</button>
    </div>`;
  wrap.appendChild(bar);
  updateSaveStatus(sub);

  $('#btn-save', wrap).addEventListener('click', async () => {
    await doSave(sub, false);
  });
  $('#btn-submit', wrap).addEventListener('click', async () => {
    if (!confirm('최종 제출 후에는 수정이 잠깁니다. 제출할까요?')) return;
    await doSave(sub, true);
  });

  return wrap;
}

function renderSection(s, sub, side, locked) {
  const label = side === 'past'
    ? (s.round.form === 'monthly' ? '지난 달 실적' : '지난 주 실적')
    : (s.round.form === 'monthly' ? '이번 달 계획' : '이번 주 계획');
  const box = document.createElement('div');
  box.className = 'author-block';
  box.innerHTML = `<h3>${label} <span class="muted tight">${side === 'past' ? `(${s.round.rangeStart} ~ ${s.round.rangeEnd})` : `(${s.round.nextRangeStart} ~ ${s.round.nextRangeEnd})`}</span></h3>`;
  const entries = sub.entries?.[side] ?? [];
  const catList = s.round.categoriesSnapshot ?? [];
  const usedCatIds = new Set(entries.map(e => e.categoryId));

  for (let eIdx = 0; eIdx < entries.length; eIdx++) {
    box.appendChild(renderCategoryBlock(s, sub, side, eIdx, locked));
  }

  if (!locked) {
    const addWrap = document.createElement('div');
    addWrap.className = 'row';
    const sel = document.createElement('select');
    sel.innerHTML = '<option value="">+ 카테고리 추가</option>'
      + catList
        .filter(c => !usedCatIds.has(c.id))
        .map(c => `<option value="${c.id}">[${kindLabelKor(c.kind)}] ${escapeHtml(c.title)}${c.owner ? ' (' + escapeHtml(c.owner) + ')' : ''}</option>`)
        .join('');
    addWrap.appendChild(sel);
    sel.addEventListener('change', () => {
      const v = sel.value;
      if (!v) return;
      const myName = s.round.authorsSnapshot?.find(a => a.id === sub._id)?.name || '';
      if (!sub.entries) sub.entries = { past: [], next: [] };
      if (!sub.entries[side]) sub.entries[side] = [];
      sub.entries[side].push(emptyEntry(v, myName));
      scheduleSave();
      render();
    });
    box.appendChild(addWrap);
  }
  return box;
}

function renderCategoryBlock(s, sub, side, eIdx, locked) {
  const entry = sub.entries[side][eIdx];
  const cat = s.round.categoriesSnapshot.find(c => c.id === entry.categoryId);
  const box = document.createElement('div');
  box.className = 'cat-block';
  const title = cat
    ? `<span class="chip kind-${cat.kind}">${kindLabelKor(cat.kind)}</span> ${escapeHtml(cat.title)}${cat.owner ? ' <span class="muted">(' + escapeHtml(cat.owner) + ')</span>' : ''}`
    : `<span class="muted">(알 수 없는 카테고리: ${escapeHtml(entry.categoryId)})</span>`;
  const head = document.createElement('header');
  head.innerHTML = `<div>${title}</div>`;
  if (!locked) {
    const rm = document.createElement('button');
    rm.className = 'btn ghost small'; rm.textContent = '카테고리 삭제';
    rm.addEventListener('click', () => {
      if (!confirm('이 카테고리와 입력한 수행내용들을 삭제합니다.')) return;
      sub.entries[side].splice(eIdx, 1);
      scheduleSave(); render();
    });
    head.appendChild(rm);
  }
  box.appendChild(head);

  const itemsBox = document.createElement('div');
  itemsBox.className = 'items';
  for (let i = 0; i < entry.items.length; i++) {
    itemsBox.appendChild(renderItemRow(s, sub, side, eIdx, i, locked));
  }
  box.appendChild(itemsBox);

  if (!locked) {
    const add = document.createElement('button');
    add.className = 'btn small'; add.textContent = '+ 수행내용 추가';
    add.addEventListener('click', () => {
      const myName = s.round.authorsSnapshot?.find(a => a.id === sub._id)?.name || '';
      entry.items.push(emptyItem(myName));
      scheduleSave(); render();
    });
    box.appendChild(add);
  }
  return box;
}

function renderItemRow(s, sub, side, eIdx, itemIdx, locked) {
  const entry = sub.entries[side][eIdx];
  const it = entry.items[itemIdx];
  const row = document.createElement('div');
  row.className = 'item-row';

  const taText = document.createElement('textarea');
  taText.placeholder = '수행내용 (필수)';
  taText.value = it.text || '';
  taText.disabled = locked;
  taText.addEventListener('input', () => { it.text = taText.value; scheduleSave(); updatePreviewOnly(); });

  const iDate = document.createElement('input');
  iDate.type = 'text'; iDate.placeholder = '예: 4/13 (선택)';
  iDate.value = it.date || '';
  iDate.disabled = locked;
  iDate.addEventListener('input', () => { it.date = iDate.value; scheduleSave(); updatePreviewOnly(); });

  const iOrg = document.createElement('input');
  iOrg.type = 'text'; iOrg.placeholder = '수행 관련 기업/기관 (선택)';
  iOrg.value = it.org || '';
  iOrg.disabled = locked;
  iOrg.addEventListener('input', () => { it.org = iOrg.value; scheduleSave(); updatePreviewOnly(); });

  const iPerson = document.createElement('input');
  iPerson.type = 'text'; iPerson.placeholder = '수행자명 (필수)';
  iPerson.value = it.person || '';
  iPerson.disabled = locked;
  iPerson.addEventListener('input', () => { it.person = iPerson.value; scheduleSave(); updatePreviewOnly(); });

  const up = document.createElement('button');
  up.className = 'btn ghost small'; up.textContent = '↑'; up.disabled = locked || itemIdx === 0;
  up.addEventListener('click', () => {
    [entry.items[itemIdx - 1], entry.items[itemIdx]] = [entry.items[itemIdx], entry.items[itemIdx - 1]];
    scheduleSave(); render();
  });

  const down = document.createElement('button');
  down.className = 'btn ghost small'; down.textContent = '↓';
  down.disabled = locked || itemIdx === entry.items.length - 1;
  down.addEventListener('click', () => {
    [entry.items[itemIdx + 1], entry.items[itemIdx]] = [entry.items[itemIdx], entry.items[itemIdx + 1]];
    scheduleSave(); render();
  });

  const del = document.createElement('button');
  del.className = 'btn ghost small'; del.textContent = '✕'; del.title = '삭제'; del.disabled = locked;
  del.addEventListener('click', () => {
    entry.items.splice(itemIdx, 1);
    if (entry.items.length === 0) sub.entries[side].splice(eIdx, 1);
    scheduleSave(); render();
  });

  row.append(taText, iDate, iOrg, iPerson, up, down, del);
  return row;
}

function updatePreviewOnly() {
  const s = getState();
  if (!s.round) return;
  const merged = s.submissions.map(x => x._id === s.activeAuthorId ? mySubmission : x);
  if (!merged.some(x => x._id === s.activeAuthorId)) merged.push(mySubmission);
  const previewEl = $('#preview-area');
  previewEl.innerHTML = '';
  previewEl.appendChild(renderPreview(s.round, merged));
}

function updateSaveStatus(sub) {
  const el = $('#save-status');
  if (!el) return;
  if (sub.status === 'submitted') {
    el.textContent = `최종 제출 완료 · ${relativeTimeLabel(sub.submittedAt?.toMillis?.() ?? sub.lastSavedAt) }`;
  } else if (sub.status === 'draft') {
    el.textContent = `임시저장 · ${relativeTimeLabel(sub.lastSavedAt?.toMillis?.() ?? null)}`;
  } else {
    el.textContent = '아직 저장 안됨';
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { doSave(mySubmission, false).catch(e => console.error(e)); }, 800);
}

async function doSave(sub, finalize) {
  const s = getState();
  if (!s.current.roundId) return;
  try {
    skipNextLocal = true;
    if (finalize) {
      // 최소 요구: 본인 이름이 채워진 항목이 1개 이상
      const hasAny = ['past', 'next'].some(side => (sub.entries?.[side] || []).some(e => e.items.some(i => (i.text || '').trim() && (i.person || '').trim())));
      if (!hasAny) {
        alert('수행내용과 수행자명을 최소 1개 입력해야 제출할 수 있습니다.');
        return;
      }
      await finalSubmit(s.current.roundId, s.activeAuthorId, {
        authorName: sub.authorName,
        entries: sub.entries,
      });
      sub.status = 'submitted';
    } else {
      await saveDraft(s.current.roundId, s.activeAuthorId, {
        authorName: sub.authorName,
        entries: sub.entries,
      });
      sub.status = 'draft';
    }
    updateSaveStatus(sub);
    // 저장 성공 후 상태 반영
    render();
  } catch (e) {
    console.error(e);
    alert('저장 실패: ' + e.message);
  }
}

mountApp();
