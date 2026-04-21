// Firebase 웹 config — 사용자가 직접 주입해야 함.
// 1) https://console.firebase.google.com 에서 프로젝트 생성
// 2) Firestore (asia-northeast3 Seoul) + Authentication(Anonymous) 활성화
// 3) 웹앱 등록 후 받은 config 객체를 아래 변수에 붙여넣기
// 자세한 절차는 README.md 참고.

export const firebaseConfig = {
  apiKey: "AIzaSyDFP9_RpkeWtT9jdpaJmhCkFxdcQYM6zlo",
  authDomain: "krri-hwpx.firebaseapp.com",
  projectId: "krri-hwpx",
  storageBucket: "krri-hwpx.firebasestorage.app",
  messagingSenderId: "800187991603",
  appId: "1:800187991603:web:f22e3a38be36b570a08546"
};

export const DEFAULT_ORG_NAME = "[철도AI융합연구실]";
