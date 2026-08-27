# Song Requests App

A live song-request app for gigs, backed by Firebase (Firestore). This guide does
**everything through the GitHub website** — no terminal, no installing anything on
your computer. GitHub builds the app for you automatically in the cloud.

> **Already deployed once and the site looked unstyled/basic?** That was a missing
> piece (Tailwind CSS wasn't set up) — this version fixes it. Just re-upload
> everything in this folder over your existing files on GitHub (Add file → Upload
> files, same as before) and commit. The Actions workflow will rebuild
> automatically with the fix included.

---

## 1. Edit one file before uploading: your Firebase config

1. On your computer, open the file **`src/firebase.js`** from this folder in any
   plain text editor (Notepad, TextEdit, VS Code — anything that opens `.js` files
   as text).
2. Go to the [Firebase Console](https://console.firebase.google.com), open your
   project → gear icon → **Project settings** → scroll to **"Your apps"**.
   If you don't have a Web app registered yet, click the `</>` icon to create one.
3. Copy the `apiKey`, `authDomain`, `projectId`, etc. shown there, and paste them
   into the `firebaseConfig` object at the top of `src/firebase.js`, replacing the
   placeholder text.
4. Save the file.

(It's fine for these values to be public — they're not secret keys. Access control
is handled by Firestore's security rules, set up in step 3 below.)

**Note:** `vite.config.js` is already set up correctly for your repo name
(`Requestasong`) — you don't need to touch it.

---

## 2. Upload the project to GitHub

1. Go to your repository on GitHub (`Requestasong`).
2. Click **Add file → Upload files**.
3. Drag your entire project folder's contents into the upload box — all of it:
   `package.json`, `vite.config.js`, `index.html`, the `src` folder, and the
   `.github` folder (this one is hidden by default on some computers — see the
   note below if you don't see it).
4. Scroll down and click **Commit changes**.

**If you can't see the `.github` folder to drag it in:** it's a hidden folder.
On Mac, press `Cmd+Shift+.` in Finder to reveal hidden files/folders. On Windows,
in File Explorer go to View → Show → Hidden items. If it's still tricky, you can
create it by hand on GitHub instead: click **Add file → Create new file**, and
for the filename type the full path `.github/workflows/deploy.yml` (GitHub will
create the folders automatically) — then paste in the contents of that file from
your project, and commit.

---

## 3. Turn on Firestore and set security rules

In the [Firebase Console](https://console.firebase.google.com), open your project:

1. Sidebar → **Build → Firestore Database → Create database**. Choose
   **Production mode**, pick any region, create it.
2. Go to the **Rules** tab and replace the contents with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /pubSongRequests/{document=**} {
      allow read, write: if true;
    }
  }
}
```

**What this means:** anyone with your Firebase project details could read or write
this one collection. That's expected for a no-login app like this — the setlist
and requests are meant to be publicly writable (that's how strangers send you
requests). Don't reuse this Firebase project for anything sensitive.

---

## 4. Turn on GitHub Pages (via GitHub Actions)

1. In your repo: **Settings → Pages**.
2. Under "Build and deployment", set **Source** to **"GitHub Actions"**
   (not "Deploy from a branch" — that's a different method).
3. That's it — no need to select a branch here, the workflow file you uploaded
   handles it.

---

## 5. Watch it build

1. Click the **Actions** tab at the top of your repo.
2. You should see a workflow run in progress (yellow dot), then a green checkmark
   once it finishes — this usually takes 1–2 minutes.
3. Once it's green, go back to **Settings → Pages** — you'll see your live URL:

```
https://mitchdeanmusician-cmyk.github.io/Requestasong/
```

Open it. You should now see the actual app, not the README.

---

## 6. Making changes later

Any time you want to update the site (new code, settings, anything), just upload
the changed file(s) again the same way (**Add file → Upload files**, or edit a
file directly on GitHub using the pencil icon), and commit. The Actions workflow
re-runs automatically and republishes the updated site within a couple of minutes.
You can watch it happen in the **Actions** tab.

---

## Your QR code

Once the site above is live, paste that URL into any free QR code generator (e.g.
qr-code-generator.com) and print the result — that's the one you hand out at gigs.
The in-app "Share your app" QR feature in Settings isn't needed for this setup.

---

## Notes on how data is stored

- **Shared data** (setlist, live requests, session stats, history, fire reactions) —
  stored in Firestore, so every device sees the same live data instantly.
- **Personal data** (your device's mute-alerts setting, which songs you've
  personally requested, your fire-reaction history) — stored in this browser's
  `localStorage`, so it stays local to each device and never leaves it.

---

## (Optional) Prefer a local terminal instead?

If you ever do want to work locally with Node.js instead of the browser-only
method above, this project also supports that — see the comments in
`package.json` (`npm install`, `npm run dev`, `npm run deploy`). Not required
for the GitHub Actions method above.
