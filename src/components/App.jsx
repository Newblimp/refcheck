import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import { T } from '../i18n.js';
import { extractData, classify } from '../logic/extract.js';
import { getAllErrors } from '../logic/errorSpans.js';
import { buildHtml, findAtPos } from '../logic/buildHtml.js';
import { computeCrossRef } from '../logic/crossref.js';
import { reconcileRefList } from '../logic/reconcile.js';
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
import { DropOverlay } from './DropOverlay.jsx';
import { ImportBanner } from './ImportBanner.jsx';
import { Bee } from './Bee.jsx';

const EMPTY_RESULT = {
  signData: {},
  termData: {},
  artErrors: [],
  bareTerms: [],
  numErrors: [],
  depErrors: [],
  noTermSigns: new Set(),
  claimGraph: null,
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
  const t = T[lang];

  // Debounce the expensive extraction on large documents; the textarea value
  // stays immediate so typing is never blocked.
  const debDesc = useDebounced(descText, descText.length > 5000 ? 200 : 0);
  const debClaims = useDebounced(claimsText, claimsText.length > 5000 ? 200 : 0);
  const debText = mode === 'description' ? debDesc : debClaims;
  const descResult = useMemo(
    () => (debDesc ? extractData(debDesc, lang, mwo, true, false) : null),
    [debDesc, lang, mwo]
  );
  const claimsResult = useMemo(
    () => (debClaims ? extractData(debClaims, lang, mwo, true, true) : null),
    [debClaims, lang, mwo]
  );
  const res = (mode === 'description' ? descResult : claimsResult) ?? EMPTY_RESULT;
  const { signData, termData, artErrors, bareTerms, numErrors, depErrors } = res;

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
  const claimSetStats = useMemo(() => claimStats(claimsResult?.claimGraph), [claimsResult]);

  useEffect(() => setNavIdx(0), [allErrors.length]);

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

  const visArt = useMemo(() => {
    const q = search.toLowerCase();
    return artErrors.filter(
      (ae) =>
        !q ||
        ae.termStem.includes(q) ||
        [...(termData[ae.termStem]?.rawTerms || [])].some((r) => r.includes(q))
    );
  }, [artErrors, termData, search]);
  // The "active" (not dismissed) splits below are memoized rather than derived
  // inline. They feed Sidebar and every card under it, so recomputing them per
  // render also handed down fresh array identities on every hover, every search
  // keystroke and every bee frame — which is what made memoizing the card
  // components pointless before. Cheap on their own; the identity is the point.
  const visArtActive = useMemo(
    () => visArt.filter((ae) => !dis.has(disKey.art(ae.termStem))),
    [visArt, dis]
  );
  const visBare = useMemo(() => {
    const q = search.toLowerCase();
    return bareTerms.filter((bt) => !q || bt.term.includes(q) || bt.termStem.includes(q));
  }, [bareTerms, search]);
  const visBareActive = useMemo(
    () => visBare.filter((bt) => !dis.has(disKey.bare(bt.termStem))),
    [visBare, dis]
  );
  const visNum = useMemo(() => {
    const q = search.toLowerCase();
    return numErrors.filter(
      (ne) => !q || String(ne.value).includes(q) || String(ne.expected).includes(q)
    );
  }, [numErrors, search]);
  const visNumActive = useMemo(
    () => visNum.filter((ne) => !dis.has(disKey.num(ne.key))),
    [visNum, dis]
  );
  const visDep = useMemo(() => {
    const q = search.toLowerCase();
    return depErrors.filter(
      (de) => !q || String(de.claim).includes(q) || String(de.ref).includes(q)
    );
  }, [depErrors, search]);
  const visDepActive = useMemo(
    () => visDep.filter((de) => !dis.has(disKey.dep(de.key))),
    [visDep, dis]
  );
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
  const anyActive =
    errSignsActive.length ||
    visArtActive.length ||
    visBareActive.length ||
    visNumActive.length ||
    visDepActive.length;

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
  const onFocusArt = useCallback(
    (ae) => focusCycle('art', ae.artStart, [[ae.artStart, ae.artEnd]]),
    [focusCycle]
  );
  const onFocusBare = useCallback(
    (bt) => focusCycle('bare', bt.termStart, [[bt.termStart, bt.termEnd]]),
    [focusCycle]
  );
  const onFocusNum = useCallback(
    (ne) => focusCycle('num', ne.start, [[ne.start, ne.end]]),
    [focusCycle]
  );
  const onFocusDep = useCallback(
    (de) => focusCycle('dep', de.start, [[de.start, de.end]]),
    [focusCycle]
  );

  function navigate(dir) {
    if (!allErrors.length) return;
    const next = (navIdx + dir + allErrors.length) % allErrors.length;
    setNavIdx(next);
    const e = allErrors[next];
    scrollTo(e.start, e.end);
    setFocus({ type: e.type, key: e.type === 'sign' ? e.sign : e.start });
    focusOcc.current = { id: null, idx: 0 }; // arrows drive their own cursor; restart card-cycling
  }

  // Keyboard shortcuts. Ctrl/Cmd+[ and +] step through the errors without
  // leaving the editor — the arrows in the status bar were previously the only
  // way. "/" focuses the sign filter, but only when the user is not typing.
  const searchRef = useRef(null);
  useHotkeys({
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
    artErrors.forEach((ae) => k.add(disKey.art(ae.termStem)));
    bareTerms.forEach((bt) => k.add(disKey.bare(bt.termStem)));
    numErrors.forEach((ne) => k.add(disKey.num(ne.key)));
    depErrors.forEach((de) => k.add(disKey.dep(de.key)));
    setDis(k);
  }
  const restoreAll = useCallback(() => setDis(new Set()), [setDis]);

  function handleCtxMenu(e) {
    e.preventDefault();
    const pos = taRef.current?.selectionStart ?? 0;
    const found = findAtPos(pos, signData, artErrors);
    if (!found) return;
    const items = [];
    if (found.type === 'sign') {
      const { sign, pos: p } = found;
      const bs = stem(p.term.split(' ').pop(), lang);
      const cur = 1 + (mwo[bs] || 0);
      items.push({ label: t.extendTerm(cur), a: 'extend', d: { bs } });
      if (cur > 1) items.push({ label: t.reduceTerm, a: 'reduce', d: { bs } });
      items.push({ sep: true });
      const isDis = dis.has(disKey.sign(sign));
      items.push({
        label: isDis ? `↩ Restore "${sign}"` : t.disSign(sign),
        a: 'toggle-dis',
        d: { key: disKey.sign(sign) },
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
    setCtx({
      x: e.clientX,
      y: e.clientY,
      items,
      label: found.type === 'sign' ? `Sign ${found.sign}` : `Article: ${found.ae?.article}`,
    });
  }

  function handleCtxAction(a, d) {
    if (a === 'extend') setMwo((m) => ({ ...m, [d.bs]: (m[d.bs] || 0) + 1 }));
    else if (a === 'reduce')
      setMwo((m) => {
        const n = { ...m };
        n[d.bs] > 1 ? n[d.bs]-- : delete n[d.bs];
        return n;
      });
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
    const { bytes, refList } = exportPatentDoc(
      imported,
      { description: descText, claims: claimsText, refList: refListText },
      {
        claimsHeading: lang === 'de' ? 'Patentansprüche' : 'Claims',
        refListHeading: lang === 'de' ? 'Bezugszeichenliste' : 'Reference signs',
      }
    );
    // The reference list is the one buffer that can be silently left out — the
    // source may not mark it out unambiguously enough to rewrite (see
    // refListWritable). Saying nothing would let the user believe an edit was
    // saved when it was not.
    const skipped = {
      noSection: 'expRefNoSection',
      ambiguous: 'expRefAmbiguous',
      table: 'expRefTable',
    };
    if (skipped[refList]) setReport({ kind: 'warn', messageKey: skipped[refList] });
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

  const chip = (count, color, label) =>
    count > 0 && (
      <div className="s-chip" style={{ color: `var(--${color})` }}>
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
      </div>

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

      <main className="main">
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
            {chip(errSignsActive.length, 'warn', t.errLbl)}
            {chip(visArtActive.length, 'art', t.artLbl)}
            {chip(visBareActive.length, 'bare', t.bareLbl)}
            {chip(visNumActive.length, 'num', t.numberingLbl)}
            {chip(visDepActive.length, 'dep', t.depLbl)}
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
          lang={lang}
          mode={mode}
          signData={signData}
          termData={termData}
          search={search}
          onSearch={setSearch}
          searchRef={searchRef}
          errSignsActive={errSignsActive}
          errSignsDismissed={errSignsDismissed}
          okSigns={okSigns}
          visArtActive={visArtActive}
          visBareActive={visBareActive}
          visNumActive={visNumActive}
          visDepActive={visDepActive}
          focus={focus}
          dis={dis}
          disCt={disCt}
          mwo={mwo}
          hoverSign={hoverSign}
          onHover={setHoverSign}
          onFocusSign={onFocusSign}
          onFocusArt={onFocusArt}
          onFocusBare={onFocusBare}
          onFocusNum={onFocusNum}
          onFocusDep={onFocusDep}
          onDismiss={toggleDis}
          onRestoreAll={restoreAll}
          orphaned={orphaned}
          refListText={refListText}
          onRefListChange={setRefListText}
          reconciled={reconciled}
          claimSetStats={claimSetStats}
        />
      </main>
      <button className="reset-btn" onClick={doReset} title={t.resetAll}>
        {t.resetAll}
      </button>
    </>
  );
}
