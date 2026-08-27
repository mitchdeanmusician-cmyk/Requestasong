# Song Requests App

A live song-request app for gigs, backed by Firebase (Firestore) so it works as a real
standalone website — no Claude.ai required.

This guide assumes no prior experience with any of this. Follow it top to bottom.

---

## 1. Install Node.js (one-time)

Download and install Node.js from **https://nodejs.org** (choose the "LTS" version).
This gives you the `npm` command you'll use below.

To check it worked, open a terminal (on Mac: Terminal app; on Windows: Command Prompt
or PowerShell) and type:

```
node -v
npm -v
```

You should see version numbers, not an error.

---

## 2. Get this project onto your computer

Unzip the folder you downloaded, and open a terminal **inside that folder**
(on Mac, you can right-click the folder → "New Terminal at Folder"; on Windows,
type `cmd` into the folder's address bar and press Enter).

Then install all the project's dependencies:

```
npm install
```

This creates a `node_modules` folder — that's normal, leave it alone.

---

## 3. Connect your Firebase project

You said you already have a Firebase project — good. You just need to plug its
config into this project:

1. Go to the [Firebase Console](https://console.firebase.google.com), open your project.
2. Click the gear icon → **Project settings**.
3. Scroll to **"Your apps"**. If you don't have a Web app yet, click the `</>` icon to
   create one (you don't need Hosting — just register the app).
4. You'll see a code block with `apiKey`, `authDomain`, etc. Copy those values.
5. Open **`src/firebase.js`** in this project and paste your values into the
   `firebaseConfig` object at the top. It's safe for these to be public/committed —
   they're not secret keys.

### Turn on Firestore

In the Firebase Console sidebar: **Build → Firestore Database → Create database**.
Choose **Production mode** (we'll set rules below), pick any region, and create it.

### Set Firestore security rules

Still in Firestore, go to the **Rules** tab and replace the contents with:

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

**What this means:** anyone with your Firestore project ID could read or write this
one collection. That's expected for a no-login app like this one — the setlist and
requests are meant to be publicly writable (that's how strangers send you requests).
Don't reuse this Firebase project for anything sensitive, and don't widen these rules
beyond the `pubSongRequests` collection.

---

## 4. Test it locally

```
npm run dev
```

This prints a `localhost` URL — open it in your browser. You should see the app.
Try uploading a CSV setlist and starting a session to confirm Firestore is actually
connected (check the Firestore Console — you should see documents appearing under
a `pubSongRequests` collection).

Press `Ctrl+C` in the terminal to stop the local server when you're done testing.

---

## 5. Put it on GitHub

1. Create a new repository on GitHub (e.g. `pub-song-requests`).
2. Open **`vite.config.js`** in this project and set `base` to match your repo name
   exactly — see the comment in that file for details.
3. Push this project to that repository. If you're not familiar with git commands,
   GitHub's own "Add file → Upload files" button in the browser works fine for a
   first upload too — just drag in everything except the `node_modules` folder.

If you're using git from the terminal instead:

```
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git
git push -u origin main
```

---

## 6. Deploy to GitHub Pages

From inside the project folder:

```
npm run deploy
```

This builds the app and pushes it to a `gh-pages` branch automatically.

Then on GitHub: go to your repo → **Settings → Pages**, and under "Build and
deployment", set **Source** to "Deploy from a branch", branch **`gh-pages`**, folder
**`/ (root)`**. Save.

After a minute or two, your site will be live at:

```
https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/
```

Whenever you make changes later, just run `npm run deploy` again to push an update.

---

## 7. Your QR code

Once the site above is live, paste that URL into any free QR code generator (e.g.
qr-code-generator.com) and print the result — that's the one you hand out at gigs.
The in-app "Share your app" QR feature in Settings isn't needed for this setup;
it was built for a different hosting scenario. Feel free to ignore it.

---

## Notes on how data is stored

- **Shared data** (setlist, live requests, session stats, history, fire reactions) —
  stored in Firestore, so every device sees the same live data instantly.
- **Personal data** (your device's mute-alerts setting, which songs you've
  personally requested, your fire-reaction history) — stored in this browser's
  `localStorage`, so it stays local to each device and never leaves it.
