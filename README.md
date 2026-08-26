# Finding Light — Song Requests

Live song-request app for gigs. Audience scans a QR code, searches the setlist, and sends requests. Host manages the queue with a PIN.

Data is shared across phones via **Firebase Realtime Database**.

---

## 1. Create a Firebase project (one-time)

1. Open [Firebase Console](https://console.firebase.google.com) → **Add project**.
2. **Build → Realtime Database → Create database**
   - Pick a region close to you.
   - Start in **test mode** for setup (you can tighten rules later).
3. **Project settings** (gear) → **Your apps** → **Web** (`</>`) → register app.
   Copy the `firebaseConfig` values.
4. **Realtime Database → Rules** — for a simple gig, use:

```json
{
  "rules": {
    "pubreq": {
      ".read": true,
      ".write": true
    }
  }
}
```

Anyone with the site link can read/write. Fine for a trusted room; lock down later if needed.

5. In this project folder, create `.env.local`:

```bash
cp .env.example .env.local
```

Paste your values into `.env.local` (see `.env.example` for the variable names).

---

## 2. Run locally

```bash
npm install
npm run dev
```

1. Tap **Musician? Tap here to manage** → set PIN and band name.
2. **Setlist** → add songs or upload CSV.
3. **Requests** → **Start session**.
4. On another phone, open the same URL → request a song. Host should see it live.

---

## 3. Push to GitHub

### A. Create the repo on GitHub

1. Go to https://github.com/new
2. Name: e.g. `finding-light-requests`
3. Public → **Create repository** (skip adding a README if this folder already has one)

### B. Push this folder from your computer

Open a terminal **in this project folder**:

```bash
git init
git add .
git commit -m "Finding Light song requests app"

git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/finding-light-requests.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username.

If GitHub asks for a password, use a **Personal Access Token**  
(GitHub → Settings → Developer settings → Personal access tokens), not your account password.

### C. Turn on GitHub Pages

1. Repo → **Settings → Pages**
2. **Source:** GitHub Actions
3. Open the **Actions** tab and wait for the deploy workflow to finish
4. Your site:

```text
https://YOUR_USERNAME.github.io/finding-light-requests/
```

### D. Firebase on the live site

Vite bakes env vars in at **build** time. Add secrets so GitHub Actions can build with Firebase:

1. Repo → **Settings → Secrets and variables → Actions**
2. **New repository secret** for each:

   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_DATABASE_URL`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`

3. Re-run the workflow (**Actions → Deploy → Re-run**) or push a small commit.

4. Make a QR code from your Pages URL and print it for the gig.

---

## Host flow at a gig

1. Open the site → **Musician? Tap here to manage** → enter PIN
2. Load **Setlist**
3. **Start session**
4. Audience scans QR → sends requests
5. Mark songs done as you play them
6. **End session & see stats**
