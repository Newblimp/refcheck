import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import { T } from '../i18n.js';
import { extractData, classify } from '../logic/extract.js';
import { getAllErrors, errorGroup } from '../logic/errorSpans.js';
import { ERROR_KINDS, KIND_BY_ID, kindItems } from '../logic/errorKinds.js';
import { buildHtml, findAtPos } from '../logic/buildHtml.js';
import { computeCrossRef } from '../logic/crossref.js';
import { reconcileRefList } from '../logic/reconcile.js';
import { listTermIndex, appliedListTerms } from '../logic/listTerms.js';
import { claimStats } from '../logic/claimStats.js';
import { compareSigns, disKey } from '../logic/constants.js';
import { backdropScroll } from '../logic/scrollSync.js';
import { stem } from '../logic/stem.js';
import { useDebounced } from '../hooks/useDebounced.js';
import { usePersistentState, jsonCodec, setCodec, oneOf } from '../hooks/usePersistentState.js';
import { useTheme } from '../hooks/useTheme.js';
import { useFileDrop } from '../hooks/useFileDrop.js';
import { useBee } from '../hooks/useBee.js';
import { useHotkeys } from '../hooks/useHotkeys.js';
import { fileKind } from '../logic/fileKind.js';

// The .docx pipeline (and fflate with it) is loaded on demand — most sessions
// paste text and never touch it, so it does not belong in the initial bundle.
// The service worker precaches every emitted chunk, so this still resolves
// offline for a user who imports for the first time with no connection.
const loadDocIO = () => import('../logic/importDoc.js');
import { CtxMenu } from './CtxMenu.jsx';
import { Sidebar } from './Sidebar.jsx';
import { RefPane } from './RefPane.jsx';
import { HelpDialog } from './HelpDialog.jsx';
import { DropOverlay } from './DropOverlay.jsx';
import { ImportBanner } from './ImportBanner.jsx';
import { Bee } from './Bee.jsx';

// The shape extractData returns, with nothing in it. The per-category arrays are
// derived from ERROR_KINDS so a new category cannot be forgotten here — an
// omission would surface as a crash on an empty buffer, which is the one moment
// nobody tests by hand.
const EMPTY_RESULT = {
  signData: {},
  termData: {},
  noTermSigns: new Set(),
  claimGraph: null,
  ...Object.fromEntries(ERROR_KINDS.map((k) => [k.field, []])),
};

// useLayoutEffect on the client (runs before paint, so no highlight flash); plain
// useEffect on the server so the render smoke test logs no SSR warning.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// How long the text buffers wait before being written to localStorage. Long
// enough that a burst of typing produces one write, short enough that a refresh
// straight after typing keeps the text.
const SAVE_MS = 400;

// ── APP ─────────────────────────────────────────────────────────────────────
export function App() {
  // Persisted preferences and buffers (all survive a refresh; see CLAUDE.md for keys)
  const [lang, setLang] = usePersistentState('rsc_lang', 'en', oneOf(['en', 'de'], 'en'));
  const [mode, setMode] = usePersistentState(
    'rsc_mode',
    'description',
    oneOf(['description', 'claims'], 'description')
  );
  // The two text buffers are the only large values stored, so they are the only
  // ones that need a debounce (an undebounced write serialised the whole buffer
  // on every keystroke) and the only ones that can realistically hit the quota.
  const [storageFull, setStorageFull] = useState(false);
  const onStorageError = useCallback(() => setStorageFull(true), []);
  const textOpts = useMemo(
    () => ({ debounce: SAVE_MS, onError: onStorageError }),
    [onStorageError]
  );
  const [descText, setDescText] = usePersistentState('rsc_desc', '', undefined, textOpts);
  const [claimsText, setClaimsText] = usePersistentState('rsc_claims', '', undefined, textOpts);
  // The drafter's own reference-sign list, checked against the active buffer.
  // Small enough not to need the debounce the text buffers use.
  const [refListText, setRefListText] = usePersistentState('rsc_reflist', '');
  // Which side panes are open. Persisted because it is a working preference,
  // not transient state — a drafter who folds the reference pane away wants it
  // to stay away.
  const [panes, setPanes] = usePersistentState('rsc_panes', { left: true, right: true }, jsonCodec);
  // Narrow screens show exactly one pane; ignored by the desktop layout.
  const [mobilePane, setMobilePane] = useState('editor');
  const [helpOpen, setHelpOpen] = useState(false);
  const [mwo, setMwo] = usePersistentState('rsc_mwo', {}, jsonCodec);
  const [dis, setDis] = usePersistentState('rsc_dis', new Set(), setCodec);
  const [theme, setTheme] = useTheme();
  // Transient UI state
  const text = mode === 'description' ? descText : claimsText;
  const [hoverSign, setHoverSign] = useState(null);
  // Currently highlighted error card: {type: 'sign'|'art'|'bare'|'num'|'dep', key}
  // (key = sign string for signs, char position for everything else).
  const [focus, setFocus] = useState(null);
  const [search, setSearch] = useState('');
  const [navIdx, setNavIdx] = useState(0);
  const [ctx, setCtx] = useState(null);
  // .docx import/export. `imported` holds the parsed source document and the
  // paragraph provenance that round-trip export needs. It is deliberately NOT
  // persisted — a 200 KB document would blow the localStorage quota alongside
  // the text buffers — so a refresh keeps the text but drops round-trip export.
  const [imported, setImported] = useState(null);
  const [report, setReport] = useState(null);
  const undoRef = useRef(null);
  const fileRef = useRef(null);
  const bdRef = useRef(null),
    taRef = useRef(null);
  // Occurrence cursor for click-to-cycle on the sidebar error cards: which
  // occurrence of the currently-focused error the next click should advance from.
  const focusOcc = useRef({ id: null, idx: 0 });
  // Caret position to restore once an edit the app made itself (inserting a
  // reference sign) has been committed to the textarea.
  const pendingCaret = useRef(null);
  const t = T[lang];

  // Debounce the expensive extraction on large documents; the textarea value
  // stays immediate so typing is never blocked.
  const debDesc = useDebounced(descText, descText.length > 5000 ? 200 : 0);
  const debClaims = useDebounced(claimsText, claimsText.length > 5000 ? 200 : 0);
  const debText = mode === 'description' ? debDesc : debClaims;

  // Multi-word terms read out of the drafter's own reference list, applied to
  // BOTH buffers — the list describes the invention, not one section of it.
  // Debounced on the same rule as the buffers: editing the list box re-runs
  // extraction, so on a large document it must not do so per keystroke.
  const bigDoc = descText.length + claimsText.length > 5000;
  const debRefList = useDebounced(refListText, bigDoc ? 200 : 0);
  const rawListIdx = useMemo(() => listTermIndex(debRefList, lang), [debRefList, lang]);
  // Hold the identity stable while the parsed content is unchanged: most edits
  // in that box (a typo in a term, a re-ordered line, a sign whose entry has no
  // second word) change nothing the extraction can see, and a fresh object
  // would still invalidate both extraction memos.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const listIdx = useMemo(() => rawListIdx, [rawListIdx.sig]);

  const descResult = useMemo(
    () => (debDesc ? extractData(debDesc, lang, mwo, true, false, listIdx) : null),
    [debDesc, lang, mwo, listIdx]
  );
  const claimsResult = useMemo(
    () => (debClaims ? extractData(debClaims, lang, mwo, true, true, listIdx) : null),
    [debClaims, lang, mwo, listIdx]
  );
  const res = (mode === 'description' ? descResult : claimsResult) ?? EMPTY_RESULT;
  const { signData, termData } = res;

  const orphaned = useMemo(
    () => computeCrossRef(descResult, claimsResult),
    [descResult, claimsResult]
  );

  const allErrors = useMemo(() => getAllErrors(res, mode, dis), [res, mode, dis]);

  // The reference list describes the invention as a whole, so it is checked
  // against the description when there is one and the claims otherwise.
  const refListTarget = descResult || claimsResult;
  const reconciled = useMemo(
    () => reconcileRefList(refListText, refListTarget, lang),
    [refListText, refListTarget, lang]
  );
  // Which of the list's multi-word terms the text actually uses as such — the
  // panel reports what the automatic extension did, so a drafter is never left
  // guessing why a term suddenly reads wider (or, after a manual reduce, why it
  // does not).
  const listMultiWord = useMemo(
    () => appliedListTerms(listIdx, refListTarget?.termData),
    [listIdx, refListTarget]
  );
  const claimSetStats = useMemo(() => claimStats(claimsResult?.claimGraph), [claimsResult]);

  useEffect(() => setNavIdx(0), [allErrors.length]);

  // Put the caret back after an edit the app made on the user's behalf. The
  // textarea is controlled, so the new value only exists after this commit —
  // setting the selection inside the click handler would move it in the old one.
  useEffect(() => {
    const at = pendingCaret.current;
    if (at == null) return;
    pendingCaret.current = null;
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(at, at);
  }, [text]);

  // Keep <html lang> in step with the checking language. It was hardcoded to
  // "en" in index.html, so screen readers announced German patent text with
  // English pronunciation rules.
  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  }, [lang]);

  const focusSign = focus?.type === 'sign' ? focus.key : null;
  const html = useMemo(
    () => buildHtml(debText, res, mode, dis, focusSign),
    [debText, res, mode, dis, focusSign]
  );

  // Mirror the textarea's scroll position onto the backdrop. At the ends of
  // the document an elastic-overscroll browser slides the textarea's content
  // past its own scroll range and springs it back; the backdrop clamps that
  // position, so the text bounced while the highlights sat pinned to the edge.
  // styles.css turns the rubber-band off, and the overshoot the geometry still
  // reports (iOS Safari puts it in scrollTop) is applied as a translation,
  // which the backdrop's scrollTop cannot express. See logic/scrollSync.js.
  const syncScroll = useCallback(() => {
    const ta = taRef.current,
      bd = bdRef.current;
    if (!ta || !bd) return;
    const { top, shift } = backdropScroll(ta.scrollTop, ta.scrollHeight, ta.clientHeight);
    bd.scrollTop = top;
    const tf = shift ? `translateY(${-shift}px)` : '';
    if (bd.style.transform !== tf) bd.style.transform = tf;
  }, []);

  // Re-mirror the scroll position whenever the backdrop's highlight content
  // (re-)renders. On a large paste the textarea scrolls to the caret at once,
  // but the backdrop html is debounced (≥5000 chars) — so the single scroll
  // event that fired synced against stale, short content and clamped, leaving
  // the highlights shifted until the next manual scroll. Re-syncing after the
  // content commits realigns the two layers before the browser paints.
  useIsoLayoutEffect(() => {
    syncScroll();
  }, [html, syncScroll]);

  // Editor hover → sidebar-card highlight. elementFromPoint forces a synchronous
  // hit-test, so throttle to one lookup per animation frame instead of running
  // it on every mousemove.
  const hoverPending = useRef(false);
  const handleEditorHover = useCallback((e) => {
    if (hoverPending.current) return;
    hoverPending.current = true;
    const x = e.clientX,
      y = e.clientY;
    const raf =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb) => setTimeout(cb, 16);
    raf(() => {
      hoverPending.current = false;
      const ta = taRef.current;
      if (!ta) return;
      ta.style.pointerEvents = 'none';
      const el = document.elementFromPoint(x, y);
      ta.style.pointerEvents = '';
      const sign = el?.dataset?.sign || el?.closest?.('[data-sign]')?.dataset?.sign || null;
      setHoverSign((prev) => (prev === sign ? prev : sign));
    });
  }, []);

  // Hovering a sign highlights all of its marks in the editor. Doing that by
  // walking every mark in the document on each hover transition meant a
  // querySelectorAll plus a classList write per mark — thousands of them on a
  // real patent, for a pointer movement. Index the marks by sign once per
  // backdrop render, then touch only the outgoing and incoming sign's marks.
  const markIndex = useRef(new Map());
  const hoveredMarks = useRef(null);
  useIsoLayoutEffect(() => {
    const bd = bdRef.current;
    const index = new Map();
    if (bd) {
      for (const m of bd.querySelectorAll('mark[data-sign]')) {
        const s = m.dataset.sign;
        const list = index.get(s);
        if (list) list.push(m);
        else index.set(s, [m]);
      }
    }
    markIndex.current = index;
    // The nodes just got replaced, so nothing carries the hover class any more.
    hoveredMarks.current = null;
  }, [html]);

  useEffect(() => {
    for (const m of hoveredMarks.current || []) m.classList.remove('h-hover');
    const next = hoverSign === null ? null : markIndex.current.get(hoverSign) || null;
    for (const m of next || []) m.classList.add('h-hover');
    hoveredMarks.current = next;
  }, [hoverSign, html]);

  // ── Search-filtered card lists (also drive the status-bar chips) ──
  const { errSigns, okSigns } = useMemo(() => {
    const q = search.toLowerCase(),
      err = [],
      ok = [];
    for (const [sign, sData] of Object.entries(signData)) {
      if (q && !sign.toLowerCase().includes(q)) {
        const termMatch = Object.keys(sData.terms).some((ts) =>
          [...(termData[ts]?.rawTerms || [])].some((r) => r.includes(q))
        );
        if (!termMatch) continue;
      }
      (classify(sign, sData, termData, mode) === 'warn' ? err : ok).push([sign, sData]);
    }
    const byN = ([a], [b]) => compareSigns(a, b);
    return { errSigns: err.sort(byN), okSigns: ok.sort(byN) };
  }, [signData, termData, mode, search]);

  // Search + dismissal filtering for the four non-sign categories, in one pass
  // over ERROR_KINDS. This was four hand-written memo PAIRS, each re-deriving
  // the lowercased query and each naming its own disKey.
  //
  // It stays memoized for the same reason the pairs were: the lists feed Sidebar
  // and every card under it, so recomputing them per render would hand down
  // fresh array identities on every hover, every search keystroke and every bee
  // frame — which is what made memoizing the card components pointless before.
  // Cheap on their own; the identity is the point.
  const errorLists = useMemo(() => {
    const q = search.toLowerCase();
    const out = {};
    for (const kind of ERROR_KINDS)
      out[kind.id] = kindItems(res, kind).filter(
        (e) => (!q || kind.matches(e, q, termData)) && !dis.has(kind.disKey(e))
      );
    return out;
  }, [res, termData, search, dis]);

  const errSignsActive = useMemo(
    () => errSigns.filter(([s]) => !dis.has(disKey.sign(s))),
    [errSigns, dis]
  );
  const errSignsDismissed = useMemo(
    () => errSigns.filter(([s]) => dis.has(disKey.sign(s))),
    [errSigns, dis]
  );
  const disCt = dis.size;
  const totalSigns = Object.keys(signData).length;
  const anyActive = errSignsActive.length || ERROR_KINDS.some((k) => errorLists[k.id].length > 0);

  // Live mirrors of state the card callbacks below read. Keeping them in refs is
  // what lets those callbacks be genuinely stable: every one of them is passed
  // down to Sidebar and the cards, so a fresh identity per render would defeat
  // the React.memo on each of them and re-render the whole sidebar on every
  // keystroke, hover and bee frame.
  const textRef = useRef(text);
  textRef.current = text;
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const signDataRef = useRef(signData);
  signDataRef.current = signData;

  const scrollTo = useCallback(
    (start, end) => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(start, end);
      // Measure the real line height instead of hardcoding it, so CSS changes and
      // browser zoom cannot desync click-to-navigate scrolling.
      let lh = parseFloat(getComputedStyle(ta).lineHeight);
      if (!Number.isFinite(lh)) lh = (parseFloat(getComputedStyle(ta).fontSize) || 13.5) * 1.75;
      const lines = textRef.current.slice(0, start).split('\n').length;
      ta.scrollTop = Math.max(0, (lines - 5) * lh);
      syncScroll();
    },
    [syncScroll]
  );

  // Click an error card: the first click focuses it and jumps to its first
  // occurrence; each further click on the same card advances to the next
  // occurrence (in document order); the click after the last one clears the
  // focus. `occs` is the sorted [start, end] spans for the error, so a
  // single-occurrence card (article/bare/numbering/dependency) simply toggles,
  // exactly as before, while a multi-occurrence sign cycles through its marks.
  const focusCycle = useCallback(
    (type, key, occs) => {
      if (!occs.length) return;
      const id = type + ':' + key;
      const cur = focusOcc.current;
      const focus = focusRef.current;
      // Only continue an existing cycle if this same error is still focused.
      const advancing = !!focus && focus.type === type && focus.key === key && cur.id === id;
      const idx = advancing ? cur.idx + 1 : 0;
      if (advancing && idx >= occs.length) {
        // stepped past the last → unfocus
        focusOcc.current = { id: null, idx: 0 };
        setFocus(null);
        return;
      }
      focusOcc.current = { id, idx };
      setFocus({ type, key });
      scrollTo(occs[idx][0], occs[idx][1]);
    },
    [scrollTo]
  );
  const onFocusSign = useCallback(
    (sign) => {
      const occs = (signDataRef.current[sign]?.positions || [])
        .map((p) => [p.signStart, p.signEnd])
        .sort((a, b) => a[0] - b[0]);
      focusCycle('sign', sign, occs);
    },
    [focusCycle]
  );
  // One handler for all four non-sign categories. Each has a single occurrence,
  // so the card simply toggles; the focus key is the span start, which is the
  // convention every card's `focused` comparison uses. (Signs keep their own
  // handler: their key is the sign string, and they cycle through occurrences.)
  const onFocusError = useCallback(
    (kindId, item) => {
      const kind = KIND_BY_ID[kindId];
      const start = kind.start(item);
      focusCycle(kindId, start, [[start, kind.end(item)]]);
    },
    [focusCycle]
  );

  function goToError(idx) {
    const e = allErrors[idx];
    if (!e) return;
    setNavIdx(idx);
    scrollTo(e.start, e.end);
    setFocus({ type: e.type, key: e.type === 'sign' ? e.sign : e.start });
    focusOcc.current = { id: null, idx: 0 }; // arrows drive their own cursor; restart card-cycling
  }

  function navigate(dir) {
    if (!allErrors.length) return;
    goToError((navIdx + dir + allErrors.length) % allErrors.length);
  }

  // Which error a jump measures from. The arrows own navIdx, but a sidebar card
  // click focuses an error without moving it — so when the focus points at a
  // different error than navIdx does, the focus is the more recent intent.
  function anchorIdx() {
    const f = focusRef.current;
    if (!f) return navIdx;
    const matches = (e) =>
      e.type === f.type && (e.type === 'sign' ? e.sign === f.key : e.start === f.key);
    if (matches(allErrors[navIdx] || {})) return navIdx;
    const i = allErrors.findIndex(matches);
    return i >= 0 ? i : navIdx;
  }

  // Ctrl+Shift+↓/↑: the next error about the SAME term, skipping everything
  // else — stepping through every faulty "banana" without wading through the
  // "kiwi" errors between them. Errors with no term (claim numbering,
  // dependencies) step within their own category; see errorGroup.
  function navigateTerm(dir) {
    const n = allErrors.length;
    if (!n) return;
    const from = anchorIdx();
    const group = errorGroup(allErrors[from]);
    // Walk outwards, wrapping. `step === n` lands back on `from`, so a term with
    // a single error simply stays put instead of jumping to an unrelated one.
    for (let step = 1; step <= n; step++) {
      const i = (((from + dir * step) % n) + n) % n;
      if (errorGroup(allErrors[i]) === group) {
        goToError(i);
        return;
      }
    }
  }

  // Keyboard shortcuts. Every binding takes Ctrl/Cmd, because the editor holds
  // focus almost always and useHotkeys suppresses unmodified keys while typing
  // — a shortcut that dies mid-sentence is worse than none.
  //
  // The choice of keys is a German-layout decision. "[" and "]" need AltGr
  // there and "/" needs Shift, so the old bindings were awkward to reach on the
  // very keyboards this tool is written for. Arrows, F and ? are unshifted or
  // standard on both layouts. Up/Down rather than Left/Right: Ctrl+Left/Right
  // is word-by-word cursor movement inside a textarea, which a drafter uses
  // constantly and which we must not take away.
  //
  // "?" arrives as Shift+ß on a German layout and Shift+/ on a US one; both
  // report e.key === '?', so one binding covers both — with the shift-less
  // spelling accepted too, since some layouts get there without it.
  const searchRef = useRef(null);
  const toggleMode = useCallback(
    () => setMode((m) => (m === 'description' ? 'claims' : 'description')),
    [setMode]
  );
  const openHelp = useCallback(() => setHelpOpen(true), []);
  useHotkeys({
    'mod+ArrowDown': () => navigate(1),
    'mod+ArrowUp': () => navigate(-1),
    'mod+shift+ArrowDown': () => navigateTerm(1),
    'mod+shift+ArrowUp': () => navigateTerm(-1),
    'mod+f': () => searchRef.current?.focus(),
    'mod+m': toggleMode,
    'mod+b': () => setPanes((p) => ({ ...p, left: !p.left })),
    'mod+shift+b': () => setPanes((p) => ({ ...p, right: !p.right })),
    'mod+o': () => fileRef.current?.click(),
    'mod+s': doExport,
    'mod+shift+?': openHelp,
    'mod+?': openHelp,
    // Kept from before: harmless on a US layout, and muscle memory is cheap to
    // honour. The help screen documents the arrows.
    'mod+[': () => navigate(-1),
    'mod+]': () => navigate(1),
    '/': () => searchRef.current?.focus(),
    Escape: () => setCtx(null),
  });

  const toggleDis = useCallback(
    (key) => {
      setDis((d) => {
        const n = new Set(d);
        n.has(key) ? n.delete(key) : n.add(key);
        return n;
      });
    },
    [setDis]
  );
  function disAll() {
    const k = new Set();
    Object.keys(signData).forEach((s) => k.add(disKey.sign(s)));
    // Every category, including ones added after this was written.
    for (const kind of ERROR_KINDS) for (const e of kindItems(res, kind)) k.add(kind.disKey(e));
    setDis(k);
  }
  const restoreAll = useCallback(() => setDis(new Set()), [setDis]);

  // Menu title for whatever the right-click landed on.
  const ctxLabel = (found) => {
    if (found.type === 'sign') return `Sign ${found.sign}`;
    if (found.type === 'bare') return t.ctxTermLbl(found.bt.term);
    return `Article: ${found.ae?.article}`;
  };

  function handleCtxMenu(e) {
    e.preventDefault();
    const pos = taRef.current?.selectionStart ?? 0;
    // Named directly rather than through ERROR_KINDS: the menu is genuinely
    // per-category (a sign offers extend/reduce + dismiss, a bare term also
    // offers writing the sign in, an article offers only dismiss), so there is
    // no uniform behaviour here for a registry to drive.
    const found = findAtPos(pos, signData, res.artErrors, res.bareTerms);
    if (!found) return;
    const items = [];
    // Extending or reducing a term is a property of the term, not of the sign
    // next to it — so a bare occurrence offers it just as a sign-attached one
    // does, keyed on the same base stem.
    // The current width is read off the term as recorded, not off mwo: the
    // reference list and the ordinal detector widen terms too, and a menu that
    // offered "Extend term (1 word)" on a term already showing two words would
    // both mislabel it and, on the next click, widen it by nothing.
    const termItems = (rawTerm) => {
      const words = rawTerm.split(' ');
      const bs = stem(words[words.length - 1], lang);
      const cur = words.length;
      items.push({ label: t.extendTerm(cur), a: 'extend', d: { bs, cur } });
      if (cur > 1) items.push({ label: t.reduceTerm, a: 'reduce', d: { bs, cur } });
    };
    if (found.type === 'sign') {
      const { sign, pos: p } = found;
      termItems(p.term);
      items.push({ sep: true });
      const isDis = dis.has(disKey.sign(sign));
      items.push({
        label: isDis ? `↩ Restore "${sign}"` : t.disSign(sign),
        a: 'toggle-dis',
        d: { key: disKey.sign(sign) },
      });
    } else if (found.type === 'bare') {
      const { bt } = found;
      termItems(bt.term);
      // Writing the sign in is only offered when the term has exactly one — with
      // two or more, choosing between them is the drafter's call, not ours.
      if (bt.signs.length === 1) {
        items.push({ sep: true });
        items.push({
          label: t.insertSign(bt.signs[0]),
          a: 'insert-sign',
          d: { bt, sign: bt.signs[0] },
        });
      }
      items.push({ sep: true });
      const key = disKey.bare(bt.termStem);
      items.push({
        label: dis.has(key) ? `↩ ${t.restoreOne}` : t.disBare(bt.term),
        a: 'toggle-dis',
        d: { key },
      });
    } else {
      const { ae } = found;
      const isDis = dis.has(disKey.art(ae.termStem));
      items.push({
        label: isDis ? `↩ Restore article` : t.disArt(ae.termStem),
        a: 'toggle-dis',
        d: { key: disKey.art(ae.termStem) },
      });
    }
    items.push({ sep: true });
    items.push({ label: t.disAll, a: 'dis-all', v: 'warn' });
    if (disCt) items.push({ label: `↩ ${t.restoreAll} (${disCt})`, a: 'restore-all' });
    setCtx({ x: e.clientX, y: e.clientY, items, label: ctxLabel(found) });
  }

  /**
   * Write a bare term's reference sign into the text, right after the term.
   * Claims mode brackets it, because a bare sign there is an error of its own.
   */
  function insertSign(bt, sign) {
    const cur = textRef.current;
    // The spans come from the (debounced) extraction, so the buffer may have
    // moved on. Check the term is still where it was said to be rather than
    // splicing a sign into the middle of some other word.
    const at = cur.slice(bt.termStart, bt.termEnd).toLowerCase().replace(/\s+/g, ' ');
    if (at !== bt.term) return;
    const ins = mode === 'claims' ? ` (${sign})` : ` ${sign}`;
    const next = cur.slice(0, bt.termEnd) + ins + cur.slice(bt.termEnd);
    (mode === 'description' ? setDescText : setClaimsText)(next);
    setFocus(null);
    // Leave the caret after what was just written, so the drafter carries on
    // where they were reading. Applied once the new value has been committed.
    pendingCaret.current = bt.termEnd + ins.length;
  }

  function handleCtxAction(a, d) {
    // Both write an ABSOLUTE width (extra words beyond the base noun) measured
    // from what is on screen, so the override lands where the drafter expects
    // whatever widened the term in the first place. Reduce stores an explicit 0
    // rather than deleting the key — deleting it would just hand the term back
    // to the reference list, and the reduction would appear not to work.
    if (a === 'extend') setMwo((m) => ({ ...m, [d.bs]: d.cur }));
    else if (a === 'reduce') setMwo((m) => ({ ...m, [d.bs]: Math.max(0, d.cur - 2) }));
    else if (a === 'insert-sign') insertSign(d.bt, d.sign);
    else if (a === 'toggle-dis') toggleDis(d.key);
    else if (a === 'dis-all') disAll();
    else if (a === 'restore-all') restoreAll();
  }

  function doReset() {
    if (typeof window !== 'undefined' && !window.confirm(t.resetConfirm)) return;
    setDis(new Set());
    setMwo({});
    setDescText('');
    setClaimsText('');
    setRefListText('');
    setImported(null);
    setReport(null);
    undoRef.current = null;
  }

  // ── .docx import ──────────────────────────────────────────────────────────
  const handleFile = useCallback(
    async (file) => {
      const kind = fileKind(file?.name);
      if (kind !== 'ok') {
        setReport({
          kind: 'error',
          messageKey: kind === 'legacyDoc' ? 'impErrLegacy' : 'impErrUnsupported',
        });
        return;
      }
      let result;
      try {
        const { importPatentDoc } = await loadDocIO();
        result = importPatentDoc(await file.arrayBuffer());
      } catch {
        setReport({ kind: 'error', messageKey: 'impErrRead' });
        return;
      }
      // Filling the buffers discards whatever is in them — same stance doReset takes.
      if (
        (descText || claimsText) &&
        typeof window !== 'undefined' &&
        !window.confirm(t.impConfirm)
      )
        return;

      undoRef.current = { desc: descText, claims: claimsText, lang, mode, refList: refListText };
      const { split, lang: detectedLang } = result;
      result.fileName = file.name;
      setDescText(split.description);
      setClaimsText(split.claims);
      // The Bezugszeichenliste is excluded from both buffers, but it is exactly
      // what the reference-list check wants, so hand it over instead of dropping it.
      if (split.signList) setRefListText(split.signList);
      setLang(detectedLang);
      setImported(result);
      setFocus(null);

      // Warnings are stored as i18n KEYS, not resolved strings: the import may
      // have just switched the language, and `t` here is still the outgoing one.
      // Resolving in ImportBanner also keeps the banner correct if the user
      // toggles EN/DE afterwards.
      const warnings = [];
      const d = split.detected;
      if (!d.description) warnings.push({ key: 'impNoDesc' });
      if (!d.claims) warnings.push({ key: 'impNoClaims' });
      if (d.synthesizedClaimNumbers)
        warnings.push({ key: 'impRenumbered', arg: d.synthesizedClaimNumbers });
      if (d.unusualNumbering) warnings.push({ key: 'impUnusualNum' });
      setReport({
        kind: warnings.length ? 'warn' : 'ok',
        descChars: split.description.length,
        claimsChars: split.claims.length,
        lang: detectedLang,
        warnings,
      });
    },
    [descText, claimsText, lang, mode, t, setDescText, setClaimsText, setLang]
  );

  const dragging = useFileDrop(handleFile);
  // Watch both buffers at once, so switching modes never looks like new text.
  const [bees, beeDone] = useBee(`${descText}\n${claimsText}`, lang);

  function undoImport() {
    const u = undoRef.current;
    if (!u) return;
    setDescText(u.desc);
    setClaimsText(u.claims);
    setRefListText(u.refList ?? '');
    setLang(u.lang);
    setImported(null);
    setReport(null);
    undoRef.current = null;
  }

  function pickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // re-selecting the same file must fire change again
    if (file) handleFile(file);
  }

  async function doExport() {
    const { exportPatentDoc } = await loadDocIO();
    let result;
    try {
      result = exportPatentDoc(
        imported,
        { description: descText, claims: claimsText, refList: refListText },
        {
          claimsHeading: lang === 'de' ? 'Patentansprüche' : 'Claims',
          refListHeading: lang === 'de' ? 'Bezugszeichenliste' : 'Reference signs',
        }
      );
    } catch {
      // The writer refuses to emit a document it knows is broken. Say so —
      // silently downloading nothing is the one outcome a drafter cannot act on.
      setReport({ kind: 'error', messageKey: 'expErrFailed' });
      return;
    }
    const { bytes, verified, diffs = [], refList } = result;
    // The reference list is the one buffer that can be left out on purpose — the
    // source may not mark it out unambiguously enough to rewrite (see
    // refListWritable). Saying nothing would let the user believe an edit was
    // saved when it was not.
    const skipped = {
      noSection: 'expRefNoSection',
      ambiguous: 'expRefAmbiguous',
      table: 'expRefTable',
    };
    // The file was written, but reading it back did not reproduce the buffers.
    // It is still handed over — the drafter needs a way to get their work out —
    // with a warning naming the first place the two disagree. That outranks a
    // skipped reference list: one says the file may be wrong, the other says a
    // part of it was deliberately not touched.
    if (!verified) {
      const d = diffs[0];
      setReport({
        kind: 'warn',
        messageKey: 'expErrUnverified',
        warnings: d ? [{ key: 'expDiffAt', arg: d }] : [],
      });
    } else if (skipped[refList]) {
      setReport({ kind: 'warn', messageKey: skipped[refList] });
    }
    const base = imported?.fileName ? imported.fileName.replace(/\.docm?x?$/i, '') : 'refcheck';
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${base}-checked.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  // Takes a key because the category chips are produced by a map now.
  const chip = (key, count, color, label) =>
    count > 0 && (
      <div key={key} className="s-chip" style={{ color: `var(--${color})` }}>
        <span className="s-dot" style={{ background: `var(--${color})` }} />
        {count} {label}
      </div>
    );

  return (
    <>
      {ctx && <CtxMenu menu={ctx} onClose={() => setCtx(null)} onAction={handleCtxAction} />}
      <DropOverlay visible={dragging} t={t} />
      {bees.map((id) => (
        <Bee key={id} t={t} onDone={() => beeDone(id)} />
      ))}

      <div className="topbar">
        <div className="logo">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="9" y1="13" x2="15" y2="13" />
            <line x1="9" y1="17" x2="12" y2="17" />
          </svg>
          <span>
            RefSign<em> Checker</em>
          </span>
        </div>
        <div className="spacer" />
        <div className="file-actions">
          <input
            ref={fileRef}
            type="file"
            accept=".docx,.docm"
            onChange={pickFile}
            style={{ display: 'none' }}
            data-testid="file-input"
          />
          <button className="file-btn" onClick={() => fileRef.current?.click()}>
            {t.impBtn}
          </button>
          {(descText || claimsText) && (
            <button
              className="file-btn"
              onClick={doExport}
              title={imported ? t.expTitleRound : t.expTitleFresh}
            >
              {imported ? t.expBtn : t.expFresh}
            </button>
          )}
        </div>
        <div className="theme-toggle">
          <button
            className={theme === 'light' ? 'active' : ''}
            onClick={() => setTheme('light')}
            title={t.themeLight}
            aria-label={t.themeLight}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
          </button>
          <button
            className={theme === 'system' ? 'active' : ''}
            onClick={() => setTheme('system')}
            title={t.themeSystem}
            aria-label={t.themeSystem}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="4" width="20" height="13" rx="1.5" />
              <path d="M8 20h8M12 17v3" />
            </svg>
          </button>
          <button
            className={theme === 'dark' ? 'active' : ''}
            onClick={() => setTheme('dark')}
            title={t.themeDark}
            aria-label={t.themeDark}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 12.5A8 8 0 1 1 11.5 4a6.5 6.5 0 0 0 8.5 8.5z" />
            </svg>
          </button>
        </div>
        <div className="pill-toggle">
          <button
            className={mode === 'description' ? 'active' : ''}
            onClick={() => {
              setMode('description');
              setFocus(null);
            }}
          >
            {t.modeDesc}
            {descText && <span className="buf-dot" />}
          </button>
          <button
            className={mode === 'claims' ? 'active' : ''}
            onClick={() => {
              setMode('claims');
              setFocus(null);
            }}
          >
            {t.modeClaims}
            {claimsText && <span className="buf-dot" />}
          </button>
        </div>
        <div className="lang-toggle" role="group" aria-label="Language">
          <button
            className={lang === 'en' ? 'active' : ''}
            aria-pressed={lang === 'en'}
            onClick={() => setLang('en')}
          >
            EN
          </button>
          <button
            className={lang === 'de' ? 'active' : ''}
            aria-pressed={lang === 'de'}
            onClick={() => setLang('de')}
          >
            DE
          </button>
        </div>
        <button
          className="help-btn"
          onClick={() => setHelpOpen(true)}
          title={t.helpBtn}
          aria-label={t.helpBtn}
        >
          ?
        </button>
      </div>

      {helpOpen && <HelpDialog t={t} lang={lang} onClose={() => setHelpOpen(false)} />}

      <ImportBanner
        report={report}
        t={t}
        onUndo={undoRef.current && !report?.messageKey ? undoImport : null}
        onDismiss={() => setReport(null)}
      />

      {/* Storage failures used to be swallowed, so a user pasting an oversized
          patent lost their work at the next refresh with no warning at all. */}
      {storageFull && (
        <div className="imp-banner imp-error" role="alert">
          <span className="imp-main">
            <strong>{t.storageFull}</strong>
          </span>
          <span className="imp-actions">
            <button className="imp-x" onClick={() => setStorageFull(false)} aria-label={t.dismiss}>
              ×
            </button>
          </span>
        </div>
      )}

      {/* Mobile shows one pane at a time — three columns do not fit a phone,
          and stacking them buries the reference list under a long scroll. */}
      <div className="pane-tabs" role="tablist" aria-label={t.paneTabsLbl}>
        {[
          ['ref', t.refPaneLbl],
          ['editor', t.editorLbl],
          ['signs', t.ovLbl],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={mobilePane === id}
            className={mobilePane === id ? 'active' : ''}
            onClick={() => setMobilePane(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <main
        className={`main pane-${mobilePane}${panes.left ? '' : ' left-off'}${panes.right ? '' : ' right-off'}`}
      >
        <aside className="ref-pane" aria-label={t.refPaneLbl}>
          <div className="pane-hdr">
            <span className="pane-title">{t.refPaneLbl}</span>
            <button
              className="pane-collapse"
              onClick={() => setPanes((p) => ({ ...p, left: !p.left }))}
              title={panes.left ? t.paneHideRef : t.paneShowRef}
              aria-label={panes.left ? t.paneHideRef : t.paneShowRef}
              aria-expanded={panes.left}
            >
              {panes.left ? '‹' : '›'}
            </button>
          </div>
          {/* Always mounted; collapsing is CSS, so the mobile tab bar and the
              desktop chevron cannot disagree about what exists. */}
          <RefPane
            t={t}
            signData={signData}
            termData={termData}
            refListText={refListText}
            onRefListChange={setRefListText}
            reconciled={reconciled}
            multiWord={listMultiWord}
          />
        </aside>

        <div className="editor-pane">
          <div className="pane-hdr">
            <span className="pane-title">{t.editorLbl}</span>
            <span
              style={{ fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}
            >
              {t.charCount(text.length)}
            </span>
          </div>
          <div
            className="editor-wrap"
            onMouseMove={handleEditorHover}
            onMouseLeave={() => setHoverSign(null)}
          >
            <div
              className="backdrop"
              ref={bdRef}
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: html }}
            />
            <textarea
              className="editor-ta"
              aria-label={t.editorAria}
              ref={taRef}
              value={text}
              placeholder={mode === 'description' ? t.placeholder_desc : t.placeholder_claims}
              onChange={(e) => {
                mode === 'description'
                  ? setDescText(e.target.value)
                  : setClaimsText(e.target.value);
                setFocus(null);
              }}
              onScroll={syncScroll}
              onContextMenu={handleCtxMenu}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
            />
          </div>
          <div className="statusbar">
            {chip('sign', errSignsActive.length, 'warn', t.errLbl)}
            {ERROR_KINDS.map((k) => chip(k.id, errorLists[k.id].length, k.color, t[k.chipLbl]))}
            {totalSigns > 0 && !anyActive && (
              <div className="s-chip" style={{ color: 'var(--ok)' }}>
                <span className="s-dot" style={{ background: 'var(--ok)' }} />
                All consistent
              </div>
            )}
            {allErrors.length > 0 && (
              <div className="err-nav" style={{ marginLeft: 'auto' }}>
                <button
                  className="nav-btn"
                  onClick={() => navigate(-1)}
                  aria-label={t.navPrev}
                  title={t.navPrev}
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <span className="nav-lbl">{t.navLabel(navIdx + 1, allErrors.length)}</span>
                <button
                  className="nav-btn"
                  onClick={() => navigate(1)}
                  aria-label={t.navNext}
                  title={t.navNext}
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>
            )}
            {disCt > 0 && (
              <button className="restore-btn" onClick={restoreAll}>
                ↩ {t.restoreAll} ({disCt})
              </button>
            )}
            {mode === 'claims' && text.length > 0 && (
              <div className="s-chip" style={{ color: 'var(--text-dim)', fontSize: '11px' }}>
                {t.claimsNote}
              </div>
            )}
          </div>
        </div>

        <Sidebar
          t={t}
          mode={mode}
          signData={signData}
          termData={termData}
          search={search}
          onSearch={setSearch}
          searchRef={searchRef}
          errSignsActive={errSignsActive}
          errSignsDismissed={errSignsDismissed}
          okSigns={okSigns}
          errorLists={errorLists}
          focus={focus}
          dis={dis}
          disCt={disCt}
          hoverSign={hoverSign}
          onHover={setHoverSign}
          onFocusSign={onFocusSign}
          onFocusError={onFocusError}
          onDismiss={toggleDis}
          onRestoreAll={restoreAll}
          orphaned={orphaned}
          collapsed={!panes.right}
          onToggleCollapse={() => setPanes((p) => ({ ...p, right: !p.right }))}
          claimSetStats={claimSetStats}
        />
      </main>
      <button className="reset-btn" onClick={doReset} title={t.resetAll}>
        {t.resetAll}
      </button>
    </>
  );
}
