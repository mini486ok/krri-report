// 관리자 페이지 로직
import { ensureSignedIn, isConfigPlaceholder, db } from '../firebase-init.js';
import { getDoc, doc } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {
  subscribeAuthors, subscribeCategories, subscribeCurrent,
  subscribeRound, subscribeSubmissions, subscribeRoundList,
  addAuthor, removeAuthor,
  seedDefaultCategories, addCategory, updateCategory, removeCategory,
  createAndConfirmRound, archiveCurrentRound, unlockSubmission,
  restoreArchivedRound, deleteRoundPermanently,
  getAllSubmissions, kindLabelKor,
} from '../store.js';
import { getState, patchState, subscribe } from '../state.js';
import { renderPreview } from './preview-render.js';
import { computeRanges, relativeTimeLabel } from '../util/date.js';
import { buildHwpxBlob, suggestFileName } from '../hwpx/hwpx-builder.js';
import { downloadBlob } from '../util/download.js';

const BUILD_TAG = 'admin-v8-2026-04-21';

// HTML의 인라인 진단 스크립트에게 "모듈이 실제로 실행 시작됨"을 알림
if (typeof window !== 'undefined') {
  window.__adminViewEntered = true;
  console.log('[admin-view.js] module entered, build=', BUILD_TAG);
}

// ── 단계별 진행 로그를 DOM에 append-only 로 남기는 디버그 HUD ──
const _bootLog = [];
function stage(msg) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2,'0');
  const mm = String(now.getMinutes()).padStart(2,'0');
  const ss = String(now.getSeconds()).padStart(2,'0');
  const ms = String(now.getMilliseconds()).padStart(3,'0');
  const line = `[${hh}:${mm}:${ss}.${ms}] ${msg}`;
  _bootLog.push(line);
  console.log(line);
  const el = document.getElementById('boot-log');
  if (el) el.textContent = _bootLog.join('\n');
}

function $(sel, root = document) { return root.querySelector(sel); }
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

let _loadingActive = false;
let _loadingStart = 0;
function startLoadingHud() {
  _loadingActive = true;
  _loadingStart = Date.now();
  // 초기 1회 렌더: 로딩 상태 + 진행 로그 + 타이머 <span>
  $('#app-root').innerHTML = `
    <div class="banner">
      <strong>Firebase 연결 중…</strong>
      <span class="muted">(<span id="hud-elapsed">0</span>초 경과, 10초 후 자동 타임아웃)</span><br/>
      <code style="font-size:11px">build: ${BUILD_TAG}</code>
    </div>
    <div class="panel">
      <h3 style="margin-top:0">진행 로그 (디버그)</h3>
      <pre id="boot-log" style="font-size:11px; white-space:pre-wrap; margin:0; font-family:ui-monospace,SFMono-Regular,monospace; color:#374151">(로그 대기 중…)</pre>
    </div>`;
  // setInterval 대신 setTimeout 재귀로 HUD 경과초 갱신
  const tick = () => {
    if (!_loadingActive) return;
    const s = Math.floor((Date.now() - _loadingStart) / 1000);
    const el = document.getElementById('hud-elapsed');
    if (el) el.textContent = String(s);
    setTimeout(tick, 500);
  };
  setTimeout(tick, 500);
  stage('startLoadingHud: HUD 초기 렌더 완료, setTimeout tick 등록');
}
function stopLoadingHud() { _loadingActive = false; }
function statusText(s) {
  return { idle: '작성전', draft: '작성중', submitted: '작성완료' }[s] || s;
}

let activeTab = 'round';

async function mountApp() {
  if (isConfigPlaceholder()) {
    $('#app-root').innerHTML = `
      <div class="banner danger">
        Firebase 설정이 비어 있습니다. <code>assets/js/firebase-config.js</code>의 <code>firebaseConfig</code>를 채워주세요.
        자세한 절차는 README.md 참고.
      </div>`;
    return;
  }

  // 로딩 표시 (경과초 카운트 + 빌드 버전 표시 + 진행 로그)
  startLoadingHud();
  stage('mountApp: isConfigPlaceholder 통과');

  try {
    stage('ensureSignedIn() 호출 전');
    await ensureSignedIn();
    stage('ensureSignedIn() 완료');
  } catch (e) {
    stage('ensureSignedIn() 실패: ' + (e?.code || e?.message || e));
    stopLoadingHud();
    showFatalError(e, 'Firebase 익명 로그인 실패');
    return;
  }

  // 첫 Firestore 읽기가 성공하는지 확인 (보안 규칙 문제 조기 감지)
  try {
    stage('probeFirestore() 호출 전');
    await probeFirestore();
    stage('probeFirestore() 완료');
  } catch (e) {
    stage('probeFirestore() 실패: ' + (e?.code || e?.message || e));
    stopLoadingHud();
    showFatalError(e, 'Firestore 접근 실패 (보안 규칙 또는 네트워크)');
    return;
  }
  stopLoadingHud();
  stage('stopLoadingHud, 구독 등록 시작');

  subscribeAuthors((authors) => patchState({ authors }));
  subscribeCategories((categories) => patchState({ categories }));
  subscribeCurrent((current) => patchState({ current }));
  subscribeRoundList((list) => patchState({ roundList: list }));

  let unsubRound = null;
  let unsubSubs = null;
  subscribe((s) => {
    const rid = s.current.roundId || null;
    if (!rid) {
      if (unsubRound) { unsubRound(); unsubRound = null; }
      if (unsubSubs) { unsubSubs(); unsubSubs = null; }
      // 이미 비어 있으면 patchState 재호출 하지 않음 (무한 재귀 방지)
      if (s.round !== null || (s.submissions && s.submissions.length > 0)) {
        patchState({ round: null, submissions: [] });
      }
      return;
    }
    if (!unsubRound || s.round?.__rid !== rid) {
      if (unsubRound) unsubRound();
      unsubRound = subscribeRound(rid, (r) => patchState({ round: r ? { ...r, __rid: rid } : null }));
      if (unsubSubs) unsubSubs();
      unsubSubs = subscribeSubmissions(rid, (subs2) => patchState({ submissions: subs2 }));
    }
  });

  stage('subscribe(render) 등록');
  subscribe(() => render());
  stage('mountApp 완료');
}

async function probeFirestore() {
  // 문서가 없어도 OK, permission 여부만 확인
  await getDoc(doc(db, 'config', 'authors'));
}

function showFatalError(err, hint) {
  console.error(hint, err);
  const code = err?.code || err?.name || 'Error';
  const msg = err?.message || String(err);
  const tips = diagnosisFor(code, msg);
  $('#app-root').innerHTML = `
    <div class="banner danger">
      <strong>${hint}</strong><br/>
      <code>${escapeHtml(code)}</code>: ${escapeHtml(msg)}
    </div>
    <div class="panel">
      <h3>가능한 원인과 해결</h3>
      <ul>${tips.map(t => `<li>${t}</li>`).join('')}</ul>
      <p class="muted">개발자도구(F12) → Console 탭에서 더 자세한 로그를 볼 수 있습니다.</p>
    </div>`;
}

function diagnosisFor(code, msg) {
  const tips = [];
  if (/timeout/i.test(code + msg)) {
    tips.push('Identity Toolkit API가 활성화되지 않았을 수 있습니다. Google Cloud Console(console.cloud.google.com) → API 및 서비스 → 라이브러리에서 <strong>Identity Toolkit API</strong>를 검색해 "사용" 버튼을 눌러 활성화하세요.');
    tips.push('사내 방화벽/프록시/VPN이 <code>identitytoolkit.googleapis.com</code> 또는 <code>firestore.googleapis.com</code> 접근을 차단하고 있을 수 있습니다. 다른 네트워크(개인 핫스팟 등)에서 테스트해 보세요.');
    tips.push('브라우저 확장(AdBlock, uBlock, Privacy Badger 등)이 Google API 도메인을 차단하는 경우도 있습니다. 시크릿 창(Ctrl+Shift+N)으로 재시도하거나 확장을 일시 비활성화하세요.');
    tips.push('F12 → Network 탭에서 <code>accounts:signUp</code> 요청의 상태(Status 컬럼)를 확인하면 원인을 바로 알 수 있습니다.');
  }
  if (/admin-restricted-operation/i.test(code + msg)) {
    tips.push('Firebase 콘솔 → Authentication → Sign-in method → <strong>익명(Anonymous)</strong> 로그인을 사용 설정했는지 확인하세요.');
  }
  if (/unauthorized-domain/i.test(code + msg)) {
    tips.push('Firebase 콘솔 → Authentication → 설정 → 승인된 도메인에 현재 접속 도메인이 포함되어 있는지 확인하세요. localhost는 기본 포함입니다.');
  }
  if (/permission|insufficient/i.test(code + msg)) {
    tips.push('Firestore → 규칙 탭에 README 1-5의 규칙 블록이 <strong>게시(Publish)</strong> 되었는지 확인하세요.');
  }
  if (/api-key-not-valid|invalid-api-key|referrer/i.test(code + msg)) {
    tips.push('assets/js/firebase-config.js 의 apiKey 값이 Firebase 콘솔의 웹앱 config와 일치하는지 확인하세요.');
    tips.push('Google Cloud Console → API 및 서비스 → 사용자 인증 정보 → 해당 API 키에 HTTP 리퍼러 제한이 걸려있다면 제거하거나 <code>localhost</code>, 배포 도메인을 추가하세요.');
  }
  if (/failed to get document|unavailable|network/i.test(code + msg)) {
    tips.push('네트워크 연결(사내 프록시/방화벽)로 firestore.googleapis.com 접근이 차단되었을 수 있습니다.');
  }
  if (tips.length === 0) {
    tips.push('위 메시지를 그대로 구글에서 검색하시면 대부분 해결됩니다. README.md 의 "문제 해결 체크리스트"도 참고하세요.');
  }
  return tips;
}

function render() {
  const s = getState();
  const root = $('#app-root');
  root.innerHTML = '';

  const tabs = document.createElement('div');
  tabs.className = 'tabs';
  for (const [id, label] of [
    ['round', '회차 관리'],
    ['authors', '작성자 명단'],
    ['categories', '카테고리 관리'],
    ['archive', '아카이브'],
  ]) {
    const b = document.createElement('button');
    b.className = 'tab' + (activeTab === id ? ' active' : '');
    b.textContent = label;
    b.addEventListener('click', () => { activeTab = id; render(); });
    tabs.appendChild(b);
  }
  root.appendChild(tabs);

  const panel = document.createElement('div');
  panel.className = 'tab-panels';
  if (activeTab === 'round') panel.appendChild(renderRoundTab(s));
  else if (activeTab === 'authors') panel.appendChild(renderAuthorsTab(s));
  else if (activeTab === 'categories') panel.appendChild(renderCategoriesTab(s));
  else if (activeTab === 'archive') panel.appendChild(renderArchiveTab(s));
  root.appendChild(panel);
}

// ────────── 회차 관리 ──────────
function renderRoundTab(s) {
  const box = document.createElement('div');
  if (!s.round) {
    box.appendChild(renderNewRoundForm(s));
    const hint = document.createElement('div');
    hint.className = 'muted';
    hint.textContent = '아직 활성 회차가 없습니다. 위에서 새 회차를 시작하세요.';
    box.appendChild(hint);
    return box;
  }

  // 활성 회차 정보
  const info = document.createElement('div');
  info.className = 'panel';
  const form = s.round.form === 'monthly' ? '월례' : '주례';
  info.innerHTML = `
    <h2>현재 활성 회차</h2>
    <div><strong>${form}</strong> · 기준일 ${escapeHtml(s.round.baseDate || '')}
      · 지난 ${form === '월례' ? '달' : '주'} ${escapeHtml(s.round.rangeStart)} ~ ${escapeHtml(s.round.rangeEnd)}
      · 이번 ${form === '월례' ? '달' : '주'} ${escapeHtml(s.round.nextRangeStart)} ~ ${escapeHtml(s.round.nextRangeEnd)}</div>
    <div class="muted">조직명: ${escapeHtml(s.round.orgName || '')}</div>
    <div class="row" style="margin-top:10px">
      <button class="btn primary" id="btn-hwpx">HWPX 출력</button>
      <button class="btn" id="btn-archive">회차 종료 & 아카이브</button>
      <button class="btn" id="btn-new-round">다른 회차로 교체</button>
    </div>`;
  box.appendChild(info);

  $('#btn-hwpx', info).addEventListener('click', async () => {
    try {
      const submissions = s.submissions.length ? s.submissions : await getAllSubmissions(s.current.roundId);
      const blob = await buildHwpxBlob(s.round, submissions);
      downloadBlob(blob, suggestFileName(s.round));
    } catch (e) {
      console.error(e);
      alert('HWPX 출력 실패: ' + e.message);
    }
  });
  $('#btn-archive', info).addEventListener('click', async () => {
    if (!confirm('현재 회차를 종료하고 아카이브합니다. 계속할까요?')) return;
    await archiveCurrentRound();
  });
  $('#btn-new-round', info).addEventListener('click', () => {
    const form = $('#new-round-form', document);
    if (form) form.scrollIntoView({ behavior: 'smooth' });
    else {
      // render new form panel below
      const np = renderNewRoundForm(s);
      box.appendChild(np);
      np.scrollIntoView({ behavior: 'smooth' });
    }
  });

  // 상태판
  const statusPanel = document.createElement('div');
  statusPanel.className = 'panel';
  statusPanel.innerHTML = '<h2>작성자 진행 현황</h2>';
  const submissions = s.submissions ?? [];
  const counts = { idle: 0, draft: 0, submitted: 0 };
  for (const x of submissions) counts[x.status ?? 'idle'] = (counts[x.status ?? 'idle'] ?? 0) + 1;
  const cnt = document.createElement('div');
  cnt.className = 'status-counts';
  cnt.innerHTML = `
    <span class="stat idle">작성전 ${counts.idle}</span>
    <span class="stat draft">작성중 ${counts.draft}</span>
    <span class="stat submitted">작성완료 ${counts.submitted}</span>`;
  statusPanel.appendChild(cnt);

  const table = document.createElement('table');
  table.className = 'status-table';
  table.innerHTML = `
    <thead><tr><th>작성자</th><th>상태</th><th>마지막 저장</th><th>동작</th></tr></thead>
    <tbody></tbody>`;
  const tbody = table.querySelector('tbody');
  const authorsSnap = s.round.authorsSnapshot ?? [];
  for (const a of authorsSnap) {
    const sub = submissions.find(x => x._id === a.id);
    const st = sub?.status ?? 'idle';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(a.name)}</td>
      <td><span class="status-chip ${st}">${statusText(st)}</span></td>
      <td>${sub?.lastSavedAt ? relativeTimeLabel(sub.lastSavedAt.toMillis?.() ?? sub.lastSavedAt) : '-'}</td>
      <td></td>`;
    const actTd = tr.querySelector('td:last-child');
    if (st === 'submitted') {
      const b = document.createElement('button');
      b.className = 'btn small'; b.textContent = '제출 잠금 해제';
      b.addEventListener('click', async () => {
        if (!confirm(`${a.name} 님의 제출 잠금을 해제합니다. 계속할까요?`)) return;
        try {
          await unlockSubmission(s.current.roundId, a.id);
        } catch (e) { alert('해제 실패: ' + e.message); }
      });
      actTd.appendChild(b);
    }
    tbody.appendChild(tr);
  }
  statusPanel.appendChild(table);
  box.appendChild(statusPanel);

  // 미리보기
  const preview = document.createElement('div');
  preview.className = 'panel';
  preview.innerHTML = '<h2>취합 미리보기 (HTML)</h2>';
  preview.appendChild(renderPreview(s.round, submissions));
  box.appendChild(preview);

  return box;
}

function renderNewRoundForm(s) {
  const box = document.createElement('div');
  box.className = 'panel';
  box.id = 'new-round-form';
  const todayIso = new Date().toISOString().slice(0, 10);
  box.innerHTML = `
    <h2>새 회차 시작</h2>
    <div class="row">
      <div class="field"><label>양식</label>
        <select id="nf-form">
          <option value="weekly" selected>주례</option>
          <option value="monthly">월례</option>
        </select>
      </div>
      <div class="field"><label>기준일</label>
        <input type="date" id="nf-base" value="${todayIso}" />
      </div>
      <div class="field"><label>조직명</label>
        <input type="text" id="nf-org" value="[철도AI융합연구실]" style="width:220px" />
      </div>
    </div>
    <div class="muted" id="nf-range-preview"></div>
    <div class="row" style="margin-top:10px">
      <button class="btn primary" id="nf-confirm">확정</button>
    </div>`;

  const update = () => {
    const form = $('#nf-form', box).value;
    const base = $('#nf-base', box).value;
    try {
      const r = computeRanges(form, base);
      $('#nf-range-preview', box).textContent =
        `지난 ${form === 'monthly' ? '달' : '주'} ${r.rangeStart} ~ ${r.rangeEnd}  ·  이번 ${form === 'monthly' ? '달' : '주'} ${r.nextRangeStart} ~ ${r.nextRangeEnd}`;
    } catch {
      $('#nf-range-preview', box).textContent = '기준일을 선택해 주세요.';
    }
  };
  $('#nf-form', box).addEventListener('change', update);
  $('#nf-base', box).addEventListener('input', update);
  update();

  $('#nf-confirm', box).addEventListener('click', async () => {
    const form = $('#nf-form', box).value;
    const base = $('#nf-base', box).value;
    const org = $('#nf-org', box).value.trim() || '[철도AI융합연구실]';
    if (!base) { alert('기준일을 선택해 주세요.'); return; }
    if (!s.authors || s.authors.length === 0) {
      alert('작성자 명단이 비어 있습니다. "작성자 명단" 탭에서 먼저 추가하세요.');
      return;
    }
    if (!s.categories || s.categories.length === 0) {
      if (!confirm('카테고리 명단이 비어 있습니다. 디폴트 5개를 시드하고 계속할까요?')) return;
      await seedDefaultCategories();
    }
    if (s.current.roundId) {
      if (!confirm('이미 활성 회차가 있습니다. 이전 회차를 아카이브하고 새 회차를 시작할까요?')) return;
    }
    const r = computeRanges(form, base);
    try {
      await createAndConfirmRound({
        form, baseDate: base,
        rangeStart: r.rangeStart, rangeEnd: r.rangeEnd,
        nextRangeStart: r.nextRangeStart, nextRangeEnd: r.nextRangeEnd,
        orgName: org,
        authors: getState().authors,
        categories: getState().categories.length ? getState().categories : [],
      });
    } catch (e) {
      console.error(e);
      alert('회차 확정 실패: ' + e.message);
    }
  });
  return box;
}

// ────────── 작성자 명단 ──────────
function renderAuthorsTab(s) {
  const box = document.createElement('div');
  box.innerHTML = '<h2>작성자 명단</h2>';
  const listWrap = document.createElement('div');
  if (!s.authors.length) {
    listWrap.innerHTML = '<div class="muted">아직 작성자가 없습니다.</div>';
  } else {
    const tbl = document.createElement('table');
    tbl.className = 'data';
    tbl.innerHTML = '<thead><tr><th>이름</th><th style="width:120px"></th></tr></thead><tbody></tbody>';
    const tb = tbl.querySelector('tbody');
    for (const a of s.authors) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(a.name)}</td><td></td>`;
      const btn = document.createElement('button');
      btn.className = 'btn small danger'; btn.textContent = '삭제';
      btn.addEventListener('click', async () => {
        if (!confirm(`${a.name} 을 삭제합니다.`)) return;
        await removeAuthor(a.id);
      });
      tr.querySelector('td:last-child').appendChild(btn);
      tb.appendChild(tr);
    }
    listWrap.appendChild(tbl);
  }
  box.appendChild(listWrap);

  const addBox = document.createElement('div');
  addBox.className = 'row';
  addBox.style.marginTop = '12px';
  addBox.innerHTML = `
    <input id="new-author-name" type="text" placeholder="이름 입력" />
    <button class="btn primary" id="btn-add-author">추가</button>`;
  box.appendChild(addBox);
  $('#btn-add-author', addBox).addEventListener('click', async () => {
    const name = $('#new-author-name', addBox).value.trim();
    if (!name) return;
    await addAuthor(name);
    $('#new-author-name', addBox).value = '';
  });
  return box;
}

// ────────── 카테고리 관리 ──────────
function renderCategoriesTab(s) {
  const box = document.createElement('div');
  box.innerHTML = `<h2>카테고리 관리</h2>`;
  const toolbar = document.createElement('div');
  toolbar.className = 'row';
  toolbar.innerHTML = `
    <button class="btn" id="btn-seed">디폴트 5개로 리셋 / 시드</button>`;
  box.appendChild(toolbar);
  $('#btn-seed', toolbar).addEventListener('click', async () => {
    if (!confirm('현재 카테고리 목록을 디폴트 5개로 덮어씁니다. 계속할까요?')) return;
    await seedDefaultCategories();
  });

  if (!s.categories.length) {
    const d = document.createElement('div');
    d.className = 'muted'; d.style.marginTop = '8px';
    d.textContent = '카테고리가 없습니다. 위 버튼으로 디폴트 5개를 시드하거나 아래에서 직접 추가하세요.';
    box.appendChild(d);
  } else {
    const tbl = document.createElement('table');
    tbl.className = 'data';
    tbl.style.marginTop = '12px';
    tbl.innerHTML = `<thead><tr>
      <th style="width:90px">종류</th>
      <th>제목</th>
      <th style="width:120px">담당자</th>
      <th style="width:80px">순서</th>
      <th style="width:100px"></th>
    </tr></thead><tbody></tbody>`;
    const tb = tbl.querySelector('tbody');
    const sorted = [...s.categories].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    sorted.forEach((c, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="chip kind-${c.kind}">${kindLabelKor(c.kind)}</span></td>
        <td>${escapeHtml(c.title)}</td>
        <td>${escapeHtml(c.owner)}</td>
        <td>
          <button class="btn ghost small" data-act="up" ${idx === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn ghost small" data-act="down" ${idx === sorted.length - 1 ? 'disabled' : ''}>↓</button>
        </td>
        <td><button class="btn small danger" data-act="del">삭제</button></td>`;
      tr.querySelector('[data-act="del"]').addEventListener('click', async () => {
        if (!confirm('삭제할까요?')) return;
        await removeCategory(c.id);
      });
      tr.querySelector('[data-act="up"]').addEventListener('click', async () => {
        if (idx === 0) return;
        const prev = sorted[idx - 1];
        await updateCategory(c.id, { order: prev.order });
        await updateCategory(prev.id, { order: c.order });
      });
      tr.querySelector('[data-act="down"]').addEventListener('click', async () => {
        if (idx === sorted.length - 1) return;
        const next = sorted[idx + 1];
        await updateCategory(c.id, { order: next.order });
        await updateCategory(next.id, { order: c.order });
      });
      tb.appendChild(tr);
    });
    box.appendChild(tbl);
  }

  const addBox = document.createElement('div');
  addBox.className = 'panel';
  addBox.style.marginTop = '12px';
  addBox.innerHTML = `
    <h3 style="margin-top:0">카테고리 추가</h3>
    <div class="row">
      <div class="field"><label>종류</label>
        <select id="cat-kind">
          <option value="basic">기본사업</option>
          <option value="natl_rnd">국가R&D</option>
          <option value="consign">수탁사업</option>
          <option value="etc">기타</option>
        </select>
      </div>
      <div class="field grow"><label>제목</label><input id="cat-title" type="text" placeholder="과제명" /></div>
      <div class="field"><label>담당자</label><input id="cat-owner" type="text" placeholder="예: 홍길동" /></div>
      <div class="field"><label>&nbsp;</label><button class="btn primary" id="btn-add-cat">추가</button></div>
    </div>`;
  box.appendChild(addBox);
  $('#btn-add-cat', addBox).addEventListener('click', async () => {
    const kind = $('#cat-kind', addBox).value;
    const title = $('#cat-title', addBox).value.trim();
    const owner = $('#cat-owner', addBox).value.trim();
    if (!title) { alert('제목을 입력하세요.'); return; }
    await addCategory({ kind, title, owner });
    $('#cat-title', addBox).value = '';
    $('#cat-owner', addBox).value = '';
  });

  return box;
}

// ────────── 아카이브 ──────────
function renderArchiveTab(s) {
  const box = document.createElement('div');
  box.innerHTML = '<h2>아카이브</h2>';
  const rounds = (s.roundList || []).filter(r => r.status === 'archived');
  if (!rounds.length) {
    const d = document.createElement('div');
    d.className = 'muted'; d.textContent = '아직 아카이브된 회차가 없습니다.';
    box.appendChild(d);
    return box;
  }
  const tbl = document.createElement('table');
  tbl.className = 'data';
  tbl.innerHTML = `<thead><tr>
    <th>양식</th><th>기준일</th><th>기간</th><th>아카이브 시각</th><th style="width:360px">동작</th>
  </tr></thead><tbody></tbody>`;
  const tb = tbl.querySelector('tbody');
  for (const r of rounds) {
    const form = r.form === 'monthly' ? '월례' : '주례';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${form}</td>
      <td>${escapeHtml(r.baseDate || '')}</td>
      <td>${escapeHtml(r.rangeStart)} ~ ${escapeHtml(r.rangeEnd)}</td>
      <td>${r.archivedAt ? relativeTimeLabel(r.archivedAt.toMillis?.() ?? r.archivedAt) : '-'}</td>
      <td></td>`;
    const act = tr.querySelector('td:last-child');

    // HWPX 재생성
    const dl = document.createElement('button');
    dl.className = 'btn small primary'; dl.textContent = 'HWPX 재생성';
    dl.style.marginRight = '4px';
    dl.addEventListener('click', async () => {
      try {
        const subs = await getAllSubmissions(r.id);
        const blob = await buildHwpxBlob(r, subs);
        downloadBlob(blob, suggestFileName(r));
      } catch (e) {
        alert('출력 실패: ' + e.message);
      }
    });
    act.appendChild(dl);

    // 불러오기 (현재 활성 회차로 복원)
    const restore = document.createElement('button');
    restore.className = 'btn small'; restore.textContent = '불러오기';
    restore.title = '이 회차를 현재 활성 회차로 복원. 기존 활성 회차는 아카이브됩니다.';
    restore.style.marginRight = '4px';
    restore.addEventListener('click', async () => {
      const msg = `"${form} ${r.baseDate || ''}" 회차를 현재 활성 회차로 복원합니다.\n`
        + (s.current.roundId && s.current.roundId !== r.id
          ? '현재 활성 회차는 자동으로 아카이브됩니다. '
          : '')
        + '계속할까요?';
      if (!confirm(msg)) return;
      try {
        await restoreArchivedRound(r.id);
      } catch (e) {
        alert('불러오기 실패: ' + e.message);
      }
    });
    act.appendChild(restore);

    // 영구삭제
    const del = document.createElement('button');
    del.className = 'btn small danger'; del.textContent = '영구삭제';
    del.title = '회차 문서 + 모든 작성자 입력 내용을 영구 삭제 (복구 불가)';
    del.addEventListener('click', async () => {
      const warn = `"${form} ${r.baseDate || ''}" 회차를 영구 삭제합니다.\n`
        + '이 회차에 입력된 모든 작성자 수행내용이 함께 삭제되며, 복구할 수 없습니다.\n\n'
        + '정말 계속하시겠습니까?';
      if (!confirm(warn)) return;
      if (!confirm('한 번 더 확인합니다. 이 작업은 되돌릴 수 없습니다.\n삭제 진행?')) return;
      try {
        await deleteRoundPermanently(r.id);
      } catch (e) {
        console.error(e);
        alert('삭제 실패: ' + e.message
          + '\n\nFirestore 보안 규칙이 rounds/** 에 대해 delete 를 허용해야 합니다. '
          + 'README 1-5 섹션의 최신 규칙으로 업데이트하세요.');
      }
    });
    act.appendChild(del);

    tb.appendChild(tr);
  }
  box.appendChild(tbl);
  return box;
}

mountApp();
