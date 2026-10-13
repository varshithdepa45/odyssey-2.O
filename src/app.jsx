/* ================================================================
   Odyssey — Campus Treasure Hunt
   ----------------------------------------------------------------
   Single-file React app loaded as an ES module via Babel-standalone.
   ================================================================ */

import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from "https://esm.sh/react@18.2.0";
import { createRoot } from "https://esm.sh/react-dom@18.2.0/client";
import {
  motion,
  AnimatePresence,
  animate,
} from "https://esm.sh/framer-motion@11.0.8?deps=react@18.2.0";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  serverTimestamp,
  onSnapshot,
  runTransaction,
  query,
  orderBy,
  limit,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  getAuth,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

/* ================== FIREBASE INIT ================== */

const firebaseConfig = {
  apiKey: "AIzaSyBzaceNHFlq09fy6NDyRgcC93gPYLo0vhE",
  authDomain: "lost-found-clg.firebaseapp.com",
  projectId: "lost-found-clg",
  storageBucket: "lost-found-clg.firebasestorage.app",
  messagingSenderId: "335035491718",
  appId: "1:335035491718:web:0fc46d65558a627f26f807",
  measurementId: "G-FVDL55B1JH",
};

const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);
const auth = getAuth(fbApp);
const googleProvider = new GoogleAuthProvider();
// Always show the account chooser, so a shared laptop doesn't silently
// reuse whichever Google account signed in last.
googleProvider.setCustomParameters({ prompt: "select_account" });

/* ================== HUNT DATA (Firestore) ================== */

// teams/{uid}   — teamName, score, cluesSolved, lastSolvedAt
// clues/{id}    — id, order, title, riddle, locationCoords, passcodeHash
//
// One team per signed-in account (doc id = auth uid). Clues are solved
// strictly in `order`, so `cluesSolved` doubles as the unlock cursor:
// the clue at index `cluesSolved` is the open case, everything before
// it is solved, everything after it stays sealed.

const POINTS_PER_CLUE = 100;

// Default map anchor (NYC midtown) — used until clue pins arrive.
// Point this at your campus.
const MAP_CENTER = [40.7589, -73.9851];

function normalizePasscode(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// SHA-256 hex of the normalized passcode. `clues.passcodeHash` must be
// produced with this same function (see window.bakerStreet below).
async function hashPasscode(input) {
  const bytes = new TextEncoder().encode(normalizePasscode(input));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Accepts a Firestore GeoPoint, { lat, lng|lon }, or [lat, lng].
function toLatLng(c) {
  if (!c) return null;
  const lat = parseFloat(Array.isArray(c) ? c[0] : (c.latitude ?? c.lat));
  const lng = parseFloat(
    Array.isArray(c) ? c[1] : (c.longitude ?? c.lng ?? c.lon),
  );
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  )
    return null;
  return [lat, lng];
}

const clueCoords = (clue) => toLatLng(clue?.locationCoords);

async function registerTeam(user, teamName) {
  const name = (teamName || "").trim().slice(0, 40);
  if (!user) throw new Error("Sign in to register your agency.");
  if (name.length < 2) throw new Error("Give your agency a name.");
  await setDoc(doc(db, "teams", user.uid), {
    teamName: name,
    score: 0,
    cluesSolved: 0,
    lastSolvedAt: null,
  });
}

// Returns true when the passcode matches. The team doc is advanced in
// a transaction so a double submit (or a second device) can't score
// the same clue twice.
async function submitPasscode({ user, clue, index, attempt }) {
  if (!user) throw new Error("Sign in to submit a deduction.");
  const hash = await hashPasscode(attempt);
  if (hash !== String(clue.passcodeHash || "").toLowerCase()) return false;

  const ref = doc(db, "teams", user.uid);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Register your agency first.");
    const team = snap.data();
    if ((team.cluesSolved || 0) !== index) return; // already advanced
    tx.update(ref, {
      score: (team.score || 0) + POINTS_PER_CLUE,
      cluesSolved: index + 1,
      lastSolvedAt: serverTimestamp(),
    });
  });
  return true;
}

// Higher score first; ties go to whoever solved their last clue earlier.
function rankTeams(teams) {
  return [...teams].sort((a, b) => {
    if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
    const ta = tsToMillis(a.lastSolvedAt) || Infinity;
    const tb = tsToMillis(b.lastSolvedAt) || Infinity;
    if (ta !== tb) return ta - tb;
    return (a.teamName || "").localeCompare(b.teamName || "");
  });
}

// ----- Organizer helpers (DevTools console) -----------------------
// bakerStreet.hashPasscode("answer")  → value for clues.passcodeHash
// bakerStreet.seedSampleClues()       → writes four demo clues around
//                                       MAP_CENTER (needs write access
//                                       to `clues` in your rules)
const SAMPLE_CLUES = [
  {
    title: "A Study in Scarlet",
    riddle:
      "I hold a thousand voices yet never speak. Find the desk where silence is the rule, and read the number on its brass plate.",
    passcode: "221b",
    offset: [0.0012, -0.001],
  },
  {
    title: "The Sign of the Four",
    riddle:
      "Four faces, eight hands, and not one of them can hold a pipe. Stand beneath me at noon and count my chimes.",
    passcode: "twelve",
    offset: [-0.0009, 0.0014],
  },
  {
    title: "The Speckled Band",
    riddle:
      "Where steam rises and the morning crowd gathers, a spotted ribbon hangs by the door. What word is stitched upon it?",
    passcode: "elementary",
    offset: [0.0018, 0.0016],
  },
  {
    title: "The Final Problem",
    riddle:
      "Water falls where no river runs. At the drop point by the fountain, the Professor left his name behind.",
    passcode: "moriarty",
    offset: [-0.0016, -0.0013],
  },
];

async function seedSampleClues() {
  for (let i = 0; i < SAMPLE_CLUES.length; i++) {
    const c = SAMPLE_CLUES[i];
    const id = `clue-${i + 1}`;
    await setDoc(doc(db, "clues", id), {
      id,
      order: i + 1,
      title: c.title,
      riddle: c.riddle,
      locationCoords: {
        lat: MAP_CENTER[0] + c.offset[0],
        lng: MAP_CENTER[1] + c.offset[1],
      },
      passcodeHash: await hashPasscode(c.passcode),
    });
  }
  console.info(`[BakerStreet] seeded ${SAMPLE_CLUES.length} sample clues`);
}

window.bakerStreet = { hashPasscode, seedSampleClues };

/* ================== UTILS ================== */

function tsToMillis(ts) {
  if (!ts) return 0;
  if (typeof ts === "number") return ts;
  if (ts.seconds != null) return ts.seconds * 1000;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

const cn = (...a) => a.filter(Boolean).join(" ");

function escapeHtml(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

function formatDate(d) {
  if (!d) return "Unknown";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatRelativeTime(ts) {
  const ms = tsToMillis(ts);
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 0) return "just now";
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  if (diff < 2_592_000_000) return `${Math.floor(diff / 604_800_000)}w ago`;
  return formatDate(new Date(ms).toISOString().slice(0, 10));
}

function formatDistance(meters) {
  if (meters == null || !Number.isFinite(meters)) return null;
  if (meters < 100) return `${Math.round(meters)} m`;
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  if (meters < 10000) return `${(meters / 1000).toFixed(2)} km`;
  if (meters < 100000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters / 1000)} km`;
}

/* ================== HOOKS ================== */

function useAnimatedNumber(target, duration = 1.1) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const controls = animate(0, target, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setValue(v),
    });
    return () => controls.stop();
  }, [target, duration]);
  return value;
}

function useClues() {
  const [clues, setClues] = useState([]);
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "clues"),
      (snap) => {
        const list = [];
        snap.forEach((d) => list.push({ ...d.data(), id: d.id }));
        list.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
        setClues(list);
      },
      (err) => console.error("clues snapshot:", err),
    );
    return () => unsub();
  }, []);
  return clues;
}

function useTeams() {
  const [teams, setTeams] = useState([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "teams"),
      (snap) => {
        const list = [];
        snap.forEach((d) =>
          list.push({
            id: d.id,
            // "estimate" keeps a just-written lastSolvedAt from reading
            // as null (and briefly mis-ranking) before the server acks.
            ...d.data({ serverTimestamps: "estimate" }),
          }),
        );
        setTeams(rankTeams(list));
        setLoaded(true);
      },
      (err) => console.error("teams snapshot:", err),
    );
    return () => unsub();
  }, []);
  return [teams, loaded];
}

/* ================== ICON SET ================== */

const Icon = {
  Search: () => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  ),
  Plus: () => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  Pin: () => (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  ),
  Calendar: () => (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  ),
  Mail: () => (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-10 5L2 7" />
    </svg>
  ),
  X: () => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  ),
  Trash: () => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  ),
  Bolt: () => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />
    </svg>
  ),
  Shield: () => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
    </svg>
  ),
  Activity: () => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  ),
  Globe: () => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10ZM2 12h20" />
    </svg>
  ),
  Alert: () => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0ZM12 9v4M12 17h.01" />
    </svg>
  ),
  Sparkles: () => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
    </svg>
  ),
  TrendUp: () => (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m22 7-8.5 8.5-5-5L2 17" />
      <path d="M16 7h6v6" />
    </svg>
  ),
  Logo: () => (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3" />
    </svg>
  ),
  Brain: () => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
    </svg>
  ),
  Lock: () => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="18" height="11" x="3" y="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  Trophy: () => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  ),
  Check: () => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
};

/* ================== INTEL FEED (Firestore) ================== */

// intel_feed/{id} — teamName, message, timestamp, mapCoordinates
//
// "The Wire" is a public channel any enrolled agency can post to.
// Nothing marks a post as true or false, and an attached map pin
// looks the same either way — that's what makes bluffing possible.

const INTEL_MAX = 140;
const INTEL_LIMIT = 60;
const INTEL_COOLDOWN_MS = 15000;

async function postIntel({ team, message, coords }) {
  const text = (message || "").trim().slice(0, INTEL_MAX);
  if (!team) throw new Error("Enrol your agency before transmitting.");
  if (!text) throw new Error("Nothing to transmit.");
  await addDoc(collection(db, "intel_feed"), {
    teamName: team.teamName,
    message: text,
    timestamp: serverTimestamp(),
    mapCoordinates: coords ? { lat: coords[0], lng: coords[1] } : null,
  });
}

// Latest INTEL_LIMIT posts, oldest first (the terminal appends at the
// bottom). Each entry carries resolved `coords` or null.
function useIntel() {
  const [intel, setIntel] = useState([]);
  useEffect(() => {
    const q = query(
      collection(db, "intel_feed"),
      orderBy("timestamp", "desc"),
      limit(INTEL_LIMIT),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = [];
        snap.forEach((d) => {
          const data = d.data({ serverTimestamps: "estimate" });
          list.push({
            id: d.id,
            ...data,
            coords: toLatLng(data.mapCoordinates),
          });
        });
        setIntel(list.reverse());
      },
      (err) => console.error("intel snapshot:", err),
    );
    return () => unsub();
  }, []);
  return intel;
}

/* ================== 3D TILT + REACTIVE BACKDROP ================== */

const REDUCED_MOTION =
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

// Cursor-tracking 3D tilt. Writes CSS variables that .tn-tilt in
// styles.css turns into rotateX/rotateY plus a glare that follows the
// pointer; no React re-render per mouse move. `max` is the tilt in
// degrees at the element's edge — keep it small on large panels.
function Tilt({ as: Tag = "div", max = 6, className, children, ...rest }) {
  const ref = useRef(null);
  const raf = useRef(0);

  const handleMove = useCallback(
    (e) => {
      if (REDUCED_MOTION || e.pointerType === "touch") return;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const px = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const py = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(() => {
        el.dataset.tilting = "";
        el.style.setProperty("--rx", `${((0.5 - py) * 2 * max).toFixed(2)}deg`);
        el.style.setProperty("--ry", `${((px - 0.5) * 2 * max).toFixed(2)}deg`);
        el.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`);
        el.style.setProperty("--my", `${(py * 100).toFixed(1)}%`);
      });
    },
    [max],
  );

  const handleLeave = useCallback(() => {
    cancelAnimationFrame(raf.current);
    const el = ref.current;
    if (!el) return;
    delete el.dataset.tilting;
    el.style.removeProperty("--rx");
    el.style.removeProperty("--ry");
  }, []);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return (
    <Tag
      ref={ref}
      className={cn("tn-tilt", className)}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      {...rest}
    >
      {children}
    </Tag>
  );
}

// Fixed backdrop: scrolling perspective grid + a particle field that
// is pushed away from the cursor and wires itself to it + a spotlight
// that follows the pointer.
function CyberBackground() {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const REPEL = 130;
    const LINK = 110;
    const CURSOR_LINK = 180;
    const mouse = { x: -9999, y: -9999 };
    let w = 0;
    let h = 0;
    let raf = 0;
    let particles = [];

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(90, Math.round((w * h) / 22000));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.25,
        vy: -(0.08 + Math.random() * 0.28),
        r: 0.6 + Math.random() * 1.4,
      }));
      if (REDUCED_MOTION) draw();
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#3dffa2";
      ctx.strokeStyle = "#3dffa2";
      ctx.lineWidth = 1;

      for (const p of particles) {
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const d = Math.hypot(dx, dy);
        if (d < REPEL && d > 0.01) {
          const push = (1 - d / REPEL) * 2.6;
          p.x += (dx / d) * push;
          p.y += (dy / d) * push;
        }
        p.x += p.vx;
        p.y += p.vy;
        if (p.y < -10) p.y = h + 10;
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;

        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();

        if (d < CURSOR_LINK) {
          ctx.globalAlpha = (1 - d / CURSOR_LINK) * 0.5;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.stroke();
        }
      }

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i];
          const b = particles[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < LINK) {
            ctx.globalAlpha = (1 - d / LINK) * 0.16;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      if (!REDUCED_MOTION) raf = requestAnimationFrame(draw);
    };

    const onMove = (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      root.style.setProperty("--cx", `${e.clientX}px`);
      root.style.setProperty("--cy", `${e.clientY}px`);
      root.style.setProperty(
        "--gx",
        `${((e.clientX / w - 0.5) * -48).toFixed(1)}px`,
      );
    };
    const onLeave = () => {
      mouse.x = mouse.y = -9999;
    };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !REDUCED_MOTION) raf = requestAnimationFrame(draw);
    };

    resize();
    if (!REDUCED_MOTION) raf = requestAnimationFrame(draw);
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div ref={rootRef} className="tn-bg" aria-hidden="true">
      <div className="tn-bg-grid" />
      <canvas ref={canvasRef} className="tn-bg-canvas" />
      <div className="tn-bg-glow" />
      <div className="tn-bg-scan" />
    </div>
  );
}

// "Decrypts" text left to right: unrevealed characters flicker as
// cipher glyphs until the reveal front passes them.
const CIPHER_GLYPHS = "█▓▒░<>/\\[]{}#%&01";
function useScramble(text, duration = 900) {
  const [out, setOut] = useState(text);
  useEffect(() => {
    const full = String(text ?? "");
    if (REDUCED_MOTION || !full) {
      setOut(full);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const shown = Math.floor(full.length * p);
      let s = full.slice(0, shown);
      for (let i = shown; i < full.length; i++) {
        s += /\s/.test(full[i])
          ? full[i]
          : CIPHER_GLYPHS[(Math.random() * CIPHER_GLYPHS.length) | 0];
      }
      setOut(s);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, duration]);
  return out;
}

function SectionHeading({ label, lead, accent, blurb, children }) {
  return (
    <div className="flex items-end justify-between mb-4 flex-wrap gap-3">
      <div>
        <div className="tn-label tn-label-acc mb-1.5">// {label}</div>
        <h2 className="tn-heading text-2xl sm:text-3xl lg:text-4xl">
          {lead} <em>{accent}</em>
        </h2>
        {blurb && (
          <p className="text-sm text-ch-mute mt-1.5 max-w-2xl">{blurb}</p>
        )}
      </div>
      {children}
    </div>
  );
}

/* ================== TOP NAVBAR ================== */

const NAV_LINKS = [
  { href: "#ops", label: "Map" },
  { href: "#ops", label: "Wire" },
  { href: "#vault", label: "Vault" },
  { href: "#leaderboard", label: "Ranks" },
];

function TopNavbar({ user, team, onSignIn, onSignOut }) {
  return (
    <nav className="sticky top-0 z-40 px-3 sm:px-6 lg:px-10 pt-3 tn-rise">
      <div className="tn-panel px-3 sm:px-4 py-2.5 flex items-center justify-between gap-3">
        <a href="#top" className="flex items-center gap-3 min-w-0">
          <span className="w-8 h-8 flex items-center justify-center border border-ch-acc/50 text-ch-acc shrink-0 rounded-[3px]">
            <Icon.Search />
          </span>
          <span className="leading-tight min-w-0">
            <span className="block font-mono font-semibold text-sm tracking-[0.14em] uppercase truncate text-white">
              Baker_Street<span className="text-ch-acc">//</span>Hunt
            </span>
            <span className="tn-label hidden sm:block">
              campus codehunt · detective agency
            </span>
          </span>
        </a>

        <div className="flex items-center gap-2">
          <div className="hidden lg:flex items-center gap-1">
            {NAV_LINKS.map((l) => (
              <a
                key={l.label}
                href={l.href}
                className="px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ch-mute hover:text-ch-acc transition-colors"
              >
                {l.label}
              </a>
            ))}
          </div>

          {team && (
            <div
              className="tn-chip hidden sm:inline-flex max-w-[220px]"
              title="Your agency"
            >
              <span className="truncate">{team.teamName}</span>
              <span className="text-white tabular-nums">
                {team.score || 0}
              </span>
            </div>
          )}

          <Tilt
            as="button"
            max={14}
            onClick={user ? onSignOut : onSignIn}
            className="tn-btn tn-btn-ghost"
          >
            {user ? "Sign out" : "Sign in"}
          </Tilt>

          <Tilt
            as="a"
            max={14}
            href="#vault"
            className="tn-btn tn-btn-primary"
          >
            <Icon.Lock />
            <span className="hidden sm:inline">Vault</span>
          </Tilt>
        </div>
      </div>
    </nav>
  );
}

/* ================== HERO ================== */

const HERO_LINES = [
  "the game is afoot.",
  "you see, but you do not observe.",
  "eliminate the impossible. whatever remains is the truth.",
  "trust nothing on the wire.",
];

function Hero({ clueCount, solvedCount, team, teamCount, intelCount }) {
  const [lineIdx, setLineIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(
      () => setLineIdx((i) => (i + 1) % HERO_LINES.length),
      4200,
    );
    return () => clearInterval(t);
  }, []);
  const line = useScramble(HERO_LINES[lineIdx], 700);

  const readout = [
    ["case files", clueCount || "—"],
    ["agencies online", teamCount],
    ["wire traffic", intelCount],
    [
      "your progress",
      team ? `${solvedCount} / ${clueCount || "—"}` : "not enrolled",
    ],
  ];

  return (
    <section id="top" className="px-3 sm:px-6 lg:px-10 pt-5 scroll-mt-24">
      <Tilt max={3} className="tn-panel tn-rise">
        <div className="tn-3d grid grid-cols-1 lg:grid-cols-3 gap-8 px-6 sm:px-10 lg:px-14 py-12 sm:py-16">
          <div className="tn-3d lg:col-span-2">
            <div className="tn-z1 tn-chip mb-6">
              <span className="tn-dot" />
              221B uplink · live
            </div>

            <h1 className="tn-z3 tn-heading tn-hero-title mb-5">
              Odyssey
              <br />
              <em>Codehunt</em>
            </h1>

            <p className="tn-z2 text-base sm:text-lg text-slate-300 max-w-xl mb-3">
              Crack the riddle. Reach the drop point. Decrypt the vault.
              Mislead everyone else on the wire while you do it.
            </p>

            <div className="tn-z1 font-mono text-sm text-ch-mute h-6 mb-8 truncate">
              <span className="text-ch-acc">&gt;</span>{" "}
              <span className="tn-caret">{line}</span>
            </div>

            <div className="tn-z2 tn-3d flex flex-wrap items-center gap-3">
              <Tilt
                as="a"
                max={14}
                href="#vault"
                className="tn-btn tn-btn-primary px-5 py-3.5"
              >
                <Icon.Lock />
                Open the vault
              </Tilt>
              <Tilt
                as="a"
                max={14}
                href="#ops"
                className="tn-btn tn-btn-ghost px-5 py-3.5"
              >
                <Icon.Globe />
                Survey the map
              </Tilt>
            </div>
          </div>

          <div className="tn-z2 self-center w-full border border-ch-acc/20 bg-black/50 rounded-[4px] font-mono text-xs">
            <div className="px-3 py-2 border-b border-ch-acc/15 tn-label tn-label-acc">
              mission_status
            </div>
            <dl className="px-3 py-2">
              {readout.map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-center justify-between gap-4 py-1.5 border-b border-white/[0.04] last:border-0"
                >
                  <dt className="text-ch-mute">{k}</dt>
                  <dd className="text-white tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </Tilt>
    </section>
  );
}

/* ================== LIVE STATS ================== */

function StatCard({ icon, label, value, delay = 0 }) {
  const animated = useAnimatedNumber(value || 0);
  return (
    <Tilt
      max={10}
      className="tn-panel tn-rise p-4 sm:p-5"
      style={{ animationDelay: `${delay}s` }}
    >
      <div className="tn-z1 flex items-center justify-between mb-4">
        <span className="w-8 h-8 flex items-center justify-center border border-ch-acc/40 text-ch-acc rounded-[3px]">
          {icon}
        </span>
        <span className="tn-label flex items-center gap-1.5">
          <span className="tn-dot" />
          live
        </span>
      </div>
      <div className="tn-z3 text-3xl sm:text-4xl font-semibold font-mono tabular-nums text-white">
        {Math.round(animated)}
      </div>
      <div className="tn-z1 tn-label mt-1.5">{label}</div>
    </Tilt>
  );
}

function LiveStats({ clueCount, solvedCount, team, teamCount }) {
  const unlocked = team ? Math.min(solvedCount + 1, clueCount) : 0;
  return (
    <section className="px-3 sm:px-6 lg:px-10 pt-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          delay={0.05}
          icon={<Icon.Search />}
          label="Files unlocked"
          value={unlocked}
        />
        <StatCard
          delay={0.1}
          icon={<Icon.Check />}
          label="Vaults breached"
          value={solvedCount}
        />
        <StatCard
          delay={0.15}
          icon={<Icon.Bolt />}
          label="Your score"
          value={team?.score || 0}
        />
        <StatCard
          delay={0.2}
          icon={<Icon.Shield />}
          label="Agencies online"
          value={teamCount}
        />
      </div>
    </section>
  );
}

/* ================== INTERACTIVE MAP ================== */

const PIN_COLOR = {
  open: "#3dffa2",
  solved: "#6ad7ff",
  intel: "#ffb224",
};

const NO_PINS = []; // stable identity so a filtered-out source doesn't re-render pins

const validLatLng = (c) =>
  Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]);

// Two live sources feed the map:
//   cluePins  — clues this team has unlocked (status "solved" | "open").
//               Sealed clues are never passed in.
//   intelPins — Wire posts that carry mapCoordinates. Unverified.
// `draftPin` is the not-yet-sent pin for the Wire composer; while
// `picking` is true the next map click reports its position to onPick.
//
// The Leaflet canvas itself is deliberately not tilted: Leaflet maps
// pointer positions through its own 2D transforms, so a CSS 3D rotation
// on an ancestor makes clicks and drags land in the wrong place.
function InteractiveMap({
  cluePins,
  intelPins,
  draftPin,
  picking,
  onPick,
  emptyHint,
  focus,
}) {
  const mapEl = useRef(null);
  const mapInstance = useRef(null);
  const markersLayer = useRef(null);
  const radiusLayer = useRef(null);
  const linksLayer = useRef(null);
  const markersById = useRef(new Map());
  const [mapReady, setMapReady] = useState(false);
  const [filter, setFilter] = useState("all"); // all | clues | intel
  const [scrollZoom, setScrollZoom] = useState(false);
  const [userLocation, setUserLocation] = useState(null); // { coords:[lat,lon], accuracy }
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState(null);

  const visibleClues = filter === "intel" ? NO_PINS : cluePins;
  const visibleIntel = filter === "clues" ? NO_PINS : intelPins;
  const visibleCount = visibleClues.length + visibleIntel.length;

  // One-time map init — defensive against load-order races and
  // post-mount layout shifts (Tailwind CDN JIT, fonts, responsive
  // breakpoints).
  useEffect(() => {
    let cancelled = false;
    let resizeObs = null;
    let recalcTimers = [];
    let pollTimer = null;

    const invalidate = () => {
      if (cancelled) return;
      const m = mapInstance.current;
      if (!m) return;
      try {
        m.invalidateSize({ animate: false });
      } catch (e) {
        console.warn("[BakerStreet] invalidateSize failed", e);
      }
    };

    const initMap = () => {
      if (cancelled || mapInstance.current || !mapEl.current) return;
      const L = window.L;
      try {
        const map = L.map(mapEl.current, {
          center: MAP_CENTER,
          zoom: 13,
          zoomControl: true,
          attributionControl: true,
          scrollWheelZoom: false,
          // Defensive: prefer canvas renderer if SVG is somehow blocked.
          preferCanvas: false,
        });

        // OpenStreetMap standard tiles (no API key). They are light;
        // .leaflet-tile-pane in styles.css inverts them to match the HUD.
        const base = L.tileLayer(
          "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
          {
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19,
            crossOrigin: true,
          },
        );
        let tileErrorCount = 0;
        base.on("tileerror", (e) => {
          tileErrorCount++;
          if (tileErrorCount <= 3) {
            console.warn(
              "[BakerStreet] tile error",
              e?.tile?.src || "(no src)",
              "— check network/CDN",
            );
          }
        });
        base.addTo(map);

        radiusLayer.current = L.layerGroup().addTo(map);
        linksLayer.current = L.layerGroup().addTo(map);
        markersLayer.current = L.layerGroup().addTo(map);
        mapInstance.current = map;
        setMapReady(true);

        // Force size recalculation. Leaflet measures the container
        // once on init; we need to retry after the next paint and
        // again later in case Tailwind/fonts reflow.
        requestAnimationFrame(invalidate);
        recalcTimers.push(setTimeout(invalidate, 200));
        recalcTimers.push(setTimeout(invalidate, 800));
        recalcTimers.push(setTimeout(invalidate, 2000));

        // Watch the container for size changes (responsive layout)
        if (typeof ResizeObserver !== "undefined") {
          resizeObs = new ResizeObserver(invalidate);
          resizeObs.observe(mapEl.current);
        }

        // Window-level events as a final safety net
        window.addEventListener("resize", invalidate);
        window.addEventListener("orientationchange", invalidate);
        window.addEventListener("load", invalidate);
      } catch (err) {
        console.error("[BakerStreet] map init failed:", err);
      }
    };

    // Wait for Leaflet UMD to load (in case JSX module raced ahead)
    const tryStart = (attempt = 0) => {
      if (cancelled) return;
      if (window.L && mapEl.current) {
        // Defer one frame so any pending CSS / Tailwind JIT has applied
        requestAnimationFrame(initMap);
        return;
      }
      if (attempt >= 100) {
        console.error(
          "[BakerStreet] window.L never became available — Leaflet failed to load",
        );
        return;
      }
      pollTimer = setTimeout(() => tryStart(attempt + 1), 80);
    };
    tryStart();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      recalcTimers.forEach(clearTimeout);
      try {
        resizeObs?.disconnect();
      } catch {}
      window.removeEventListener("resize", invalidate);
      window.removeEventListener("orientationchange", invalidate);
      window.removeEventListener("load", invalidate);
      if (mapInstance.current) {
        try {
          mapInstance.current.remove();
        } catch (e) {
          console.warn("[BakerStreet] map cleanup error", e);
        }
        mapInstance.current = null;
      }
      markersLayer.current = null;
      radiusLayer.current = null;
      linksLayer.current = null;
      markersById.current.clear();
    };
  }, []);

  // Toggle scroll-wheel zoom
  useEffect(() => {
    if (!mapInstance.current) return;
    if (scrollZoom) mapInstance.current.scrollWheelZoom.enable();
    else mapInstance.current.scrollWheelZoom.disable();
  }, [scrollZoom]);

  // Pin-drop mode: the next map click becomes the Wire draft pin
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !picking) return;
    const onClick = (e) => onPick([e.latlng.lat, e.latlng.lng]);
    map.on("click", onClick);
    return () => map.off("click", onClick);
  }, [picking, onPick, mapReady]);

  // Render clue pins, intel pins, the draft pin, and the trail
  useEffect(() => {
    if (!mapInstance.current || !markersLayer.current || !window.L) return;
    const L = window.L;

    markersLayer.current.clearLayers();
    radiusLayer.current.clearLayers();
    linksLayer.current.clearLayers();
    markersById.current.clear();

    const addMarker = ({ id, coords, kind, glyph, popupHtml, zIndexOffset }) => {
      const color = PIN_COLOR[kind === "draft" ? "intel" : kind];
      const icon = L.divIcon({
        className: "tn-marker-icon",
        html: `
          <div class="tn-mk tn-mk-${kind}" style="--c:${color}">
            <span class="tn-mk-pulse"></span>
            <span class="tn-mk-core"><b>${glyph}</b></span>
          </div>
        `,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      });
      const marker = L.marker(coords, {
        icon,
        riseOnHover: true,
        zIndexOffset,
        interactive: !!popupHtml,
      });
      if (popupHtml) {
        marker.bindPopup(popupHtml, {
          maxWidth: 260,
          minWidth: 220,
          offset: [0, -10],
        });
      }
      marker.addTo(markersLayer.current);
      if (id) markersById.current.set(id, marker);
    };

    visibleClues.forEach((pin) => {
      const [lat, lng] = pin.coords;
      const solved = pin.status === "solved";
      const color = PIN_COLOR[pin.status];
      const order = escapeHtml(pin.order ?? "?");

      L.circle(pin.coords, {
        radius: solved ? 40 : 60,
        color,
        weight: solved ? 1 : 1.6,
        opacity: solved ? 0.5 : 0.85,
        fillColor: color,
        fillOpacity: solved ? 0.04 : 0.12,
        dashArray: "3 5",
        interactive: false,
      }).addTo(radiusLayer.current);

      addMarker({
        id: pin.id,
        coords: pin.coords,
        kind: pin.status,
        glyph: solved ? "✓" : order,
        zIndexOffset: solved ? 0 : 500,
        popupHtml: `
          <div class="tn-pop">
            <div class="tn-pop-head">
              <span class="tn-pop-badge" style="--c:${color}">${solved ? "Breached" : "Target"}</span>
              <span class="tn-pop-cat">File ${order}</span>
            </div>
            <div class="tn-pop-title">${escapeHtml(pin.title || "Untitled file")}</div>
            <div class="tn-pop-meta">
              <div>${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
              <div>${solved ? "passcode recovered here" : "search here for the passcode"}</div>
            </div>
          </div>
        `,
      });
    });

    // The trail so far — joins unlocked clue pins in file order
    if (visibleClues.length > 1) {
      L.polyline(
        visibleClues.map((p) => p.coords),
        {
          color: PIN_COLOR.solved,
          weight: 1.4,
          opacity: 0.6,
          dashArray: "6 8",
          className: "tn-link",
          interactive: false,
        },
      ).addTo(linksLayer.current);
    }

    // Wire intel — message text is user-supplied, so always escaped
    visibleIntel.forEach((post) => {
      addMarker({
        id: `intel:${post.id}`,
        coords: post.coords,
        kind: "intel",
        glyph: "!",
        popupHtml: `
          <div class="tn-pop">
            <div class="tn-pop-head">
              <span class="tn-pop-badge" style="--c:${PIN_COLOR.intel}">Unverified</span>
              <span class="tn-pop-cat">${escapeHtml(formatRelativeTime(post.timestamp) || "just now")}</span>
            </div>
            <div class="tn-pop-title">${escapeHtml(post.message)}</div>
            <div class="tn-pop-meta">
              <div>source: ${escapeHtml(post.teamName || "unknown")}</div>
              <div>${post.coords[0].toFixed(5)}, ${post.coords[1].toFixed(5)}</div>
            </div>
          </div>
        `,
      });
    });

    if (validLatLng(draftPin)) {
      addMarker({
        coords: draftPin,
        kind: "draft",
        glyph: "+",
        zIndexOffset: 900,
      });
    }

    // "You are here" marker + accuracy circle
    if (userLocation && Array.isArray(userLocation.coords)) {
      const me = userLocation.coords;
      L.circle(me, {
        radius: Math.min(Math.max(Number(userLocation.accuracy) || 50, 25), 500),
        color: "#6ad7ff",
        weight: 1.2,
        opacity: 0.7,
        fillColor: "#6ad7ff",
        fillOpacity: 0.08,
        interactive: false,
      }).addTo(linksLayer.current);

      const icon = L.divIcon({
        className: "tn-marker-icon",
        html: `
          <div class="tn-you">
            <span class="tn-you-ring"></span>
            <span class="tn-you-ring tn-you-ring-2"></span>
            <span class="tn-you-core"></span>
          </div>
        `,
        iconSize: [46, 46],
        iconAnchor: [23, 23],
      });
      L.marker(me, { icon, zIndexOffset: 1000, interactive: false }).addTo(
        markersLayer.current,
      );
    }
  }, [visibleClues, visibleIntel, draftPin, userLocation, mapReady]);

  // Fly the map so every visible pin fits in the viewport. Single-
  // pin case zooms in instead of fitting a degenerate bounding box.
  const handleFitAll = useCallback(() => {
    if (!mapInstance.current || !window.L) return;
    const points = [...visibleClues, ...visibleIntel].map((p) => p.coords);
    if (points.length === 0) return;
    if (points.length === 1) {
      mapInstance.current.flyTo(points[0], 17, { duration: 0.7 });
      return;
    }
    const bounds = window.L.latLngBounds(points);
    if (!bounds.isValid()) return;
    mapInstance.current.flyToBounds(bounds, {
      padding: [70, 70],
      maxZoom: 17,
      duration: 0.8,
    });
  }, [visibleClues, visibleIntel]);

  // Campus is rarely at the default anchor, so refit when the first
  // pins arrive, when a new clue unlocks, and when the filter flips —
  // but not on every Wire post, which would yank the map around.
  const fitKey = `${filter}|${visibleClues.map((p) => p.id).join(",")}|${visibleCount > 0}`;
  const didInitialFitRef = useRef(false);
  useEffect(() => {
    if (!mapReady || visibleCount === 0) return;
    const t = setTimeout(
      () => {
        didInitialFitRef.current = true;
        handleFitAll();
      },
      didInitialFitRef.current ? 60 : 1100,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, mapReady]);

  // "View on map" from the vault or a Wire line: fly there, open it.
  useEffect(() => {
    if (!focus || !mapInstance.current) return;
    const marker = markersById.current.get(focus.id);
    if (!marker) return;
    mapInstance.current.flyTo(marker.getLatLng(), 17, { duration: 0.8 });
    marker.openPopup();
  }, [focus]);

  const handleLocateMe = useCallback(() => {
    setLocError(null);
    if (!navigator.geolocation) {
      setLocError("Geolocation isn't supported by this browser");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = [pos.coords.latitude, pos.coords.longitude];
        setUserLocation({ coords, accuracy: pos.coords.accuracy || 50 });
        setLocating(false);
        if (mapInstance.current) {
          mapInstance.current.flyTo(coords, 14, { duration: 1.0 });
        }
      },
      (err) => {
        setLocating(false);
        const msg =
          err.code === 1
            ? "Location permission denied"
            : err.code === 2
              ? "Location currently unavailable"
              : err.code === 3
                ? "Location request timed out"
                : "Couldn't get your location";
        setLocError(msg);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, []);

  const openPin = cluePins.find((p) => p.status === "open") || null;

  // Straight-line distance from the detective to the open file
  const distanceToOpen = useMemo(() => {
    if (!userLocation || !openPin || !window.L) return null;
    return window.L.latLng(userLocation.coords).distanceTo(
      window.L.latLng(openPin.coords),
    );
  }, [userLocation, openPin]);

  return (
    <div
      id="hunt-map"
      className={cn(
        "tn-panel tn-rise lg:col-span-2 scroll-mt-24",
        picking && "tn-map-picking",
      )}
    >
      {/*
        Sizing is provided by .tn-map-canvas in styles.css with
        explicit pixel heights so the map has a guaranteed height
        even before Tailwind's CDN JIT finishes applying its classes.
      */}
      <div ref={mapEl} className="tn-map-canvas" />

      {/* Top-left: live counter */}
      <div className="tn-hud pointer-events-none absolute top-3 left-3 z-[400] flex items-center gap-2">
        <span className="tn-dot" />
        {cluePins.length} files · {intelPins.length} intel
      </div>

      {/* Top-right: source filter */}
      <div className="absolute top-3 right-3 z-[400] flex gap-1">
        {[
          { k: "all", label: "All" },
          { k: "clues", label: "Files" },
          { k: "intel", label: "Intel" },
        ].map((o) => (
          <button
            key={o.k}
            onClick={() => setFilter(o.k)}
            className={cn("tn-hud", filter === o.k && "tn-hud-on")}
          >
            {o.label}
          </button>
        ))}
      </div>

      {/* Pin-drop banner */}
      <AnimatePresence>
        {picking && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="tn-hud pointer-events-none absolute top-14 inset-x-0 mx-auto w-fit z-[420] !border-ch-warn !text-ch-warn whitespace-nowrap"
          >
            click the map to drop your pin · esc to cancel
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom-left: locate-me + fit + scroll-zoom toggle */}
      <div className="absolute bottom-6 left-3 z-[400] flex items-center gap-1 flex-wrap max-w-[calc(100%-1.5rem)]">
        <button
          onClick={handleLocateMe}
          disabled={locating}
          className={cn("tn-hud", userLocation && "tn-hud-on")}
          title="Center map on your location"
        >
          {locating ? "locating…" : userLocation ? "you · locked" : "locate me"}
        </button>
        <button
          onClick={handleFitAll}
          disabled={visibleCount === 0}
          className="tn-hud"
          title="Zoom & pan to fit every visible pin"
        >
          fit all
        </button>
        <button
          onClick={() => setScrollZoom((s) => !s)}
          className={cn("tn-hud", scrollZoom && "tn-hud-on")}
          title="Toggle scroll-wheel zoom"
        >
          scroll-zoom · {scrollZoom ? "on" : "off"}
        </button>
      </div>

      {/* Geolocation error toast */}
      <AnimatePresence>
        {locError && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="tn-hud absolute bottom-16 left-3 z-[420] !border-ch-danger !text-ch-danger max-w-[260px]"
          >
            {locError}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom-right: distance to the open file */}
      {distanceToOpen != null && (
        <div className="tn-hud tn-hud-on absolute bottom-6 right-3 z-[400] max-w-[240px]">
          target · {formatDistance(distanceToOpen)} out
        </div>
      )}

      {/* Empty state overlay */}
      {visibleCount === 0 && !picking && (
        <div className="absolute inset-0 z-[450] flex items-center justify-center pointer-events-none">
          <div className="tn-hud text-center !px-5 !py-3">
            <div className="text-white">no signals on the map</div>
            <div className="text-ch-mute mt-1 normal-case tracking-normal">
              {filter === "intel" ? "no pinned intel on the wire yet" : emptyHint}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================== THE WIRE (LIVE INTEL FEED) ================== */

function formatClock(ts) {
  const ms = tsToMillis(ts);
  if (!ms) return "--:--:--";
  return new Date(ms).toLocaleTimeString("en-GB", { hour12: false });
}

function TheWire({
  intel,
  user,
  team,
  draftPin,
  picking,
  onTogglePick,
  onClearPin,
  onSignIn,
  onFocusPin,
}) {
  const feedRef = useRef(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooling, setCooling] = useState(false);
  const [err, setErr] = useState("");

  // Terminal behaviour: stick to the newest line
  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [intel.length]);

  const coolTimer = useRef(0);
  useEffect(() => () => clearTimeout(coolTimer.current), []);

  const transmit = async (e) => {
    e.preventDefault();
    if (busy || cooling || !message.trim()) return;
    setErr("");
    setBusy(true);
    try {
      await postIntel({ team, message, coords: draftPin });
      setMessage("");
      onClearPin();
      setCooling(true);
      coolTimer.current = setTimeout(
        () => setCooling(false),
        INTEL_COOLDOWN_MS,
      );
    } catch (e2) {
      setErr(e2.message || "Transmission failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Tilt max={2} className="tn-panel tn-wire tn-rise">
      <div className="tn-wire-bar">
        <div className="flex items-center gap-2 min-w-0">
          <span className="tn-dot" />
          <span className="text-xs font-semibold tracking-[0.16em] uppercase text-white truncate">
            The Wire
          </span>
          <span className="tn-label hidden sm:inline">intel_feed</span>
        </div>
        <span className="tn-label">{intel.length} tx</span>
      </div>

      <div ref={feedRef} className="tn-wire-feed">
        <span className="tn-wire-line tn-wire-sys">
          // uplink established · channel open to all agencies
        </span>
        <span className="tn-wire-line tn-wire-sys">
          // intel is unverified. pins may be bluffs. trust no one.
        </span>
        {intel.map((post) => {
          const mine = team && post.teamName === team.teamName;
          const body = (
            <>
              <span className="tn-wire-time">[{formatClock(post.timestamp)}]</span>{" "}
              <span className="tn-wire-team">{post.teamName || "unknown"}</span>
              <span className="tn-wire-time"> &gt; </span>
              {post.message}
              {post.coords && <span className="tn-wire-pin"> ◆ pin</span>}
            </>
          );
          const cls = cn("tn-wire-line", mine && "tn-wire-line-mine");
          return post.coords ? (
            <button
              key={post.id}
              type="button"
              className={cls}
              title="Show this pin on the map"
              onClick={() => onFocusPin(`intel:${post.id}`)}
            >
              {body}
            </button>
          ) : (
            <span key={post.id} className={cls}>
              {body}
            </span>
          );
        })}
        {intel.length === 0 && (
          <span className="tn-wire-line tn-wire-sys">
            // channel silent. be the first to transmit.
          </span>
        )}
      </div>

      {team ? (
        <form onSubmit={transmit} className="tn-wire-form">
          <div className="tn-wire-prompt">
            <span className="text-ch-acc text-xs shrink-0">&gt;</span>
            <input
              type="text"
              value={message}
              maxLength={INTEL_MAX}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="found something near the library…"
              aria-label="Intel message"
            />
            <span className="tn-label shrink-0 tabular-nums">
              {INTEL_MAX - message.length}
            </span>
          </div>

          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              onClick={draftPin ? onClearPin : onTogglePick}
              className={cn(
                "tn-btn tn-btn-ghost flex-1 !px-2",
                (picking || draftPin) && "tn-btn-armed",
              )}
              title="Attach a map pin. Nobody can tell whether it's real or a bluff."
            >
              <Icon.Pin />
              {draftPin
                ? "Pin set · remove"
                : picking
                  ? "Click the map…"
                  : "Drop a pin"}
            </button>
            <Tilt
              as="button"
              max={14}
              type="submit"
              disabled={busy || cooling || !message.trim()}
              className="tn-btn tn-btn-primary"
            >
              {busy ? "Sending…" : cooling ? "Cooling…" : "Transmit"}
            </Tilt>
          </div>

          <div className="tn-label mt-2 normal-case tracking-normal">
            {err ? (
              <span className="text-ch-danger">{err}</span>
            ) : draftPin ? (
              <>
                pin at {draftPin[0].toFixed(4)}, {draftPin[1].toFixed(4)} —
                real lead or bluff, it looks identical to everyone else
              </>
            ) : (
              "pins are optional. real lead or bluff — your call."
            )}
          </div>
        </form>
      ) : (
        <div className="tn-wire-form flex items-center justify-between gap-3">
          <span className="tn-label normal-case tracking-normal">
            {user
              ? "enrol your agency in the vault to transmit"
              : "read-only. sign in to transmit"}
          </span>
          {user ? (
            <a href="#vault" className="tn-btn tn-btn-ghost">
              Enrol
            </a>
          ) : (
            <button onClick={onSignIn} className="tn-btn tn-btn-ghost">
              Sign in
            </button>
          )}
        </div>
      )}
    </Tilt>
  );
}

/* ================== THE VAULT (CLUES + PASSCODE) ================== */

const CELEBRATION_MS = 2600;

function RegisterTeamCard({ user }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await registerTeam(user, name);
    } catch (e2) {
      setErr(e2.message || "Couldn't register your agency.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Tilt max={4} className="tn-panel p-6 sm:p-8 max-w-xl">
      <div className="tn-z1 tn-label tn-label-acc mb-2">// enrolment</div>
      <h3 className="tn-z2 tn-heading text-xl mb-2">Name your agency</h3>
      <p className="tn-z1 text-sm text-ch-mute mb-5">
        This is the callsign shown on the leaderboard and the wire. One agency
        per account, and it can't be changed mid-hunt.
      </p>
      <form onSubmit={submit} className="tn-z2 tn-3d flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Odyssey explorers"
          aria-label="Agency name"
          className="tn-input flex-1"
        />
        <Tilt
          as="button"
          max={14}
          type="submit"
          disabled={busy}
          className="tn-btn tn-btn-primary px-5"
        >
          {busy ? "Enrolling…" : "Take the case"}
        </Tilt>
      </form>
      {err && <div className="mt-3 text-xs font-mono text-ch-danger">{err}</div>}
    </Tilt>
  );
}

// The active clue. Stays mounted across clues so the unlock
// celebration can cover the moment the Firestore snapshot swaps in
// the next file underneath it.
function Vault({ clue, index, total, user, team, onViewOnMap }) {
  const [attempt, setAttempt] = useState("");
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [err, setErr] = useState("");
  const [granted, setGranted] = useState(null); // { title, last }
  const timers = useRef([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const title = useScramble(clue?.title || "Untitled file", 600);
  const riddle = useScramble(clue?.riddle || "", 1100);

  const submit = async (e) => {
    e.preventDefault();
    if (!clue || busy || granted || !attempt.trim()) return;
    setErr("");
    setBusy(true);
    try {
      const ok = await submitPasscode({ user, clue, index, attempt });
      if (ok) {
        setAttempt("");
        setGranted({ title: clue.title, last: index === total - 1 });
        timers.current.push(
          setTimeout(() => setGranted(null), CELEBRATION_MS),
        );
      } else {
        setDenied(true);
        setErr("access denied — passcode rejected");
        timers.current.push(setTimeout(() => setDenied(false), 500));
      }
    } catch (e2) {
      setErr(e2.message || "Couldn't submit the passcode.");
    } finally {
      setBusy(false);
    }
  };

  const dialState = granted
    ? "granted"
    : denied
      ? "denied"
      : busy
        ? "busy"
        : "idle";
  const breached = !clue; // every file solved

  return (
    <Tilt max={2.5} className="tn-panel">
      <div className="tn-3d flex flex-col md:flex-row items-center gap-8 lg:gap-12 p-6 sm:p-10">
        <Tilt max={18} className="tn-vault-dial tn-z2" data-state={breached ? "granted" : dialState}>
          <span className="tn-ring tn-ring-1" />
          <span className="tn-ring tn-ring-2" />
          <span className="tn-ring tn-ring-3" />
          <span className="tn-vault-core">
            {granted || breached ? <Icon.Check /> : <Icon.Lock />}
            <span className="font-mono text-[10px] tracking-[0.16em]">
              {breached
                ? "OPEN"
                : `FILE ${String(clue.order ?? index + 1).padStart(2, "0")}`}
            </span>
          </span>
        </Tilt>

        {breached ? (
          <div className="tn-z1 flex-1 min-w-0 text-center md:text-left">
            <div className="tn-label tn-label-acc mb-2">
              // all {total} vaults breached
            </div>
            <h3 className="tn-heading text-2xl sm:text-3xl mb-3">
              Case closed, <em>{team.teamName}</em>
            </h3>
            <p className="text-sm text-ch-mute font-mono">
              final score {team.score || 0} pts. watch the leaderboard — ties
              go to whoever finished first.
            </p>
          </div>
        ) : (
          <div className="tn-3d flex-1 min-w-0 w-full">
            <div className="tn-z1 flex items-center justify-between gap-3 mb-3">
              <span className="tn-label tn-label-acc">
                // file {index + 1} of {total} · encrypted payload
              </span>
              <span className="tn-chip">+{POINTS_PER_CLUE} pts</span>
            </div>

            <h3 className="tn-z2 tn-heading text-xl sm:text-2xl mb-3 break-words">
              {title}
            </h3>
            <p className="tn-z1 tn-cipher mb-6">{riddle}</p>

            <form onSubmit={submit} className="tn-z2 tn-3d">
              <label className="tn-label block mb-1.5" htmlFor="vault-passcode">
                passcode recovered at the scene
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className={cn("tn-wire-prompt flex-1", denied && "tn-shake")}>
                  <span className="text-ch-acc font-mono text-sm shrink-0">&gt;</span>
                  <input
                    id="vault-passcode"
                    type="text"
                    value={attempt}
                    onChange={(e) => setAttempt(e.target.value)}
                    placeholder="enter passcode"
                    autoCapitalize="none"
                    autoCorrect="off"
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono !text-sm tracking-[0.12em]"
                  />
                </div>
                <Tilt
                  as="button"
                  max={14}
                  type="submit"
                  disabled={busy || !!granted || !attempt.trim()}
                  className="tn-btn tn-btn-primary px-6 py-3.5"
                >
                  {busy ? "Decrypting…" : "Decrypt"}
                </Tilt>
              </div>
            </form>

            <div className="tn-z1 flex items-center justify-between gap-3 mt-3 font-mono text-[11px]">
              <span className={err ? "text-ch-danger" : "text-ch-mute"}>
                {err || "awaiting passcode…"}
              </span>
              {clueCoords(clue) && (
                <button
                  type="button"
                  onClick={() => onViewOnMap(clue.id)}
                  className="inline-flex items-center gap-1.5 text-ch-ice hover:text-white uppercase tracking-wider"
                >
                  <Icon.Pin />
                  View on map
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {granted && (
        <div className="tn-granted" role="status">
          <div className="tn-burst" aria-hidden="true">
            {Array.from({ length: 28 }, (_, i) => (
              <i
                key={i}
                style={{
                  "--a": `${(i * 360) / 28}deg`,
                  "--d": `${140 + (i % 4) * 55}px`,
                  "--dl": `${(i % 3) * 0.05}s`,
                }}
              />
            ))}
          </div>
          <div className="tn-granted-title">ACCESS GRANTED</div>
          <div className="font-mono text-sm text-white">
            {granted.title} · +{POINTS_PER_CLUE} pts
          </div>
          <div className="tn-label">
            {granted.last ? "final vault breached" : "decrypting next file…"}
          </div>
        </div>
      )}
    </Tilt>
  );
}

function ArchiveCard({ clue, index, solved, onViewOnMap }) {
  return (
    <Tilt max={9} className={cn("tn-panel p-4", !solved && "opacity-60")}>
      <div className="tn-z1 flex items-center justify-between gap-2 mb-2">
        <span className="tn-label">
          file {String(clue.order ?? index + 1).padStart(2, "0")}
        </span>
        <span
          className="tn-chip"
          style={{ "--c": solved ? "var(--ice)" : "var(--mute)" }}
        >
          {solved ? <Icon.Check /> : <Icon.Lock />}
          {solved ? "Breached" : "Sealed"}
        </span>
      </div>
      {solved ? (
        <>
          <h4 className="tn-z2 font-semibold text-white mb-1 break-words">
            {clue.title || "Untitled file"}
          </h4>
          <p className="tn-z1 text-xs text-ch-mute font-mono leading-relaxed whitespace-pre-line">
            {clue.riddle}
          </p>
          {clueCoords(clue) && (
            <button
              type="button"
              onClick={() => onViewOnMap(clue.id)}
              className="tn-z1 mt-3 inline-flex items-center gap-1.5 font-mono text-[11px] text-ch-ice hover:text-white uppercase tracking-wider"
            >
              <Icon.Pin />
              View on map
            </button>
          )}
        </>
      ) : (
        <p className="tn-z1 font-mono text-xs text-ch-mute break-all select-none">
          ▓▓▒░█▓▒▒░░▓█▒░▓▓▒░░█▓▒░▓▒▒░█▓░▒▓
          <br />
          breach the previous file to decrypt
        </p>
      )}
    </Tilt>
  );
}

function VaultSection({
  clues,
  user,
  team,
  teamLoading,
  solvedCount,
  onSignIn,
  onViewOnMap,
}) {
  let body;
  if (!user) {
    body = (
      <Tilt max={4} className="tn-panel p-6 sm:p-8 max-w-xl">
        <div className="tn-z1 tn-label tn-label-acc mb-2">// access denied</div>
        <h3 className="tn-z2 tn-heading text-xl mb-2">Agency eyes only</h3>
        <p className="tn-z1 text-sm text-ch-mute mb-5">
          Sign in to enrol your agency and receive your first encrypted file.
        </p>
        <Tilt
          as="button"
          max={14}
          onClick={onSignIn}
          className="tn-z2 tn-btn tn-btn-primary px-5 py-3.5"
        >
          Sign in to begin
        </Tilt>
      </Tilt>
    );
  } else if (teamLoading) {
    body = (
      <div className="tn-panel p-6 font-mono text-sm text-ch-mute">
        <span className="tn-caret">querying the archives</span>
      </div>
    );
  } else if (!team) {
    body = <RegisterTeamCard user={user} />;
  } else if (clues.length === 0) {
    body = (
      <div className="tn-panel p-6 font-mono text-sm text-ch-mute">
        // no files uploaded yet. the hunt master is still setting the scene.
      </div>
    );
  } else {
    const archive = clues
      .map((clue, index) => ({ clue, index }))
      .filter(({ index }) => index !== solvedCount);
    body = (
      <>
        <Vault
          clue={clues[solvedCount] || null}
          index={solvedCount}
          total={clues.length}
          user={user}
          team={team}
          onViewOnMap={onViewOnMap}
        />
        {archive.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mt-4">
            {archive.map(({ clue, index }) => (
              <ArchiveCard
                key={clue.id}
                clue={clue}
                index={index}
                solved={index < solvedCount}
                onViewOnMap={onViewOnMap}
              />
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <section id="vault" className="px-3 sm:px-6 lg:px-10 pt-12 scroll-mt-24">
      <SectionHeading
        label="decryption vault"
        lead="Case"
        accent="Files"
        blurb="Solve the riddle, get to the location, and enter the passcode you find there. Each breach decrypts the next file."
      >
        {team && clues.length > 0 && (
          <span className="tn-chip">
            {solvedCount} / {clues.length} breached
          </span>
        )}
      </SectionHeading>
      {body}
    </section>
  );
}

/* ================== LEADERBOARD ================== */

// `teams` arrives already ranked (score desc, lastSolvedAt asc) from
// the onSnapshot listener in useTeams; framer-motion's `layout` slides
// rows to their new position whenever the order changes.
function LeaderboardSection({ teams, clueCount, currentUid }) {
  return (
    <section id="leaderboard" className="px-3 sm:px-6 lg:px-10 pt-12 scroll-mt-24">
      <SectionHeading
        label="live standings"
        lead="Agency"
        accent="Leaderboard"
        blurb="Ranked by points. Ties go to the agency that breached its latest file first."
      >
        <span className="tn-chip">
          <span className="tn-dot" />
          {teams.length} {teams.length === 1 ? "agency" : "agencies"}
        </span>
      </SectionHeading>

      <Tilt max={1.5} className="tn-panel">
        {teams.length === 0 ? (
          <div className="p-6 font-mono text-sm text-ch-mute">
            // no agencies enrolled yet. be the first on the case.
          </div>
        ) : (
          <>
            <div className="tn-lb-row tn-lb-head tn-label">
              <span>Rank</span>
              <span>Agency</span>
              <span className="text-right">Files</span>
              <span className="text-right">Points</span>
              <span className="text-right hidden sm:block">Last breach</span>
            </div>
            {teams.map((t, i) => {
              const mine = t.id === currentUid;
              const solved = t.cluesSolved || 0;
              const pct = clueCount
                ? Math.min(100, (solved / clueCount) * 100)
                : 0;
              return (
                <motion.div
                  layout
                  transition={{ type: "spring", stiffness: 420, damping: 36 }}
                  key={t.id}
                  className={cn("tn-lb-row", mine && "tn-lb-row-mine")}
                >
                  <span className="tn-lb-rank" data-rank={i + 1}>
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-semibold text-white truncate">
                        {t.teamName || "unnamed agency"}
                      </span>
                      {mine && <span className="tn-chip">You</span>}
                      {clueCount > 0 && solved >= clueCount && (
                        <span
                          className="tn-chip hidden sm:inline-flex"
                          style={{ "--c": "var(--ice)" }}
                        >
                          Case closed
                        </span>
                      )}
                    </div>
                    <div className="tn-lb-bar">
                      <i style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <span className="text-right font-mono text-sm tabular-nums text-slate-300">
                    {solved}
                    {clueCount > 0 && (
                      <span className="text-ch-mute">/{clueCount}</span>
                    )}
                  </span>
                  <span className="text-right font-mono text-base font-bold tabular-nums text-ch-acc">
                    {t.score || 0}
                  </span>
                  <span className="text-right font-mono text-[11px] text-ch-mute hidden sm:block">
                    {formatRelativeTime(t.lastSolvedAt) || "—"}
                  </span>
                </motion.div>
              );
            })}
          </>
        )}
      </Tilt>
    </section>
  );
}

/* ================== AUTH MODAL ================== */

// Firebase auth error code → terminal-style line for the modal.
const AUTH_ERRORS = {
  "auth/popup-closed-by-user": "ACCESS ABORTED - G-LINK WINDOW CLOSED",
  "auth/cancelled-popup-request": "ACCESS ABORTED - G-LINK WINDOW CLOSED",
  "auth/popup-blocked": "ACCESS DENIED - POPUP BLOCKED BY BROWSER",
  "auth/network-request-failed": "ACCESS DENIED - CONNECTION FAILED",
  "auth/unauthorized-domain": "ACCESS DENIED - DOMAIN NOT AUTHORIZED",
  "auth/operation-not-allowed": "ACCESS DENIED - SIGN-IN METHOD DISABLED",
  "auth/user-disabled": "ACCESS DENIED - ACCOUNT DISABLED",
  "auth/account-exists-with-different-credential":
    "ACCESS DENIED - EMAIL LINKED TO ANOTHER SIGN-IN METHOD",
  "auth/invalid-credential": "ACCESS DENIED - INVALID CREDENTIALS",
  "auth/invalid-action-code": "ACCESS DENIED - SIGN-IN LINK EXPIRED",
  "auth/expired-action-code": "ACCESS DENIED - SIGN-IN LINK EXPIRED",
  "auth/missing-email": "ACCESS DENIED - EMAIL ADDRESS REQUIRED",
  "auth/wrong-password": "ACCESS DENIED - INVALID CREDENTIALS",
  "auth/user-not-found": "ACCESS DENIED - INVALID CREDENTIALS",
  "auth/invalid-email": "ACCESS DENIED - MALFORMED EMAIL",
  "auth/email-already-in-use": "ACCESS DENIED - EMAIL ALREADY ENROLLED",
  "auth/weak-password": "ACCESS DENIED - PASSWORD TOO WEAK (6+ CHARS)",
  "auth/too-many-requests": "ACCESS DENIED - TOO MANY ATTEMPTS, STAND BY",
};
const authErrorLine = (e) =>
  AUTH_ERRORS[e?.code] || "ACCESS DENIED - CONNECTION FAILED";

const GoogleGlyph = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.85 3.18-1.73 4.1-1.02 1.02-2.62 2.14-5.63 2.14-4.83 0-8.6-3.89-8.6-8.72s3.77-8.72 8.6-8.72c2.6 0 4.5 1.03 5.9 2.35l2.3-2.3C19.2 1.19 16.62 0 12.48 0 5.87 0 .31 5.39.31 12s5.56 12 12.17 12c3.57 0 6.27-1.17 8.37-3.36 2.16-2.16 2.84-5.21 2.84-7.67 0-.76-.05-1.47-.17-2.05H12.48Z" />
  </svg>
);

function scrollToVault() {
  document
    .getElementById("vault")
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Two steps:
//   "credentials" — Google popup (primary) or passwordless email link
//   "agency"      — first sign-in only: name the team before entering
// Returning users (a teams/{uid} doc exists) skip straight to the vault.
function AuthModal({ open, onClose }) {
  const [step, setStep] = useState("credentials");
  const [authedUser, setAuthedUser] = useState(null);
  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState("");
  const [agency, setAgency] = useState("");
  const [busy, setBusy] = useState(""); // "" | "google" | "email" | "agency"
  const [emailSent, setEmailSent] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) {
      setStep("credentials");
      setAuthedUser(null);
      setShowEmail(false);
      setEmail("");
      setAgency("");
      setBusy("");
      setEmailSent(false);
      setErr("");
    }
  }, [open]);

  // Shared tail of every sign-in path: returning agencies go to the
  // vault, new accounts are asked for an agency name first.
  const routeSignedIn = async (user) => {
    const snap = await getDoc(doc(db, "teams", user.uid));
    if (snap.exists()) {
      onClose();
      scrollToVault();
    } else {
      setAuthedUser(user);
      setAgency("");
      setStep("agency");
    }
  };

  useEffect(() => {
    if (!open || !isSignInWithEmailLink(auth, window.location.href)) return;
    const savedEmail = window.localStorage.getItem("odyssey-email-link");
    if (!savedEmail) {
      setShowEmail(true);
      setErr("ENTER THE SAME EMAIL ADDRESS TO COMPLETE SIGN-IN");
      return;
    }

    let cancelled = false;
    setBusy("email");
    signInWithEmailLink(auth, savedEmail, window.location.href)
      .then(async (result) => {
        window.localStorage.removeItem("odyssey-email-link");
        window.history.replaceState({}, document.title, window.location.pathname);
        if (!cancelled) await routeSignedIn(result.user);
      })
      .catch((e) => {
        console.error("email link sign-in:", e);
        if (!cancelled) setErr(authErrorLine(e));
      })
      .finally(() => {
        if (!cancelled) setBusy("");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleGoogleLogin = async () => {
    if (busy) return;
    setErr("");
    setBusy("google");
    try {
      const result = await signInWithPopup(auth, googleProvider);
      await routeSignedIn(result.user);
    } catch (e) {
      console.error("google sign-in:", e);
      setErr(authErrorLine(e));
    } finally {
      setBusy("");
    }
  };

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setErr("");
    if (!email.trim()) {
      setErr("ACCESS DENIED - EMAIL ADDRESS REQUIRED");
      return;
    }
    setBusy("email");
    try {
      await sendSignInLinkToEmail(auth, email.trim(), {
        url: `${window.location.origin}${window.location.pathname}`,
        handleCodeInApp: true,
      });
      window.localStorage.setItem("odyssey-email-link", email.trim());
      setEmailSent(true);
    } catch (e2) {
      console.error("email link request:", e2);
      setErr(authErrorLine(e2));
    } finally {
      setBusy("");
    }
  };

  const handleAgencySubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setErr("");
    setBusy("agency");
    try {
      await registerTeam(authedUser, agency);
      onClose();
      scrollToVault();
    } catch (e2) {
      console.error("agency enrolment:", e2);
      setErr(
        e2?.code
          ? "ENROLMENT FAILED - CONNECTION FAILED"
          : `ENROLMENT FAILED - ${(e2.message || "unknown error").toUpperCase()}`,
      );
    } finally {
      setBusy("");
    }
  };

  const errorLine = err && (
    <div
      role="alert"
      className="font-mono text-xs text-ch-danger border border-ch-danger/40 bg-ch-danger/10 rounded-[3px] px-3 py-2"
    >
      &gt; {err}
    </div>
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 20, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 20, opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md"
          >
            <Tilt max={4} className="tn-panel p-6 sm:p-8">
              <button
                onClick={onClose}
                className="absolute top-3 right-3 p-2 text-ch-mute hover:text-white"
                aria-label="Close"
              >
                <Icon.X />
              </button>

              {step === "agency" ? (
                <>
                  <div className="tn-z1 tn-label tn-label-acc mb-2">
                    // g-link established · new operative
                  </div>
                  <h2 className="tn-z2 tn-heading text-2xl mb-2">
                    Agency name
                  </h2>
                  <p className="tn-z1 text-sm text-ch-mute mb-5 break-words">
                    Signed in as{" "}
                    <span className="text-white">
                      {authedUser?.email || authedUser?.displayName || "operative"}
                    </span>
                    . Pick the callsign shown on the leaderboard and the wire.
                    It can't be changed mid-hunt.
                  </p>
                  <form
                    onSubmit={handleAgencySubmit}
                    className="tn-z2 tn-3d space-y-3"
                  >
                    <input
                      type="text"
                      value={agency}
                      maxLength={40}
                      onChange={(e) => setAgency(e.target.value)}
                      placeholder="e.g. Odyssey explorers"
                      aria-label="Agency name"
                      autoFocus
                      className="tn-input"
                    />
                    {errorLine}
                    <Tilt
                      as="button"
                      max={10}
                      type="submit"
                      disabled={!!busy || agency.trim().length < 2}
                      className="tn-btn tn-btn-primary w-full py-3.5"
                    >
                      {busy ? "Enrolling…" : "Enter the case vault"}
                    </Tilt>
                  </form>
                </>
              ) : (
                <>
                  <div className="tn-z1 tn-label tn-label-acc mb-2">
                    // agency credentials
                  </div>
                  <h2 className="tn-z2 tn-heading text-2xl mb-5">
                    Authenticate
                  </h2>

                  <Tilt
                    as="button"
                    max={10}
                    type="button"
                    onClick={handleGoogleLogin}
                    disabled={!!busy}
                    className="tn-z2 tn-btn tn-btn-glink w-full py-4"
                  >
                    <GoogleGlyph />
                    {busy === "google"
                      ? "Establishing G-Link…"
                      : "Initialize secure G-Link"}
                  </Tilt>
                  <div className="tn-z1 tn-label mt-2 normal-case tracking-normal">
                    sign in with your google account. opens a popup.
                  </div>

                  {errorLine && <div className="tn-z1 mt-4">{errorLine}</div>}

                  <button
                    type="button"
                    onClick={() => setShowEmail((s) => !s)}
                    aria-expanded={showEmail}
                    className="tn-z1 tn-label mt-6 flex items-center gap-2 w-full hover:text-white"
                  >
                    <span className="flex-1 h-px bg-ch-acc/15" />
                    {showEmail ? "hide" : "or use"} email link
                    <span className="flex-1 h-px bg-ch-acc/15" />
                  </button>

                  {showEmail && (
                    <form
                      onSubmit={handleEmailSubmit}
                      className="tn-z1 tn-3d space-y-3 mt-4"
                    >
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        aria-label="Email"
                        autoComplete="email"
                        className="tn-input"
                      />
                      {emailSent && (
                        <div className="font-mono text-xs text-ch-acc">
                          &gt; LINK TRANSMITTED - CHECK YOUR GMAIL INBOX
                        </div>
                      )}
                      <Tilt
                        as="button"
                        max={10}
                        type="submit"
                        disabled={!!busy}
                        className="tn-btn tn-btn-ghost w-full py-3.5"
                      >
                        {busy === "email" ? "Transmitting…" : "Send sign-in link"}
                      </Tilt>
                    </form>
                  )}
                </>
              )}
            </Tilt>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ================== FOOTER ================== */

function Footer() {
  return (
    <footer className="px-3 sm:px-6 lg:px-10 py-10">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-ch-acc/15 pt-5 tn-label">
        <span>
          Baker_Street<span className="text-ch-acc">//</span>Hunt
        </span>
        <span className="flex items-center gap-2">
          <span className="tn-dot" />
          the game is afoot · powered by firebase
        </span>
      </div>
    </footer>
  );
}

/* ================== ROOT APP ================== */

const scrollToMap = () =>
  document
    .getElementById("hunt-map")
    ?.scrollIntoView({ behavior: "smooth", block: "nearest" });

function App() {
  const [user, setUser] = useState(null);
  const [authOpen, setAuthOpen] = useState(() =>
    isSignInWithEmailLink(auth, window.location.href),
  );
  const [mapFocus, setMapFocus] = useState(null); // { id, n } — n forces re-focus
  const [draftPin, setDraftPin] = useState(null); // [lat, lng] for the Wire composer
  const [picking, setPicking] = useState(false);
  const clues = useClues();
  const [teams, teamsLoaded] = useTeams();
  const intel = useIntel();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return () => unsub();
  }, []);

  // The signed-in account's team comes straight off the leaderboard
  // subscription (doc id = uid), so no second listener is needed.
  const team = useMemo(
    () => (user ? teams.find((t) => t.id === user.uid) || null : null),
    [teams, user],
  );
  const solvedCount = team
    ? Math.min(team.cluesSolved || 0, clues.length)
    : 0;

  const cluePins = useMemo(() => {
    if (!team) return [];
    return clues
      .slice(0, solvedCount + 1)
      .map((c, i) => ({
        ...c,
        status: i < solvedCount ? "solved" : "open",
        coords: clueCoords(c),
      }))
      .filter((c) => c.coords);
  }, [clues, team, solvedCount]);

  const intelPins = useMemo(() => intel.filter((p) => p.coords), [intel]);

  // Losing the team (sign-out) abandons any half-composed pin
  useEffect(() => {
    if (!team) {
      setPicking(false);
      setDraftPin(null);
    }
  }, [team]);

  useEffect(() => {
    if (!picking) return;
    const onKey = (e) => e.key === "Escape" && setPicking(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking]);

  const handleTogglePick = () => {
    if (!picking) scrollToMap();
    setPicking(!picking);
  };

  const handlePick = useCallback((coords) => {
    setDraftPin(coords);
    setPicking(false);
  }, []);

  const handleClearPin = useCallback(() => {
    setDraftPin(null);
    setPicking(false);
  }, []);

  const handleSignOut = useCallback(async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const handleViewOnMap = useCallback((id) => {
    setMapFocus((f) => ({ id, n: (f?.n || 0) + 1 }));
    scrollToMap();
  }, []);

  const mapEmptyHint = !user
    ? "sign in to reveal your first target"
    : !team
      ? "enrol your agency to reveal your first target"
      : "no clue locations filed yet";

  return (
    <>
      <CyberBackground />

      <TopNavbar
        user={user}
        team={team}
        onSignIn={() => setAuthOpen(true)}
        onSignOut={handleSignOut}
      />

      <Hero
        clueCount={clues.length}
        solvedCount={solvedCount}
        team={team}
        teamCount={teams.length}
        intelCount={intel.length}
      />
      <LiveStats
        clueCount={clues.length}
        solvedCount={solvedCount}
        team={team}
        teamCount={teams.length}
      />

      <section id="ops" className="px-3 sm:px-6 lg:px-10 pt-12 scroll-mt-24">
        <SectionHeading
          label="field operations"
          lead="Map &"
          accent="The Wire"
          blurb="Green is your open target, blue is a file you've breached. Amber diamonds are intel from the wire — some of it is true."
        />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <InteractiveMap
            cluePins={cluePins}
            intelPins={intelPins}
            draftPin={draftPin}
            picking={picking}
            onPick={handlePick}
            emptyHint={mapEmptyHint}
            focus={mapFocus}
          />
          <TheWire
            intel={intel}
            user={user}
            team={team}
            draftPin={draftPin}
            picking={picking}
            onTogglePick={handleTogglePick}
            onClearPin={handleClearPin}
            onSignIn={() => setAuthOpen(true)}
            onFocusPin={handleViewOnMap}
          />
        </div>
      </section>

      <VaultSection
        clues={clues}
        user={user}
        team={team}
        teamLoading={!teamsLoaded}
        solvedCount={solvedCount}
        onSignIn={() => setAuthOpen(true)}
        onViewOnMap={handleViewOnMap}
      />

      <LeaderboardSection
        teams={teams}
        clueCount={clues.length}
        currentUid={user?.uid}
      />

      <Footer />

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
