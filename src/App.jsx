import { useState, useEffect, useRef, useCallback } from "react";
import Papa from "papaparse";
import {
  Music2,
  AtSign,
  HeartHandshake,
  Search,
  Check,
  X,
  Upload,
  Settings,
  LogOut,
  Plus,
  Trash2,
  ListMusic,
  Inbox,
  KeyRound,
  ChevronRight,
  ChevronDown,
  Loader2,
} from "lucide-react";
import { ref, get, set, onValue } from "firebase/database";
import { db, isFirebaseConfigured } from "./firebase";

// ---------- storage helpers ----------
// Priority: 1) Firebase (shared across all phones)  2) platform window.storage
//           3) localStorage (single-device only)
const KEYS = {
  config: "pubreq:config",
  songs: "pubreq:songs",
  requests: "pubreq:requests",
  sessionStats: "pubreq:sessionStats",
};

// Firebase paths (no colons)
const FB_PATH = {
  config: "pubreq/config",
  songs: "pubreq/songs",
  requests: "pubreq/requests",
  sessionStats: "pubreq/sessionStats",
};

const EMPTY_STATS = { songCounts: {}, missed: {} };

function fbPathFor(key) {
  if (key === KEYS.config) return FB_PATH.config;
  if (key === KEYS.songs) return FB_PATH.songs;
  if (key === KEYS.requests) return FB_PATH.requests;
  if (key === KEYS.sessionStats) return FB_PATH.sessionStats;
  return `pubreq/${key.replace(/:/g, "/")}`;
}

/** Firebase sometimes stores arrays as objects with numeric keys */
function asArray(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") return Object.values(v);
  return [];
}

async function readShared(key, fallback) {
  try {
    if (isFirebaseConfigured()) {
      const snap = await get(ref(db, fbPathFor(key)));
      if (!snap.exists()) return fallback;
      const val = snap.val();
      if (key === KEYS.songs || key === KEYS.requests) return asArray(val);
      return val;
    }
    if (typeof window !== "undefined" && window.storage) {
      const res = await window.storage.get(key, true);
      return res ? JSON.parse(res.value) : fallback;
    }
    const raw = localStorage.getItem(key);
    return raw != null ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error("storage read failed", e);
    return fallback;
  }
}

async function writeShared(key, value) {
  try {
    if (isFirebaseConfigured()) {
      await set(ref(db, fbPathFor(key)), value);
      return;
    }
    if (typeof window !== "undefined" && window.storage) {
      await window.storage.set(key, JSON.stringify(value), true);
      return;
    }
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error("storage write failed", e);
  }
}

/** Subscribe to live Firebase updates; returns unsubscribe fn or null */
function subscribeShared(key, onData) {
  if (!isFirebaseConfigured()) return null;
  const r = ref(db, fbPathFor(key));
  return onValue(
    r,
    (snap) => {
      if (snap.exists()) onData(snap.val());
    },
    (err) => console.error("subscribe failed", err)
  );
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

const DEFAULT_CONFIG = {
  bandName: "Finding Light",
  personalInstagram: "",
  bandInstagram: "",
  tipLink: "",
  pin: "",
  setUp: false,
  requestsOpen: false,
  sessionActive: false,
  sessionStartedAt: null,
};

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function normalizeUrl(url) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

function instaUrl(handle) {
  if (!handle) return "";
  const cleaned = handle
    .trim()
    .replace(/^@/, "")
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/\/$/, "");
  return `https://instagram.com/${cleaned}`;
}

function groupByGenre(songs) {
  const map = new Map();
  for (const song of songs) {
    const genre = (song.genre || "").trim() || "Other";
    if (!map.has(genre)) map.set(genre, []);
    map.get(genre).push(song);
  }
  const genres = [...map.keys()].sort((a, b) => {
    if (a === "Other") return 1;
    if (b === "Other") return -1;
    return a.localeCompare(b);
  });
  return genres.map((genre) => ({ genre, songs: map.get(genre) }));
}

export default function App() {
  const [config, setConfig] = useState(null);
  const [songs, setSongs] = useState(null);
  const [requests, setRequests] = useState(null);
  const [view, setView] = useState("audience"); // audience | hostLogin | hostSetup | host
  const [loaded, setLoaded] = useState(false);

  // audience state
  const [query, setQuery] = useState("");
  const [activeSong, setActiveSong] = useState(null);
  const [reqName, setReqName] = useState("");
  const [reqNote, setReqNote] = useState("");
  const [sendState, setSendState] = useState("idle"); // idle | sending | sent
  const [toast, setToast] = useState(null);
  const [sessionRecap, setSessionRecap] = useState(null);

  // host state
  const [pinInput, setPinInput] = useState("");
  const [loginError, setLoginError] = useState("");
  const [hostTab, setHostTab] = useState("requests");
  const [showDone, setShowDone] = useState(false);
  const fileInputRef = useRef(null);
  const [csvError, setCsvError] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [manualArtist, setManualArtist] = useState("");
  const [manualGenre, setManualGenre] = useState("");
  const [setupBand, setSetupBand] = useState("");
  const [setupPersonalInsta, setSetupPersonalInsta] = useState("");
  const [setupBandInsta, setSetupBandInsta] = useState("");
  const [setupTip, setSetupTip] = useState("");
  const [setupPin, setSetupPin] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  // load initial
  useEffect(() => {
    (async () => {
      const [c, s, r] = await Promise.all([
        readShared(KEYS.config, DEFAULT_CONFIG),
        readShared(KEYS.songs, []),
        readShared(KEYS.requests, []),
      ]);
      setConfig(c);
      setSongs(s);
      setRequests(r);
      setLoaded(true);
    })();
  }, []);

  // Live updates: Firebase realtime when configured, otherwise poll every 4s
  useEffect(() => {
    if (!loaded) return;

    if (isFirebaseConfigured()) {
      const unsubs = [
        subscribeShared(KEYS.config, (v) => setConfig(v || DEFAULT_CONFIG)),
        subscribeShared(KEYS.songs, (v) => setSongs(asArray(v))),
        subscribeShared(KEYS.requests, (v) => setRequests(asArray(v))),
      ].filter(Boolean);
      return () => unsubs.forEach((u) => u && u());
    }

    const iv = setInterval(async () => {
      const [c, s, r] = await Promise.all([
        readShared(KEYS.config, DEFAULT_CONFIG),
        readShared(KEYS.songs, []),
        readShared(KEYS.requests, []),
      ]);
      setConfig(c);
      setSongs(s);
      setRequests(r);
    }, 4000);
    return () => clearInterval(iv);
  }, [loaded]);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 2600);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const filteredSongs = (songs || []).filter((s) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      s.title.toLowerCase().includes(q) || (s.artist || "").toLowerCase().includes(q)
    );
  });

  // log searches that come up empty while a session is live, debounced so we
  // don't log on every keystroke
  useEffect(() => {
    if (!loaded || !config?.sessionActive) return;
    const q = query.trim();
    if (!q || (songs || []).length === 0 || filteredSongs.length > 0) return;
    const t = setTimeout(async () => {
      const stats = await readShared(KEYS.sessionStats, EMPTY_STATS);
      const key = q.toLowerCase();
      const existing = stats.missed[key] || { query: q, count: 0 };
      existing.count += 1;
      stats.missed[key] = existing;
      await writeShared(KEYS.sessionStats, stats);
    }, 900);
    return () => clearTimeout(t);
  }, [query, loaded, config?.sessionActive, filteredSongs.length, songs]);

  async function sendRequest() {
    if (!activeSong) return;
    const latestConfig = await readShared(KEYS.config, config);
    if (!latestConfig.sessionActive || !latestConfig.requestsOpen) {
      setActiveSong(null);
      setToast("Requests are paused right now — try again shortly");
      return;
    }
    setSendState("sending");

    const name = reqName.trim();
    const note = reqNote.trim();
    const latest = await readShared(KEYS.requests, []);
    const existingIdx = latest.findIndex(
      (r) =>
        r.status === "pending" &&
        (r.songId === activeSong.id ||
          (r.title.toLowerCase() === activeSong.title.toLowerCase() &&
            (r.artist || "").toLowerCase() === (activeSong.artist || "").toLowerCase()))
    );

    let updated;
    let bumped = false;
    if (existingIdx >= 0) {
      bumped = true;
      const existing = latest[existingIdx];
      const merged = {
        ...existing,
        count: (existing.count || 1) + 1,
        names: name ? [...(existing.names || []), name] : existing.names || [],
        notes: note ? [...(existing.notes || []), note] : existing.notes || [],
        ts: Date.now(),
      };
      updated = [...latest];
      updated[existingIdx] = merged;
    } else {
      const newReq = {
        id: uid(),
        songId: activeSong.id,
        title: activeSong.title,
        artist: activeSong.artist,
        count: 1,
        names: name ? [name] : [],
        notes: note ? [note] : [],
        ts: Date.now(),
        status: "pending",
      };
      updated = [newReq, ...latest];
    }
    await writeShared(KEYS.requests, updated);
    setRequests(updated);

    // tally for end-of-session stats
    const stats = await readShared(KEYS.sessionStats, EMPTY_STATS);
    const statKey = `${activeSong.title.toLowerCase()}||${(activeSong.artist || "").toLowerCase()}`;
    const cur = stats.songCounts[statKey] || { title: activeSong.title, artist: activeSong.artist, count: 0 };
    cur.count += 1;
    stats.songCounts[statKey] = cur;
    await writeShared(KEYS.sessionStats, stats);

    setSendState("sent");
    setTimeout(() => {
      setActiveSong(null);
      setReqName("");
      setReqNote("");
      setSendState("idle");
      setToast(bumped ? "Already on the list — pushed it up!" : "Sent to the stage");
    }, 900);
  }

  async function startSession() {
    const newConfig = {
      ...config,
      sessionActive: true,
      requestsOpen: true,
      sessionStartedAt: Date.now(),
    };
    await writeShared(KEYS.config, newConfig);
    await writeShared(KEYS.sessionStats, EMPTY_STATS);
    await writeShared(KEYS.requests, []);
    setConfig(newConfig);
    setRequests([]);
  }

  async function endSession() {
    const stats = await readShared(KEYS.sessionStats, EMPTY_STATS);
    const songCounts = Object.values(stats.songCounts).sort((a, b) => b.count - a.count);
    const missed = Object.values(stats.missed).sort((a, b) => b.count - a.count);
    setSessionRecap({ songCounts, missed });
    const newConfig = { ...config, sessionActive: false, requestsOpen: false };
    await writeShared(KEYS.config, newConfig);
    setConfig(newConfig);
  }

  async function addSongFromMissed(title) {
    const latest = await readShared(KEYS.songs, []);
    if (latest.some((s) => s.title.toLowerCase() === title.toLowerCase())) return;
    const newSong = { id: uid(), title, artist: "", genre: "" };
    const updated = [...latest, newSong];
    await writeShared(KEYS.songs, updated);
    setSongs(updated);
  }

  function tryHostEntry() {
    if (!config.setUp) {
      setSetupBand(config.bandName || "");
      setSetupPersonalInsta(config.personalInstagram || "");
      setSetupBandInsta(config.bandInstagram || "");
      setSetupTip(config.tipLink || "");
      setSetupPin("");
      setView("hostSetup");
    } else {
      setPinInput("");
      setLoginError("");
      setView("hostLogin");
    }
  }

  async function completeSetup() {
    if (setupPin.trim().length < 4) {
      setLoginError("Choose a PIN with at least 4 digits.");
      return;
    }
    const newConfig = {
      bandName: setupBand.trim() || "Finding Light",
      personalInstagram: setupPersonalInsta.trim(),
      bandInstagram: setupBandInsta.trim(),
      tipLink: setupTip.trim(),
      pin: setupPin.trim(),
      setUp: true,
      requestsOpen: false,
      sessionActive: false,
      sessionStartedAt: null,
    };
    await writeShared(KEYS.config, newConfig);
    setConfig(newConfig);
    setLoginError("");
    setHostTab("songs");
    setView("host");
  }

  function submitPin() {
    if (pinInput.trim() === config.pin) {
      setView("host");
      setLoginError("");
    } else {
      setLoginError("Wrong PIN. Try again.");
    }
  }

  async function resetPin() {
    const newConfig = { ...config, pin: "", setUp: false };
    await writeShared(KEYS.config, newConfig);
    setConfig(newConfig);
    setSetupBand(newConfig.bandName || "");
    setSetupPersonalInsta(newConfig.personalInstagram || "");
    setSetupBandInsta(newConfig.bandInstagram || "");
    setSetupTip(newConfig.tipLink || "");
    setSetupPin("");
    setLoginError("");
    setView("hostSetup");
  }

  async function markStatus(id, status) {
    const latest = await readShared(KEYS.requests, []);
    const updated = latest.map((r) => (r.id === id ? { ...r, status } : r));
    await writeShared(KEYS.requests, updated);
    setRequests(updated);
  }

  async function clearDone() {
    const latest = await readShared(KEYS.requests, []);
    const updated = latest.filter((r) => r.status !== "done");
    await writeShared(KEYS.requests, updated);
    setRequests(updated);
  }

  async function clearAllRequests() {
    await writeShared(KEYS.requests, []);
    setRequests([]);
  }

  function handleCsvUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvError("");
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const rows = results.data;
        if (!rows.length) {
          setCsvError("That file looks empty.");
          return;
        }
        const headers = Object.keys(rows[0]).map((h) => h.toLowerCase());
        const titleKey = Object.keys(rows[0]).find((h) =>
          /title|song/i.test(h)
        );
        const artistKey = Object.keys(rows[0]).find((h) => /artist|by/i.test(h));
        const genreKey = Object.keys(rows[0]).find((h) => /genre|category|style/i.test(h));

        let parsed;
        if (titleKey) {
          parsed = rows
            .map((r) => ({
              id: uid(),
              title: (r[titleKey] || "").trim(),
              artist: artistKey ? (r[artistKey] || "").trim() : "",
              genre: genreKey ? (r[genreKey] || "").trim() : "",
            }))
            .filter((s) => s.title);
        } else {
          // no header matched — treat first column as title, second as artist
          const keys = Object.keys(rows[0]);
          parsed = rows
            .map((r) => ({
              id: uid(),
              title: (r[keys[0]] || "").trim(),
              artist: keys[1] ? (r[keys[1]] || "").trim() : "",
              genre: keys[2] ? (r[keys[2]] || "").trim() : "",
            }))
            .filter((s) => s.title);
        }
        if (!parsed.length) {
          setCsvError("Couldn't find any song titles in that file.");
          return;
        }
        await writeShared(KEYS.songs, parsed);
        setSongs(parsed);
        if (fileInputRef.current) fileInputRef.current.value = "";
      },
      error: () => setCsvError("Couldn't read that file. Try a plain CSV export."),
    });
  }

  async function addManualSong() {
    if (!manualTitle.trim()) return;
    const newSong = {
      id: uid(),
      title: manualTitle.trim(),
      artist: manualArtist.trim(),
      genre: manualGenre.trim(),
    };
    const latest = await readShared(KEYS.songs, []);
    const updated = [...latest, newSong];
    await writeShared(KEYS.songs, updated);
    setSongs(updated);
    setManualTitle("");
    setManualArtist("");
    setManualGenre("");
  }

  async function removeSong(id) {
    const latest = await readShared(KEYS.songs, []);
    const updated = latest.filter((s) => s.id !== id);
    await writeShared(KEYS.songs, updated);
    setSongs(updated);
  }

  async function saveSettings() {
    setSavingSettings(true);
    const newConfig = {
      ...config,
      bandName: setupBand.trim() || config.bandName,
      personalInstagram: setupPersonalInsta.trim(),
      bandInstagram: setupBandInsta.trim(),
      tipLink: setupTip.trim(),
      pin: setupPin.trim() ? setupPin.trim() : config.pin,
    };
    await writeShared(KEYS.config, newConfig);
    setConfig(newConfig);
    setSavingSettings(false);
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 1800);
  }

  async function toggleRequestsOpen() {
    const newConfig = { ...config, requestsOpen: !config.requestsOpen };
    await writeShared(KEYS.config, newConfig);
    setConfig(newConfig);
  }

  if (!loaded || !config || !songs || !requests) {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center h-full gap-3 text-cream/70">
          <Loader2 className="animate-spin" size={28} />
          <span className="font-body text-sm tracking-wide">Tuning up…</span>
        </div>
      </Shell>
    );
  }

  const pendingCount = requests.filter((r) => r.status === "pending").length;

  return (
    <Shell>
      {view === "audience" && (
        <AudienceView
          config={config}
          songs={filteredSongs}
          totalSongs={songs.length}
          query={query}
          setQuery={setQuery}
          activeSong={activeSong}
          setActiveSong={setActiveSong}
          reqName={reqName}
          setReqName={setReqName}
          reqNote={reqNote}
          setReqNote={setReqNote}
          sendState={sendState}
          sendRequest={sendRequest}
          onHostTap={tryHostEntry}
          toast={toast}
          requests={requests}
        />
      )}

      {view === "hostSetup" && (
        <SetupView
          setupBand={setupBand}
          setSetupBand={setSetupBand}
          setupPersonalInsta={setupPersonalInsta}
          setSetupPersonalInsta={setSetupPersonalInsta}
          setupBandInsta={setupBandInsta}
          setSetupBandInsta={setSetupBandInsta}
          setupTip={setupTip}
          setSetupTip={setSetupTip}
          setupPin={setupPin}
          setSetupPin={setSetupPin}
          loginError={loginError}
          onCancel={() => setView("audience")}
          onSubmit={completeSetup}
        />
      )}

      {view === "hostLogin" && (
        <LoginView
          bandName={config.bandName}
          pinInput={pinInput}
          setPinInput={setPinInput}
          loginError={loginError}
          onCancel={() => setView("audience")}
          onSubmit={submitPin}
          onForgotPin={resetPin}
        />
      )}

      {view === "host" && (
        <HostView
          config={config}
          songs={songs}
          requests={requests}
          hostTab={hostTab}
          setHostTab={setHostTab}
          showDone={showDone}
          setShowDone={setShowDone}
          markStatus={markStatus}
          clearDone={clearDone}
          clearAllRequests={clearAllRequests}
          pendingCount={pendingCount}
          fileInputRef={fileInputRef}
          handleCsvUpload={handleCsvUpload}
          csvError={csvError}
          manualTitle={manualTitle}
          setManualTitle={setManualTitle}
          manualArtist={manualArtist}
          setManualArtist={setManualArtist}
          manualGenre={manualGenre}
          setManualGenre={setManualGenre}
          addManualSong={addManualSong}
          removeSong={removeSong}
          setupBand={setupBand}
          setSetupBand={setSetupBand}
          setupPersonalInsta={setupPersonalInsta}
          setSetupPersonalInsta={setSetupPersonalInsta}
          setupBandInsta={setupBandInsta}
          setSetupBandInsta={setSetupBandInsta}
          setupTip={setupTip}
          setSetupTip={setSetupTip}
          setupPin={setupPin}
          setSetupPin={setSetupPin}
          saveSettings={saveSettings}
          savingSettings={savingSettings}
          settingsSaved={settingsSaved}
          toggleRequestsOpen={toggleRequestsOpen}
          startSession={startSession}
          endSession={endSession}
          onOpenSettings={() => {
            setSetupBand(config.bandName);
            setSetupPersonalInsta(config.personalInstagram);
            setSetupBandInsta(config.bandInstagram);
            setSetupTip(config.tipLink);
            setSetupPin("");
          }}
          onLogout={() => setView("audience")}
        />
      )}

      {sessionRecap && (
        <SessionRecapModal
          recap={sessionRecap}
          bandName={config.bandName}
          onClose={() => setSessionRecap(null)}
          onAddMissedSong={addSongFromMissed}
        />
      )}
    </Shell>
  );
}

// ---------- shell + shared styles ----------
function Shell({ children }) {
  return (
    <div className="pr-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

        .pr-root {
          --ink: #1B1712;
          --ink-raised: #24201A;
          --ink-card: #2A2420;
          --cream: #F1E7D2;
          --cream-dim: #C9BFA9;
          --amber: #E8A33D;
          --amber-soft: rgba(232, 163, 61, 0.14);
          --burgundy: #8C4A44;
          --brass: #6E5A3B;
          --green: #7FA66E;
          --line: rgba(241, 231, 210, 0.12);
          font-family: 'Inter', sans-serif;
          background: var(--ink);
          color: var(--cream);
          min-height: 100vh;
          width: 100%;
          position: relative;
        }
        .pr-root, .pr-root * { box-sizing: border-box; }
        .font-display { font-family: 'Oswald', sans-serif; letter-spacing: 0.02em; }
        .font-mono { font-family: 'JetBrains Mono', monospace; }
        .font-body { font-family: 'Inter', sans-serif; }
        .text-cream { color: var(--cream); }
        .text-cream\\/70 { color: rgba(241,231,210,0.7); }
        .text-cream\\/50 { color: rgba(241,231,210,0.5); }
        .bg-ink { background: var(--ink); }
        .bg-ink-raised { background: var(--ink-raised); }
        .bg-ink-card { background: var(--ink-card); }
        .border-line { border-color: var(--line); }
        .text-amber { color: var(--amber); }
        .bg-amber { background: var(--amber); }
        .text-burgundy { color: var(--burgundy); }
        .text-green { color: var(--green); }
        .bg-green { background: var(--green); }

        .pulse-dot {
          width: 8px; height: 8px; border-radius: 999px;
          background: var(--green);
          box-shadow: 0 0 0 0 rgba(127,166,110,0.6);
          animation: pulseDot 2s infinite;
        }
        @keyframes pulseDot {
          0% { box-shadow: 0 0 0 0 rgba(127,166,110,0.55); }
          70% { box-shadow: 0 0 0 8px rgba(127,166,110,0); }
          100% { box-shadow: 0 0 0 0 rgba(127,166,110,0); }
        }
        .paused-dot {
          width: 8px; height: 8px; border-radius: 999px;
          background: var(--brass);
        }

        .song-row {
          background: var(--ink-card);
          border: 1px solid var(--line);
          border-radius: 10px;
          transition: border-color 0.15s ease, transform 0.1s ease;
        }
        .song-row:active { transform: scale(0.99); }
        .song-row:hover { border-color: rgba(232,163,61,0.4); }

        .genre-section {
          background: var(--ink-card);
          border: 1px solid var(--line);
        }
        .genre-header {
          background: transparent;
          transition: background 0.15s ease;
        }
        .genre-header:hover { background: var(--amber-soft); }

        .ticket-num {
          font-family: 'JetBrains Mono', monospace;
          color: var(--amber);
          border-right: 1px dashed var(--brass);
        }

        .btn-amber {
          background: var(--amber);
          color: #201404;
          font-weight: 600;
          transition: filter 0.15s ease, transform 0.08s ease;
        }
        .btn-amber:hover { filter: brightness(1.08); }
        .btn-amber:active { transform: scale(0.98); }
        .btn-amber:disabled { opacity: 0.5; }

        .btn-outline {
          background: transparent;
          border: 1px solid var(--line);
          color: var(--cream);
          transition: border-color 0.15s ease, background 0.15s ease;
        }
        .btn-outline:hover { border-color: var(--amber); background: var(--amber-soft); }

        .modal-backdrop {
          background: rgba(10, 8, 5, 0.72);
          backdrop-filter: blur(2px);
          animation: fadeIn 0.15s ease;
        }
        .modal-card {
          background: var(--ink-raised);
          border: 1px solid var(--line);
          animation: slideUp 0.2s ease;
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }

        .toast {
          background: var(--ink-raised);
          border: 1px solid rgba(127,166,110,0.4);
          animation: toastIn 0.2s ease;
        }
        @keyframes toastIn { from { opacity: 0; transform: translate(-50%, 8px); } to { opacity: 1; transform: translate(-50%, 0); } }

        .req-card {
          background: var(--ink-card);
          border: 1px solid var(--line);
          border-left: 3px solid var(--amber);
          border-radius: 8px;
        }
        .req-card.done {
          border-left-color: var(--brass);
          opacity: 0.55;
        }

        input, textarea {
          background: var(--ink);
          border: 1px solid var(--line);
          color: var(--cream);
          font-family: 'Inter', sans-serif;
        }
        input::placeholder, textarea::placeholder { color: rgba(241,231,210,0.35); }
        input:focus, textarea:focus {
          outline: none;
          border-color: var(--amber);
          box-shadow: 0 0 0 3px rgba(232,163,61,0.15);
        }
        button:focus-visible, input:focus-visible, textarea:focus-visible, [tabindex]:focus-visible {
          outline: 2px solid var(--amber);
          outline-offset: 2px;
        }

        .tab-btn {
          color: rgba(241,231,210,0.55);
          border-bottom: 2px solid transparent;
        }
        .tab-btn.active {
          color: var(--amber);
          border-bottom-color: var(--amber);
        }

        .toggle-switch {
          width: 44px; height: 26px; border-radius: 999px;
          background: rgba(241,231,210,0.15);
          position: relative;
          transition: background 0.2s ease;
        }
        .toggle-switch[data-on="true"] { background: var(--green); }
        .toggle-knob {
          position: absolute;
          top: 3px; left: 3px;
          width: 20px; height: 20px;
          border-radius: 999px;
          background: var(--cream);
          transition: transform 0.2s ease;
        }
        .toggle-switch[data-on="true"] .toggle-knob {
          transform: translateX(18px);
        }

        @media (prefers-reduced-motion: reduce) {
          .pulse-dot, .modal-backdrop, .modal-card, .toast { animation: none; }
        }

        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-thumb { background: var(--brass); border-radius: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
      `}</style>
      <div className="max-w-lg mx-auto min-h-screen flex flex-col">{children}</div>
    </div>
  );
}

// ---------- Audience view ----------
function AudienceView({
  config,
  songs,
  totalSongs,
  query,
  setQuery,
  activeSong,
  setActiveSong,
  reqName,
  setReqName,
  reqNote,
  setReqNote,
  sendState,
  sendRequest,
  onHostTap,
  toast,
  requests = [],
}) {
  const live = config.sessionActive && config.requestsOpen;
  const effectiveConfig = { ...config, requestsOpen: live };
  const pendingQueue = (requests || [])
    .filter((r) => r.status === "pending")
    .sort((a, b) => (b.count || 1) - (a.count || 1) || a.ts - b.ts);

  function goExternal(url) {
    if (!url) return;
    // Same-tab navigation avoids the "open external link" confirmation
    // that many in-app browsers show for target="_blank".
    window.location.assign(url);
  }

  return (
    <div className="flex flex-col flex-1 px-4 pb-10">
      {/* header */}
      <div className="pt-8 pb-5 border-b border-line">
        <div className="flex items-center gap-2.5 mb-1.5">
          <span className={live ? "pulse-dot" : "paused-dot"} />
          <span className="font-mono text-sm font-semibold uppercase tracking-[0.2em] text-cream/80">
            {config.sessionActive
              ? live
                ? "Taking requests now"
                : "Taking a quick break"
              : "Not taking requests right now"}
          </span>
        </div>
        <h1 className="font-display text-3xl font-semibold leading-tight">
          {config.bandName}
        </h1>
        <div className="flex flex-wrap gap-2 mt-4">
          {config.personalInstagram && (
            <button
              type="button"
              onClick={() => goExternal(instaUrl(config.personalInstagram))}
              className="btn-outline flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-body"
            >
              <AtSign size={15} />
              Follow me here
            </button>
          )}
          {config.bandInstagram && (
            <button
              type="button"
              onClick={() => goExternal(instaUrl(config.bandInstagram))}
              className="btn-outline flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-body"
            >
              <AtSign size={15} />
              Follow my band here — Finding Light
            </button>
          )}
          {config.tipLink && (
            <button
              type="button"
              onClick={() => goExternal(normalizeUrl(config.tipLink))}
              className="btn-amber flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-body"
            >
              <HeartHandshake size={15} />
              Tip the band
            </button>
          )}
        </div>
      </div>

      {!live && (
        <div className="mt-4 px-3 py-2.5 rounded-lg bg-ink-card border border-line">
          <p className="font-body text-sm text-cream/60">
            {config.sessionActive
              ? "The band's taking a short break from requests — check back shortly. Feel free to browse the setlist or drop a tip."
              : "The band hasn't started taking requests yet — check back once they're live. Feel free to browse the setlist or drop a tip."}
          </p>
        </div>
      )}

      {/* Live request queue — separate from setlist genre dropdowns */}
      {config.sessionActive && (
        <AudienceQueueDropdown queue={pendingQueue} />
      )}

      {/* search */}
      <div className="pt-4 pb-2">
        <div className="relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-cream/50"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the setlist…"
            className="w-full pl-9 pr-3 py-2.5 rounded-lg text-sm font-body"
          />
        </div>
      </div>

      {/* song list */}
      <div className="flex-1 mt-2">
        {totalSongs === 0 ? (
          <div className="flex flex-col items-center text-center gap-2 mt-16 text-cream/50">
            <ListMusic size={28} />
            <p className="font-body text-sm max-w-[220px]">
              The setlist isn't loaded yet. Check back once the band's set it up.
            </p>
          </div>
        ) : songs.length === 0 ? (
          <p className="text-center text-cream/50 text-sm mt-10 font-body">
            Sorry, I don't know that one!
          </p>
        ) : query.trim() ? (
          <ul className="flex flex-col gap-2">
            {songs.map((song) => (
              <SongRow key={song.id} song={song} config={effectiveConfig} onTap={() => setActiveSong(song)} />
            ))}
          </ul>
        ) : (
          <GenreAccordion songs={songs} config={effectiveConfig} onSelectSong={setActiveSong} />
        )}
      </div>

      <button
        onClick={onHostTap}
        className="mt-8 text-center text-xs font-mono text-cream/30 hover:text-cream/60 transition-colors"
      >
        Musician? Tap here to manage
      </button>

      {/* request modal */}
      {activeSong && (
        <div
          className="fixed inset-0 z-40 flex items-end sm:items-center justify-center modal-backdrop"
          onClick={() => sendState !== "sending" && setActiveSong(null)}
        >
          <div
            className="modal-card w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            {sendState === "sent" ? (
              <div className="flex flex-col items-center gap-2 py-6">
                <div className="w-12 h-12 rounded-full bg-green flex items-center justify-center">
                  <Check size={22} className="text-ink" />
                </div>
                <p className="font-display text-lg">Sent to the stage</p>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-amber mb-1">
                      Request
                    </p>
                    <p className="font-display text-xl leading-tight">
                      {activeSong.title}
                    </p>
                    {activeSong.artist && (
                      <p className="font-body text-sm text-cream/50">
                        {activeSong.artist}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => setActiveSong(null)}
                    className="text-cream/40 hover:text-cream"
                  >
                    <X size={18} />
                  </button>
                </div>
                <input
                  value={reqName}
                  onChange={(e) => setReqName(e.target.value)}
                  placeholder="Your name (optional)"
                  className="w-full px-3 py-2.5 rounded-lg text-sm font-body mb-2"
                />
                <textarea
                  value={reqNote}
                  onChange={(e) => setReqNote(e.target.value)}
                  placeholder="Add a note — e.g. 'shoutout to Sarah!' (optional)"
                  rows={2}
                  className="w-full px-3 py-2.5 rounded-lg text-sm font-body mb-4 resize-none"
                />
                <button
                  onClick={sendRequest}
                  disabled={sendState === "sending"}
                  className="btn-amber w-full py-3 rounded-lg font-body flex items-center justify-center gap-2"
                >
                  {sendState === "sending" ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Music2 size={16} />
                  )}
                  Send request
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className="toast fixed bottom-6 left-1/2 px-4 py-2.5 rounded-full text-sm font-body flex items-center gap-2 z-50">
          <Check size={14} className="text-green" />
          {toast}
        </div>
      )}
    </div>
  );
}

function SongRow({ song, config, onTap, index }) {
  return (
    <li>
      <button
        onClick={() => config.requestsOpen && onTap()}
        disabled={!config.requestsOpen}
        className={`song-row w-full flex items-stretch text-left rounded-[10px] overflow-hidden ${!config.requestsOpen ? "opacity-50 cursor-default" : ""}`}
      >
        {index != null && (
          <div className="ticket-num flex items-center justify-center w-11 shrink-0 text-xs">
            {String(index + 1).padStart(2, "0")}
          </div>
        )}
        <div className="flex-1 px-3 py-3 min-w-0">
          <p className="font-body font-semibold text-[15px] truncate">{song.title}</p>
          {song.artist && (
            <p className="font-body text-xs text-cream/50 truncate">{song.artist}</p>
          )}
        </div>
        <div className="flex items-center pr-3 text-cream/30">
          {config.requestsOpen && <ChevronRight size={16} />}
        </div>
      </button>
    </li>
  );
}

function GenreAccordion({ songs, config, onSelectSong }) {
  const groups = groupByGenre(songs);
  const [openGenre, setOpenGenre] = useState(groups.length === 1 ? groups[0].genre : null);

  return (
    <div className="flex flex-col gap-2">
      {groups.map(({ genre, songs: groupSongs }) => {
        const isOpen = openGenre === genre;
        return (
          <div key={genre} className="genre-section rounded-[10px] overflow-hidden">
            <button
              onClick={() => setOpenGenre(isOpen ? null : genre)}
              className="genre-header w-full flex items-center justify-between px-3.5 py-3 text-left"
            >
              <span className="flex items-baseline gap-2">
                <span className="font-display text-base">{genre}</span>
                <span className="font-mono text-[11px] text-cream/40">{groupSongs.length}</span>
              </span>
              <ChevronDown
                size={16}
                className={`text-amber transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`}
              />
            </button>
            {isOpen && (
              <ul className="flex flex-col gap-2 px-2 pb-2.5 pt-0.5">
                {groupSongs.map((song, i) => (
                  <SongRow key={song.id} song={song} config={config} index={i} onTap={() => onSelectSong(song)} />
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}


/** Audience-facing live queue — separate collapsible from the setlist genre dropdowns */
function AudienceQueueDropdown({ queue }) {
  const [open, setOpen] = useState(false);
  const count = queue.length;

  return (
    <div className="mt-4 genre-section rounded-[10px] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="genre-header w-full flex items-center justify-between px-3.5 py-3 text-left"
      >
        <span className="flex items-center gap-2">
          <Inbox size={15} className="text-amber" />
          <span className="font-display text-base">Live request queue</span>
          <span className="font-mono text-[11px] text-cream/40">{count}</span>
        </span>
        <ChevronDown
          size={16}
          className={`text-amber transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="px-2 pb-2.5 pt-0.5">
          {count === 0 ? (
            <p className="font-body text-sm text-cream/50 px-2 py-3 text-center">
              Nothing in the queue yet — be the first to request.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {queue.map((r, i) => (
                <li
                  key={r.id}
                  className="song-row flex items-stretch overflow-hidden"
                >
                  <div className="ticket-num flex items-center justify-center w-11 shrink-0 text-xs">
                    {String(i + 1).padStart(2, "0")}
                  </div>
                  <div className="flex-1 px-3 py-3 min-w-0 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-body font-semibold text-[15px] truncate">{r.title}</p>
                      {r.artist && (
                        <p className="font-body text-xs text-cream/50 truncate">{r.artist}</p>
                      )}
                    </div>
                    {(r.count || 1) > 1 && (
                      <span className="bg-amber text-ink text-[11px] font-mono font-bold rounded-full px-1.5 py-0.5 shrink-0">
                        ×{r.count}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Host login ----------
function LoginView({ bandName, pinInput, setPinInput, loginError, onCancel, onSubmit, onForgotPin }) {
  const [confirmingReset, setConfirmingReset] = useState(false);

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6">
      <KeyRound size={26} className="text-amber mb-3" />
      <h2 className="font-display text-2xl mb-1">{bandName}</h2>
      <p className="font-body text-sm text-cream/50 mb-6">Enter your PIN to manage the stage</p>
      <input
        autoFocus
        type="password"
        inputMode="numeric"
        value={pinInput}
        onChange={(e) => setPinInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        placeholder="PIN"
        className="w-full max-w-[220px] text-center tracking-[0.3em] px-3 py-3 rounded-lg text-lg font-mono mb-3"
      />
      {loginError && <p className="text-burgundy text-sm font-body mb-3">{loginError}</p>}
      <button onClick={onSubmit} className="btn-amber w-full max-w-[220px] py-2.5 rounded-lg font-body mb-2">
        Enter
      </button>
      <button onClick={onCancel} className="text-cream/40 text-sm font-body mb-6">
        Back to requests
      </button>

      {!confirmingReset ? (
        <button onClick={() => setConfirmingReset(true)} className="text-cream/30 text-xs font-mono">
          Forgot PIN?
        </button>
      ) : (
        <div className="text-center">
          <p className="font-body text-xs text-cream/50 mb-2 max-w-[220px]">
            This clears your PIN so you can set a new one. Your setlist and past requests stay put.
          </p>
          <div className="flex gap-2 justify-center">
            <button onClick={onForgotPin} className="btn-outline px-3 py-1.5 rounded-full text-xs font-body">
              Reset PIN
            </button>
            <button onClick={() => setConfirmingReset(false)} className="text-cream/30 text-xs font-mono px-2">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Session recap ----------
function SessionRecapModal({ recap, bandName, onClose, onAddMissedSong }) {
  const [added, setAdded] = useState({});
  const { songCounts, missed } = recap;

  function handleAdd(title) {
    onAddMissedSong(title);
    setAdded((prev) => ({ ...prev, [title]: true }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center modal-backdrop">
      <div className="modal-card w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 max-h-[85vh] overflow-y-auto">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-amber mb-1">
          Session recap
        </p>
        <h2 className="font-display text-2xl mb-4">{bandName}'s set is done</h2>

        <div className="mb-5">
          <p className="font-body text-sm font-semibold mb-2 flex items-center gap-1.5">
            <Music2 size={14} className="text-amber" /> Most requested
          </p>
          {songCounts.length === 0 ? (
            <p className="font-body text-xs text-cream/40">No requests came in this session.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {songCounts.map((s, i) => (
                <li key={i} className="song-row flex items-center justify-between px-3 py-2">
                  <div className="min-w-0">
                    <p className="font-body text-sm truncate">{s.title}</p>
                    {s.artist && <p className="font-body text-xs text-cream/50 truncate">{s.artist}</p>}
                  </div>
                  <span className="font-mono text-xs text-amber shrink-0 ml-2">×{s.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mb-5">
          <p className="font-body text-sm font-semibold mb-1.5 flex items-center gap-1.5">
            <Search size={14} className="text-amber" /> Searches with no match
          </p>
          <p className="font-body text-xs text-cream/50 mb-2 leading-relaxed">
            When someone typed a song into search and nothing on your setlist matched, it shows up here. Useful for spotting songs to learn next.
          </p>
          {missed.length === 0 ? (
            <p className="font-body text-xs text-cream/40">No empty searches this session — your setlist covered what people looked for.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {missed.map((m, i) => (
                <li key={i} className="song-row flex items-center justify-between px-3 py-2 gap-2">
                  <div className="min-w-0 flex items-center gap-2">
                    <p className="font-body text-sm truncate">"{m.query}"</p>
                    <span className="font-mono text-xs text-amber shrink-0">×{m.count}</span>
                  </div>
                  <button
                    onClick={() => handleAdd(m.query)}
                    disabled={added[m.query]}
                    className="btn-outline shrink-0 px-2.5 py-1 rounded-full text-[11px] font-body flex items-center gap-1"
                  >
                    {added[m.query] ? <Check size={11} /> : <Plus size={11} />}
                    {added[m.query] ? "Added" : "Add to setlist"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button onClick={onClose} className="btn-amber w-full py-3 rounded-lg font-body">
          Done
        </button>
      </div>
    </div>
  );
}

// ---------- Host first-time setup ----------
function SetupView({
  setupBand, setSetupBand,
  setupPersonalInsta, setSetupPersonalInsta,
  setupBandInsta, setSetupBandInsta,
  setupTip, setSetupTip,
  setupPin, setSetupPin,
  loginError, onCancel, onSubmit,
}) {
  return (
    <div className="flex-1 flex flex-col px-5 pt-10 pb-8">
      <h2 className="font-display text-2xl mb-1">Set up your stage</h2>
      <p className="font-body text-sm text-cream/50 mb-6">
        This runs once. You'll use this PIN every time you want to manage requests or the setlist.
      </p>
      <Field label="Band / artist name">
        <input value={setupBand} onChange={(e) => setSetupBand(e.target.value)} placeholder="Finding Light" className="w-full px-3 py-2.5 rounded-lg text-sm font-body" />
      </Field>
      <Field label="Your personal Instagram (optional)">
        <input value={setupPersonalInsta} onChange={(e) => setSetupPersonalInsta(e.target.value)} placeholder="@yourhandle" className="w-full px-3 py-2.5 rounded-lg text-sm font-body" />
      </Field>
      <Field label="Band Instagram (optional)">
        <input value={setupBandInsta} onChange={(e) => setSetupBandInsta(e.target.value)} placeholder="@thebandhandle" className="w-full px-3 py-2.5 rounded-lg text-sm font-body" />
      </Field>
      <Field label="Tip link — Venmo, Cash App, or PayPal (optional)">
        <input value={setupTip} onChange={(e) => setSetupTip(e.target.value)} placeholder="venmo.com/yourname" className="w-full px-3 py-2.5 rounded-lg text-sm font-body" />
      </Field>
      <Field label="Choose a PIN (4+ digits)">
        <input value={setupPin} onChange={(e) => setSetupPin(e.target.value)} inputMode="numeric" type="password" placeholder="••••" className="w-full px-3 py-2.5 rounded-lg text-sm font-mono tracking-[0.2em]" />
      </Field>
      {loginError && <p className="text-burgundy text-sm font-body mb-3">{loginError}</p>}
      <button onClick={onSubmit} className="btn-amber w-full py-3 rounded-lg font-body mt-2 mb-3">
        Save and continue
      </button>
      <button onClick={onCancel} className="text-cream/40 text-sm font-body text-center">
        Cancel
      </button>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="mb-4">
      <label className="block font-body text-xs text-cream/50 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

// ---------- Host dashboard ----------
function HostView({
  config, songs, requests,
  hostTab, setHostTab,
  showDone, setShowDone,
  markStatus, clearDone, clearAllRequests,
  pendingCount,
  fileInputRef, handleCsvUpload, csvError,
  manualTitle, setManualTitle, manualArtist, setManualArtist, manualGenre, setManualGenre, addManualSong, removeSong,
  setupBand, setSetupBand,
  setupPersonalInsta, setSetupPersonalInsta,
  setupBandInsta, setSetupBandInsta,
  setupTip, setSetupTip, setupPin, setSetupPin,
  saveSettings, savingSettings, settingsSaved,
  toggleRequestsOpen, startSession, endSession,
  onOpenSettings, onLogout,
}) {
  const pending = requests
    .filter((r) => r.status === "pending")
    .sort((a, b) => (b.count || 1) - (a.count || 1) || a.ts - b.ts);
  const done = requests.filter((r) => r.status === "done").sort((a, b) => b.ts - a.ts);

  return (
    <div className="flex flex-col flex-1">
      <div className="px-4 pt-6 pb-3 flex items-center justify-between border-b border-line">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber mb-0.5">Stage mode</p>
          <h1 className="font-display text-xl">{config.bandName}</h1>
        </div>
        <button onClick={onLogout} className="btn-outline flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-body">
          <LogOut size={13} /> Exit
        </button>
      </div>

      <div className="flex px-4 border-b border-line">
        {[
          { id: "requests", label: "Requests", icon: Inbox, badge: pendingCount },
          { id: "songs", label: "Setlist", icon: ListMusic },
          { id: "settings", label: "Settings", icon: Settings },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setHostTab(t.id);
              if (t.id === "settings") onOpenSettings();
            }}
            className={`tab-btn flex items-center gap-1.5 px-3 py-3 text-sm font-body ${hostTab === t.id ? "active" : ""}`}
          >
            <t.icon size={14} />
            {t.label}
            {t.badge > 0 && (
              <span className="bg-amber text-ink text-[10px] font-mono font-semibold rounded-full w-4 h-4 flex items-center justify-center">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 px-4 py-4 overflow-y-auto">
        {hostTab === "requests" && (
          <div>
            {!config.sessionActive ? (
              <div className="text-center px-4 py-8 rounded-xl bg-ink-card border border-line mb-4">
                <Music2 size={22} className="mx-auto mb-2 text-amber" />
                <p className="font-display text-lg mb-1">Ready to go live?</p>
                <p className="font-body text-xs text-cream/40 mb-4 max-w-[260px] mx-auto">
                  Starting a session opens requests, clears last time's queue, and starts tracking stats for tonight.
                </p>
                <button onClick={startSession} className="btn-amber px-5 py-2.5 rounded-full font-body inline-flex items-center gap-2">
                  <Music2 size={14} /> Start session
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3 px-3 py-3 rounded-xl bg-ink-card border border-line">
                  <div>
                    <p className="font-body text-sm font-semibold">
                      {config.requestsOpen ? "Taking requests" : "Requests paused"}
                    </p>
                    <p className="font-body text-xs text-cream/40 mt-0.5">
                      {config.requestsOpen
                        ? "Audience can send you songs right now."
                        : "The setlist still shows, but no one can send a request."}
                    </p>
                  </div>
                  <button
                    onClick={toggleRequestsOpen}
                    role="switch"
                    aria-checked={config.requestsOpen}
                    className="toggle-switch shrink-0"
                    data-on={config.requestsOpen}
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>
                <button
                  onClick={endSession}
                  className="btn-outline w-full py-2.5 rounded-lg font-body text-sm mb-4 flex items-center justify-center gap-2"
                >
                  <LogOut size={14} /> End session &amp; see stats
                </button>
              </>
            )}

            {config.sessionActive && pending.length === 0 ? (
              <div className="flex flex-col items-center text-center gap-2 mt-10 text-cream/50">
                <Inbox size={26} />
                <p className="font-body text-sm">No pending requests. Enjoy the calm.</p>
              </div>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {pending.map((r) => (
                  <li key={r.id} className="req-card p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-body font-semibold text-[15px] truncate">{r.title}</p>
                          {(r.count || 1) > 1 && (
                            <span className="bg-amber text-ink text-[11px] font-mono font-bold rounded-full px-1.5 py-0.5 shrink-0">
                              ×{r.count}
                            </span>
                          )}
                        </div>
                        {r.artist && <p className="font-body text-xs text-cream/50 truncate">{r.artist}</p>}
                        {r.names && r.names.length > 0 && (
                          <p className="font-body text-xs text-amber mt-1.5">
                            {r.names.join(", ")}
                          </p>
                        )}
                        {r.notes && r.notes.length > 0 && (
                          <p className="font-body text-xs text-cream/60 mt-0.5">
                            {r.notes.join(" · ")}
                          </p>
                        )}
                        <p className="font-mono text-[10px] text-cream/30 mt-1.5">{timeAgo(r.ts)}</p>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <button onClick={() => markStatus(r.id, "done")} className="btn-amber w-8 h-8 rounded-full flex items-center justify-center">
                          <Check size={14} />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {done.length > 0 && (
              <div className="mt-6">
                <button onClick={() => setShowDone((v) => !v)} className="text-xs font-mono text-cream/40 mb-2">
                  {showDone ? "Hide" : "Show"} played ({done.length})
                </button>
                {showDone && (
                  <>
                    <ul className="flex flex-col gap-2">
                      {done.map((r) => (
                        <li key={r.id} className="req-card done p-3 flex items-center justify-between">
                          <div className="min-w-0">
                            <p className="font-body text-sm truncate">{r.title}</p>
                            {r.artist && <p className="font-body text-xs text-cream/50 truncate">{r.artist}</p>}
                          </div>
                          <span className="font-mono text-[10px] text-cream/30 shrink-0">{timeAgo(r.ts)}</span>
                        </li>
                      ))}
                    </ul>
                    <button onClick={clearDone} className="text-xs font-mono text-burgundy mt-3">
                      Clear played
                    </button>
                  </>
                )}
              </div>
            )}

            {requests.length > 0 && (
              <button onClick={clearAllRequests} className="text-xs font-mono text-cream/30 mt-8">
                Clear all requests
              </button>
            )}
          </div>
        )}

        {hostTab === "songs" && (
          <div>
            <div className="border border-dashed border-line rounded-xl p-4 mb-5 text-center">
              <Upload size={20} className="mx-auto mb-2 text-amber" />
              <p className="font-body text-sm mb-1">Upload your setlist as a CSV</p>
              <p className="font-body text-xs text-cream/40 mb-3">
                Columns: title, artist, genre. Genre is optional — ungrouped songs land under "Other". Uploading replaces the current list.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleCsvUpload}
                className="hidden"
                id="csv-upload"
              />
              <label htmlFor="csv-upload" className="btn-amber inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-body cursor-pointer">
                <Upload size={13} /> Choose file
              </label>
              {csvError && <p className="text-burgundy text-xs font-body mt-2">{csvError}</p>}
            </div>

            <div className="flex flex-col gap-2 mb-5">
              <div className="flex gap-2">
                <input value={manualTitle} onChange={(e) => setManualTitle(e.target.value)} placeholder="Song title" className="flex-1 px-3 py-2 rounded-lg text-sm font-body" />
                <input value={manualArtist} onChange={(e) => setManualArtist(e.target.value)} placeholder="Artist" className="flex-1 px-3 py-2 rounded-lg text-sm font-body" />
              </div>
              <div className="flex gap-2">
                <input value={manualGenre} onChange={(e) => setManualGenre(e.target.value)} placeholder="Genre (optional) — e.g. Rock, Country" className="flex-1 px-3 py-2 rounded-lg text-sm font-body" />
                <button onClick={addManualSong} className="btn-outline px-3 rounded-lg shrink-0">
                  <Plus size={16} />
                </button>
              </div>
            </div>

            <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-cream/40 mb-3">
              {songs.length} song{songs.length !== 1 ? "s" : ""} on the list
            </p>

            {groupByGenre(songs).map(({ genre, songs: groupSongs }) => (
              <div key={genre} className="mb-4">
                <p className="font-body text-xs font-semibold text-amber mb-1.5">
                  {genre} <span className="text-cream/30 font-normal">({groupSongs.length})</span>
                </p>
                <ul className="flex flex-col gap-1.5">
                  {groupSongs.map((s) => (
                    <li key={s.id} className="song-row flex items-center justify-between px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="font-body text-sm truncate">{s.title}</p>
                        {s.artist && <p className="font-body text-xs text-cream/50 truncate">{s.artist}</p>}
                      </div>
                      <button onClick={() => removeSong(s.id)} className="text-cream/30 hover:text-burgundy shrink-0 ml-2">
                        <Trash2 size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {hostTab === "settings" && (
          <div>
            <Field label="Band / artist name">
              <input value={setupBand} onChange={(e) => setSetupBand(e.target.value)} className="w-full px-3 py-2.5 rounded-lg text-sm font-body" />
            </Field>
            <Field label="Your personal Instagram">
              <input value={setupPersonalInsta} onChange={(e) => setSetupPersonalInsta(e.target.value)} placeholder="@yourhandle" className="w-full px-3 py-2.5 rounded-lg text-sm font-body" />
            </Field>
            <Field label="Band Instagram">
              <input value={setupBandInsta} onChange={(e) => setSetupBandInsta(e.target.value)} placeholder="@thebandhandle" className="w-full px-3 py-2.5 rounded-lg text-sm font-body" />
            </Field>
            <Field label="Tip link — Venmo, Cash App, or PayPal">
              <input value={setupTip} onChange={(e) => setSetupTip(e.target.value)} placeholder="venmo.com/yourname" className="w-full px-3 py-2.5 rounded-lg text-sm font-body" />
            </Field>
            <Field label="Change PIN (leave blank to keep current)">
              <input value={setupPin} onChange={(e) => setSetupPin(e.target.value)} inputMode="numeric" type="password" placeholder="••••" className="w-full px-3 py-2.5 rounded-lg text-sm font-mono tracking-[0.2em]" />
            </Field>
            <button onClick={saveSettings} disabled={savingSettings} className="btn-amber w-full py-3 rounded-lg font-body flex items-center justify-center gap-2">
              {savingSettings ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              {settingsSaved ? "Saved" : "Save changes"}
            </button>
            <p className="font-body text-xs text-cream/30 mt-4 leading-relaxed">
              Heads up: the setlist, requests, and this info are stored so anyone with your app link can view them. Only the PIN stands between someone and this dashboard.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}