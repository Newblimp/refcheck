import { memo } from 'react';
import { LogoIcon, SunIcon, MonitorIcon, MoonIcon } from './icons.tsx';
import type { JSX, Ref } from 'preact';
import type { Lang, Mode } from '../logic/constants.ts';
import type { Theme } from '../hooks/useTheme.ts';
import type { ImportResult } from '../logic/importDoc.ts';
import type { PlainStringKey, Strings } from '../i18n.ts';

// ── TOP BAR ─────────────────────────────────────────────────────────────────
// Logo, the .docx file actions, and the three preference toggles (theme, mode,
// language) plus the help button.
//
// Purely presentational: every piece of state it shows lives in App, and every
// control calls back. Splitting it out took ~150 lines of markup — half of it
// SVG path data — out of the middle of App's render.
//
// The theme buttons are a table rather than three near-identical blocks, which
// is the same reasoning ERROR_KINDS applies to the error categories: three
// copies of one button differing in an icon and a label is a place to get one
// of them wrong.
const THEMES: { id: Theme; Icon: () => JSX.Element; lbl: PlainStringKey }[] = [
  { id: 'light', Icon: SunIcon, lbl: 'themeLight' },
  { id: 'system', Icon: MonitorIcon, lbl: 'themeSystem' },
  { id: 'dark', Icon: MoonIcon, lbl: 'themeDark' },
];

export interface TopBarProps {
  t: Strings;
  lang: Lang;
  onLang: (lang: Lang) => void;
  mode: Mode;
  onMode: (mode: Mode) => void;
  theme: Theme;
  onTheme: (theme: Theme) => void;
  /** Whether each buffer has content — drives the mode buttons' dot indicator. */
  hasDesc: boolean;
  hasClaims: boolean;
  /** Non-null once a .docx has been imported, which makes export a round trip. */
  imported: ImportResult | null;
  fileRef: Ref<HTMLInputElement>;
  onPickFile: JSX.GenericEventHandler<HTMLInputElement>;
  onImportClick: () => void;
  onExport: () => void;
  onHelp: () => void;
  onHelpHover: () => void;
}

function TopBarImpl({
  t,
  lang,
  onLang,
  mode,
  onMode,
  theme,
  onTheme,
  hasDesc,
  hasClaims,
  imported,
  fileRef,
  onPickFile,
  onImportClick,
  onExport,
  onHelp,
  onHelpHover,
}: TopBarProps) {
  return (
    <div className="topbar">
      <div className="logo">
        <LogoIcon />
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
          onChange={onPickFile}
          style={{ display: 'none' }}
          data-testid="file-input"
        />
        <button className="file-btn" onClick={onImportClick}>
          {t.impBtn}
        </button>
        {/* Nothing to export from two empty buffers. */}
        {(hasDesc || hasClaims) && (
          <button
            className="file-btn"
            onClick={onExport}
            title={imported ? t.expTitleRound : t.expTitleFresh}
          >
            {imported ? t.expBtn : t.expFresh}
          </button>
        )}
      </div>
      <div className="theme-toggle">
        {THEMES.map(({ id, Icon, lbl }) => (
          <button
            key={id}
            className={theme === id ? 'active' : ''}
            onClick={() => onTheme(id)}
            title={t[lbl]}
            aria-label={t[lbl]}
          >
            <Icon />
          </button>
        ))}
      </div>
      <div className="pill-toggle">
        <button
          className={mode === 'description' ? 'active' : ''}
          onClick={() => onMode('description')}
        >
          {t.modeDesc}
          {/* A dot marks a buffer that holds text, so the inactive mode still
              says whether there is anything in it. */}
          {hasDesc && <span className="buf-dot" />}
        </button>
        <button className={mode === 'claims' ? 'active' : ''} onClick={() => onMode('claims')}>
          {t.modeClaims}
          {hasClaims && <span className="buf-dot" />}
        </button>
      </div>
      <div className="lang-toggle" role="group" aria-label="Language">
        <button
          className={lang === 'en' ? 'active' : ''}
          aria-pressed={lang === 'en'}
          onClick={() => onLang('en')}
        >
          EN
        </button>
        <button
          className={lang === 'de' ? 'active' : ''}
          aria-pressed={lang === 'de'}
          onClick={() => onLang('de')}
        >
          DE
        </button>
      </div>
      {/* The dialog is a lazy chunk (LazyHelpDialog); starting its fetch on
          hover or keyboard focus means the click almost always lands on an
          import that has already resolved. */}
      <button
        className="help-btn"
        onClick={onHelp}
        onMouseEnter={onHelpHover}
        onFocus={onHelpHover}
        title={t.helpBtn}
        aria-label={t.helpBtn}
      >
        ?
      </button>
    </div>
  );
}

export const TopBar = memo(TopBarImpl);
