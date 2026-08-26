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
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyD99oOtXH3upbkGqZV6HcSsMDtcLcsyhMU",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "realtime-database-b556c.firebaseapp.com",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://realtime-database-b556c-default-rtdb.firebaseio.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "realtime-database-b556c",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "realtime-database-b556c.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "936320602614",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:936320602614:web:c2917d110287c188cc37d7",
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
