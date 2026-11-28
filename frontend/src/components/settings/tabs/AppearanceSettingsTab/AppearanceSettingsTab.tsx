import { useId } from 'react';
import clsx from 'clsx';
import { Check } from 'lucide-react';
import { SectionCard, SettingRow } from '@/components/settings/SettingsCard/SettingsCard';
import {
  SegmentedControl,
  type SegmentOption,
} from '@/components/ui/primitives/SegmentedControl/SegmentedControl';
import { Select } from '@/components/ui/primitives/Select/Select';
import { useMountEffect } from '@/hooks/useMountEffect';
import { useUIStore } from '@/store/uiStore';
import type { Palette, Theme, TranscriptWidth } from '@/types/ui.types';
import { DARK_PALETTES, PALETTE_TOKENS, THEMES, getThemeMeta, type ThemeMeta } from '@/utils/theme';
import styles from './AppearanceSettingsTab.module.scss';

type PaletteMeta = ThemeMeta & { value: Palette };

const PALETTE_THEMES = THEMES.filter((t): t is PaletteMeta => t.value !== 'system');
const LIGHT_THEMES = PALETTE_THEMES.filter((t) => !DARK_PALETTES.has(t.value));
const DARK_THEMES = PALETTE_THEMES.filter((t) => DARK_PALETTES.has(t.value));

const THEME_GROUPS: { title: string; themes: ThemeMeta[] }[] = [
  { title: 'System', themes: [getThemeMeta('system')] },
  { title: 'Light', themes: LIGHT_THEMES },
  { title: 'Dark', themes: DARK_THEMES },
];

const CODE_FONT_SIZES = [11, 12, 13, 14, 15, 16];

const DIFF_STYLE_OPTIONS: SegmentOption<'unified' | 'split'>[] = [
  { value: 'unified', label: 'Unified' },
  { value: 'split', label: 'Split' },
];

const TRANSCRIPT_WIDTH_OPTIONS: SegmentOption<TranscriptWidth>[] = [
  { value: 'narrow', label: 'Narrow' },
  { value: 'default', label: 'Default' },
  { value: 'wide', label: 'Wide' },
];

function SwatchHalf({ palette }: { palette: Palette }) {
  const tokens = PALETTE_TOKENS[palette];
  return (
    <span className={styles['swatch-half']} style={{ backgroundColor: tokens.surface }}>
      <span className={styles['swatch-panel']} style={{ backgroundColor: tokens.surfaceSecondary }}>
        <span className={styles['swatch-line']} style={{ backgroundColor: tokens.textPrimary }} />
        <span
          className={clsx(styles['swatch-line'], styles['swatch-line--short'])}
          style={{ backgroundColor: tokens.textSecondary }}
        />
      </span>
    </span>
  );
}

function ThemeCard({ meta, selected }: { meta: ThemeMeta; selected: boolean }) {
  const systemLightTheme = useUIStore((state) => state.systemLightTheme);
  const systemDarkTheme = useUIStore((state) => state.systemDarkTheme);
  const { setTheme, setThemePreview } = useUIStore.getState();
  const preview = () => setThemePreview(meta.value);
  const clearPreview = () => setThemePreview(null);

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={selected ? 0 : -1}
      className={clsx(styles.card, selected && styles['card--selected'])}
      onClick={() => setTheme(meta.value)}
      onMouseEnter={preview}
      onMouseLeave={clearPreview}
      onFocus={preview}
      onBlur={clearPreview}
    >
      <span className={styles.swatch} aria-hidden="true">
        {meta.value === 'system' ? (
          <>
            <SwatchHalf palette={systemLightTheme} />
            <SwatchHalf palette={systemDarkTheme} />
          </>
        ) : (
          <SwatchHalf palette={meta.value} />
        )}
      </span>
      <span className={styles['card-label']}>
        <span className={styles['card-name']}>{meta.label}</span>
        {selected && <Check className={styles['card-check']} aria-hidden="true" />}
      </span>
    </button>
  );
}

// Roving focus like SegmentedControl; focus previews, Enter/Space/click commits.
function handleGalleryKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
  const cards = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
  const index = cards.findIndex((card) => card === document.activeElement);
  if (index < 0) return;
  let next: number | undefined;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % cards.length;
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
    next = (index - 1 + cards.length) % cards.length;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = cards.length - 1;
  if (next === undefined) return;
  e.preventDefault();
  cards[next].focus();
}

function ThemeGallery({ theme }: { theme: Theme }) {
  const idPrefix = useId();

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={styles.gallery}
      onKeyDown={handleGalleryKeyDown}
    >
      {THEME_GROUPS.map(({ title, themes }) => (
        <div key={title} role="group" aria-labelledby={`${idPrefix}-${title}`}>
          <h3 id={`${idPrefix}-${title}`} className={styles['group-title']}>
            {title}
          </h3>
          <div className={styles.grid}>
            {themes.map((meta) => (
              <ThemeCard key={meta.value} meta={meta} selected={meta.value === theme} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PaletteSelect({
  label,
  value,
  themes,
  onChange,
}: {
  label: string;
  value: Palette;
  themes: PaletteMeta[];
  onChange: (palette: Palette) => void;
}) {
  return (
    <div className={styles.control}>
      <Select
        value={value}
        onChange={(e) => onChange(e.target.value as Palette)}
        className={styles.select}
        aria-label={label}
      >
        {themes.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function AppearanceSettingsTab() {
  const theme = useUIStore((state) => state.theme);
  const systemLightTheme = useUIStore((state) => state.systemLightTheme);
  const systemDarkTheme = useUIStore((state) => state.systemDarkTheme);
  const codeFontSize = useUIStore((state) => state.codeFontSize);
  const diffStyle = useUIStore((state) => state.diffStyle);
  const transcriptWidth = useUIStore((state) => state.transcriptWidth);
  const {
    setSystemLightTheme,
    setSystemDarkTheme,
    setCodeFontSize,
    setDiffStyle,
    setTranscriptWidth,
  } = useUIStore.getState();

  useMountEffect(() => () => useUIStore.getState().setThemePreview(null));

  return (
    <div className={styles.appearance}>
      <h2 className={styles['page-title']}>Appearance</h2>

      <SectionCard title="Theme">
        <ThemeGallery theme={theme} />
        {theme === 'system' && (
          <>
            <SettingRow title="Light theme" desc="Used while your system is in light mode.">
              <PaletteSelect
                label="Light theme"
                value={systemLightTheme}
                themes={LIGHT_THEMES}
                onChange={setSystemLightTheme}
              />
            </SettingRow>
            <SettingRow title="Dark theme" desc="Used while your system is in dark mode.">
              <PaletteSelect
                label="Dark theme"
                value={systemDarkTheme}
                themes={DARK_THEMES}
                onChange={setSystemDarkTheme}
              />
            </SettingRow>
          </>
        )}
      </SectionCard>

      <SectionCard title="Code">
        <SettingRow title="Font size" desc="Applies to the editor, diffs and terminal.">
          <div className={styles.control}>
            <Select
              value={codeFontSize}
              onChange={(e) => setCodeFontSize(Number(e.target.value))}
              className={styles.select}
              aria-label="Code font size"
            >
              {CODE_FONT_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}px
                </option>
              ))}
            </Select>
          </div>
        </SettingRow>
        <SettingRow title="Diff style" desc="Layout of the git diff view.">
          <SegmentedControl
            options={DIFF_STYLE_OPTIONS}
            value={diffStyle}
            onChange={setDiffStyle}
            size="sm"
          />
        </SettingRow>
      </SectionCard>

      <SectionCard title="Chat">
        <SettingRow title="Transcript width" desc="Maximum width of the message column.">
          <SegmentedControl
            options={TRANSCRIPT_WIDTH_OPTIONS}
            value={transcriptWidth}
            onChange={setTranscriptWidth}
            size="sm"
          />
        </SettingRow>
      </SectionCard>
    </div>
  );
}
