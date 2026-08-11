# TypeScript migration

A record of the migration from JavaScript-plus-JSDoc to TypeScript: what changed
in the tooling, what the compiler found, and the handful of decisions that are
worth not re-litigating.

Every `.js` and `.jsx` file under `src/` and `build/` is now `.ts`/`.tsx` — 100
files, including all 41 test files, the four build scripts and the service
worker. The suite was 705 tests before and 705 after; no test was deleted or
weakened.

## Tooling

Three projects, all run by `npm run typecheck`:

| Project              | Covers                        | Notes                                                              |
| -------------------- | ----------------------------- | ------------------------------------------------------------------ |
| `tsconfig.json`      | `src/`, `build/`, vite config | `strict` + `noUncheckedIndexedAccess`                              |
| `tsconfig.test.json` | the test suite                | same, with `noUncheckedIndexedAccess` off — see below              |
| `tsconfig.sw.json`   | `src/sw.ts` alone             | `lib: WebWorker` in place of DOM; the two cannot share one project |

Four choices that are load-bearing:

- **Imports name real files** (`./constants.ts`), via `allowImportingTsExtensions`.
  It is the one specifier style that `tsc`, Vite, Vitest and Node's own type
  stripping all resolve identically.
- **`erasableSyntaxOnly`** is on because `build/*.ts` runs under Node directly
  (`node build/budget.ts dist`). Without it, an enum or a namespace would type
  check and then fail to run in CI.
- **`paths` mirrors the react → preact/compat aliases** in `vite.config.ts`. If
  the two disagree, the checker and the bundler are reading different libraries.
  `react-dom/server` points at `preact-render-to-string`, which is what
  `preact/compat/server` re-exports and what Vite resolves to at runtime;
  `preact/compat/server` itself ships no declarations.
- **The service worker is type-stripped, not bundled.** It has to ship as a
  classic script at a stable, unhashed URL, and a worker that imports a chunk in
  order to boot defeats its own purpose. It has no imports and no exports, so
  erasure is all it needs — `swPrecache.ts` runs esbuild's `transform` (esbuild
  is already a Vite dependency) and writes `dist/sw.js` itself.

### Why `noUncheckedIndexedAccess` is on in production and off in tests

Measured before converting anything, against the logic layer as it then stood:

| Flag                       | Errors |
| -------------------------- | ------ |
| full `strict`              | 310    |
| `noImplicitAny` alone      | 309    |
| `noUncheckedIndexedAccess` | 48     |

Almost all of `strict`'s cost was `noImplicitAny`, which is the annotation work
the migration consists of anyway. `noUncheckedIndexedAccess` was cheap and is the
flag this codebase actually needs: nearly everything here is a map lookup
(`signData[sign]`) or a regex capture group (`m[1]`), and both type as present
without it. It went on at the start rather than at the end, so each file was
written against it once instead of twice.

In test code the same flag inverts. `expect(res.signData['12'].count).toBe(2)` is
an assertion _about the fixture_; requiring a guard there adds noise to every
line and invites the `?.` chains that turn a broken fixture into a passing test.
So the test project turns that one flag off and keeps everything that catches
real mistakes in tests — unknown properties, wrong arity, wrong types, unused
bindings.

Two helpers stand in for what would otherwise have been several hundred non-null
assertions (`src/test/helpers.ts`): `must()` fails with a named message instead
of "cannot read properties of undefined", and `q()` is a `querySelector` that
throws on a miss and returns the element type asked for.

## Bugs found

### 1. `undefined` reaching `event.respondWith()` in the service worker

**Where:** `src/sw.ts`, the `fetch` handler — both the navigation fallback and
the unhashed-asset fallback.

**What the type revealed:** under `lib: WebWorker`, `caches.match()` is typed
`Promise<Response | undefined>`. Both fallbacks handed that promise straight to
`event.respondWith()`, which requires a `Response`.

**The failure:** offline, with the requested URL _and_ the shell both absent from
the cache — a first visit whose precache never completed, or a cache the browser
evicted — the promise resolves to `undefined`. Per spec that is a network error,
but it also raises an unhandled rejection, so the failure surfaces as a bug in
the worker rather than as the user being offline.

**Fix:** both paths now `throw` explicitly when nothing is cached, with a message
saying so. This is the class of defect the file had no way to surface before: it
has no test that exercises a cache miss, and the symptom only appears with no
network. The existing code even carried a comment describing the hazard.

## Things that were not bugs, but were wrong

The compiler found a number of smaller things. None of them misbehaved, and each
is the kind of thing that quietly becomes a bug later.

1. **`classify()` took a `sign` parameter it never read.** Fourteen call sites
   passed one; each could only ever agree with the `sData` beside it or lie about
   it. Removed.
2. **Two dead imports** — `disKey` in `extract.ts` (unused since the dismissal
   keys moved into `ERROR_KINDS`) and `pickTarget` in `beeFlight.test.ts`. Found
   by `noUnusedLocals`.
3. **`spellCheck` (React casing) was being handed to Preact**, which declares only
   `spellcheck`. It reached the DOM as an unrecognised attribute rather than the
   known property — harmless in practice, since HTML attribute names are
   case-insensitive, but not what the code meant. Two call sites.
4. **Five signatures understated what their implementation accepts.**
   `detectLangFromText`, `fileKind`, `parseRefList`, `reconcileRefList` and
   `backdropScroll` all handle `null`/`undefined` deliberately, and each had a
   test passing one. Their types now say so, rather than leaving the next caller
   to guess from the body.
5. **`extractData`'s `lang` was required but routinely omitted.** A dozen tests
   called `extractData(text)` and got English — correctly, but by accident, since
   "anything that is not 'de'" means English three modules away in `stem()`. It
   now carries an explicit `'en'` default.
6. **`URL.lastBlob`** — the export tests read back the downloaded bytes through a
   property invented on `URL` that nothing declared. It is now a declared
   `globalThis.__lastExportedBlob` (`src/test/globals.d.ts`).
7. **i18n keys stored for direct rendering were typed `keyof Strings`**, which
   also admits the formatter-valued keys; naming one would have rendered
   `[object Function]` into the UI. They are `PlainStringKey` now — a mapped type
   over the keys whose values are strings — which also removed four casts.
8. **`focus.key` was `string | number`.** It is a sign string for signs and a
   character offset for everything else, an asymmetry CLAUDE.md documents at
   length and the type flattened away. It is a `Focus` union now.

## Two corrections to CLAUDE.md

Both were recorded as JSDoc limitations. One of them is not.

**The `SignSpan` / `SignTermSpan` split is a TypeScript constraint, not a JSDoc
one.** The two are kept as separate union members carrying a single literal
`kind` each, rather than one member with `kind: 'sign' | 'signTerm'`. This was
assumed to be a JSDoc quirk that real TypeScript would remove. It is not —
verified with a minimal repro before changing anything:

```ts
interface A {
  kind: 'sign' | 'signTerm';
  sev: string;
}
interface B {
  kind: 'art' | 'bare';
  item: object;
}
function f(sp: A | B) {
  if (sp.kind === 'sign' || sp.kind === 'signTerm') return;
  sp.item; // error: Property 'item' does not exist on type 'A | B'
}
```

TypeScript does not eliminate a union member whose discriminant is itself a union
of literals, even when every one of those literals has been excluded. The split
stays, and the comment in `errorSpans.ts` now says why correctly.

**`'reason' in can` really was JSDoc-only.** `exportPatentDoc` tested for the
property rather than the boolean because a boolean discriminant did not narrow
reliably under JSDoc. TypeScript narrows `!can.ok` on
`{ok: true} | {ok: false, reason}` correctly, so it is a plain `!can.ok` now.

## Design notes

**`ERROR_KINDS` is a generic `ErrorKind<T>` table.** Every accessor used to be
`(e: any) => …`, which made this the largest untyped surface in the app — and,
worse, the one place the design exists to protect: a row reading a field its
records do not have type-checked fine and produced `undefined` in the UI. Rows
are now authored through `defineKind<T>()` and checked against their own record
type (`ArtError`, `BareTerm`, `NumError`, `DepError`).

Consumers see `ErrorKind<ErrorRecord>` via a single documented cast. That cast is
unavoidable: which row goes with which records is a runtime invariant of the
array, and iterating a heterogeneous table hands a consumer a union of rows whose
accessors would then demand an intersection of all four record types. Erasing to
`ErrorRecord` still keeps consumers honest — they get a union, not `any`, so the
only way to read a field off a record is through the row's own accessor, which is
exactly the discipline the table exists to enforce.

**German is declared against English.** `i18n.ts` and `helpText.ts` both define
the English table first, derive `type Strings = typeof en`, and declare the German
one as `Strings`. A missing key, a spare key, or a formatter whose arity has
drifted is now a compile error. `i18n.test.ts` still runs — it also checks the
value kinds agree, and it costs nothing.

**Map types dropped their redundant `| undefined`.** `Record<string, SignEntry>`
rather than `Record<string, SignEntry | undefined>`: with
`noUncheckedIndexedAccess` on, indexing already yields `| undefined`, so writing
it in the type doubled up — and it was the single largest source of noise in the
tests, which run with the flag off.

## Cost

The critical path went from **40.6 KB to 41.1 KB** gzipped (budget: 50 KB). Types
erase, so the difference is entirely runtime guards that
`noUncheckedIndexedAccess` required — `instanceof` narrowing on DOM event
targets, and `in` checks on the context menu's action payloads. That is a real
0.5 KB for real checks, not an accounting artefact.

`npm run build`, `npm run budget`, `npm run format:check`, `npm run typecheck`
and `npm test` are all green.
