// Group Tehillim in the browser, for people without the app. Same server, rules and sharing logic as
// the app (group-core.js is generated from src/lib/group-core.ts by scripts/build-site.mjs), so app
// and browser readers share one group and never get the same perek.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import { doc, getFirestore, runTransaction } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore-lite.js';

import { finish, release, stats, swap, take } from './group-core.js';

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
const OFFLINE = ['אין חיבור. בדקו את האינטרנט ונסו שוב.', 'No connection. Check your internet and try again.'];
const APK = 'https://github.com/autoupdates21/limud-releases/releases/latest';

const id = new URLSearchParams(location.search).get('r');
const db = getFirestore(initializeApp(CONFIG));
const screen = document.getElementById('screen');

// iPhones draw Hebrew marks with a different text engine from the one the nikud check covers, and
// ta'amim are the marks most likely to collide there, so iPhones show nikud only for now.
const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const ANDROID = /Android/.test(navigator.userAgent);

// Everything shows in both languages: the reader's language first, the other one under it.
const LANG = new URLSearchParams(location.search).get('lang') || navigator.language || 'he';
const HEBREW = /^(he|iw)/i.test(LANG);
document.documentElement.lang = HEBREW ? 'he' : 'en';
document.documentElement.dir = HEBREW ? 'rtl' : 'ltr';
const inOrder = ([he, en]) => (HEBREW ? [he, en] : [en, he]);
/** Both languages on one line. */
const line = (pair) => inOrder(pair).join(' · ');
/** Both languages on two lines, the second one smaller. */
function both(pair) {
  const [main, second] = inOrder(pair);
  return [main, el('span', { className: 'second', textContent: second })];
}

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
  node.append(...children.flat().filter((c) => c !== null && c !== undefined));
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
/** The title in the reader's language; a name is shown as it was written. */
const shownTitle = (g) => (g.purpose === 'refua' && !HEBREW ? `For the healing of ${g.name}` : groupTitle(g));

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
  const text = `תהילים בקבוצה ${groupTitle(group)}: כל אחד מקבל פרק אחר, ויחד משלימים את הספר. להצטרפות: ${link}\n\nGroup Tehillim: everyone gets a different perek, and together you complete the sefer. Join here: ${link}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

const show = (...nodes) => {
  screen.replaceChildren(...nodes.filter(Boolean));
  window.scrollTo(0, 0);
};

function message(pair, again) {
  show(el('p', { className: 'center' }, both(pair)), again ? el('button', { className: 'main', onclick: again }, both(['נסה שוב', 'Try again'])) : null);
}

function heading(group) {
  return el(
    'div',
    {},
    el('h1', { textContent: shownTitle(group), dir: 'auto' }),
    group.note ? el('p', { className: 'muted', textContent: group.note, dir: 'auto' }) : null,
    el('p', { className: 'muted', textContent: line([`ספר ${group.round}`, `Book ${group.round}`]) }),
  );
}

function counts(s) {
  const box = (n, label) => el('div', { className: 'count' }, el('b', { textContent: n }), el('span', {}, both(label)));
  return el('div', { className: 'counts' }, box(s.read, ['נקראו', 'Read']), box(s.reading, ['בקריאה', 'Being read']), box(s.free, ['פנויים', 'Free']));
}

/** A button that shows an error and stays usable if its action fails. */
function action(label, className, work) {
  const button = el('button', { className }, both(label));
  button.onclick = async () => {
    screen.querySelectorAll('button').forEach((b) => (b.disabled = true));
    try {
      await work(button);
    } catch {
      button.classList.remove('finish');
      screen.querySelectorAll('button').forEach((b) => (b.disabled = false));
      screen.querySelector('.error')?.remove();
      (button.closest('.row') || button).before(el('p', { className: 'error', textContent: line(OFFLINE) }));
    }
  };
  return button;
}

/** Everything happens on this one screen. `marked`: this perek was read, so only next or finish are left. */
function showPerek(group, perek, marked = false, bookFinished = false) {
  const verses = chapters[perek - 1].flatMap((verse, i) => [
    el('b', { textContent: `${heNum(i + 1)} ` }),
    `${IOS ? stripTaamim(verse) : verse} `,
  ]);
  const s = stats(group, Date.now());
  const nodes = [
    heading(group),
    counts(s),
    el('h2', { textContent: line([`פרק ${heNum(perek)}`, `Psalm ${perek}`]) }),
    el('p', { className: 'perek', lang: 'he' }, ...verses),
    marked ? el('p', { className: 'thanks' }, both(bookFinished ? ['תודה! ספר תהילים הושלם', 'Thank you! The sefer is complete'] : ['תודה! הפרק נקרא', 'Thank you! The perek is read'])) : null,
    marked ? el('p', { className: 'totals' }, both([`סך הכול: ספרים שהושלמו ${s.booksDone} · פרקים שנקראו ${s.totalRead} · קוראים ${s.readers}`, `In all: books complete ${s.booksDone} · perakim read ${s.totalRead} · readers ${s.readers}`])) : null,
    el(
      'div',
      { className: marked ? 'row two' : 'row' },
      marked
        ? el('button', { className: 'finish', disabled: true }, both(['✓ סיימתי', '✓ I finished']))
        : action(['סיימתי', 'I finished'], '', async (button) => {
            button.classList.add('finish');
            const { group: next } = await change((g, me, now) => ({ group: finish(g, me, perek, now) }));
            // Stay at the same place on the page: the reader only pressed a button.
            const top = window.scrollY;
            showPerek(next, perek, true, next.round > group.round);
            window.scrollTo(0, top);
          }),
      // Straight on to the next perek; this one counts as read if it isn't marked yet.
      action(['פרק נוסף', 'Next perek'], 'main', async () => {
        if (!marked) await change((g, me, now) => ({ group: finish(g, me, perek, now) }));
        await open();
      }),
      marked
        ? null
        : action(['פרק אחר', 'Different perek'], '', async () => {
            const result = await change((g, me, now) => swap(g, me, now));
            showPerek(result.group, result.perek);
            if (result.perek === perek) screen.querySelector('.row').before(el('p', { className: 'error', textContent: line(['אין כרגע פרק פנוי אחר', 'No other perek is free right now']) }));
          }),
    ),
    el(
      'div',
      { className: marked ? 'row one' : 'row two' },
      // A perek not marked as read goes back to the group at once.
      el('button', {
        async onclick() {
          if (!marked) await change((g, me, now) => ({ group: release(g, me, now) })).catch(() => {});
          exit();
        },
      }, both(['סיום', 'Finish'])),
      marked
        ? null
        : action(['אקרא אחר כך', 'Read later'], '', async () => {
            const { group: next } = await change((g, me, now) => ({ group: release(g, me, now) }));
            show(heading(next), counts(stats(next, Date.now())), el('p', { className: 'center' }, both(['הפרק חזר לקבוצה. אפשר לחזור לקישור מתי שנוח.', 'The perek went back to the group. Come back to the link whenever you like.'])), el('button', { className: 'main', onclick: open }, both(['קרא פרק', 'Read a perek'])), el('button', { onclick: exit }, both(['סיום', 'Finish'])));
          }),
    ),
    el('a', { className: 'btn', href: inviteHref(group) }, both(['שלח את הקישור בווטסאפ', 'Send the link on WhatsApp'])),
  ];
  show(...nodes);
}

/** Closes the page where the browser allows it, and otherwise says it can be closed. */
function exit() {
  window.close();
  show(el('p', { className: 'thanks' }, both(['תודה רבה', 'Thank you'])), el('p', { className: 'center' }, both(['אפשר לסגור את הדף.', 'You can close this page.'])), el('button', { onclick: open }, both(['קרא פרק נוסף', 'Read another perek'])));
}

/** Gives this reader a perek: the one they hold, or the next free one. */
async function open() {
  show(el('p', { className: 'center', textContent: line(['טוען…', 'Loading…']) }));
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
    else show(heading(group), counts(stats(group, Date.now())), el('p', { className: 'center' }, both(['כל הפרקים נמצאים כרגע בקריאה. נסו שוב בעוד כמה דקות.', 'All the perakim are being read right now. Try again in a few minutes.'])), el('button', { className: 'main', onclick: open }, both(['נסה שוב', 'Try again'])));
  } catch (e) {
    if (e.message === 'not-found') message(['הקבוצה לא נמצאה. בדקו את הקישור.', "This group wasn't found. Check the link."]);
    else message(OFFLINE, open);
  }
}

function footer() {
  const box = document.getElementById('footer');
  if (ANDROID) {
    box.append(`${line(['רוצים את האפליקציה?', 'Want the app?'])} `, el('a', { href: APK, textContent: line(['הורדה ללימוד', 'Download Limud']) }));
    if (id) box.append(' · ', el('a', { href: `limud://g?r=${encodeURIComponent(id)}`, textContent: line(['פתיחה באפליקציה', 'Open in the app']) }));
    box.hidden = false;
  }
}

document.getElementById('brand').textContent = line(['תהילים בקבוצה', 'Group Tehillim']);
footer();
if (id) open();
else message(['כדי להצטרף צריך קישור לקבוצה. בקשו אותו ממי ששלח לכם.', 'To join you need a link to a group. Ask whoever sent you here.']);
