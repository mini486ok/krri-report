// 관리자 페이지 로직
import {
  ensureAdminSignedIn, signOutAdmin, currentUser, isAnonymousUser,
  isConfigPlaceholder, db,
} from '../firebase-init.js';
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
import { computeRanges, relativeTimeLabel, formatYMDDash } from '../util/date.js';
import { buildHwpxBlob, suggestFileName } from '../hwpx/hwpx-builder.js';
import { downloadBlob } from '../util/download.js';

const BUILD_TAG = 'admin-v13-2026-04-24';

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

function statusText(s) {
  return { idle: '작성전', draft: '작성중', submitted: '작성완료' }[s] || s;
}

let activeTab = 'round';
let _appMounted = false;  // 실제 앱 구독이 1회 이상 mount 되었는지

// ─────────────────────────────────────────────────────────
// 1. 부팅 — 로그인 랜딩 → 관리자 확인 → 앱 mount
// ─────────────────────────────────────────────────────────

function renderAuthLanding(message) {
  const buildLine = `<code style="font-size:11px">build: ${BUILD_TAG}</code>`;
  $('#app-root').innerHTML = `
    <div class="panel" style="max-width:540px; margin:40px auto; text-align:center">
      <h2 style="margin-top:0">관리자 로그인</h2>
      <p class="muted">이 페이지는 사전에 등록된 Google 계정으로만 접근할 수 있습니다.</p>
      ${message ? `<div class="banner warn" style="text-align:left">${message}</div>` : ''}
      <div style="margin:20px 0">
        <button class="btn primary" id="btn-admin-login" style="padding:10px 20px; font-size:15px">Google 계정으로 로그인</button>
      </div>
      <div class="muted" style="font-size:12px">${buildLine}</div>
    </div>
    <div class="panel" style="max-width:540px; margin:0 auto">
      <h3 style="margin-top:0">진행 로그 (디버그)</h3>
      <pre id="boot-log" style="font-size:11px; white-space:pre-wrap; margin:0; font-family:ui-monospace,SFMono-Regular,monospace; color:#374151">${_bootLog.join('\n') || '(로그 대기 중…)'}</pre>
    </div>`;
  $('#btn-admin-login').addEventListener('click', () => { doLoginAndMount(); });
}

function renderNotAdmin(err) {
  const uid = err?.attemptedUid || '(알 수 없음)';
  const email = err?.attemptedEmail || '(알 수 없음)';
  $('#app-root').innerHTML = `
    <div class="panel" style="max-width:640px; margin:40px auto">
      <h2 style="margin-top:0; color:#b91c1c">관리자 권한이 없습니다</h2>
      <p>로그인은 성공했지만 이 계정은 관리자 목록에 등록되어 있지 않습니다.</p>
      <div class="banner" style="text-align:left">
        <div><strong>로그인 이메일</strong>: ${escapeHtml(email)}</div>
        <div><strong>Firebase uid</strong>: <code>${escapeHtml(uid)}</code></div>
      </div>
      <h3>관리자 등록 방법 (최초 1회)</h3>
      <ol>
        <li>위 <code>uid</code> 문자열을 복사합니다.</li>
        <li>Firebase 콘솔 → Firestore Database → <code>config</code> 컬렉션 → <code>admins</code> 문서를 엽니다. 없으면 "문서 추가"로 생성.</li>
        <li><code>uids</code> 라는 <strong>Array</strong> 필드에 방금 복사한 uid 를 string 으로 추가합니다.</li>
        <li>저장 후 이 페이지에서 "다시 시도" 버튼을 누르세요.</li>
      </ol>
      <div class="row">
        <button class="btn primary" id="btn-retry">다시 시도</button>
        <button class="btn" id="btn-signout">다른 계정으로 로그인</button>
      </div>
    </div>`;
  $('#btn-retry').addEventListener('click', () => { doLoginAndMount(); });
  $('#btn-signout').addEventListener('click', async () => {
    await signOutAdmin();
    renderAuthLanding('');
  });
}

async function doLoginAndMount() {
  // 로그인 시도 중에는 보이는 버튼을 잠시 비활성화 — 사용자 반복 클릭 방지
  const btn = document.getElementById('btn-admin-login');
  if (btn) { btn.disabled = true; btn.textContent = '로그인 팝업 확인 중…'; }

  stage('ensureAdminSignedIn() 호출 전');
  let uid;
  try {
    uid = await ensureAdminSignedIn();
    stage('ensureAdminSignedIn() 완료: uid=' + uid);
  } catch (e) {
    stage('ensureAdminSignedIn() 실패: ' + (e?.code || e?.message || e));
    if (e?.code === 'auth/not-admin') {
      renderNotAdmin(e);
      return;
    }
    // 팝업 차단, 사용자가 닫음 등
    showAuthError(e);
    return;
  }
  await mountApp();
}

function showAuthError(err) {
  const code = err?.code || err?.name || 'Error';
  const msg = err?.message || String(err);
  const tips = diagnosisFor(code, msg);
  $('#app-root').innerHTML = `
    <div class="panel" style="max-width:640px; margin:40px auto">
      <div class="banner danger">
        <strong>관리자 로그인 실패</strong><br/>
        <code>${escapeHtml(code)}</code>: ${escapeHtml(msg)}
      </div>
      <h3>가능한 원인과 해결</h3>
      <ul>${tips.map(t => `<li>${t}</li>`).join('')}</ul>
      <div class="row">
        <button class="btn primary" id="btn-retry">다시 시도</button>
      </div>
    </div>`;
  $('#btn-retry').addEventListener('click', () => renderAuthLanding(''));
}

// ─────────────────────────────────────────────────────────
// 2. 앱 mount (로그인+화이트리스트 통과 후)
// ─────────────────────────────────────────────────────────

async function mountApp() {
  if (_appMounted) { render(); return; }

  // 로딩 표시
  $('#app-root').innerHTML = `
    <div class="banner">
      <strong>Firestore 연결 중…</strong>
      <code style="font-size:11px; margin-left:8px">build: ${BUILD_TAG}</code>
    </div>
    <div class="panel">
      <h3 style="margin-top:0">진행 로그 (디버그)</h3>
      <pre id="boot-log" style="font-size:11px; white-space:pre-wrap; margin:0; font-family:ui-monospace,SFMono-Regular,monospace; color:#374151">${_bootLog.join('\n')}</pre>
    </div>`;

  // 첫 Firestore 읽기가 성공하는지 확인 (보안 규칙 문제 조기 감지)
  try {
    stage('probeFirestore() 호출 전');
    await probeFirestore();
    stage('probeFirestore() 완료');
  } catch (e) {
    stage('probeFirestore() 실패: ' + (e?.code || e?.message || e));
    showFatalError(e, 'Firestore 접근 실패 (보안 규칙 또는 네트워크)');
    return;
  }

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
  _appMounted = true;
  stage('mountApp 완료');
  render();
}

async function probeFirestore() {
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
  if (/popup-blocked/i.test(code + msg)) {
    tips.push('브라우저가 로그인 팝업을 차단했습니다. 주소창 오른쪽의 팝업 차단 아이콘을 눌러 이 사이트에 허용한 뒤 다시 시도하세요.');
  }
  if (/popup-closed-by-user|cancelled-popup-request/i.test(code + msg)) {
    tips.push('로그인 팝업 창이 닫혔습니다. "다시 시도" 버튼을 눌러 진행하세요.');
  }
  if (/timeout/i.test(code + msg)) {
    tips.push('Identity Toolkit API가 활성화되지 않았을 수 있습니다. Google Cloud Console → API 및 서비스 → 라이브러리에서 <strong>Identity Toolkit API</strong>를 "사용" 으로 변경.');
    tips.push('사내 방화벽/프록시가 <code>identitytoolkit.googleapis.com</code> 또는 <code>firestore.googleapis.com</code> 을 차단하고 있을 수 있습니다.');
    tips.push('브라우저 확장(AdBlock 등)을 일시 비활성 또는 시크릿 창으로 재시도하세요.');
  }
  if (/admin-restricted-operation/i.test(code + msg)) {
    tips.push('Firebase 콘솔 → Authentication → Sign-in method → <strong>Google</strong> 제공업체를 사용 설정했는지 확인하세요.');
  }
  if (/unauthorized-domain/i.test(code + msg)) {
    tips.push('Firebase 콘솔 → Authentication → 설정 → <strong>승인된 도메인</strong>에 현재 접속 도메인(localhost 또는 github.io)을 추가하세요.');
  }
  if (/operation-not-allowed/i.test(code + msg)) {
    tips.push('Firebase 콘솔 → Authentication → Sign-in method 에서 Google 로그인이 "사용 설정됨" 상태인지 확인하세요.');
  }
  if (/permission|insufficient/i.test(code + msg)) {
    tips.push('Firestore → 규칙 탭에 README 1-5의 <strong>최신 규칙 블록</strong>이 게시되었는지 확인하세요 (isAdmin 헬퍼 포함).');
    tips.push('Firestore → <code>config/admins</code> 문서의 <code>uids</code> 배열에 본인 uid 가 포함되어 있는지 확인하세요.');
  }
  if (/api-key-not-valid|invalid-api-key|referrer/i.test(code + msg)) {
    tips.push('<code>assets/js/firebase-config.js</code> 의 apiKey 값이 Firebase 콘솔의 웹앱 config 와 일치하는지 확인하세요.');
  }
  if (/failed to get document|unavailable|network/i.test(code + msg)) {
    tips.push('네트워크 연결(사내 프록시/방화벽)로 firestore.googleapis.com 접근이 차단되었을 수 있습니다.');
  }
  if (tips.length === 0) {
    tips.push('위 메시지를 그대로 구글에서 검색하시면 대부분 해결됩니다. README.md 의 "문제 해결 체크리스트"도 참고하세요.');
  }
  return tips;
}

// ─────────────────────────────────────────────────────────
// 3. 렌더링
// ─────────────────────────────────────────────────────────

function renderAdminBar(root) {
  const u = currentUser();
  const bar = document.createElement('div');
  bar.className = 'banner';
  bar.style.display = 'flex';
  bar.style.justifyContent = 'space-between';
  bar.style.alignItems = 'center';
  bar.innerHTML = `
    <div>관리자 로그인: <strong>${escapeHtml(u?.displayName || u?.email || '(알 수 없음)')}</strong>
      <span class="muted" style="margin-left:6px">${escapeHtml(u?.email || '')}</span>
    </div>
    <div>
      <code style="font-size:11px; margin-right:10px">build: ${BUILD_TAG}</code>
      <button class="btn ghost small" id="btn-signout">로그아웃</button>
    </div>`;
  root.appendChild(bar);
  bar.querySelector('#btn-signout').addEventListener('click', async () => {
    if (!confirm('로그아웃 하시겠습니까?')) return;
    await signOutAdmin();
    _appMounted = false;  // 다음 mountApp 호출 시 다시 mount 되도록
    renderAuthLanding('');
  });
}

function render() {
  const s = getState();
  const root = $('#app-root');
  root.innerHTML = '';

  renderAdminBar(root);

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
  // 로컬 시간 기준 YYYY-MM-DD (toISOString 은 UTC 기준이라 KST 오전 9시 이전이면 전날로 나옴)
  const todayIso = formatYMDDash(new Date());
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
      if (!confirm('카테고리 명단이 비어 있습니다. 디폴트 6개를 시드하고 계속할까요?')) return;
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
    <button class="btn" id="btn-seed">디폴트 6개로 리셋 / 시드</button>`;
  box.appendChild(toolbar);
  $('#btn-seed', toolbar).addEventListener('click', async () => {
    if (!confirm('현재 카테고리 목록을 디폴트 6개로 덮어씁니다. 계속할까요?')) return;
    await seedDefaultCategories();
  });

  if (!s.categories.length) {
    const d = document.createElement('div');
    d.className = 'muted'; d.style.marginTop = '8px';
    d.textContent = '카테고리가 없습니다. 위 버튼으로 디폴트 6개를 시드하거나 아래에서 직접 추가하세요.';
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

// ─────────────────────────────────────────────────────────
// 4. 진입점
// ─────────────────────────────────────────────────────────

async function boot() {
  if (isConfigPlaceholder()) {
    $('#app-root').innerHTML = `
      <div class="banner danger">
        Firebase 설정이 비어 있습니다. <code>assets/js/firebase-config.js</code>의 <code>firebaseConfig</code>를 채워주세요.
        자세한 절차는 README.md 참고.
      </div>`;
    return;
  }
  stage('boot 시작');

  // onAuthStateChanged 결과를 잠시 기다려(1초) 이미 로그인된 세션이 있으면 자동 진입.
  // 단, Anonymous 사용자는 관리자로 인정하지 않음.
  await new Promise((r) => setTimeout(r, 800));
  const u = currentUser();
  stage('boot: currentUser=' + (u ? (u.email || u.uid) + (u.isAnonymous ? ' (anon)' : '') : 'null'));

  if (u && !isAnonymousUser()) {
    // Google 로그인 세션이 이미 있음 → 화이트리스트만 조용히 확인 후 자동 진입
    try {
      await ensureAdminSignedIn();
      await mountApp();
      return;
    } catch (e) {
      if (e?.code === 'auth/not-admin') { renderNotAdmin(e); return; }
      stage('자동 진입 중 예외: ' + (e?.code || e?.message || e));
      // 그 외 에러면 랜딩으로 폴백
    }
  }
  renderAuthLanding('');
}

boot();
