// Group Tehillim in the browser, for people without the app. Same server, rules and sharing logic as
// the app (group-core.js is generated from src/lib/group-core.ts by scripts/build-site.mjs), so app
// and browser readers share one group and never get the same perek.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import { doc, getFirestore, runTransaction } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore-lite.js';

import { PERAKIM, finish, release, stats, swap, take } from './group-core.js';

// Identifies the project and is public by design; firestore.rules is what protects the data.
const CONFIG = {
  apiKey: 'AIzaSyAPLeOMJz1IELeWneBHot5V0_QxPU82Brk',
  authDomain: 'limud-7df1a.firebaseapp.com',
  projectId: 'limud-7df1a',
  storageBucket: 'limud-7df1a.firebasestorage.app',
  messagingSenderId: '856272399551',
  appId: '1:856272399551:web:3124aba108c3189a25ea0a',
};
const TIMEOUT_MS = 15000;
const OFFLINE = 'אין חיבור. בדקו את האינטרנט ונסו שוב.';
const APK = 'https://github.com/autoupdates21/limud-releases/releases/latest';

const id = new URLSearchParams(location.search).get('r');
const db = getFirestore(initializeApp(CONFIG));
const screen = document.getElementById('screen');

// iPhones draw Hebrew marks with a different text engine from the one the nikud check covers, and
// ta'amim are the marks most likely to collide there, so iPhones show nikud only for now.
const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const ANDROID = /Android/.test(navigator.userAgent);

/** This browser's memory of who it is and which groups it joined; it may be blocked or cleared. */
const store = (() => {
  let memory = {};
  try {
    memory = JSON.parse(localStorage.getItem('limud-groups') || '{}');
  } catch {}
  const save = () => {
    try {
      localStorage.setItem('limud-groups', JSON.stringify(memory));
    } catch {}
  };
  return {
    device() {
      if (!memory.device) {
        const bytes = crypto.getRandomValues(new Uint8Array(15));
        memory.device = Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
        save();
      }
      return memory.device;
    },
    joined: () => (memory.joined || []).includes(id),
    markJoined() {
      memory.joined = [...(memory.joined || []), id];
      save();
    },
  };
})();

/** Builds an element; text always goes in as text, so nothing from the server can run as code. */
function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
}

function timed(work) {
  return Promise.race([work, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS))]);
}

/** Changes the group in a transaction: if two people act at once, one is re-run on the fresh state. */
function change(step) {
  const ref = doc(db, 'groups', id);
  return timed(
    runTransaction(
      db,
      async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists()) throw new Error('not-found');
        const current = snapshot.data();
        const result = step(current, store.device(), Date.now());
        if (result.group !== current) tx.set(ref, result.group);
        return result;
      },
      { maxAttempts: 10 },
    ),
  );
}

const groupTitle = (g) => (g.purpose === 'refua' ? `לרפואת ${g.name}` : g.name);

/** A Hebrew numeral, as in the app. */
function heNum(n) {
  if (n === 15) return 'טו';
  if (n === 16) return 'טז';
  const parts = [[100, 'ק'], [90, 'צ'], [80, 'פ'], [70, 'ע'], [60, 'ס'], [50, 'נ'], [40, 'מ'], [30, 'ל'], [20, 'כ'], [10, 'י'], [9, 'ט'], [8, 'ח'], [7, 'ז'], [6, 'ו'], [5, 'ה'], [4, 'ד'], [3, 'ג'], [2, 'ב'], [1, 'א']];
  let out = '';
  for (const [value, letter] of parts) {
    while (n >= value) {
      if (n === 15 || n === 16) return out + heNum(n);
      out += letter;
      n -= value;
    }
  }
  return out;
}

/** Same as stripTaamim in src/lib/torah.ts. */
const stripTaamim = (s) => s.replace(/[֑-ֽ֯]/g, '').replace(/\s*׀\s*/g, ' ');

let chapters = null;
const loadText = async () => (chapters ??= await (await fetch('tehillim.json')).json());

function inviteHref(group) {
  const link = `${location.origin}${location.pathname}?r=${encodeURIComponent(id)}`;
  const text = `תהילים בקבוצה ${groupTitle(group)}: כל אחד מקבל פרק אחר, ויחד משלימים את הספר. להצטרפות: ${link}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

const show = (...nodes) => {
  screen.replaceChildren(...nodes);
  window.scrollTo(0, 0);
};

function message(text, again) {
  show(el('p', { className: 'center', textContent: text }), again ? el('button', { className: 'main', textContent: 'נסה שוב', onclick: again }) : null);
}

function heading(group) {
  return el(
    'div',
    {},
    el('h1', { textContent: groupTitle(group) }),
    group.note ? el('p', { className: 'muted', textContent: group.note }) : null,
    el('p', { className: 'muted', textContent: `ספר ${group.round}` }),
  );
}

function counts(s) {
  const box = (n, label) => el('div', { className: 'count' }, el('b', { textContent: n }), el('span', { textContent: label }));
  return el('div', { className: 'counts' }, box(s.read, 'נקראו'), box(s.reading, 'בקריאה'), box(s.free, 'פנויים'));
}

/** A button that shows an error and stays usable if its action fails. */
function action(label, className, work) {
  const button = el('button', { className, textContent: label });
  button.onclick = async () => {
    screen.querySelectorAll('button').forEach((b) => (b.disabled = true));
    try {
      await work();
    } catch {
      screen.querySelectorAll('button').forEach((b) => (b.disabled = false));
      screen.querySelector('.error')?.remove();
      button.before(el('p', { className: 'error', textContent: OFFLINE }));
    }
  };
  return button;
}

function showPerek(group, perek) {
  const verses = chapters[perek - 1].flatMap((verse, i) => [
    el('b', { textContent: `${heNum(i + 1)} ` }),
    `${IOS ? stripTaamim(verse) : verse} `,
  ]);
  show(
    heading(group),
    counts(stats(group, Date.now())),
    el('h2', { textContent: `פרק ${heNum(perek)}` }),
    el('p', { className: 'perek', lang: 'he' }, ...verses),
    action('סיימתי לקרוא', 'finish', async () => {
      const { group: next } = await change((g, me, now) => ({ group: finish(g, me, perek, now) }));
      showDone(next, next.round > group.round);
    }),
    action('תן לי פרק אחר', '', async () => {
      const result = await change((g, me, now) => swap(g, me, now));
      showPerek(result.group, result.perek);
      if (result.perek === perek) screen.querySelector('.finish').before(el('p', { className: 'error', textContent: 'אין כרגע פרק פנוי אחר' }));
    }),
    action('אין לי זמן, אקרא אחר כך', '', async () => {
      const { group: next } = await change((g, me, now) => ({ group: release(g, me, now) }));
      show(heading(next), counts(stats(next, Date.now())), el('p', { className: 'center', textContent: 'הפרק חזר לקבוצה. אפשר לחזור לקישור מתי שנוח.' }), el('button', { className: 'main', textContent: 'קרא פרק', onclick: open }));
    }),
    el('a', { className: 'btn', href: inviteHref(group), textContent: 'שלח את הקישור בווטסאפ' }),
  );
}

function showDone(group, bookFinished) {
  const s = stats(group, Date.now());
  const bar = el('div', { className: 'bar' });
  bar.style.width = `${(s.read / PERAKIM) * 100}%`;
  show(
    el('p', { className: 'thanks', textContent: bookFinished ? 'תודה! ספר תהילים הושלם' : 'תודה! הפרק נקרא' }),
    heading(group),
    el('div', { className: 'track' }, bar),
    counts(s),
    el('p', { className: 'muted', textContent: `סך הכול: ספרים שהושלמו ${s.booksDone} · פרקים שנקראו ${s.totalRead} · קוראים ${s.readers}` }),
    el('div', { style: 'height:12px' }),
    el('button', { className: 'main', textContent: 'קרא פרק נוסף', onclick: open }),
    el('a', { className: 'btn', href: inviteHref(group), textContent: 'שלח את הקישור בווטסאפ' }),
  );
}

/** Gives this reader a perek: the one they hold, or the next free one. */
async function open() {
  show(el('p', { className: 'center', textContent: 'טוען…' }));
  try {
    await loadText();
    const joined = store.joined();
    const { group, perek } = await change((g, me, now) => {
      const t = take(g, me, now);
      if (!t.perek || joined) return t;
      return { group: { ...t.group, readers: g.readers + 1 }, perek: t.perek };
    });
    if (perek && !joined) store.markJoined();
    if (perek) showPerek(group, perek);
    else show(heading(group), counts(stats(group, Date.now())), el('p', { className: 'center', textContent: 'כל הפרקים נמצאים כרגע בקריאה. נסו שוב בעוד כמה דקות.' }), el('button', { className: 'main', textContent: 'נסה שוב', onclick: open }));
  } catch (e) {
    if (e.message === 'not-found') message('הקבוצה לא נמצאה. בדקו את הקישור.');
    else message(OFFLINE, open);
  }
}

function footer() {
  const box = document.getElementById('footer');
  if (ANDROID) {
    box.append('רוצים את האפליקציה? ', el('a', { href: APK, textContent: 'הורדה ללימוד' }));
    if (id) box.append(' · ', el('a', { href: `limud://g?r=${encodeURIComponent(id)}`, textContent: 'פתיחה באפליקציה' }));
    box.hidden = false;
  }
}

footer();
if (id) open();
else message('כדי להצטרף צריך קישור לקבוצה. בקשו אותו ממי ששלח לכם.');
