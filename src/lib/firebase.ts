import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyDEE6uvS0wByEw_q-6p-gScZn1eayojmWQ",
  authDomain: "call-monitor-cf6bc.firebaseapp.com",
  projectId: "call-monitor-cf6bc",
  storageBucket: "call-monitor-cf6bc.firebasestorage.app",
  messagingSenderId: "435047242169",
  appId: "1:435047242169:web:e823ec796ecb307efbbe68"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const db = getFirestore(app);
export const storage = getStorage(app);
export default app;
