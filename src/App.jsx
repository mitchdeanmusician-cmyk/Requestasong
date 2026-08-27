import { useState, useEffect, useRef, useCallback } from "react";
import Papa from "papaparse";
import {
  readShared,
  writeShared,
  subscribeShared,
  readPersonal,
  writePersonal,
} from "./firebase.js";
import {
  Music2,
  Instagram,
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
  Play,
  Heart,
  QrCode,
  Timer,
  History,
  Copy,
  Flame,
  EyeOff,
  Eye,
  Megaphone,
  ImageIcon,
  Users,
  TrendingUp,
  ListPlus,
} from "lucide-react";

// ---------- storage keys ----------
const KEYS = {
  config: "pubreq:config",
  songs: "pubreq:songs",
  setlists: "pubreq:setlists",
  requests: "pubreq:requests",
  sessionStats: "pubreq:sessionStats",
  history: "pubreq:history",
  reactions: "pubreq:reactions",
  reactedIds: "pubreq:reactedIds",
  muteAlerts: "pubreq:muteAlerts",
  myRequestedIds: "pubreq:myRequestedIds",
};

const EMPTY_STATS = { songCounts: {}, missed: {}, namedCount: 0, anonCount: 0 };
const PLAYED_COOLDOWN_MS = 15 * 60 * 1000;
const MAX_PENDING_REQUESTS = 10;


const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

const DEFAULT_CONFIG = {
  bandName: "Finding Light",
  personalInstagram: "",
  bandInstagram: "",
  tipLink: "",
  publicLink: "",
  pin: "",
  helperPin: "",
  setUp: false,
  requestsOpen: false,
  sessionActive: false,
  sessionStartedAt: null,
  sessionVenue: "",
  pauseUntil: null,
  doneForNight: false,
  theme: "retro",
  activeSetlistId: null,
  lastCallActive: false,
  bannerImageUrl: "",
  autoClearDone: true,
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

function instaHandle(handle) {
  if (!handle) return "";
  const cleaned = handle
    .trim()
    .replace(/^@/, "")
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/\/$/, "");
  return `@${cleaned}`;
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const row = Array(n + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      row[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, row[j], row[j - 1]);
      prev = tmp;
    }
  }
  return row[n];
}

function matchesField(text, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const t = (text || "").toLowerCase();
  if (t.includes(q)) return true;
  const words = t.split(/\s+/);
  const maxDist = q.length <= 4 ? 1 : q.length <= 7 ? 2 : 3;
  return words.some((w) => levenshtein(w, q) <= maxDist) || levenshtein(t, q) <= maxDist + 1;
}

function fuzzyMatchSongs(allSongs, titleQuery, artistQuery) {
  if (!titleQuery.trim() && !artistQuery.trim()) return allSongs;
  return allSongs.filter((s) => matchesField(s.title, titleQuery) && matchesField(s.artist, artistQuery));
}

function isBirthdaySong(title) {
  return /happy\s*birthday/i.test(title || "");
}

function sortPending(reqs) {
  return reqs
    .filter((r) => r.status === "pending")
    .sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0) || (b.count || 1) - (a.count || 1) || a.ts - b.ts);
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
  const [setlists, setSetlists] = useState(null);
  const [requests, setRequests] = useState(null);
  const [view, setView] = useState("audience"); // audience | hostLogin | hostSetup | host
  const [loaded, setLoaded] = useState(false);
  const [hostRole, setHostRole] = useState("owner"); // owner | helper
  const [reactions, setReactions] = useState({});
  const [reactedIds, setReactedIds] = useState([]);
  const [muteAlerts, setMuteAlerts] = useState(false);
  const [myRequestedIds, setMyRequestedIds] = useState([]);

  // audience state
  const [queryTitle, setQueryTitle] = useState("");
  const [queryArtist, setQueryArtist] = useState("");
  const [activeSong, setActiveSong] = useState(null);
  const [reqName, setReqName] = useState("");
  const [reqNote, setReqNote] = useState("");
  const [reqWhen, setReqWhen] = useState("");
  const [sendState, setSendState] = useState("idle"); // idle | sending | sent
  const [toast, setToast] = useState(null);
  const [liveStats, setLiveStats] = useState(EMPTY_STATS);
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
  const [setupPublicLink, setSetupPublicLink] = useState("");
  const [setupHelperPin, setSetupHelperPin] = useState("");
  const [setupBannerImageUrl, setSetupBannerImageUrl] = useState("");
  const [setupPin, setSetupPin] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [venueInput, setVenueInput] = useState("");
  const [pauseMinutes, setPauseMinutes] = useState(null);
  const [pauseChoosingDuration, setPauseChoosingDuration] = useState(false);
  const [historyView, setHistoryView] = useState(null); // set to history array when viewing
  const [newSetlistName, setNewSetlistName] = useState("");
  const prevPendingIds = useRef(new Set());
  const alertsReady = useRef(false);
  const missedStreakRef = useRef(null);

  // one-time setup: migrate legacy data shape if needed, then hand off to
  // real-time subscriptions below for everything else
  useEffect(() => {
    (async () => {
      let sl = await readShared(KEYS.setlists, null);
      let c = await readShared(KEYS.config, DEFAULT_CONFIG);

      // migrate legacy single-list songs into the new multi-setlist structure
      if (!sl || sl.length === 0) {
        const legacySongs = await readShared(KEYS.songs, []);
        const mainList = { id: uid(), name: "Main Setlist", songs: legacySongs };
        sl = [mainList];
        await writeShared(KEYS.setlists, sl);
      }
      if (!c.activeSetlistId || !sl.some((l) => l.id === c.activeSetlistId)) {
        c = { ...c, activeSetlistId: sl[0].id };
        await writeShared(KEYS.config, c);
      }

      setReactedIds(await readPersonal(KEYS.reactedIds, []));
      setMuteAlerts(await readPersonal(KEYS.muteAlerts, false));
      setMyRequestedIds(await readPersonal(KEYS.myRequestedIds, []));
      setLoaded(true);
    })();
  }, []);

  // real-time sync — every device sees changes instantly, no polling delay
  useEffect(() => {
    const unsubs = [
      subscribeShared(KEYS.config, DEFAULT_CONFIG, setConfig),
      subscribeShared(KEYS.setlists, null, setSetlists),
      subscribeShared(KEYS.requests, [], setRequests),
      subscribeShared(KEYS.reactions, {}, setReactions),
      subscribeShared(KEYS.sessionStats, EMPTY_STATS, setLiveStats),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, []);

  // quietly clear out old "done" songs so the played list doesn't grow forever
  useEffect(() => {
    if (!loaded) return;
    const iv = setInterval(async () => {
      const latestConfig = await readShared(KEYS.config, config);
      if (!latestConfig?.autoClearDone) return;
      const latest = await readShared(KEYS.requests, []);
      const cutoff = Date.now() - 3 * 60 * 60 * 1000;
      const kept = latest.filter((r) => !(r.status === "done" && (r.playedAt || r.ts) < cutoff));
      if (kept.length !== latest.length) {
        await writeShared(KEYS.requests, kept);
        setRequests(kept);
      }
    }, 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, [loaded]);

  // vibrate (no sound) when a brand new pending request arrives, host-side only
  useEffect(() => {
    if (!loaded || view !== "host" || !requests) return;
    const currentIds = new Set(requests.filter((r) => r.status === "pending").map((r) => r.id));
    if (!alertsReady.current) {
      // first time we see the queue in this view — just record it, don't alert
      prevPendingIds.current = currentIds;
      alertsReady.current = true;
      return;
    }
    const isNew = [...currentIds].some((id) => !prevPendingIds.current.has(id));
    if (isNew && !muteAlerts && navigator.vibrate) {
      try { navigator.vibrate(200); } catch {}
    }
    prevPendingIds.current = currentIds;
  }, [requests, loaded, view, muteAlerts]);

  useEffect(() => {
    if (view !== "host") alertsReady.current = false;
  }, [view]);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 2600);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const activeList = setlists && config ? setlists.find((l) => l.id === config.activeSetlistId) || setlists[0] : null;
  const songs = activeList ? activeList.songs : [];
  function songPopularity(title, artist) {
    const key = `${(title || "").toLowerCase()}||${(artist || "").toLowerCase()}`;
    return liveStats.songCounts[key]?.count || 0;
  }
  const availableSongs = songs
    .filter((s) => !s.unavailable)
    .slice()
    .sort((a, b) => songPopularity(b.title, b.artist) - songPopularity(a.title, a.artist));
  const filteredSongs = fuzzyMatchSongs(availableSongs, queryTitle, queryArtist);

  async function markMyRequest(id) {
    const updated = [...myRequestedIds, id];
    setMyRequestedIds(updated);
    await writePersonal(KEYS.myRequestedIds, updated);
  }

  async function quickQueue(song) {
    if (!config.sessionActive) {
      setToast("The band hasn't started their set yet — check back once they do!");
      return;
    }
    if (config.doneForNight) {
      setToast("Not taking any more requests tonight — thanks for coming out!");
      return;
    }
    const latest = await readShared(KEYS.requests, []);
    const birthday = isBirthdaySong(song.title);
    const pendingCountNow = latest.filter((r) => r.status === "pending").length;
    if (!birthday && pendingCountNow >= MAX_PENDING_REQUESTS) {
      setToast("Sorry! I have a lot of requests right now, try again in a few minutes");
      return;
    }

    const sameSong = (r) =>
      r.songId === song.id ||
      (r.title.toLowerCase() === song.title.toLowerCase() &&
        (r.artist || "").toLowerCase() === (song.artist || "").toLowerCase());

    if (!birthday) {
      const nowPlayingMatch = latest.find((r) => sameSong(r) && r.status === "nowPlaying");
      if (nowPlayingMatch) {
        setToast("That one's playing right now!");
        return;
      }
      const recentlyPlayed = latest.find((r) => {
        if (!sameSong(r) || r.status !== "done") return false;
        const playedAt = r.playedAt || r.ts;
        return Date.now() - playedAt < PLAYED_COOLDOWN_MS;
      });
      if (recentlyPlayed) {
        const playedAt = recentlyPlayed.playedAt || recentlyPlayed.ts;
        const remaining = Math.ceil((PLAYED_COOLDOWN_MS - (Date.now() - playedAt)) / 60000);
        setToast(`Just played that one — try again in ${remaining} min`);
        return;
      }
    }

    const existingIdx = birthday
      ? -1
      : latest.findIndex((r) => r.status === "pending" && sameSong(r));

    if (existingIdx >= 0 && myRequestedIds.includes(latest[existingIdx].id)) {
      setToast("You've already put this one in — sit tight!");
      return;
    }

    let updated;
    let bumped = false;
    let newId = null;
    if (existingIdx >= 0) {
      bumped = true;
      const existing = latest[existingIdx];
      newId = existing.id;
      updated = [...latest];
      updated[existingIdx] = { ...existing, count: (existing.count || 1) + 1, ts: Date.now() };
    } else {
      newId = uid();
      const newReq = {
        id: newId,
        songId: song.id,
        title: song.title,
        artist: song.artist,
        count: 1,
        names: [],
        notes: [],
        ts: Date.now(),
        status: "pending",
      };
      updated = [newReq, ...latest];
    }
    await writeShared(KEYS.requests, updated);
    setRequests(updated);
    await markMyRequest(newId);

    const stats = await readShared(KEYS.sessionStats, EMPTY_STATS);
    const statKey = `${song.title.toLowerCase()}||${(song.artist || "").toLowerCase()}`;
    const cur = stats.songCounts[statKey] || { title: song.title, artist: song.artist, count: 0 };
    cur.count += 1;
    stats.songCounts[statKey] = cur;
    stats.anonCount = (stats.anonCount || 0) + 1;
    await writeShared(KEYS.sessionStats, stats);
    setLiveStats(stats);

    setToast(
      config.requestsOpen
        ? bumped
          ? "Already queued — pushed it up!"
          : "Added to the queue!"
        : bumped
        ? "Already queued for when they're back!"
        : "Queued for when they're back!"
    );
  }

  // log searches that come up empty while a session is live, debounced so we
  // don't log on every keystroke. Also consolidates progressive typing (e.g.
  // "Wic" -> "Wicked" -> "Wicked Game") into a single entry instead of one per pause.
  useEffect(() => {
    if (!loaded || !config?.sessionActive) return;
    const t1 = queryTitle.trim();
    const t2 = queryArtist.trim();
    const q = [t1, t2].filter(Boolean).join(" - ");
    if (!q || availableSongs.length === 0 || filteredSongs.length > 0) {
      missedStreakRef.current = null;
      return;
    }
    const t = setTimeout(async () => {
      const stats = await readShared(KEYS.sessionStats, EMPTY_STATS);
      const key = q.toLowerCase();
      const streak = missedStreakRef.current;

      // if this looks like a continuation of the same typing session (same prefix,
      // logged recently), remove the earlier partial entry instead of stacking a new one
      if (
        streak &&
        streak.key !== key &&
        Date.now() - streak.time < 15000 &&
        (key.startsWith(streak.key) || streak.key.startsWith(key)) &&
        stats.missed[streak.key]
      ) {
        if (stats.missed[streak.key].count <= 1) {
          delete stats.missed[streak.key];
        } else {
          stats.missed[streak.key].count -= 1;
        }
      }

      const existing = stats.missed[key] || { query: q, count: 0 };
      existing.count += 1;
      existing.query = q;
      stats.missed[key] = existing;
      await writeShared(KEYS.sessionStats, stats);
      setLiveStats(stats);
      missedStreakRef.current = { key, time: Date.now() };
    }, 900);
    return () => clearTimeout(t);
  }, [queryTitle, queryArtist, loaded, config?.sessionActive, filteredSongs.length, availableSongs.length]);

  async function sendRequest(timing) {
    if (!activeSong) return;
    const latestConfig = await readShared(KEYS.config, config);
    if (!latestConfig.sessionActive || !latestConfig.requestsOpen) {
      setActiveSong(null);
      setToast(
        latestConfig.doneForNight
          ? "Not taking any more requests tonight — thanks for coming out!"
          : "Requests are paused right now — try again shortly"
      );
      return;
    }

    const preCheck = await readShared(KEYS.requests, []);
    const pendingCountNow = preCheck.filter((r) => r.status === "pending").length;
    if (!isBirthdaySong(activeSong.title) && pendingCountNow >= MAX_PENDING_REQUESTS) {
      setActiveSong(null);
      setToast("Sorry! I have a lot of requests right now, try again in a few minutes");
      return;
    }

    setSendState("sending");

    const name = reqName.trim();
    const note = reqNote.trim();
    const when = reqWhen.trim();
    const birthday = isBirthdaySong(activeSong.title);
    const whenNote = birthday && timing === "later" && when ? `⏰ ${when}` : null;
    const noteEntries = [note, whenNote].filter(Boolean);
    const latest = await readShared(KEYS.requests, []);

    const sameSong = (r) =>
      r.songId === activeSong.id ||
      (r.title.toLowerCase() === activeSong.title.toLowerCase() &&
        (r.artist || "").toLowerCase() === (activeSong.artist || "").toLowerCase());

    // birthday requests always get their own copy and skip the "already played" cooldown —
    // it's normal to sing it more than once a night for different people
    if (!birthday) {
      const nowPlayingMatch = latest.find((r) => sameSong(r) && r.status === "nowPlaying");
      if (nowPlayingMatch) {
        setActiveSong(null);
        setSendState("idle");
        setToast("That one's playing right now!");
        return;
      }
      const recentlyPlayed = latest.find((r) => {
        if (!sameSong(r) || r.status !== "done") return false;
        const playedAt = r.playedAt || r.ts;
        return Date.now() - playedAt < PLAYED_COOLDOWN_MS;
      });
      if (recentlyPlayed) {
        const playedAt = recentlyPlayed.playedAt || recentlyPlayed.ts;
        const remaining = Math.ceil((PLAYED_COOLDOWN_MS - (Date.now() - playedAt)) / 60000);
        setActiveSong(null);
        setSendState("idle");
        setToast(`Just played that one — try again in ${remaining} min`);
        return;
      }
    }

    const existingIdx = birthday ? -1 : latest.findIndex((r) => r.status === "pending" && sameSong(r));

    if (existingIdx >= 0 && myRequestedIds.includes(latest[existingIdx].id)) {
      setActiveSong(null);
      setSendState("idle");
      setToast("You've already put this one in — sit tight!");
      return;
    }

    let updated;
    let bumped = false;
    let newId = null;
    if (existingIdx >= 0) {
      bumped = true;
      const existing = latest[existingIdx];
      newId = existing.id;
      const merged = {
        ...existing,
        count: (existing.count || 1) + 1,
        names: name ? [...(existing.names || []), name] : existing.names || [],
        notes: noteEntries.length ? [...(existing.notes || []), ...noteEntries] : existing.notes || [],
        ts: Date.now(),
      };
      updated = [...latest];
      updated[existingIdx] = merged;
    } else {
      newId = uid();
      const newReq = {
        id: newId,
        songId: activeSong.id,
        title: activeSong.title,
        artist: activeSong.artist,
        count: 1,
        names: name ? [name] : [],
        notes: noteEntries,
        ts: Date.now(),
        status: "pending",
        priority: birthday && timing === "next",
      };
      updated = [newReq, ...latest];
    }
    await writeShared(KEYS.requests, updated);
    setRequests(updated);
    await markMyRequest(newId);

    // tally for end-of-session stats
    const stats = await readShared(KEYS.sessionStats, EMPTY_STATS);
    const statKey = `${activeSong.title.toLowerCase()}||${(activeSong.artist || "").toLowerCase()}`;
    const cur = stats.songCounts[statKey] || { title: activeSong.title, artist: activeSong.artist, count: 0 };
    cur.count += 1;
    stats.songCounts[statKey] = cur;
    if (name) {
      stats.namedCount = (stats.namedCount || 0) + 1;
    } else {
      stats.anonCount = (stats.anonCount || 0) + 1;
    }
    await writeShared(KEYS.sessionStats, stats);
    setLiveStats(stats);

    setSendState("sent");
    setTimeout(() => {
      setActiveSong(null);
      setReqName("");
      setReqNote("");
      setReqWhen("");
      setSendState("idle");
      setToast(
        birthday && timing === "next"
          ? "Jumped to the top of the queue! 🎉"
          : bumped
          ? "Already on the list — pushed it up!"
          : "Sent to the stage"
      );
    }, 900);
  }

  async function startSession() {
    const newConfig = {
      ...config,
      sessionActive: true,
      requestsOpen: true,
      sessionStartedAt: Date.now(),
      sessionVenue: venueInput.trim(),
      pauseUntil: null,
      doneForNight: false,
    };
    await writeShared(KEYS.config, newConfig);
    await writeShared(KEYS.sessionStats, EMPTY_STATS);
    await writeShared(KEYS.requests, []);
    await writeShared(KEYS.reactions, {});
    setConfig(newConfig);
    setRequests([]);
    setReactions({});
  }

  async function endSession() {
    const stats = await readShared(KEYS.sessionStats, EMPTY_STATS);
    const songCounts = Object.values(stats.songCounts).sort((a, b) => b.count - a.count);
    const missed = Object.values(stats.missed).sort((a, b) => b.count - a.count);

    // correlate fire reactions (keyed by request id) back to songs, so we can show
    // which songs the crowd actually reacted to, not just which were requested most
    const latestRequests = await readShared(KEYS.requests, []);
    const latestReactions = await readShared(KEYS.reactions, {});
    const fireTally = {};
    for (const reqId in latestReactions) {
      const count = latestReactions[reqId];
      if (!count) continue;
      const req = latestRequests.find((r) => r.id === reqId);
      if (!req) continue;
      const key = `${req.title.toLowerCase()}||${(req.artist || "").toLowerCase()}`;
      if (!fireTally[key]) fireTally[key] = { title: req.title, artist: req.artist, count: 0 };
      fireTally[key].count += count;
    }
    const songFires = Object.values(fireTally).sort((a, b) => b.count - a.count);
    const namedCount = stats.namedCount || 0;
    const anonCount = stats.anonCount || 0;
    const endedAt = Date.now();
    const startedAt = config.sessionStartedAt || endedAt;

    setSessionRecap({ songCounts, missed, songFires, namedCount, anonCount, startedAt, endedAt });

    // append to cross-session history
    const history = await readShared(KEYS.history, []);
    const entry = {
      id: uid(),
      startedAt,
      endedAt,
      venue: config.sessionVenue || "",
      songCounts: stats.songCounts,
      missed: stats.missed,
      songFires: fireTally,
      namedCount,
      anonCount,
    };
    const updatedHistory = [entry, ...history].slice(0, 100);
    await writeShared(KEYS.history, updatedHistory);

    const newConfig = { ...config, sessionActive: false, requestsOpen: false, pauseUntil: null, doneForNight: false };
    await writeShared(KEYS.config, newConfig);
    setConfig(newConfig);
    setVenueInput("");
  }

  async function pauseFor(minutes) {
    const newConfig = {
      ...config,
      requestsOpen: false,
      pauseUntil: Date.now() + minutes * 60 * 1000,
      doneForNight: false,
    };
    await writeShared(KEYS.config, newConfig);
    setConfig(newConfig);
    setPauseMinutes(null);
    setPauseChoosingDuration(false);
  }

  async function stopRequestsForNight() {
    const newConfig = {
      ...config,
      requestsOpen: false,
      pauseUntil: null,
      doneForNight: true,
    };
    await writeShared(KEYS.config, newConfig);
    setConfig(newConfig);
    setPauseMinutes(null);
    setPauseChoosingDuration(false);
  }

  async function resumeNow() {
    const newConfig = { ...config, requestsOpen: true, pauseUntil: null, doneForNight: false };
    await writeShared(KEYS.config, newConfig);
    setConfig(newConfig);
  }

  async function setNowPlaying(id) {
    const latest = await readShared(KEYS.requests, []);
    const updated = latest.map((r) => {
      if (r.id === id) return { ...r, status: "nowPlaying" };
      if (r.status === "nowPlaying") return { ...r, status: "done" };
      return r;
    });
    await writeShared(KEYS.requests, updated);
    setRequests(updated);
  }

  async function saveActiveSongs(updatedSongs) {
    const latestLists = await readShared(KEYS.setlists, setlists);
    const updated = latestLists.map((l) =>
      l.id === config.activeSetlistId ? { ...l, songs: updatedSongs } : l
    );
    await writeShared(KEYS.setlists, updated);
    setSetlists(updated);
  }

  async function createSetlist(name) {
    const latestLists = await readShared(KEYS.setlists, setlists);
    const newList = { id: uid(), name: name.trim() || "New Setlist", songs: [] };
    const updated = [...latestLists, newList];
    await writeShared(KEYS.setlists, updated);
    setSetlists(updated);
    const newConfig = { ...config, activeSetlistId: newList.id };
    await writeShared(KEYS.config, newConfig);
    setConfig(newConfig);
  }

  async function switchSetlist(id) {
    const newConfig = { ...config, activeSetlistId: id };
    await writeShared(KEYS.config, newConfig);
    setConfig(newConfig);
  }

  async function renameSetlist(id, name) {
    const latestLists = await readShared(KEYS.setlists, setlists);
    const updated = latestLists.map((l) => (l.id === id ? { ...l, name: name.trim() || l.name } : l));
    await writeShared(KEYS.setlists, updated);
    setSetlists(updated);
  }

  async function deleteSetlist(id) {
    const latestLists = await readShared(KEYS.setlists, setlists);
    if (latestLists.length <= 1) return;
    const updated = latestLists.filter((l) => l.id !== id);
    await writeShared(KEYS.setlists, updated);
    setSetlists(updated);
    if (config.activeSetlistId === id) {
      const newConfig = { ...config, activeSetlistId: updated[0].id };
      await writeShared(KEYS.config, newConfig);
      setConfig(newConfig);
    }
  }

  async function duplicateSetlist(id) {
    const latestLists = await readShared(KEYS.setlists, setlists);
    const source = latestLists.find((l) => l.id === id);
    if (!source) return;
    const copy = {
      id: uid(),
      name: `${source.name} (copy)`,
      songs: source.songs.map((s) => ({ ...s, id: uid() })),
    };
    const updated = [...latestLists, copy];
    await writeShared(KEYS.setlists, updated);
    setSetlists(updated);
    const newConfig = { ...config, activeSetlistId: copy.id };
    await writeShared(KEYS.config, newConfig);
    setConfig(newConfig);
  }

  async function updateSong(id, updates) {
    const activeList = setlists.find((l) => l.id === config.activeSetlistId);
    const updatedSongs = (activeList?.songs || []).map((s) =>
      s.id === id ? { ...s, ...updates } : s
    );
    await saveActiveSongs(updatedSongs);
  }

  async function toggleSongAvailability(id) {
    const activeList = setlists.find((l) => l.id === config.activeSetlistId);
    const updatedSongs = (activeList?.songs || []).map((s) =>
      s.id === id ? { ...s, unavailable: !s.unavailable } : s
    );
    await saveActiveSongs(updatedSongs);
  }

  async function toggleLastCall() {
    const newConfig = { ...config, lastCallActive: !config.lastCallActive };
    await writeShared(KEYS.config, newConfig);
    setConfig(newConfig);
  }

  async function toggleMuteAlerts() {
    const next = !muteAlerts;
    setMuteAlerts(next);
    await writePersonal(KEYS.muteAlerts, next);
  }

  async function toggleAutoClear() {
    const newConfig = { ...config, autoClearDone: !config.autoClearDone };
    await writeShared(KEYS.config, newConfig);
    setConfig(newConfig);
  }

  async function toggleReaction(requestId) {
    const latest = await readShared(KEYS.reactions, {});
    const updated = { ...latest, [requestId]: (latest[requestId] || 0) + 1 };
    await writeShared(KEYS.reactions, updated);
    setReactions(updated);
  }

  async function addSongFromMissed(title) {
    const activeList = setlists.find((l) => l.id === config.activeSetlistId);
    const latest = activeList?.songs || [];
    if (latest.some((s) => s.title.toLowerCase() === title.toLowerCase())) return;
    const newSong = { id: uid(), title, artist: "", genre: "", vibe: "", unavailable: false };
    await saveActiveSongs([...latest, newSong]);
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
      ...DEFAULT_CONFIG,
      ...config,
      bandName: setupBand.trim() || "The Band",
      personalInstagram: setupPersonalInsta.trim(),
      bandInstagram: setupBandInsta.trim(),
      tipLink: setupTip.trim(),
      pin: setupPin.trim(),
      setUp: true,
      requestsOpen: false,
      sessionActive: false,
      sessionStartedAt: null,
      sessionVenue: "",
      pauseUntil: null,
    };
    await writeShared(KEYS.config, newConfig);
    setConfig(newConfig);
    setLoginError("");
    setHostTab("songs");
    setView("host");
  }

  function submitPin() {
    const entered = pinInput.trim();
    if (entered === config.pin) {
      setHostRole("owner");
      setView("host");
      setLoginError("");
    } else if (config.helperPin && entered === config.helperPin) {
      setHostRole("helper");
      setHostTab("requests");
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
    const updated = latest.map((r) =>
      r.id === id ? { ...r, status, ...(status === "done" ? { playedAt: Date.now() } : {}) } : r
    );
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

  function handleCsvUpload(e, append) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvError("");

    const reader = new FileReader();
    reader.onload = () => {
      // strip a leading UTF-8 BOM if present — some spreadsheet exports (e.g. Excel/Numbers)
      // add one, which otherwise makes the first column header fail to match
      let text = String(reader.result || "");
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
          const rows = results.data;
          if (!rows.length) {
            setCsvError("That file looks empty.");
            return;
          }
          const cleanKey = (h) => h.replace(/^\ufeff/, "").trim();
          const rawKeys = Object.keys(rows[0]);
          const titleKey = rawKeys.find((h) => /title|song/i.test(cleanKey(h)));
          const artistKey = rawKeys.find((h) => /artist|by/i.test(cleanKey(h)));
          const genreKey = rawKeys.find((h) => /genre|category|style/i.test(cleanKey(h)));
          const vibeKey = rawKeys.find((h) => /vibe|mood|feel/i.test(cleanKey(h)));

          let parsed;
          if (titleKey) {
            parsed = rows
              .map((r) => ({
                id: uid(),
                title: (r[titleKey] || "").trim(),
                artist: artistKey ? (r[artistKey] || "").trim() : "",
                genre: genreKey ? (r[genreKey] || "").trim() : "",
                vibe: vibeKey ? (r[vibeKey] || "").trim() : "",
              }))
              .filter((s) => s.title);
          } else {
            // no header matched — treat first column as title, second as artist
            const keys = rawKeys;
            parsed = rows
              .map((r) => ({
                id: uid(),
                title: (r[keys[0]] || "").trim(),
                artist: keys[1] ? (r[keys[1]] || "").trim() : "",
                genre: keys[2] ? (r[keys[2]] || "").trim() : "",
                vibe: keys[3] ? (r[keys[3]] || "").trim() : "",
              }))
              .filter((s) => s.title);
          }
          if (!parsed.length) {
            setCsvError("Couldn't find any song titles in that file.");
            return;
          }
          if (append) {
            const activeList = setlists.find((l) => l.id === config.activeSetlistId);
            await saveActiveSongs([...(activeList?.songs || []), ...parsed]);
          } else {
            await saveActiveSongs(parsed);
          }
          if (fileInputRef.current) fileInputRef.current.value = "";
        },
        error: () => setCsvError("Couldn't read that file. Try a plain CSV export."),
      });
    };
    reader.onerror = () => setCsvError("Couldn't read that file. Try a plain CSV export.");
    reader.readAsText(file, "utf-8");
  }

  async function addManualSong() {
    if (!manualTitle.trim()) return;
    const newSong = {
      id: uid(),
      title: manualTitle.trim(),
      artist: manualArtist.trim(),
      genre: manualGenre.trim(),
      vibe: "",
      unavailable: false,
    };
    const activeList = setlists.find((l) => l.id === config.activeSetlistId);
    const latest = activeList?.songs || [];
    await saveActiveSongs([...latest, newSong]);
    setManualTitle("");
    setManualArtist("");
    setManualGenre("");
  }

  async function removeSong(id) {
    const activeList = setlists.find((l) => l.id === config.activeSetlistId);
    const latest = activeList?.songs || [];
    await saveActiveSongs(latest.filter((s) => s.id !== id));
  }

  async function saveSettings() {
    setSavingSettings(true);
    const newConfig = {
      ...config,
      bandName: setupBand.trim() || config.bandName,
      personalInstagram: setupPersonalInsta.trim(),
      bandInstagram: setupBandInsta.trim(),
      tipLink: setupTip.trim(),
      publicLink: setupPublicLink.trim(),
      bannerImageUrl: setupBannerImageUrl.trim(),
      pin: setupPin.trim() ? setupPin.trim() : config.pin,
      helperPin: setupHelperPin.trim(),
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

  async function setTheme(theme) {
    const newConfig = { ...config, theme };
    await writeShared(KEYS.config, newConfig);
    setConfig(newConfig);
  }

  if (!loaded || !config || !setlists || !requests) {
    return (
      <Shell theme="retro">
        <div className="flex flex-col items-center justify-center h-full gap-3 text-cream/70">
          <Loader2 className="animate-spin" size={28} />
          <span className="font-body text-sm tracking-wide">Tuning up…</span>
        </div>
      </Shell>
    );
  }

  const pendingCount = requests.filter((r) => r.status === "pending").length;

  return (
    <Shell theme={config.theme || "retro"}>
      {view === "audience" && (
        <AudienceView
          config={config}
          songs={filteredSongs}
          allSongs={availableSongs}
          totalSongs={availableSongs.length}
          queue={sortPending(requests)}
          nowPlaying={(requests || []).find((r) => r.status === "nowPlaying") || null}
          reactions={reactions}
          toggleReaction={toggleReaction}
          quickQueue={quickQueue}
          queryTitle={queryTitle}
          setQueryTitle={setQueryTitle}
          queryArtist={queryArtist}
          setQueryArtist={setQueryArtist}
          activeSong={activeSong}
          setActiveSong={setActiveSong}
          reqName={reqName}
          setReqName={setReqName}
          reqNote={reqNote}
          setReqNote={setReqNote}
          reqWhen={reqWhen}
          setReqWhen={setReqWhen}
          sendState={sendState}
          sendRequest={sendRequest}
          onHostTap={tryHostEntry}
          toast={toast}
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
          setlists={setlists}
          createSetlist={createSetlist}
          switchSetlist={switchSetlist}
          renameSetlist={renameSetlist}
          deleteSetlist={deleteSetlist}
          duplicateSetlist={duplicateSetlist}
          updateSong={updateSong}
          toggleSongAvailability={toggleSongAvailability}
          hostRole={hostRole}
          toggleLastCall={toggleLastCall}
          muteAlerts={muteAlerts}
          toggleMuteAlerts={toggleMuteAlerts}
          toggleAutoClear={toggleAutoClear}
          reactions={reactions}
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
          setupHelperPin={setupHelperPin}
          setSetupHelperPin={setSetupHelperPin}
          setupBannerImageUrl={setupBannerImageUrl}
          setSetupBannerImageUrl={setSetupBannerImageUrl}
          saveSettings={saveSettings}
          savingSettings={savingSettings}
          settingsSaved={settingsSaved}
          toggleRequestsOpen={toggleRequestsOpen}
          startSession={startSession}
          endSession={endSession}
          setNowPlaying={setNowPlaying}
          pauseFor={pauseFor}
          resumeNow={resumeNow}
          stopRequestsForNight={stopRequestsForNight}
          pauseMinutes={pauseMinutes}
          setPauseMinutes={setPauseMinutes}
          pauseChoosingDuration={pauseChoosingDuration}
          setPauseChoosingDuration={setPauseChoosingDuration}
          venueInput={venueInput}
          setVenueInput={setVenueInput}
          setupPublicLink={setupPublicLink}
          setSetupPublicLink={setSetupPublicLink}
          setTheme={setTheme}
          onOpenSettings={() => {
            setSetupBand(config.bandName);
            setSetupPersonalInsta(config.personalInstagram);
            setSetupBandInsta(config.bandInstagram);
            setSetupTip(config.tipLink);
            setSetupPublicLink(config.publicLink || "");
            setSetupBannerImageUrl(config.bannerImageUrl || "");
            setSetupHelperPin("");
            setSetupPin("");
          }}
          onLogout={() => {
            setHostRole("owner");
            setView("audience");
          }}
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
function Shell({ children, theme = "retro" }) {
  return (
    <div className="pr-root" data-theme={theme}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Space+Mono:wght@400;700&family=VT323&family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

        .pr-root {
          /* retro (default) */
          --ink: #08020f;
          --ink-raised: #140a24;
          --ink-card: #1b0e30;
          --cream: #eafcff;
          --cream-dim: #a6b8d6;
          --amber: #00f0ff;
          --amber-soft: rgba(0, 240, 255, 0.12);
          --on-amber: #05020a;
          --burgundy: #ff2e63;
          --brass: #8b5cf6;
          --green: #39ff14;
          --line: rgba(0, 240, 255, 0.18);

          --ff-display: 'Space Mono', monospace;
          --tt-display: uppercase;
          --ls-display: 0.03em;
          --fw-display: 700;
          --ff-pixel: 'Press Start 2P', monospace;
          --ff-mono: 'VT323', monospace;
          --mono-size: 1.05em;
          --ff-body: 'Space Mono', monospace;

          --radius: 4px;
          --card-border: 2px;
          --btn-shadow-amber: 3px 3px 0 #000;
          --btn-shadow-amber-active: 1px 1px 0 #000;
          --btn-shadow-outline: 2px 2px 0 rgba(0,240,255,0.3);
          --btn-shadow-outline-active: 1px 1px 0 rgba(0,240,255,0.3);
          --toggle-radius: 4px;
          --scanline-display: block;
          --bg-grid: linear-gradient(rgba(139,92,246,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(139,92,246,0.08) 1px, transparent 1px);
          --bg-grid-size: 24px 24px;
          --modal-shadow: 0 0 20px rgba(0,240,255,0.25);

          font-family: var(--ff-body);
          background: var(--ink);
          color: var(--cream);
          min-height: 100vh;
          width: 100%;
          position: relative;
          background-image: var(--bg-grid);
          background-size: var(--bg-grid-size);
        }

        /* ---------- Original (warm pub jukebox) ---------- */
        .pr-root[data-theme="original"] {
          --ink: #1B1712;
          --ink-raised: #24201A;
          --ink-card: #2A2420;
          --cream: #F1E7D2;
          --cream-dim: #C9BFA9;
          --amber: #E8A33D;
          --amber-soft: rgba(232, 163, 61, 0.14);
          --on-amber: #201404;
          --burgundy: #8C4A44;
          --brass: #6E5A3B;
          --green: #7FA66E;
          --line: rgba(241, 231, 210, 0.12);

          --ff-display: 'Oswald', sans-serif;
          --tt-display: none;
          --ls-display: 0.02em;
          --fw-display: 600;
          --ff-pixel: 'Oswald', sans-serif;
          --ff-mono: 'JetBrains Mono', monospace;
          --mono-size: 1em;
          --ff-body: 'Inter', sans-serif;

          --radius: 10px;
          --card-border: 1px;
          --btn-shadow-amber: none;
          --btn-shadow-amber-active: none;
          --btn-shadow-outline: none;
          --btn-shadow-outline-active: none;
          --toggle-radius: 999px;
          --scanline-display: none;
          --bg-grid: none;
          --bg-grid-size: 0 0;
          --modal-shadow: none;
        }

        /* ---------- Dark (clean modern) ---------- */
        .pr-root[data-theme="dark"] {
          --ink: #0f1115;
          --ink-raised: #171a20;
          --ink-card: #1e2229;
          --cream: #e8eaed;
          --cream-dim: #9aa0a8;
          --amber: #5b8def;
          --amber-soft: rgba(91, 141, 239, 0.14);
          --on-amber: #0b1220;
          --burgundy: #f87171;
          --brass: #3f4650;
          --green: #34d399;
          --line: rgba(255,255,255,0.08);

          --ff-display: 'Inter', sans-serif;
          --tt-display: none;
          --ls-display: 0;
          --fw-display: 700;
          --ff-pixel: 'Inter', sans-serif;
          --ff-mono: 'JetBrains Mono', monospace;
          --mono-size: 1em;
          --ff-body: 'Inter', sans-serif;

          --radius: 10px;
          --card-border: 1px;
          --btn-shadow-amber: none;
          --btn-shadow-amber-active: none;
          --btn-shadow-outline: none;
          --btn-shadow-outline-active: none;
          --toggle-radius: 999px;
          --scanline-display: none;
          --bg-grid: none;
          --bg-grid-size: 0 0;
          --modal-shadow: 0 8px 30px rgba(0,0,0,0.4);
        }

        /* ---------- Light (bright & simple) ---------- */
        .pr-root[data-theme="light"] {
          --ink: #f7f7fb;
          --ink-raised: #ffffff;
          --ink-card: #ffffff;
          --cream: #14151a;
          --cream-dim: #5b5f6a;
          --amber: #4f46e5;
          --amber-soft: rgba(79, 70, 229, 0.1);
          --on-amber: #ffffff;
          --burgundy: #dc2626;
          --brass: #d1d5db;
          --green: #16a34a;
          --line: rgba(20,21,26,0.12);

          --ff-display: 'Inter', sans-serif;
          --tt-display: none;
          --ls-display: 0;
          --fw-display: 700;
          --ff-pixel: 'Inter', sans-serif;
          --ff-mono: 'JetBrains Mono', monospace;
          --mono-size: 1em;
          --ff-body: 'Inter', sans-serif;

          --radius: 10px;
          --card-border: 1px;
          --btn-shadow-amber: none;
          --btn-shadow-amber-active: none;
          --btn-shadow-outline: none;
          --btn-shadow-outline-active: none;
          --toggle-radius: 999px;
          --scanline-display: none;
          --bg-grid: none;
          --bg-grid-size: 0 0;
          --modal-shadow: 0 8px 30px rgba(0,0,0,0.12);
        }

        .pr-root::before {
          content: "";
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 999;
          display: var(--scanline-display);
          background: repeating-linear-gradient(
            0deg,
            rgba(0,0,0,0.12) 0px,
            rgba(0,0,0,0.12) 1px,
            transparent 1px,
            transparent 3px
          );
          mix-blend-mode: overlay;
        }
        .pr-root, .pr-root * { box-sizing: border-box; }
        .font-display { font-family: var(--ff-display); font-weight: var(--fw-display); letter-spacing: var(--ls-display); text-transform: var(--tt-display); }
        .font-pixel { font-family: var(--ff-pixel); line-height: 1.5; }
        .pr-root[data-theme="retro"] .font-pixel { text-shadow: 2px 2px 0 rgba(0,0,0,0.5); }
        .font-mono { font-family: var(--ff-mono); font-size: var(--mono-size); }
        .font-body { font-family: var(--ff-body); }
        .text-cream { color: var(--cream); }
        .text-cream\\/70 { color: var(--cream); opacity: 0.7; }
        .text-cream\\/50 { color: var(--cream); opacity: 0.5; }
        .bg-ink { background: var(--ink); }
        .bg-ink-raised { background: var(--ink-raised); }
        .bg-ink-card { background: var(--ink-card); }
        .border-line { border-color: var(--line); }
        .text-amber { color: var(--amber); }
        .bg-amber { background: var(--amber); }
        .text-burgundy { color: var(--burgundy); }
        .text-green { color: var(--green); }
        .bg-green { background: var(--green); }
        .bg-amber-soft { background: var(--amber-soft); }
        .border-burgundy { border-color: var(--burgundy) !important; }
        .border-amber { border-color: var(--amber) !important; }

        .pulse-dot {
          width: 10px; height: 10px; border-radius: 2px;
          background: var(--green);
          box-shadow: 0 0 8px var(--green);
          animation: pulseDot 1s steps(2) infinite;
        }
        @keyframes pulseDot {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0.35; }
        }
        .paused-dot {
          width: 10px; height: 10px; border-radius: 2px;
          background: var(--brass);
        }

        .song-row {
          background: var(--ink-card);
          border: var(--card-border) solid var(--line);
          border-radius: var(--radius);
          transition: border-color 0.15s ease, transform 0.1s ease;
        }
        .song-row:active { transform: scale(0.99); }
        .song-row:hover { border-color: var(--amber); }

        .genre-section {
          background: var(--ink-card);
          border: var(--card-border) solid var(--line);
          border-radius: var(--radius);
        }
        .genre-header {
          background: transparent;
          transition: background 0.15s ease;
        }
        .genre-header:hover { background: var(--amber-soft); }

        .ticket-num {
          font-family: var(--ff-mono);
          font-size: 1.3em;
          color: var(--amber);
          border-right: 2px dashed var(--brass);
        }

        .btn-amber {
          background: var(--amber);
          color: var(--on-amber);
          font-weight: 700;
          text-transform: var(--tt-display);
          letter-spacing: var(--ls-display);
          border: var(--card-border) solid var(--line);
          border-radius: var(--radius) !important;
          box-shadow: var(--btn-shadow-amber);
          transition: transform 0.08s ease, box-shadow 0.08s ease, filter 0.15s ease;
        }
        .pr-root[data-theme="retro"] .btn-amber { border-color: #000; }
        .btn-amber:hover { filter: brightness(1.1); }
        .btn-amber:active { transform: translate(2px, 2px); box-shadow: var(--btn-shadow-amber-active); }
        .btn-amber:disabled { opacity: 0.5; }

        .btn-outline {
          background: var(--ink-raised);
          border: var(--card-border) solid var(--amber);
          color: var(--cream);
          border-radius: var(--radius) !important;
          text-transform: var(--tt-display);
          letter-spacing: var(--ls-display);
          box-shadow: var(--btn-shadow-outline);
          transition: border-color 0.15s ease, background 0.15s ease, transform 0.08s ease;
        }
        .btn-outline:hover { background: var(--amber-soft); }
        .btn-outline:active { transform: translate(1px, 1px); box-shadow: var(--btn-shadow-outline-active); }

        .modal-backdrop {
          background: rgba(2, 0, 8, 0.72);
          backdrop-filter: blur(2px);
          animation: fadeIn 0.15s ease;
        }
        .modal-card {
          background: var(--ink-raised);
          border: var(--card-border) solid var(--amber);
          box-shadow: var(--modal-shadow);
          animation: slideUp 0.2s ease;
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }

        .toast {
          background: var(--ink-raised);
          border: var(--card-border) solid var(--green);
          box-shadow: 0 0 12px rgba(57,255,20,0.2);
          animation: toastIn 0.2s ease;
        }
        @keyframes toastIn { from { opacity: 0; transform: translate(-50%, 8px); } to { opacity: 1; transform: translate(-50%, 0); } }

        .req-card {
          background: var(--ink-card);
          border: var(--card-border) solid var(--line);
          border-left: 4px solid var(--amber);
          border-radius: var(--radius);
        }
        .req-card.done {
          border-left-color: var(--brass);
          opacity: 0.55;
        }

        input, textarea {
          background: var(--ink);
          border: var(--card-border) solid var(--line);
          border-radius: var(--radius);
          color: var(--cream);
          font-family: var(--ff-body);
        }
        input::placeholder, textarea::placeholder { color: var(--cream); opacity: 0.35; }
        input:focus, textarea:focus {
          outline: none;
          border-color: var(--amber);
          box-shadow: 0 0 0 3px var(--amber-soft);
        }
        button:focus-visible, input:focus-visible, textarea:focus-visible, [tabindex]:focus-visible {
          outline: 2px solid var(--amber);
          outline-offset: 2px;
        }

        .tab-btn {
          color: var(--cream);
          opacity: 0.55;
          border-bottom: 3px solid transparent;
          text-transform: var(--tt-display);
          letter-spacing: var(--ls-display);
        }
        .tab-btn.active {
          color: var(--amber);
          opacity: 1;
          border-bottom-color: var(--amber);
        }

        .toggle-switch {
          width: 46px; height: 26px; border-radius: var(--toggle-radius);
          background: var(--line);
          border: var(--card-border) solid var(--line);
          position: relative;
          transition: background 0.2s ease;
        }
        .toggle-switch[data-on="true"] { background: var(--green); box-shadow: 0 0 8px rgba(57,255,20,0.3); }
        .toggle-knob {
          position: absolute;
          top: 2px; left: 2px;
          width: 18px; height: 18px;
          border-radius: calc(var(--toggle-radius) / 2);
          background: var(--cream);
          transition: transform 0.15s ease;
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
  allSongs,
  totalSongs,
  queue,
  nowPlaying,
  reactions,
  toggleReaction,
  quickQueue,
  queryTitle,
  setQueryTitle,
  queryArtist,
  setQueryArtist,
  activeSong,
  setActiveSong,
  reqName,
  setReqName,
  reqNote,
  setReqNote,
  reqWhen,
  setReqWhen,
  sendState,
  sendRequest,
  onHostTap,
  toast,
}) {
  const live = config.sessionActive && config.requestsOpen;
  const effectiveConfig = { ...config, requestsOpen: live };
  const showQuickQueue = config.sessionActive && !live && !config.doneForNight;
  const [queueOpen, setQueueOpen] = useState(false);
  const [showWhenInput, setShowWhenInput] = useState(false);
  const [countdown, setCountdown] = useState("");

  function isSongQueued(song) {
    return (queue || []).some(
      (r) =>
        r.songId === song.id ||
        (r.title.toLowerCase() === song.title.toLowerCase() &&
          (r.artist || "").toLowerCase() === (song.artist || "").toLowerCase())
    );
  }

  useEffect(() => {
    if (!config.pauseUntil) {
      setCountdown("");
      return;
    }
    const tick = () => {
      const diff = config.pauseUntil - Date.now();
      if (diff <= 0) {
        setCountdown("any moment now");
        return;
      }
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setCountdown(mins > 0 ? `${mins}m ${secs}s` : `${secs}s`);
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [config.pauseUntil]);

  useEffect(() => {
    setShowWhenInput(false);
  }, [activeSong]);

  function goTo(url) {
    window.open(url, "_self");
  }

  return (
    <div className="flex flex-col flex-1 px-4 pb-10">
      {config.lastCallActive && (
        <div className="mt-6 px-3.5 py-3 rounded-lg bg-amber-soft border-2 border-amber flex items-center gap-2.5">
          <Megaphone size={18} className="text-amber shrink-0" />
          <p className="font-body text-sm font-semibold">
            Last call! Get your final requests in for the night 🎤
          </p>
        </div>
      )}

      {config.bannerImageUrl && (
        <img
          src={config.bannerImageUrl}
          alt=""
          className={`w-full h-28 object-cover rounded-lg ${config.lastCallActive ? "mt-3" : "mt-6"}`}
        />
      )}

      {/* header */}
      <div className="pt-8 pb-5 border-b border-line">
        <div className="flex items-center gap-2.5 mb-1.5">
          <span className={live ? "pulse-dot" : "paused-dot"} />
          <span className="font-mono text-sm font-semibold uppercase tracking-[0.2em] text-cream/80">
            {config.sessionActive
              ? live
                ? "Taking requests now"
                : config.doneForNight
                ? "Not taking more requests tonight"
                : "Taking a quick break"
              : "Not taking requests right now"}
          </span>
        </div>
        {config.sessionActive ? (
          <div className="mb-2">
            {config.sessionVenue && (
              <p className="font-display text-lg leading-snug break-words">
                Hello! Welcome to <span className="text-amber">{config.sessionVenue}</span>
              </p>
            )}
            <p className="font-display text-xl leading-snug break-words">
              You are listening to <span className="text-amber">{config.bandName}</span>
            </p>
          </div>
        ) : (
          <h1 className="font-pixel text-lg leading-snug break-words">
            {config.bandName}
          </h1>
        )}
        <div className="flex gap-2 mt-4">
          {config.personalInstagram && (
            <button
              onClick={() => goTo(instaUrl(config.personalInstagram))}
              className="btn-outline flex-1 min-w-0 flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-full text-sm font-body"
            >
              <Instagram size={15} className="shrink-0" />
              <span className="break-words leading-tight">{instaHandle(config.personalInstagram)}</span>
            </button>
          )}
          {config.bandInstagram && (
            <button
              onClick={() => goTo(instaUrl(config.bandInstagram))}
              className="btn-outline flex-1 min-w-0 flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-full text-sm font-body"
            >
              <Instagram size={15} className="shrink-0" />
              <span className="break-words leading-tight">{instaHandle(config.bandInstagram)}</span>
            </button>
          )}
          {config.tipLink && (
            <button
              onClick={() => goTo(normalizeUrl(config.tipLink))}
              className="btn-amber shrink-0 flex items-center justify-center gap-1.5 px-3 py-2 rounded-full text-xs font-body"
            >
              <HeartHandshake size={13} className="shrink-0" />
              <span className="whitespace-nowrap">Tip</span>
            </button>
          )}
        </div>
      </div>

      {nowPlaying && (
        <div className="mt-4 px-3.5 py-3 rounded-lg bg-amber-soft border-2 border-amber flex items-center gap-2.5">
          <Play size={16} className="text-amber shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-amber">Now playing</p>
            <p className="font-body font-semibold text-sm truncate">{nowPlaying.title}</p>
          </div>
          <button
            onClick={() => toggleReaction(nowPlaying.id)}
            className="btn-amber shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-body"
          >
            <Flame size={13} fill="currentColor" />
            {(reactions && reactions[nowPlaying.id]) || 0}
          </button>
        </div>
      )}

      {!live && (
        <div className="mt-4 px-3 py-2.5 rounded-lg bg-ink-card border border-line">
          <p className="font-body text-sm text-cream/60">
            {config.sessionActive
              ? config.doneForNight
                ? "That's a wrap on requests for tonight — thanks for playing along! Feel free to browse the setlist or drop a tip."
                : config.pauseUntil
                ? `The band's taking a quick break — back in about ${countdown}. Feel free to browse the setlist, ♥ a song to queue it up for when they're back, or drop a tip.`
                : "The band's taking a short break from requests — check back shortly. Feel free to browse the setlist, ♥ a song to queue it up for when they're back, or drop a tip."
              : "The band hasn't started taking requests yet — check back once they're live. Feel free to browse the setlist or drop a tip."}
          </p>
        </div>
      )}

      {/* live queue — separate from song browsing */}
      {queue.length > 0 && (
        <div className="mt-4 genre-section rounded-[10px] overflow-hidden">
          <button
            onClick={() => setQueueOpen((v) => !v)}
            className="genre-header w-full flex items-center justify-between px-3.5 py-3 text-left"
          >
            <span className="flex items-baseline gap-2">
              <ListMusic size={15} className="text-amber shrink-0 self-center" />
              <span className="font-display text-base">Up next</span>
              <span className="font-mono text-[11px] text-cream/40">{queue.length}</span>
            </span>
            <ChevronDown
              size={16}
              className={`text-amber transition-transform duration-150 ${queueOpen ? "rotate-180" : ""}`}
            />
          </button>
          {queueOpen && (
            <ul className="flex flex-col gap-2 px-2 pb-2.5 pt-0.5">
              {queue.map((r) => (
                <li key={r.id} className="song-row flex items-center justify-between px-3 py-2.5">
                  <div className="min-w-0 flex items-center gap-1.5">
                    {r.priority && <Flame size={13} className="text-amber shrink-0" fill="currentColor" />}
                    <div className="min-w-0">
                      <p className="font-body font-semibold text-[15px] truncate">{r.title}</p>
                      {r.artist && <p className="font-body text-xs text-cream/50 truncate">{r.artist}</p>}
                    </div>
                  </div>
                  {(r.count || 1) > 1 && (
                    <span className="bg-amber text-ink text-[11px] font-mono font-bold rounded-full px-1.5 py-0.5 shrink-0 ml-2">
                      ×{r.count}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* search */}
      <div className="pt-4 pb-2 flex gap-2">
        <div className="relative flex-1 min-w-0">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-cream/50"
          />
          <input
            value={queryTitle}
            onChange={(e) => setQueryTitle(e.target.value)}
            placeholder="Song…"
            className="w-full pl-9 pr-3 py-2.5 rounded-lg text-sm font-body"
          />
        </div>
        <div className="relative flex-1 min-w-0">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-cream/50"
          />
          <input
            value={queryArtist}
            onChange={(e) => setQueryArtist(e.target.value)}
            placeholder="Artist…"
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
        ) : queryTitle.trim() || queryArtist.trim() ? (
          <ul className="flex flex-col gap-2">
            {songs.map((song) => (
              <SongRow
                key={song.id}
                song={song}
                config={effectiveConfig}
                onTap={() => setActiveSong(song)}
                isQueued={isSongQueued(song)}
                onQuickQueue={showQuickQueue ? () => quickQueue(song) : null}
              />
            ))}
          </ul>
        ) : (
          <GenreAccordion
            songs={songs}
            config={effectiveConfig}
            onSelectSong={setActiveSong}
            isSongQueued={isSongQueued}
            quickQueue={showQuickQueue ? quickQueue : null}
          />
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
          className="fixed inset-0 z-40 flex items-center justify-center px-4 modal-backdrop"
          onClick={() => sendState !== "sending" && setActiveSong(null)}
        >
          <div
            className="modal-card w-full max-w-sm rounded-2xl p-5"
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
                  placeholder={isBirthdaySong(activeSong.title) ? "Whose birthday is it?" : "Your name (optional)"}
                  className="w-full px-3 py-2.5 rounded-lg text-sm font-body mb-2"
                />
                <textarea
                  value={reqNote}
                  onChange={(e) => setReqNote(e.target.value)}
                  placeholder={
                    isBirthdaySong(activeSong.title)
                      ? "Do you have a message for the birthday boy/girl? (optional)"
                      : "Add a note — e.g. 'shoutout to Sarah!' (optional)"
                  }
                  rows={2}
                  className="w-full px-3 py-2.5 rounded-lg text-sm font-body mb-4 resize-none"
                />
                {isBirthdaySong(activeSong.title) ? (
                  showWhenInput ? (
                    <div className="flex flex-col gap-2">
                      <input
                        value={reqWhen}
                        onChange={(e) => setReqWhen(e.target.value)}
                        placeholder="When? e.g. 'after this song', 'in 20 mins'"
                        className="w-full px-3 py-2.5 rounded-lg text-sm font-body"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => setShowWhenInput(false)}
                          className="btn-outline flex-1 py-3 rounded-lg font-body"
                        >
                          Back
                        </button>
                        <button
                          onClick={() => sendRequest("later")}
                          disabled={sendState === "sending"}
                          className="btn-amber flex-1 py-3 rounded-lg font-body flex items-center justify-center gap-2"
                        >
                          {sendState === "sending" ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <Check size={16} />
                          )}
                          Confirm
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <button
                        onClick={() => sendRequest("next")}
                        disabled={sendState === "sending"}
                        className="btn-amber w-full py-3 rounded-lg font-body flex items-center justify-center gap-2"
                      >
                        {sendState === "sending" ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <Flame size={16} />
                        )}
                        Sing next
                      </button>
                      <button
                        onClick={() => setShowWhenInput(true)}
                        disabled={sendState === "sending"}
                        className="btn-outline w-full py-3 rounded-lg font-body flex items-center justify-center gap-2"
                      >
                        <Music2 size={16} />
                        Sing later
                      </button>
                    </div>
                  )
                ) : (
                  <button
                    onClick={() => sendRequest()}
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
                )}
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

function SongRow({ song, config, onTap, index, isQueued, onQuickQueue }) {
  return (
    <li className="flex items-stretch gap-1.5">
      <button
        onClick={() => config.requestsOpen && onTap()}
        disabled={!config.requestsOpen}
        className={`song-row flex-1 flex items-stretch text-left rounded-[10px] overflow-hidden ${!config.requestsOpen ? "opacity-50 cursor-default" : ""}`}
      >
        {index != null && (
          <div className="ticket-num flex items-center justify-center w-11 shrink-0 text-xs">
            {String(index + 1).padStart(2, "0")}
          </div>
        )}
        <div className="flex-1 px-3 py-3 min-w-0">
          <p className="font-body font-semibold text-[15px] truncate">{song.title}</p>
          <div className="flex items-center gap-2">
            {song.artist && (
              <p className="font-body text-xs text-cream/50 truncate">{song.artist}</p>
            )}
            {song.vibe && (
              <span className="font-mono text-[10px] text-amber border border-amber rounded-full px-1.5 shrink-0">
                {song.vibe}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center pr-3 text-cream/30">
          {config.requestsOpen && <ChevronRight size={16} />}
        </div>
      </button>
      {onQuickQueue && (
        <button
          onClick={onQuickQueue}
          aria-label={isQueued ? "Already queued" : "Add to queue"}
          className="song-row w-11 shrink-0 flex items-center justify-center"
        >
          <Heart size={16} className={isQueued ? "text-burgundy" : "text-cream/30"} fill={isQueued ? "currentColor" : "none"} />
        </button>
      )}
    </li>
  );
}

function GenreAccordion({ songs, config, onSelectSong, isSongQueued, quickQueue }) {
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
                  <SongRow
                    key={song.id}
                    song={song}
                    config={config}
                    index={i}
                    onTap={() => onSelectSong(song)}
                    isQueued={isSongQueued ? isSongQueued(song) : false}
                    onQuickQueue={quickQueue ? () => quickQueue(song) : null}
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}
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
  const { songCounts, missed, songFires = [], namedCount = 0, anonCount = 0, startedAt, endedAt } = recap;
  const totalRequests = songCounts.reduce((sum, s) => sum + s.count, 0);
  const totalMissed = missed.reduce((sum, m) => sum + m.count, 0);
  const birthdayCount = songCounts
    .filter((s) => isBirthdaySong(s.title))
    .reduce((sum, s) => sum + s.count, 0);
  const durationHrs = startedAt && endedAt ? Math.max((endedAt - startedAt) / 3600000, 1 / 60) : null;
  const perHour = durationHrs ? (totalRequests / durationHrs).toFixed(1) : null;
  const totalNamed = namedCount + anonCount;

  function handleAdd(title) {
    onAddMissedSong(title);
    setAdded((prev) => ({ ...prev, [title]: true }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center modal-backdrop">
      <div className="modal-card w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 max-h-[85vh] min-h-0 overflow-y-auto overscroll-contain">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-amber mb-1">
          Session recap
        </p>
        <h2 className="font-display text-2xl mb-4">{bandName}'s set is done</h2>

        <div className="grid grid-cols-2 gap-2 mb-2">
          <div className="song-row px-3 py-3 text-center">
            <p className="font-display text-2xl text-amber">{totalRequests}</p>
            <p className="font-body text-[11px] text-cream/50 mt-0.5">Requests sent</p>
          </div>
          <div className={`song-row px-3 py-3 text-center ${totalMissed > 0 ? "border-burgundy" : ""}`}>
            <p className={`font-display text-2xl ${totalMissed > 0 ? "text-burgundy" : "text-amber"}`}>
              {totalMissed}
            </p>
            <p className="font-body text-[11px] text-cream/50 mt-0.5">Songs searched you didn't have</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-5 px-1">
          {perHour && (
            <p className="font-mono text-[11px] text-cream/40">~{perHour}/hr</p>
          )}
          {totalNamed > 0 && (
            <p className="font-mono text-[11px] text-cream/40">
              {namedCount} named · {anonCount} anonymous
            </p>
          )}
          {birthdayCount > 0 && (
            <p className="font-mono text-[11px] text-cream/40">🎂 {birthdayCount} birthday{birthdayCount !== 1 ? "s" : ""}</p>
          )}
        </div>

        {missed.length > 0 && (
          <div className="mb-5 px-3 py-2.5 rounded-lg bg-amber-soft border border-line">
            <p className="font-body text-xs text-cream/70">
              Heads up — {missed.length} different song{missed.length !== 1 ? "s were" : " was"} searched for tonight that {missed.length !== 1 ? "aren't" : "isn't"} on your setlist. See the list below.
            </p>
          </div>
        )}

        <div className="mb-5">
          <p className="font-body text-sm font-semibold mb-2 flex items-center gap-1.5">
            <Search size={14} className="text-burgundy" /> Songs people wanted but you didn't have
          </p>
          {missed.length === 0 ? (
            <p className="font-body text-xs text-cream/40">Nothing came up empty tonight — nice setlist.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {missed.map((m, i) => (
                <li key={i} className="song-row flex items-center justify-between px-3 py-2 gap-2">
                  <div className="min-w-0 flex items-center gap-2">
                    <p className="font-body text-sm truncate">{m.query}</p>
                    <span className="font-mono text-xs text-burgundy shrink-0">×{m.count}</span>
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

        {songFires.length > 0 && (
          <div className="mb-5">
            <p className="font-body text-sm font-semibold mb-2 flex items-center gap-1.5">
              <Flame size={14} className="text-amber" /> Went down well
            </p>
            <ul className="flex flex-col gap-1.5">
              {songFires.map((s, i) => (
                <li key={i} className="song-row flex items-center justify-between px-3 py-2">
                  <div className="min-w-0">
                    <p className="font-body text-sm truncate">{s.title}</p>
                    {s.artist && <p className="font-body text-xs text-cream/50 truncate">{s.artist}</p>}
                  </div>
                  <span className="font-mono text-xs text-amber shrink-0 ml-2 flex items-center gap-1">
                    <Flame size={12} fill="currentColor" /> {s.count}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

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
        <input value={setupBand} onChange={(e) => setSetupBand(e.target.value)} placeholder="The Band" className="w-full px-3 py-2.5 rounded-lg text-sm font-body" />
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
  config, songs, setlists, requests,
  createSetlist, switchSetlist, renameSetlist, deleteSetlist, duplicateSetlist, updateSong, toggleSongAvailability,
  muteAlerts, toggleMuteAlerts, toggleAutoClear,
  hostRole, toggleLastCall, reactions,
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
  setupHelperPin, setSetupHelperPin,
  setupBannerImageUrl, setSetupBannerImageUrl,
  setupPublicLink, setSetupPublicLink,
  setTheme,
  saveSettings, savingSettings, settingsSaved,
  toggleRequestsOpen, startSession, endSession,
  setNowPlaying, pauseFor, resumeNow, stopRequestsForNight, pauseMinutes, setPauseMinutes,
  pauseChoosingDuration, setPauseChoosingDuration,
  venueInput, setVenueInput,
  onOpenSettings, onLogout,
}) {
  const pending = sortPending(requests);
  const done = requests.filter((r) => r.status === "done").sort((a, b) => b.ts - a.ts);
  const nowPlaying = requests.find((r) => r.status === "nowPlaying") || null;
  const [history, setHistory] = useState(null);
  const [newSetlistName, setNewSetlistName] = useState("");
  const [addingSetlist, setAddingSetlist] = useState(false);
  const [confirmingStart, setConfirmingStart] = useState(false);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [editingSongId, setEditingSongId] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editArtist, setEditArtist] = useState("");
  const [editGenre, setEditGenre] = useState("");
  const [editVibe, setEditVibe] = useState("");
  const [csvAppendMode, setCsvAppendMode] = useState(false);
  const leftoverCount = pending.length + (nowPlaying ? 1 : 0);

  useEffect(() => {
    if (hostTab === "history") {
      readShared(KEYS.history, []).then(setHistory);
    }
  }, [hostTab]);

  async function deleteHistoryEntry(id) {
    const latest = await readShared(KEYS.history, []);
    const updated = latest.filter((entry) => entry.id !== id);
    await writeShared(KEYS.history, updated);
    setHistory(updated);
  }

  async function clearAllHistory() {
    await writeShared(KEYS.history, []);
    setHistory([]);
  }

  const visibleTabs =
    hostRole === "helper"
      ? [{ id: "requests", label: "Requests", icon: Inbox, badge: pendingCount }]
      : [
          { id: "requests", label: "Requests", icon: Inbox, badge: pendingCount },
          { id: "songs", label: "Setlist", icon: ListMusic },
          { id: "history", label: "History", icon: History },
          { id: "settings", label: "Settings", icon: Settings },
        ];

  return (
    <div className="flex flex-col flex-1">
      <div className="px-4 pt-6 pb-3 flex items-center justify-between border-b border-line">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber mb-0.5">
            {hostRole === "helper" ? "Helper mode" : "Stage mode"}
          </p>
          <h1 className="font-display text-xl">{config.bandName}</h1>
        </div>
        <button onClick={onLogout} className="btn-outline flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-body">
          <LogOut size={13} /> Exit
        </button>
      </div>

      <div className="flex px-4 border-b border-line overflow-x-auto">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setHostTab(t.id);
              if (t.id === "settings") onOpenSettings();
            }}
            className={`tab-btn flex items-center gap-1.5 px-3 py-3 text-sm font-body shrink-0 ${hostTab === t.id ? "active" : ""}`}
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
                <input
                  value={venueInput}
                  onChange={(e) => setVenueInput(e.target.value)}
                  placeholder="Venue name (optional)"
                  className="w-full max-w-[260px] mx-auto px-3 py-2 rounded-lg text-sm font-body mb-3 block"
                />
                {confirmingStart ? (
                  <div className="max-w-[260px] mx-auto">
                    <p className="font-body text-xs text-burgundy mb-3">
                      You still have {leftoverCount} unplayed song{leftoverCount !== 1 ? "s" : ""} from before — starting a new session will clear {leftoverCount !== 1 ? "them" : "it"}. Continue?
                    </p>
                    <div className="flex gap-2">
                      <button onClick={() => setConfirmingStart(false)} className="btn-outline flex-1 py-2 rounded-full text-sm font-body">
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          startSession();
                          setConfirmingStart(false);
                        }}
                        className="btn-amber flex-1 py-2 rounded-full text-sm font-body"
                      >
                        Start anyway
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => (leftoverCount > 0 ? setConfirmingStart(true) : startSession())}
                    className="btn-amber px-5 py-2.5 rounded-full font-body inline-flex items-center gap-2"
                  >
                    <Music2 size={14} /> Start session
                  </button>
                )}
              </div>
            ) : (
              <>
                {nowPlaying && (
                  <div className="mb-3 px-3.5 py-3 rounded-lg bg-amber-soft border-2 border-amber flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Play size={16} className="text-amber shrink-0" />
                      <div className="min-w-0">
                        <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-amber">Now playing</p>
                        <p className="font-body font-semibold text-sm truncate">{nowPlaying.title}</p>
                      </div>
                    </div>
                    {(reactions?.[nowPlaying.id] || 0) > 0 && (
                      <span className="flex items-center gap-1 text-xs font-mono text-amber shrink-0">
                        <Flame size={13} fill="currentColor" /> {reactions[nowPlaying.id]}
                      </span>
                    )}
                    <button onClick={() => markStatus(nowPlaying.id, "done")} className="btn-amber w-8 h-8 rounded-full flex items-center justify-center shrink-0">
                      <Check size={14} />
                    </button>
                  </div>
                )}

                <div className="flex items-center justify-between mb-3 px-3 py-3 rounded-xl bg-ink-card border border-line">
                  <div>
                    <p className="font-body text-sm font-semibold">
                      {config.requestsOpen
                        ? "Taking requests"
                        : config.doneForNight
                        ? "Done for the night"
                        : "On a break"}
                    </p>
                    <p className="font-body text-xs text-cream/40 mt-0.5">
                      {config.requestsOpen
                        ? "Audience can send you songs right now."
                        : config.doneForNight
                        ? "Audience sees a friendly 'that's a wrap' message — no more requests tonight."
                        : "Audience can still ♥ a song to queue it up, but won't get a live confirmation until you resume."}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      if (config.requestsOpen) {
                        setPauseMinutes(pauseMinutes === null ? 0 : null);
                        setPauseChoosingDuration(false);
                      } else {
                        resumeNow();
                      }
                    }}
                    role="switch"
                    aria-checked={config.requestsOpen}
                    className="toggle-switch shrink-0"
                    data-on={config.requestsOpen}
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>

                {pauseMinutes !== null && config.requestsOpen && (
                  pauseChoosingDuration ? (
                    <div className="mb-4">
                      <div className="flex gap-1.5 mb-2">
                        {[5, 10, 15, 30].map((m) => (
                          <button key={m} onClick={() => pauseFor(m)} className="btn-outline flex-1 py-2 rounded-lg text-xs font-body flex items-center justify-center gap-1">
                            <Timer size={12} /> {m}m
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => setPauseChoosingDuration(false)}
                        className="btn-outline w-full py-2.5 rounded-lg text-xs font-body flex items-center justify-center gap-1.5"
                      >
                        ← Back
                      </button>
                    </div>
                  ) : (
                    <div className="mb-4">
                      <div className="flex gap-2 mb-2">
                        <button
                          onClick={() => setPauseChoosingDuration(true)}
                          className="btn-outline flex-1 py-2.5 rounded-lg text-xs font-body flex items-center justify-center gap-1.5"
                        >
                          <Timer size={13} /> Taking a break
                        </button>
                        <button
                          onClick={stopRequestsForNight}
                          className="btn-outline flex-1 py-2.5 rounded-lg text-xs font-body flex items-center justify-center gap-1.5"
                        >
                          <Megaphone size={13} /> Done for tonight
                        </button>
                      </div>
                      <button
                        onClick={() => setPauseMinutes(null)}
                        className="btn-outline w-full py-2.5 rounded-lg text-xs font-body flex items-center justify-center gap-1.5"
                      >
                        ← Back
                      </button>
                    </div>
                  )
                )}

                <div className="flex items-center justify-between mb-4 px-3 py-3 rounded-xl bg-ink-card border border-line">
                  <div className="pr-3">
                    <p className="font-body text-sm font-semibold flex items-center gap-1.5">
                      <Megaphone size={13} className={config.lastCallActive ? "text-amber" : "text-cream/40"} />
                      Last call
                    </p>
                    <p className="font-body text-xs text-cream/40 mt-0.5">
                      {config.lastCallActive
                        ? "Audience sees a last-call banner right now."
                        : "Flash a banner telling the crowd to get final requests in."}
                    </p>
                  </div>
                  <button
                    onClick={toggleLastCall}
                    role="switch"
                    aria-checked={config.lastCallActive}
                    className="toggle-switch shrink-0"
                    data-on={config.lastCallActive}
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>

                {confirmingEnd ? (
                  <div className="mb-4">
                    <p className="font-body text-xs text-burgundy mb-2 text-center">
                      End the session and see tonight's stats? This can't be undone.
                    </p>
                    <div className="flex gap-2">
                      <button onClick={() => setConfirmingEnd(false)} className="btn-outline flex-1 py-2.5 rounded-lg font-body text-sm">
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          endSession();
                          setConfirmingEnd(false);
                        }}
                        className="btn-amber flex-1 py-2.5 rounded-lg font-body text-sm"
                      >
                        Yes, end it
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmingEnd(true)}
                    className="btn-outline w-full py-2.5 rounded-lg font-body text-sm mb-4 flex items-center justify-center gap-2"
                  >
                    <LogOut size={14} /> End session &amp; see stats
                  </button>
                )}
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
                  <li key={r.id} className={`req-card p-3 ${r.priority ? "border-amber" : ""}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          {r.priority && <Flame size={13} className="text-amber shrink-0" fill="currentColor" />}
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
                        <button onClick={() => setNowPlaying(r.id)} className="btn-amber w-8 h-8 rounded-full flex items-center justify-center" aria-label="Mark as now playing">
                          <Play size={14} />
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
            {/* setlist switcher */}
            <div className="mb-4">
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {(setlists || []).map((l) => (
                  <button
                    key={l.id}
                    onClick={() => switchSetlist(l.id)}
                    className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-body border-2 ${
                      l.id === config.activeSetlistId ? "border-amber text-amber" : "border-line text-cream/50"
                    }`}
                  >
                    {l.name}
                  </button>
                ))}
                <button
                  onClick={() => setAddingSetlist((v) => !v)}
                  className="shrink-0 btn-outline px-2.5 py-1.5 rounded-full text-xs font-body flex items-center gap-1"
                >
                  <ListPlus size={13} /> New
                </button>
              </div>
              {addingSetlist && (
                <div className="flex gap-2 mt-2">
                  <input
                    value={newSetlistName}
                    onChange={(e) => setNewSetlistName(e.target.value)}
                    placeholder="Setlist name — e.g. 'Slow Set'"
                    className="flex-1 px-3 py-2 rounded-lg text-sm font-body"
                  />
                  <button
                    onClick={() => {
                      if (newSetlistName.trim()) {
                        createSetlist(newSetlistName.trim());
                        setNewSetlistName("");
                        setAddingSetlist(false);
                      }
                    }}
                    className="btn-amber px-3 rounded-lg shrink-0"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              )}
              {setlists && setlists.length > 0 && (
                <div className="flex items-center gap-3 mt-2">
                  <button
                    onClick={() => duplicateSetlist(config.activeSetlistId)}
                    className="text-[11px] font-mono text-cream/40 hover:text-amber flex items-center gap-1"
                  >
                    <Copy size={11} /> Duplicate this list
                  </button>
                  {setlists.length > 1 && (
                    <button
                      onClick={() => deleteSetlist(config.activeSetlistId)}
                      className="text-[11px] font-mono text-cream/40 hover:text-burgundy flex items-center gap-1"
                    >
                      <Trash2 size={11} /> Delete this list
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="border border-dashed border-line rounded-xl p-4 mb-5 text-center">
              <Upload size={20} className="mx-auto mb-2 text-amber" />
              <p className="font-body text-sm mb-1">Upload a CSV to this setlist</p>
              <p className="font-body text-xs text-cream/40 mb-3">
                Columns: title, artist, genre, vibe. Genre and vibe are optional.
              </p>
              <label className="flex items-center justify-center gap-2 text-xs font-body text-cream/60 mb-3">
                <input
                  type="checkbox"
                  checked={csvAppendMode}
                  onChange={(e) => setCsvAppendMode(e.target.checked)}
                />
                Add to current list instead of replacing it
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => handleCsvUpload(e, csvAppendMode)}
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
              {songs.length} song{songs.length !== 1 ? "s" : ""} on this list
            </p>

            {groupByGenre(songs).map(({ genre, songs: groupSongs }) => (
              <div key={genre} className="mb-4">
                <p className="font-body text-xs font-semibold text-amber mb-1.5">
                  {genre} <span className="text-cream/30 font-normal">({groupSongs.length})</span>
                </p>
                <ul className="flex flex-col gap-1.5">
                  {groupSongs.map((s) =>
                    editingSongId === s.id ? (
                      <li key={s.id} className="song-row px-3 py-2.5 flex flex-col gap-1.5">
                        <div className="flex gap-1.5">
                          <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="Title" className="flex-1 px-2 py-1.5 rounded-lg text-sm font-body" />
                          <input value={editArtist} onChange={(e) => setEditArtist(e.target.value)} placeholder="Artist" className="flex-1 px-2 py-1.5 rounded-lg text-sm font-body" />
                        </div>
                        <div className="flex gap-1.5">
                          <input value={editGenre} onChange={(e) => setEditGenre(e.target.value)} placeholder="Genre" className="flex-1 px-2 py-1.5 rounded-lg text-sm font-body" />
                          <input value={editVibe} onChange={(e) => setEditVibe(e.target.value)} placeholder="Vibe" className="flex-1 px-2 py-1.5 rounded-lg text-sm font-body" />
                        </div>
                        <div className="flex gap-1.5 mt-0.5">
                          <button onClick={() => setEditingSongId(null)} className="btn-outline flex-1 py-1.5 rounded-lg text-xs font-body">
                            Cancel
                          </button>
                          <button
                            onClick={() => {
                              updateSong(s.id, {
                                title: editTitle.trim() || s.title,
                                artist: editArtist.trim(),
                                genre: editGenre.trim(),
                                vibe: editVibe.trim(),
                              });
                              setEditingSongId(null);
                            }}
                            className="btn-amber flex-1 py-1.5 rounded-lg text-xs font-body"
                          >
                            Save
                          </button>
                        </div>
                      </li>
                    ) : (
                      <li key={s.id} className={`song-row flex items-center justify-between px-3 py-2.5 ${s.unavailable ? "opacity-50" : ""}`}>
                        <div className="min-w-0">
                          <p className="font-body text-sm truncate">{s.title}</p>
                          {s.artist && <p className="font-body text-xs text-cream/50 truncate">{s.artist}</p>}
                        </div>
                        <div className="flex items-center gap-2.5 shrink-0 ml-2">
                          <button
                            onClick={() => toggleSongAvailability(s.id)}
                            aria-label={s.unavailable ? "Mark available" : "Mark not tonight"}
                            className="text-cream/30 hover:text-amber"
                          >
                            {s.unavailable ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                          <button
                            onClick={() => {
                              setEditingSongId(s.id);
                              setEditTitle(s.title);
                              setEditArtist(s.artist || "");
                              setEditGenre(s.genre || "");
                              setEditVibe(s.vibe || "");
                            }}
                            className="text-cream/30 hover:text-amber"
                          >
                            <Settings size={14} />
                          </button>
                          <button onClick={() => removeSong(s.id)} className="text-cream/30 hover:text-burgundy">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </li>
                    )
                  )}
                </ul>
              </div>
            ))}
          </div>
        )}

        {hostTab === "history" && (
          <HistoryTab history={history} onDelete={deleteHistoryEntry} onClearAll={clearAllHistory} allSetlists={setlists} />
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

            <div className="mt-6 pt-5 border-t border-line">
              <p className="font-body text-sm font-semibold mb-3">App theme</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: "original", label: "Original", desc: "Warm pub jukebox", swatch: ["#1B1712", "#E8A33D", "#F1E7D2"] },
                  { id: "retro", label: "Retro Future", desc: "Neon 8-bit arcade", swatch: ["#08020f", "#00f0ff", "#ff2e63"] },
                  { id: "dark", label: "Dark", desc: "Clean & modern", swatch: ["#0f1115", "#5b8def", "#e8eaed"] },
                  { id: "light", label: "Light", desc: "Bright & simple", swatch: ["#ffffff", "#4f46e5", "#14151a"] },
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    className={`song-row px-3 py-3 text-left flex flex-col gap-2 ${(config.theme || "retro") === t.id ? "border-amber" : ""}`}
                    style={(config.theme || "retro") === t.id ? { borderColor: "var(--amber)", boxShadow: "0 0 8px var(--amber-soft)" } : undefined}
                  >
                    <div className="flex gap-1">
                      {t.swatch.map((c, i) => (
                        <span key={i} className="w-4 h-4 rounded-full border border-line shrink-0" style={{ background: c }} />
                      ))}
                    </div>
                    <div>
                      <p className="font-body text-sm font-semibold flex items-center gap-1.5">
                        {t.label}
                        {(config.theme || "retro") === t.id && <Check size={12} className="text-amber" />}
                      </p>
                      <p className="font-body text-[11px] text-cream/40">{t.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6 pt-5 border-t border-line">
              <p className="font-body text-sm font-semibold mb-3">Alerts &amp; cleanup</p>
              <div className="flex items-center justify-between mb-3 px-3 py-3 rounded-xl bg-ink-card border border-line">
                <div className="pr-3">
                  <p className="font-body text-sm font-semibold">New request vibration</p>
                  <p className="font-body text-xs text-cream/40 mt-0.5">
                    Silent — just a vibration on this device when a new request comes in. No sound, ever.
                  </p>
                </div>
                <button
                  onClick={toggleMuteAlerts}
                  role="switch"
                  aria-checked={!muteAlerts}
                  className="toggle-switch shrink-0"
                  data-on={!muteAlerts}
                >
                  <span className="toggle-knob" />
                </button>
              </div>
              <div className="flex items-center justify-between px-3 py-3 rounded-xl bg-ink-card border border-line">
                <div className="pr-3">
                  <p className="font-body text-sm font-semibold">Auto-clear played songs</p>
                  <p className="font-body text-xs text-cream/40 mt-0.5">
                    Quietly removes songs from your "played" list after a few hours so it doesn't pile up.
                  </p>
                </div>
                <button
                  onClick={toggleAutoClear}
                  role="switch"
                  aria-checked={config.autoClearDone}
                  className="toggle-switch shrink-0"
                  data-on={config.autoClearDone}
                >
                  <span className="toggle-knob" />
                </button>
              </div>
            </div>

            <div className="mt-6 pt-5 border-t border-line">
              <p className="font-body text-sm font-semibold mb-1 flex items-center gap-1.5">
                <QrCode size={14} className="text-amber" /> Share your app
              </p>
              <p className="font-body text-xs text-cream/40 mb-3">
                Paste your published app link here to get a QR code you can print for the room.
              </p>
              <Field label="Your app's shareable link">
                <input value={setupPublicLink} onChange={(e) => setSetupPublicLink(e.target.value)} placeholder="https://claude.ai/public/artifacts/..." className="w-full px-3 py-2.5 rounded-lg text-sm font-body" />
              </Field>
              {setupPublicLink.trim() && (
                <div className="song-row p-4 flex flex-col items-center gap-3 mt-2">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(normalizeUrl(setupPublicLink.trim()))}`}
                    alt="QR code to your app"
                    width={180}
                    height={180}
                    className="rounded"
                  />
                  <button
                    onClick={() => navigator.clipboard?.writeText(normalizeUrl(setupPublicLink.trim()))}
                    className="btn-outline px-3 py-1.5 rounded-full text-xs font-body flex items-center gap-1.5"
                  >
                    <Copy size={12} /> Copy link
                  </button>
                </div>
              )}
            </div>

            <p className="font-body text-xs text-cream/30 mt-4 leading-relaxed">
              Heads up: the setlist, requests, and this info are stored so anyone with your app link can view them. Only the PIN stands between someone and this dashboard.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function StatAccordion({ icon: Icon, title, count, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-3 genre-section rounded-[10px] overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="genre-header w-full flex items-center justify-between px-3.5 py-3 text-left"
      >
        <span className="flex items-center gap-2">
          {Icon && <Icon size={14} className="text-amber shrink-0" />}
          <span className="font-body text-sm font-semibold">{title}</span>
          {count != null && <span className="font-mono text-[11px] text-cream/40">{count}</span>}
        </span>
        <ChevronDown
          size={16}
          className={`text-amber transition-transform duration-150 shrink-0 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className="px-2 pb-2.5 pt-0.5">{children}</div>}
    </div>
  );
}

function HistoryTab({ history, onDelete, onClearAll, allSetlists }) {
  const [expandedId, setExpandedId] = useState(null);

  if (history === null) {
    return (
      <div className="flex flex-col items-center text-center gap-2 mt-10 text-cream/50">
        <Loader2 size={22} className="animate-spin" />
        <p className="font-body text-sm">Loading history…</p>
      </div>
    );
  }
  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center text-center gap-2 mt-10 text-cream/50">
        <History size={26} />
        <p className="font-body text-sm max-w-[240px]">
          No past sessions yet — stats from your gigs will build up here after you end a session.
        </p>
      </div>
    );
  }

  const allTime = {};
  const allTimeFires = {};
  const byVenue = {};
  let busiestGig = null;

  for (const entry of history) {
    const entryTotal = Object.values(entry.songCounts).reduce((sum, s) => sum + s.count, 0);
    for (const key in entry.songCounts) {
      const s = entry.songCounts[key];
      if (!allTime[key]) allTime[key] = { title: s.title, artist: s.artist, count: 0 };
      allTime[key].count += s.count;
    }
    for (const key in entry.songFires || {}) {
      const s = entry.songFires[key];
      if (!allTimeFires[key]) allTimeFires[key] = { title: s.title, artist: s.artist, count: 0 };
      allTimeFires[key].count += s.count;
    }
    const venueName = entry.venue || "Unnamed gig";
    if (!byVenue[venueName]) byVenue[venueName] = { total: 0, gigs: 0 };
    byVenue[venueName].total += entryTotal;
    byVenue[venueName].gigs += 1;
    if (!busiestGig || entryTotal > busiestGig.total) {
      busiestGig = { total: entryTotal, venue: entry.venue || "Unnamed gig", endedAt: entry.endedAt };
    }
  }
  const topAllTime = Object.values(allTime).sort((a, b) => b.count - a.count).slice(0, 10);
  const topFiresAllTime = Object.values(allTimeFires).sort((a, b) => b.count - a.count).slice(0, 10);

  // fire-to-request ratio — only meaningful once a song has a few requests
  const ratioSongs = Object.keys(allTime)
    .filter((key) => allTime[key].count >= 2)
    .map((key) => ({
      title: allTime[key].title,
      artist: allTime[key].artist,
      requests: allTime[key].count,
      fires: allTimeFires[key]?.count || 0,
      ratio: (allTimeFires[key]?.count || 0) / allTime[key].count,
    }));
  const topRatio = ratioSongs.filter((s) => s.fires > 0).sort((a, b) => b.ratio - a.ratio).slice(0, 5);

  // songs on the current setlist(s) that have never been requested
  const allSongsFlat = (allSetlists || []).flatMap((l) => l.songs || []);
  const uniqueSongs = {};
  for (const s of allSongsFlat) {
    const key = `${s.title.toLowerCase()}||${(s.artist || "").toLowerCase()}`;
    uniqueSongs[key] = s;
  }
  const neverPlayed = Object.keys(uniqueSongs)
    .filter((key) => !allTime[key])
    .map((key) => uniqueSongs[key])
    .slice(0, 10);

  // genre breakdown — attribute each history request to a genre using the current setlist's mapping
  const genreMap = {};
  for (const s of allSongsFlat) {
    const key = `${s.title.toLowerCase()}||${(s.artist || "").toLowerCase()}`;
    genreMap[key] = (s.genre || "").trim() || "Other";
  }
  const byGenre = {};
  for (const key in allTime) {
    const genre = genreMap[key] || "Other";
    byGenre[genre] = (byGenre[genre] || 0) + allTime[key].count;
  }
  const genreBreakdown = Object.entries(byGenre).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const venueBreakdown = Object.entries(byVenue)
    .map(([name, v]) => ({ name, avg: v.total / v.gigs, gigs: v.gigs }))
    .sort((a, b) => b.avg - a.avg);


  return (
    <div>
      <StatAccordion id="top" icon={Music2} title="Top Ten All Time Requests" count={topAllTime.length} defaultOpen>
        <ul className="flex flex-col gap-1.5">
          {topAllTime.map((s, i) => (
            <li key={i} className="song-row flex items-center justify-between px-3 py-2">
              <div className="min-w-0">
                <p className="font-body text-sm truncate">{s.title}</p>
                {s.artist && <p className="font-body text-xs text-cream/50 truncate">{s.artist}</p>}
              </div>
              <span className="font-mono text-xs text-amber shrink-0 ml-2">×{s.count}</span>
            </li>
          ))}
        </ul>
      </StatAccordion>

      {topFiresAllTime.length > 0 && (
        <StatAccordion id="fires" icon={Flame} title="All-time crowd favorites" count={topFiresAllTime.length}>
          <ul className="flex flex-col gap-1.5">
            {topFiresAllTime.map((s, i) => (
              <li key={i} className="song-row flex items-center justify-between px-3 py-2">
                <div className="min-w-0">
                  <p className="font-body text-sm truncate">{s.title}</p>
                  {s.artist && <p className="font-body text-xs text-cream/50 truncate">{s.artist}</p>}
                </div>
                <span className="font-mono text-xs text-amber shrink-0 ml-2 flex items-center gap-1">
                  <Flame size={12} fill="currentColor" /> {s.count}
                </span>
              </li>
            ))}
          </ul>
        </StatAccordion>
      )}

      {topRatio.length > 0 && (
        <StatAccordion id="ratio" title="Hidden gems" count={topRatio.length}>
          <p className="font-body text-xs text-cream/40 mb-2">
            Songs that go down especially well relative to how often they're requested.
          </p>
          <ul className="flex flex-col gap-1.5">
            {topRatio.map((s, i) => (
              <li key={i} className="song-row flex items-center justify-between px-3 py-2">
                <div className="min-w-0">
                  <p className="font-body text-sm truncate">{s.title}</p>
                  {s.artist && <p className="font-body text-xs text-cream/50 truncate">{s.artist}</p>}
                </div>
                <span className="font-mono text-xs text-amber shrink-0 ml-2">
                  {s.fires}🔥 / {s.requests} req
                </span>
              </li>
            ))}
          </ul>
        </StatAccordion>
      )}

      {neverPlayed.length > 0 && (
        <StatAccordion id="never" title="Never requested" count={neverPlayed.length}>
          <p className="font-body text-xs text-cream/40 mb-2">
            On your setlist, but nobody's asked for these yet.
          </p>
          <ul className="flex flex-col gap-1.5">
            {neverPlayed.map((s, i) => (
              <li key={i} className="song-row px-3 py-2">
                <p className="font-body text-sm truncate">{s.title}</p>
                {s.artist && <p className="font-body text-xs text-cream/50 truncate">{s.artist}</p>}
              </li>
            ))}
          </ul>
        </StatAccordion>
      )}

      {genreBreakdown.length > 1 && (
        <StatAccordion id="genre" title="By genre" count={genreBreakdown.length}>
          <ul className="flex flex-col gap-1.5">
            {genreBreakdown.map(([genre, count], i) => (
              <li key={i} className="song-row flex items-center justify-between px-3 py-2">
                <p className="font-body text-sm truncate">{genre}</p>
                <span className="font-mono text-xs text-amber shrink-0 ml-2">×{count}</span>
              </li>
            ))}
          </ul>
        </StatAccordion>
      )}

      {venueBreakdown.length > 1 && (
        <StatAccordion id="venue" title="By venue" count={venueBreakdown.length}>
          <ul className="flex flex-col gap-1.5">
            {venueBreakdown.map((v, i) => (
              <li key={i} className="song-row flex items-center justify-between px-3 py-2">
                <div className="min-w-0">
                  <p className="font-body text-sm truncate">{v.name}</p>
                  <p className="font-body text-xs text-cream/40">{v.gigs} gig{v.gigs !== 1 ? "s" : ""}</p>
                </div>
                <span className="font-mono text-xs text-amber shrink-0 ml-2">{v.avg.toFixed(1)} avg</span>
              </li>
            ))}
          </ul>
        </StatAccordion>
      )}

      {busiestGig && busiestGig.total > 0 && (
        <div className="mb-4 px-3 py-2.5 rounded-lg bg-amber-soft border border-line">
          <p className="font-body text-xs text-cream/70">
            Your busiest gig was <span className="text-amber font-semibold">{busiestGig.venue}</span>
            {busiestGig.endedAt && ` on ${new Date(busiestGig.endedAt).toLocaleDateString()}`} — {busiestGig.total} request{busiestGig.total !== 1 ? "s" : ""}.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between mb-2">
        <p className="font-body text-sm font-semibold">Past sessions</p>
        <button onClick={onClearAll} className="text-[11px] font-mono text-burgundy">
          Clear all
        </button>
      </div>
      <ul className="flex flex-col gap-2">
        {history.map((entry) => {
          const totalReqs = Object.values(entry.songCounts).reduce((sum, s) => sum + s.count, 0);
          const totalMissed = Object.values(entry.missed).reduce((sum, m) => sum + m.count, 0);
          const date = new Date(entry.endedAt);
          const isOpen = expandedId === entry.id;
          const songList = Object.values(entry.songCounts).sort((a, b) => b.count - a.count);
          const missedList = Object.values(entry.missed).sort((a, b) => b.count - a.count);
          const fireList = Object.values(entry.songFires || {}).sort((a, b) => b.count - a.count);
          const entryBirthdays = songList
            .filter((s) => isBirthdaySong(s.title))
            .reduce((sum, s) => sum + s.count, 0);
          const entryHrs = entry.startedAt && entry.endedAt ? Math.max((entry.endedAt - entry.startedAt) / 3600000, 1 / 60) : null;
          const entryPerHour = entryHrs ? (totalReqs / entryHrs).toFixed(1) : null;
          const entryNamed = entry.namedCount || 0;
          const entryAnon = entry.anonCount || 0;
          return (
            <li key={entry.id} className="song-row overflow-hidden">
              <button
                onClick={() => setExpandedId(isOpen ? null : entry.id)}
                className="w-full text-left px-3 py-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-body text-sm font-semibold truncate">
                      {entry.venue || "Unnamed gig"}
                    </p>
                    <span className="font-mono text-[11px] text-cream/40">
                      {date.toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(entry.id);
                      }}
                      role="button"
                      aria-label="Delete this session"
                      className="text-cream/30 hover:text-burgundy p-1"
                    >
                      <Trash2 size={14} />
                    </span>
                    <ChevronDown
                      size={16}
                      className={`text-amber transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`}
                    />
                  </div>
                </div>
                <p className="font-body text-xs text-cream/50 mt-0.5">
                  {totalReqs} request{totalReqs !== 1 ? "s" : ""} · {totalMissed} searched, not on the list
                </p>
                {isOpen && (entryPerHour || entryNamed + entryAnon > 0 || entryBirthdays > 0) && (
                  <p className="font-mono text-[10px] text-cream/30 mt-1 flex flex-wrap gap-x-3">
                    {entryPerHour && <span>~{entryPerHour}/hr</span>}
                    {entryNamed + entryAnon > 0 && <span>{entryNamed} named · {entryAnon} anon</span>}
                    {entryBirthdays > 0 && <span>🎂 {entryBirthdays}</span>}
                  </p>
                )}
              </button>
              {isOpen && (
                <div className="px-3 pb-3 pt-1 border-t border-line">
                  <p className="font-body text-xs font-semibold text-amber mt-2 mb-1.5">Requested</p>
                  {songList.length === 0 ? (
                    <p className="font-body text-xs text-cream/40 mb-2">No requests came in.</p>
                  ) : (
                    <ul className="flex flex-col gap-1 mb-2">
                      {songList.map((s, i) => (
                        <li key={i} className="flex items-center justify-between text-sm">
                          <span className="font-body truncate">
                            {s.title}
                            {s.artist && <span className="text-cream/40"> — {s.artist}</span>}
                          </span>
                          <span className="font-mono text-xs text-amber shrink-0 ml-2">×{s.count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {fireList.length > 0 && (
                    <>
                      <p className="font-body text-xs font-semibold text-amber mt-2 mb-1.5">Went down well</p>
                      <ul className="flex flex-col gap-1 mb-2">
                        {fireList.map((s, i) => (
                          <li key={i} className="flex items-center justify-between text-sm">
                            <span className="font-body truncate">
                              {s.title}
                              {s.artist && <span className="text-cream/40"> — {s.artist}</span>}
                            </span>
                            <span className="font-mono text-xs text-amber shrink-0 ml-2 flex items-center gap-1">
                              <Flame size={11} fill="currentColor" /> {s.count}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {missedList.length > 0 && (
                    <>
                      <p className="font-body text-xs font-semibold text-burgundy mt-2 mb-1.5">Songs searched you didn't have</p>
                      <ul className="flex flex-col gap-1">
                        {missedList.map((m, i) => (
                          <li key={i} className="flex items-center justify-between text-sm">
                            <span className="font-body truncate">{m.query}</span>
                            <span className="font-mono text-xs text-burgundy shrink-0 ml-2">×{m.count}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
