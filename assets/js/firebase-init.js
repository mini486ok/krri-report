import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getAuth, signInAnonymously, signInWithPopup, GoogleAuthProvider, signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
  getFirestore, serverTimestamp, Timestamp, doc, getDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export { serverTimestamp, Timestamp };

let _user = null;
const _authWaiters = [];

onAuthStateChanged(auth, (user) => {
  _user = user ?? null;
  if (_user) {
    while (_authWaiters.length) _authWaiters.shift()(_user);
  }
});

export function currentUser() { return _user; }
export function currentUid() { return _user?.uid ?? null; }
export function isAnonymousUser() { return !!_user?.isAnonymous; }

/**
 * 작성자 페이지 전용: 익명 로그인 보장.
 * 이미 Google 등 다른 방식으로 로그인되어 있으면 그대로 사용.
 */
export async function ensureSignedIn({ timeoutMs = 10000 } = {}) {
  if (_user?.uid) return _user.uid;
  // 10초 타임아웃을 걸어 hang 상태를 에러로 변환
  const waitUser = new Promise((resolve) => _authWaiters.push(resolve));
  const timeout = new Promise((_, reject) => setTimeout(() => {
    const err = new Error('Firebase 인증 응답이 ' + (timeoutMs / 1000) + '초 내에 오지 않았습니다. (네트워크/방화벽/API 설정 확인)');
    err.code = 'auth/timeout';
    reject(err);
  }, timeoutMs));

  try {
    const signInP = signInAnonymously(auth).catch((e) => { throw e; });
    await Promise.race([signInP, waitUser, timeout]);
  } catch (e) {
    console.error('익명 로그인 실패', e);
    throw e;
  }
  if (_user?.uid) return _user.uid;
  const u = await Promise.race([waitUser, timeout]);
  return u?.uid ?? null;
}

/**
 * 관리자 페이지 전용: Google 로그인으로 계정을 확보한 뒤
 * /config/admins 문서의 uids 배열에 포함되어 있는지 확인한다.
 *
 * - 현재 익명 상태면 signOut 후 Google 팝업으로 재로그인
 * - 이미 Google 로그인된 상태면 팝업 없이 화이트리스트만 확인
 * - 팝업 차단을 피하기 위해 반드시 "사용자 버튼 클릭" 이벤트 핸들러에서 호출해야 함
 *
 * 화이트리스트 미포함 시 err.code='auth/not-admin' + err.attemptedUid/Email 첨부
 */
export async function ensureAdminSignedIn() {
  if (_user?.isAnonymous) {
    await signOut(auth);
    _user = null;
  }
  if (!_user) {
    const provider = new GoogleAuthProvider();
    // 팝업 차단 시 signInWithPopup 자체가 auth/popup-blocked 에러를 던짐
    const cred = await signInWithPopup(auth, provider);
    _user = cred.user;
  }
  const uid = _user?.uid;
  if (!uid) {
    const err = new Error('Google 로그인에 실패했습니다.');
    err.code = 'auth/no-user';
    throw err;
  }
  const adminSnap = await getDoc(doc(db, 'config', 'admins'));
  const uids = (adminSnap.exists() ? adminSnap.data()?.uids : null) ?? [];
  if (!uids.includes(uid)) {
    const err = new Error(
      '이 Google 계정은 관리자로 등록되어 있지 않습니다. Firebase 콘솔에서 uid를 등록해 주세요.',
    );
    err.code = 'auth/not-admin';
    err.attemptedUid = uid;
    err.attemptedEmail = _user?.email || null;
    throw err;
  }
  return uid;
}

/** 관리자 로그아웃 — 전역 auth 상태를 초기화. 이후 새 탭에서 자동 익명 로그인. */
export async function signOutAdmin() {
  try { await signOut(auth); } finally { _user = null; }
}

export function isConfigPlaceholder() {
  return !firebaseConfig.apiKey || firebaseConfig.apiKey === 'YOUR_API_KEY';
}
