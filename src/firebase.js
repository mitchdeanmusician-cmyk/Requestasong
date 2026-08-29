// ---------------------------------------------------------------------------
// YOUR FIREBASE CONFIG
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
  measurementId: "G-4JB1793QFR",
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

// ---------------------------------------------------------------------------
// MULTIPLE MUSICIANS ON ONE DEPLOYED SITE
// ---------------------------------------------------------------------------
// Two (or more) people can share this exact deployed website and Firebase
// project, each with their own completely separate setlist, requests, PIN,
// theme, etc. They're kept apart by a "profile" name in the URL:
//
//   https://yoursite.com/?profile=mitch
//   https://yoursite.com/?profile=alex
//
// Each person should use their own consistent link (and QR code) with their
// own profile name. Visiting a profile name for the first time is exactly
// like a fresh install — it'll ask that person to do the one-time setup
// (band name, PIN, etc.) for their own profile.
//
// If no ?profile= is in the URL, everyone lands on a shared profile called
// "default" — perfectly fine for a solo user, just make sure two different
// people don't both accidentally use plain links with no ?profile= on them,
// or they'll end up looking at (and editing!) the same data.
// ---------------------------------------------------------------------------
const params = new URLSearchParams(window.location.search);
export const PROFILE =
  (params.get("profile") || "default").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "default";

function scopedKey(key) {
  return `${PROFILE}__${key}`;
}

// All shared (cross-device) data lives in one Firestore collection, one
// document per data key (scoped to the current profile). Each document just
// holds a single "value" field containing whatever JSON-serializable data
// that key needs (an object, array, etc.).
const COLLECTION = "pubSongRequests";

export async function readShared(key, fallback) {
  try {
    const snap = await getDoc(doc(db, COLLECTION, scopedKey(key)));
    return snap.exists() ? snap.data().value : fallback;
  } catch (e) {
    console.error("Firestore read failed", key, e);
    return fallback;
  }
}

export async function writeShared(key, value) {
  try {
    await setDoc(doc(db, COLLECTION, scopedKey(key)), { value });
  } catch (e) {
    console.error("Firestore write failed", key, e);
  }
}

// Subscribe to live updates for one key. Calls `callback(value)` immediately
// with the current value, then again every time it changes (from any device).
// Returns an unsubscribe function — call it on cleanup.
export function subscribeShared(key, fallback, callback) {
  return onSnapshot(
    doc(db, COLLECTION, scopedKey(key)),
    (snap) => callback(snap.exists() ? snap.data().value : fallback),
    (err) => console.error("Firestore subscribe failed", key, err)
  );
}

// "Global" data is NOT scoped per-profile — it's shared across every profile
// on this site. Used for things like the list of known profiles, so everyone
// can see and switch between them.
export async function readGlobal(key, fallback) {
  try {
    const snap = await getDoc(doc(db, COLLECTION, `global__${key}`));
    return snap.exists() ? snap.data().value : fallback;
  } catch (e) {
    console.error("Firestore global read failed", key, e);
    return fallback;
  }
}

export async function writeGlobal(key, value) {
  try {
    await setDoc(doc(db, COLLECTION, `global__${key}`), { value });
  } catch (e) {
    console.error("Firestore global write failed", key, e);
  }
}

export function subscribeGlobal(key, fallback, callback) {
  return onSnapshot(
    doc(db, COLLECTION, `global__${key}`),
    (snap) => callback(snap.exists() ? snap.data().value : fallback),
    (err) => console.error("Firestore global subscribe failed", key, err)
  );
}

// Personal (per-device) data never needs to sync between devices, so it just
// lives in this browser's localStorage instead of Firestore. Still scoped by
// profile, in case the same device is ever used to test more than one.
export function readPersonal(key, fallback) {
  try {
    const raw = localStorage.getItem(scopedKey(key));
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function writePersonal(key, value) {
  try {
    localStorage.setItem(scopedKey(key), JSON.stringify(value));
  } catch (e) {
    console.error("localStorage write failed", key, e);
  }
}
