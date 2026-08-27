// ---------------------------------------------------------------------------
// PASTE YOUR FIREBASE CONFIG BELOW
// ---------------------------------------------------------------------------
// Get this from: Firebase Console -> Project Settings -> General ->
// "Your apps" -> Web app -> SDK setup and configuration -> Config
//
// It is safe for these values to be public / committed to GitHub. Firebase
// client config keys are not secrets — access control is handled by your
// Firestore Security Rules (see README.md), not by hiding this object.
// ---------------------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyD99oOtXH3upbkGqZV6HcSsMDtcLcsyhMU",
  authDomain: "realtime-database-b556c.firebaseapp.com",
  databaseURL: "https://realtime-database-b556c-default-rtdb.firebaseio.com",
  projectId: "realtime-database-b556c",
  storageBucket: "realtime-database-b556c.firebasestorage.app",
  messagingSenderId: "936320602614",
  appId: "1:936320602614:web:c2917d110287c188cc37d7",
};

import { initializeApp } from "firebase/app";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
} from "firebase/firestore";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// All shared (cross-device) data lives in one Firestore collection, one
// document per data key. Each document just holds a single "value" field
// containing whatever JSON-serializable data that key needs (an object,
// array, etc.) — this mirrors the original key/value storage shape closely
// so the rest of the app didn't need to change.
const COLLECTION = "pubSongRequests";

export async function readShared(key, fallback) {
  try {
    const snap = await getDoc(doc(db, COLLECTION, key));
    return snap.exists() ? snap.data().value : fallback;
  } catch (e) {
    console.error("Firestore read failed", key, e);
    return fallback;
  }
}

export async function writeShared(key, value) {
  try {
    await setDoc(doc(db, COLLECTION, key), { value });
  } catch (e) {
    console.error("Firestore write failed", key, e);
  }
}

// Subscribe to live updates for one key. Calls `callback(value)` immediately
// with the current value, then again every time it changes (from any device).
// Returns an unsubscribe function — call it on cleanup.
export function subscribeShared(key, fallback, callback) {
  return onSnapshot(
    doc(db, COLLECTION, key),
    (snap) => callback(snap.exists() ? snap.data().value : fallback),
    (err) => console.error("Firestore subscribe failed", key, err)
  );
}

// Personal (per-device) data never needs to sync between devices, so it just
// lives in this browser's localStorage instead of Firestore.
export function readPersonal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function writePersonal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error("localStorage write failed", key, e);
  }
}
