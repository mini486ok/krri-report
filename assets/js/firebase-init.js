import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getAuth, signInAnonymously, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
  getFirestore, serverTimestamp, Timestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export { serverTimestamp, Timestamp };

let _uid = null;
const _authWaiters = [];

onAuthStateChanged(auth, (user) => {
  _uid = user?.uid ?? null;
  if (_uid) {
    while (_authWaiters.length) _authWaiters.shift()(_uid);
  }
});

export async function ensureSignedIn({ timeoutMs = 10000 } = {}) {
  if (_uid) return _uid;
  // 10초 타임아웃을 걸어 hang 상태를 에러로 변환
  const waitUid = new Promise((resolve) => _authWaiters.push(resolve));
  const timeout = new Promise((_, reject) => setTimeout(() => {
    const err = new Error('Firebase 인증 응답이 ' + (timeoutMs / 1000) + '초 내에 오지 않았습니다. (네트워크/방화벽/API 설정 확인)');
    err.code = 'auth/timeout';
    reject(err);
  }, timeoutMs));

  try {
    // signInAnonymously 와 auth-state 대기 중 먼저 끝나는 쪽을 사용
    const signInP = signInAnonymously(auth).catch((e) => { throw e; });
    await Promise.race([signInP, waitUid, timeout]);
  } catch (e) {
    console.error('익명 로그인 실패', e);
    throw e;
  }
  if (_uid) return _uid;
  // 여기 도달 시 signInAnonymously는 끝났으나 onAuthStateChanged가 아직 안 온 상태
  return Promise.race([waitUid, timeout]);
}

export function isConfigPlaceholder() {
  return !firebaseConfig.apiKey || firebaseConfig.apiKey === 'YOUR_API_KEY';
}
