import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { JSX } from 'preact';
import { T } from '../i18n.ts';
import { extractData, classify } from '../logic/extract.ts';
import { getAllErrors, errorGroup } from '../logic/errorSpans.ts';
import { ERROR_KINDS, KIND_BY_ID, kindItems } from '../logic/errorKinds.ts';
import { buildHtml, findAtPos } from '../logic/buildHtml.ts';
import { computeCrossRef } from '../logic/crossref.ts';
import { reconcileRefList } from '../logic/reconcile.ts';
import { listTermIndex, appliedListTerms } from '../logic/listTerms.ts';
import { claimStats } from '../logic/claimStats.ts';
import { compareSigns, disKey } from '../logic/constants.ts';
import { ctxMenuItems } from '../logic/ctxMenuItems.ts';
import { useDebounced } from '../hooks/useDebounced.ts';
import { usePersistentState, jsonCodec, setCodec, oneOf } from '../hooks/usePersistentState.ts';
import { useTheme } from '../hooks/useTheme.ts';
import { useBee } from '../hooks/useBee.ts';
import { useHotkeys } from '../hooks/useHotkeys.ts';
import { useEditorSync } from '../hooks/useEditorSync.ts';
import { useDocumentIO } from '../hooks/useDocumentIO.ts';
import { CtxMenu } from './CtxMenu.tsx';
import { Sidebar } from './Sidebar.tsx';
import { RefPane } from './RefPane.tsx';
import { LazyHelpDialog, preloadHelpDialog } from './LazyHelpDialog.tsx';
import { DropOverlay } from './DropOverlay.tsx';
import { ImportBanner } from './ImportBanner.tsx';
import { TopBar } from './TopBar.tsx';
import { StatusBar } from './StatusBar.tsx';
import { LazyBee } from './LazyBee.tsx';
import type { ErrorKindId, ErrorRecord, Focus } from '../logic/errorKinds.ts';
import type { CtxAction, CtxActionData, CtxMenu as CtxMenuData } from '../logic/ctxMenuItems.ts';
import type { BareTerm, ExtractResult, SignEntry } from '../logic/extract.ts';
import type { ErrorEntry } from '../logic/errorSpans.ts';
import type { Lang, Mode } from '../logic/constants.ts';
import type { IOBuffers } from '../hooks/useDocumentIO.ts';

/** Which single pane a narrow screen is showing. */
type MobilePane = 'ref' | 'editor' | 'signs';

/** Which side panes are open. Persisted, so it round-trips through JSON. */
interface Panes {
  left: boolean;
  right: boolean;
}

/** The context menu, plus where the right-click happened. */
type OpenCtxMenu = CtxMenuData & { x: number; y: number };

// The shape extractData returns, with nothing in it. The per-category arrays are
// derived from ERROR_KINDS so a new category cannot be forgotten here — an
// omission would surface as a crash on an empty buffer, which is the one moment
// nobody tests by hand.
const EMPTY_RESULT = {
  signData: {},
  termData: {},
  noTermSigns: new Set<string>(),
  claimGraph: null,
  ...Object.fromEntries(ERROR_KINDS.map((k) => [k.field, []])),
} as ExtractResult;

// How long the text buffers wait before being written to localStorage. Long
// enough that a burst of typing produces one write, short enough that a refresh
// straight after typing keeps the text.
const SAVE_MS = 400;

// ── APP ─────────────────────────────────────────────────────────────────────
// State and wiring. The three things App used to do itself and no longer does:
// the imperative editor/backdrop plumbing (hooks/useEditorSync.js), the .docx
// round trip (hooks/useDocumentIO.js), and ~150 lines of chrome markup
// (TopBar.jsx, StatusBar.jsx, icons.jsx).
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
  const [panes, setPanes] = usePersistentState<Panes>(
    'rsc_panes',
    { left: true, right: true },
    jsonCodec<Panes>()
  );
  // Narrow screens show exactly one pane; ignored by the desktop layout.
  const [mobilePane, setMobilePane] = useState<MobilePane>('editor');
  const [helpOpen, setHelpOpen] = useState(false);
  const [mwo, setMwo] = usePersistentState<Record<string, number>>(
    'rsc_mwo',
    {},
    jsonCodec<Record<string, number>>()
  );
  const [dis, setDis] = usePersistentState<Set<string>>('rsc_dis', new Set(), setCodec);
  const [theme, setTheme] = useTheme();
  // Transient UI state
  const text = mode === 'description' ? descText : claimsText;
  // Currently highlighted error card: {type: 'sign'|'art'|'bare'|'num'|'dep', key}
  // (key = sign string for signs, char position for everything else).
  const [focus, setFocus] = useState<Focus | null>(null);
  const [search, setSearch] = useState('');
  const [navIdx, setNavIdx] = useState(0);
  const [ctx, setCtx] = useState<OpenCtxMenu | null>(null);
  // Occurrence cursor for click-to-cycle on the sidebar error cards: which
  // occurrence of the currently-focused error the next click should advance from.
  const focusOcc = useRef<{ id: string | null; idx: number }>({ id: null, idx: 0 });
  const t = T[lang];

  // Debounce the expensive extraction on large documents; the textarea value
  // stays immediate so typing is never blocked.
  //
  // The third argument defers the FIRST extraction of a restored buffer past
  // first paint. Both buffers come back from localStorage already full, and
  // extracting them ran synchronously inside the very first render — so a
  // returning user waited out both before seeing anything. The editor still
  // shows its text immediately (the textarea reads the raw buffer); only the
  // highlights and the sidebar arrive a frame later.
  const debDesc = useDebounced(descText, descText.length > 5000 ? 200 : 0, '');
  const debClaims = useDebounced(claimsText, claimsText.length > 5000 ? 200 : 0, '');
  const debText = mode === 'description' ? debDesc : debClaims;

  // Multi-word terms read out of the drafter's own reference list, applied to
  // BOTH buffers — the list describes the invention, not one section of it.
  // Debounced on the same rule as the buffers: editing the list box re-runs
  // extraction, so on a large document it must not do so per keystroke.
  const bigDoc = descText.length + claimsText.length > 5000;
  const debRefList = useDebounced(refListText, bigDoc ? 200 : 0, '');
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

  // Everything imperative about the editor's two layers: scroll mirroring, the
  // per-sign mark index behind hover highlighting, scroll-to-span and the caret
  // restore after an edit the app made itself.
  const {
    taRef,
    bdRef,
    hoverSign,
    setHoverSign,
    syncScroll,
    scrollTo,
    onEditorHover,
    setCaretAfterCommit,
  } = useEditorSync({ html, text });

  // ── Search-filtered card lists (also drive the status-bar chips) ──
  const { errSigns, okSigns } = useMemo(() => {
    const q = search.toLowerCase();
    const err: [string, SignEntry][] = [];
    const ok: [string, SignEntry][] = [];
    for (const [sign, sData] of Object.entries(signData)) {
      if (!sData) continue;
      if (q && !sign.toLowerCase().includes(q)) {
        const termMatch = Object.keys(sData.terms).some((ts) =>
          [...(termData[ts]?.rawTerms ?? [])].some((r) => r.includes(q))
        );
        if (!termMatch) continue;
      }
      (classify(sData, termData, mode) === 'warn' ? err : ok).push([sign, sData]);
    }
    const byN = ([a]: [string, SignEntry], [b]: [string, SignEntry]) => compareSigns(a, b);
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
    const out = {} as Record<ErrorKindId, ErrorRecord[]>;
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
  const anyActive =
    errSignsActive.length > 0 || ERROR_KINDS.some((k) => errorLists[k.id].length > 0);

  // Live mirrors of state the card callbacks below read. Keeping them in refs is
  // what lets those callbacks be genuinely stable: every one of them is passed
  // down to Sidebar and the cards, so a fresh identity per render would defeat
  // the React.memo on each of them and re-render the whole sidebar on every
  // keystroke, hover and bee frame.
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const signDataRef = useRef(signData);
  signDataRef.current = signData;

  // Click an error card: the first click focuses it and jumps to its first
  // occurrence; each further click on the same card advances to the next
  // occurrence (in document order); the click after the last one clears the
  // focus. `occs` is the sorted [start, end] spans for the error, so a
  // single-occurrence card (article/bare/numbering/dependency) simply toggles,
  // exactly as before, while a multi-occurrence sign cycles through its marks.
  const focusCycle = useCallback(
    (type: Focus['type'], key: Focus['key'], occs: [number, number][]) => {
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
      const occ = occs[idx];
      if (!occ) return;
      focusOcc.current = { id, idx };
      // `key` is a sign string for 'sign' and a char offset otherwise — the
      // asymmetry Focus spells out. The pairing holds by construction at both
      // call sites below, which is what the cast asserts.
      setFocus({ type, key } as Focus);
      scrollTo(occ[0], occ[1]);
    },
    [scrollTo]
  );
  const onFocusSign = useCallback(
    (sign: string) => {
      const occs: [number, number][] = (signDataRef.current[sign]?.positions ?? [])
        .map((p): [number, number] => [p.signStart, p.signEnd])
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
    (kindId: ErrorKindId, item: ErrorRecord) => {
      const kind = KIND_BY_ID[kindId];
      const start = kind.start(item);
      focusCycle(kindId, start, [[start, kind.end(item)]]);
    },
    [focusCycle]
  );

  function goToError(idx: number) {
    const e = allErrors[idx];
    if (!e) return;
    setNavIdx(idx);
    scrollTo(e.start, e.end);
    setFocus(e.type === 'sign' ? { type: 'sign', key: e.sign } : { type: e.type, key: e.start });
    focusOcc.current = { id: null, idx: 0 }; // arrows drive their own cursor; restart card-cycling
  }

  function navigate(dir: number) {
    if (!allErrors.length) return;
    goToError((navIdx + dir + allErrors.length) % allErrors.length);
  }

  // Which error a jump measures from. The arrows own navIdx, but a sidebar card
  // click focuses an error without moving it — so when the focus points at a
  // different error than navIdx does, the focus is the more recent intent.
  function anchorIdx() {
    const f = focusRef.current;
    if (!f) return navIdx;
    const matches = (e: ErrorEntry | undefined) =>
      !!e && e.type === f.type && (e.type === 'sign' ? e.sign === f.key : e.start === f.key);
    if (matches(allErrors[navIdx])) return navIdx;
    const i = allErrors.findIndex(matches);
    return i >= 0 ? i : navIdx;
  }

  // Ctrl+Shift+↓/↑: the next error about the SAME term, skipping everything
  // else — stepping through every faulty "banana" without wading through the
  // "kiwi" errors between them. Errors with no term (claim numbering,
  // dependencies) step within their own category; see errorGroup.
  function navigateTerm(dir: number) {
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

  // ── .docx import / export ─────────────────────────────────────────────────
  // The hook owns the file plumbing and the banner report; App keeps deciding
  // what loading a document means for the rest of its state.
  const buffers = useMemo(
    () => ({ description: descText, claims: claimsText, refList: refListText }),
    [descText, claimsText, refListText]
  );
  const applyDoc = useCallback(
    (next: IOBuffers & { lang: Lang }) => {
      setDescText(next.description);
      setClaimsText(next.claims);
      setRefListText(next.refList);
      setLang(next.lang);
      setFocus(null);
    },
    [setDescText, setClaimsText, setRefListText, setLang]
  );
  const {
    imported,
    report,
    setReport,
    dragging,
    fileRef,
    pickFile,
    openPicker,
    doExport,
    undoImport,
    canUndo,
    clear: clearDocIO,
  } = useDocumentIO({ t, lang, buffers, apply: applyDoc });

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
  const searchRef = useRef<HTMLInputElement | null>(null);
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
    'mod+o': openPicker,
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
    (key: string) => {
      setDis((d) => {
        const n = new Set(d);
        if (n.has(key)) n.delete(key);
        else n.add(key);
        return n;
      });
    },
    [setDis]
  );
  function disAll() {
    const k = new Set<string>();
    Object.keys(signData).forEach((s) => k.add(disKey.sign(s)));
    // Every category, including ones added after this was written.
    for (const kind of ERROR_KINDS) for (const e of kindItems(res, kind)) k.add(kind.disKey(e));
    setDis(k);
  }
  const restoreAll = useCallback(() => setDis(new Set()), [setDis]);

  function handleCtxMenu(e: JSX.TargetedMouseEvent<HTMLTextAreaElement>) {
    e.preventDefault();
    const pos = taRef.current?.selectionStart ?? 0;
    // findAtPos names artErrors/bareTerms directly rather than going through
    // ERROR_KINDS: the menu is genuinely per-category, so there is no uniform
    // behaviour for a registry to drive. See logic/ctxMenuItems.js.
    const menu = ctxMenuItems(findAtPos(pos, signData, res.artErrors, res.bareTerms), {
      t,
      lang,
      dis,
    });
    if (!menu) return;
    setCtx({ x: e.clientX, y: e.clientY, ...menu });
  }

  /**
   * Write a bare term's reference sign into the text, right after the term.
   * Claims mode brackets it, because a bare sign there is an error of its own.
   */
  function insertSign(bt: BareTerm, sign: string) {
    // The spans come from the (debounced) extraction, so the buffer may have
    // moved on. Check the term is still where it was said to be rather than
    // splicing a sign into the middle of some other word.
    const at = text.slice(bt.termStart, bt.termEnd).toLowerCase().replace(/\s+/g, ' ');
    if (at !== bt.term) return;
    const ins = mode === 'claims' ? ` (${sign})` : ` ${sign}`;
    const next = text.slice(0, bt.termEnd) + ins + text.slice(bt.termEnd);
    (mode === 'description' ? setDescText : setClaimsText)(next);
    setFocus(null);
    // Leave the caret after what was just written, so the drafter carries on
    // where they were reading. Applied once the new value has been committed.
    setCaretAfterCommit(bt.termEnd + ins.length);
  }

  function handleCtxAction(a: CtxAction, d: CtxActionData) {
    // Both write an ABSOLUTE width (extra words beyond the base noun) measured
    // from what is on screen, so the override lands where the drafter expects
    // whatever widened the term in the first place. Reduce stores an explicit 0
    // rather than deleting the key — deleting it would just hand the term back
    // to the reference list, and the reduction would appear not to work.
    if (a === 'extend' && d && 'bs' in d) setMwo((m) => ({ ...m, [d.bs]: d.cur }));
    else if (a === 'reduce' && d && 'bs' in d)
      setMwo((m) => ({ ...m, [d.bs]: Math.max(0, d.cur - 2) }));
    else if (a === 'insert-sign' && d && 'bt' in d) insertSign(d.bt, d.sign);
    else if (a === 'toggle-dis' && d && 'key' in d) toggleDis(d.key);
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
    clearDocIO();
  }

  const switchMode = useCallback(
    (m: Mode) => {
      setMode(m);
      setFocus(null);
    },
    [setMode]
  );

  // Watch both buffers at once, so switching modes never looks like new text.
  const [bees, beeDone] = useBee(`${descText}\n${claimsText}`, lang);

  return (
    <>
      {ctx && <CtxMenu menu={ctx} onClose={() => setCtx(null)} onAction={handleCtxAction} />}
      <DropOverlay visible={dragging} t={t} />
      {bees.map((id) => (
        <LazyBee key={id} t={t} onDone={() => beeDone(id)} />
      ))}

      <TopBar
        t={t}
        lang={lang}
        onLang={setLang}
        mode={mode}
        onMode={switchMode}
        theme={theme}
        onTheme={setTheme}
        hasDesc={!!descText}
        hasClaims={!!claimsText}
        imported={imported}
        fileRef={fileRef}
        onPickFile={pickFile}
        onImportClick={openPicker}
        onExport={doExport}
        onHelp={openHelp}
        onHelpHover={preloadHelpDialog}
      />

      {helpOpen && <LazyHelpDialog lang={lang} onClose={() => setHelpOpen(false)} />}

      <ImportBanner
        report={report}
        t={t}
        onUndo={canUndo ? undoImport : null}
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
        {(
          [
            ['ref', t.refPaneLbl],
            ['editor', t.editorLbl],
            ['signs', t.ovLbl],
          ] as [MobilePane, string][]
        ).map(([id, label]) => (
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
            onMouseMove={onEditorHover}
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
                const next = e.currentTarget.value;
                if (mode === 'description') setDescText(next);
                else setClaimsText(next);
                setFocus(null);
              }}
              onScroll={syncScroll}
              onContextMenu={handleCtxMenu}
              spellcheck={false}
              autoCorrect="off"
              autoCapitalize="off"
            />
          </div>
          <StatusBar
            t={t}
            mode={mode}
            hasText={text.length > 0}
            signErrCount={errSignsActive.length}
            errorLists={errorLists}
            totalSigns={totalSigns}
            anyActive={anyActive}
            errorCount={allErrors.length}
            navIdx={navIdx}
            onNavigate={navigate}
            disCt={disCt}
            onRestoreAll={restoreAll}
          />
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
