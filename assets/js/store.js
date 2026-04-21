// Firestore repository. onSnapshot 구독 + 간단 CRUD.
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { db, serverTimestamp } from './firebase-init.js';
import { uuid } from './util/download.js';
import { DEFAULT_ORG_NAME } from './firebase-config.js';

export const DEFAULT_CATEGORIES = [
  { kind: 'basic', title: '철도 운영 및 유지관리 고도화를 위한 디지털 트윈 플랫폼 핵심 기술 개발', owner: '박정준' },
  { kind: 'basic', title: 'AX 기반 철도교통 현안 분석 지원 기술 개발', owner: '이상근' },
  { kind: 'basic', title: 'AI 및 디지털 대전환을 위한 첨단 모빌리티 허브 핵심기술 개발', owner: '유승민' },
  { kind: 'consign', title: '(국가철도공단)철도 유지관리 단계 BIM 시범적용 연구용역', owner: '김현기' },
  { kind: 'etc', title: '기타', owner: '' },
];

export function kindLabelKor(kind) {
  return ({ basic: '기본사업', consign: '수탁사업', etc: '기타' })[kind] ?? kind;
}

// ───── config/authors ─────
const authorsRef = doc(db, 'config', 'authors');
export function subscribeAuthors(cb) {
  return onSnapshot(authorsRef, (snap) => {
    cb(snap.exists() ? (snap.data().members ?? []) : []);
  });
}
export async function setAuthors(members) {
  await setDoc(authorsRef, { members, updatedAt: serverTimestamp() }, { merge: true });
}
export async function addAuthor(name) {
  const snap = await getDoc(authorsRef);
  const members = snap.exists() ? [...(snap.data().members ?? [])] : [];
  if (members.some(m => m.name === name)) return;
  members.push({ id: uuid(), name, createdAt: new Date().toISOString() });
  await setAuthors(members);
}
export async function removeAuthor(id) {
  const snap = await getDoc(authorsRef);
  const members = snap.exists() ? (snap.data().members ?? []) : [];
  await setAuthors(members.filter(m => m.id !== id));
}

// ───── config/categories ─────
const categoriesRef = doc(db, 'config', 'categories');
export function subscribeCategories(cb) {
  return onSnapshot(categoriesRef, (snap) => {
    cb(snap.exists() ? (snap.data().items ?? []) : []);
  });
}
export async function setCategories(items) {
  await setDoc(categoriesRef, { items, updatedAt: serverTimestamp() }, { merge: true });
}
export async function seedDefaultCategories() {
  const items = DEFAULT_CATEGORIES.map((c, i) => ({
    id: uuid(), kind: c.kind, title: c.title, owner: c.owner,
    isDefault: true, order: i,
  }));
  await setCategories(items);
}
export async function addCategory(data) {
  const snap = await getDoc(categoriesRef);
  const items = snap.exists() ? [...(snap.data().items ?? [])] : [];
  items.push({ id: uuid(), isDefault: false, order: items.length, ...data });
  await setCategories(items);
}
export async function updateCategory(id, patch) {
  const snap = await getDoc(categoriesRef);
  const items = snap.exists() ? (snap.data().items ?? []) : [];
  await setCategories(items.map(i => i.id === id ? { ...i, ...patch } : i));
}
export async function removeCategory(id) {
  const snap = await getDoc(categoriesRef);
  const items = snap.exists() ? (snap.data().items ?? []) : [];
  await setCategories(items.filter(i => i.id !== id));
}

// ───── config/current ─────
const currentRef = doc(db, 'config', 'current');
export function subscribeCurrent(cb) {
  return onSnapshot(currentRef, (snap) => cb(snap.exists() ? snap.data() : { roundId: null }));
}

// ───── rounds ─────
const roundsCol = collection(db, 'rounds');
export function roundRef(roundId) { return doc(db, 'rounds', roundId); }
export function subscribeRound(roundId, cb) {
  return onSnapshot(roundRef(roundId), (snap) => cb(snap.exists() ? snap.data() : null));
}
export function subscribeRoundList(cb) {
  return onSnapshot(query(roundsCol, orderBy('confirmedAt', 'desc')), (qs) => {
    cb(qs.docs.map(d => ({ ...d.data(), id: d.id })));
  });
}

export async function createAndConfirmRound(params) {
  // params: { form, baseDate, rangeStart, rangeEnd, nextRangeStart, nextRangeEnd,
  //           orgName, authors, categories }
  const roundId = `${(params.baseDate || '').replace(/-/g, '')}-${params.form}-${Math.random().toString(36).slice(2,6)}`;
  const batch = writeBatch(db);

  // 기존 활성 회차를 archived 로
  const currentSnap = await getDoc(currentRef);
  const prevRoundId = currentSnap.exists() ? currentSnap.data().roundId : null;
  if (prevRoundId) {
    batch.update(roundRef(prevRoundId), {
      status: 'archived',
      archivedAt: serverTimestamp(),
    });
  }

  // 새 round 문서
  batch.set(roundRef(roundId), {
    form: params.form,
    baseDate: params.baseDate,
    rangeStart: params.rangeStart,
    rangeEnd: params.rangeEnd,
    nextRangeStart: params.nextRangeStart,
    nextRangeEnd: params.nextRangeEnd,
    orgName: params.orgName || DEFAULT_ORG_NAME,
    authorsSnapshot: params.authors,
    categoriesSnapshot: params.categories,
    status: 'active',
    confirmedAt: serverTimestamp(),
  });

  // 각 작성자 submission 초기화
  for (const a of params.authors) {
    const subRef = doc(db, 'rounds', roundId, 'submissions', a.id);
    batch.set(subRef, {
      authorId: a.id,
      authorName: a.name,
      entries: { past: [], next: [] },
      status: 'idle',
      lastSavedAt: serverTimestamp(),
    });
  }

  // current 포인터 교체
  batch.set(currentRef, { roundId, updatedAt: serverTimestamp() });

  await batch.commit();
  return roundId;
}

export async function archiveCurrentRound() {
  const currentSnap = await getDoc(currentRef);
  if (!currentSnap.exists()) return;
  const rid = currentSnap.data().roundId;
  if (!rid) return;
  const batch = writeBatch(db);
  batch.update(roundRef(rid), { status: 'archived', archivedAt: serverTimestamp() });
  batch.set(currentRef, { roundId: null, updatedAt: serverTimestamp() });
  await batch.commit();
}

// ───── submissions ─────
export function submissionRef(roundId, authorId) {
  return doc(db, 'rounds', roundId, 'submissions', authorId);
}
export function subscribeSubmissions(roundId, cb) {
  const col = collection(db, 'rounds', roundId, 'submissions');
  return onSnapshot(col, (qs) => cb(qs.docs.map(d => ({ ...d.data(), _id: d.id }))));
}
export async function getAllSubmissions(roundId) {
  const col = collection(db, 'rounds', roundId, 'submissions');
  const qs = await getDocs(col);
  return qs.docs.map(d => ({ ...d.data(), _id: d.id }));
}
export async function saveDraft(roundId, authorId, payload) {
  const ref = submissionRef(roundId, authorId);
  const snap = await getDoc(ref);
  const cur = snap.exists() ? snap.data() : {};
  if (cur.status === 'submitted') throw new Error('이미 최종 제출되어 수정할 수 없습니다. 관리자에게 해제를 요청하세요.');
  await setDoc(ref, {
    ...cur,
    ...payload,
    status: 'draft',
    lastSavedAt: serverTimestamp(),
  }, { merge: true });
}
export async function finalSubmit(roundId, authorId, payload) {
  const ref = submissionRef(roundId, authorId);
  const snap = await getDoc(ref);
  const cur = snap.exists() ? snap.data() : {};
  if (cur.status === 'submitted') return;
  await setDoc(ref, {
    ...cur,
    ...payload,
    status: 'submitted',
    lastSavedAt: serverTimestamp(),
    submittedAt: serverTimestamp(),
  }, { merge: true });
}
export async function unlockSubmission(roundId, authorId) {
  await updateDoc(submissionRef(roundId, authorId), {
    status: 'draft',
    submittedAt: null,
  });
}
