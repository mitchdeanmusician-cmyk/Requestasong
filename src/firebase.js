// Firebase Realtime Database — shared storage for host + audience phones.
//
// SETUP (one-time):
// 1. Go to https://console.firebase.google.com → Create project
// 2. Add a Web app → copy the firebaseConfig object
// 3. Build → Realtime Database → Create database (start in test mode for setup)
// 4. Paste your config values below (or use env vars with Vite: VITE_FIREBASE_*)
// 5. Rules (Database → Rules) — for a simple gig app you can use:
//
//    {
//      "rules": {
//        "pubreq": {
//          ".read": true,
//          ".write": true
//        }
//      }
//    }
//
//    (Anyone with the link can read/write. Fine for a trusted gig; lock down later.)

import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "YOUR_API_KEY",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "YOUR_PROJECT.firebaseapp.com",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "YOUR_PROJECT_ID",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "YOUR_PROJECT.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "YOUR_SENDER_ID",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "YOUR_APP_ID",
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);

export function isFirebaseConfigured() {
  return (
    firebaseConfig.apiKey &&
    firebaseConfig.apiKey !== "YOUR_API_KEY" &&
    firebaseConfig.databaseURL &&
    !firebaseConfig.databaseURL.includes("YOUR_PROJECT")
  );
}
