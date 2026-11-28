import { SectionCard, SettingRow } from '@/components/settings/SettingsCard/SettingsCard';
import { Dropdown } from '@/components/ui/primitives/Dropdown/Dropdown';
import {
  SegmentedControl,
  type SegmentOption,
} from '@/components/ui/primitives/SegmentedControl/SegmentedControl';
import { Select } from '@/components/ui/primitives/Select/Select';
import { useMountEffect } from '@/hooks/useMountEffect';
import { useUIStore } from '@/store/uiStore';
import type { Palette, TranscriptWidth } from '@/types/ui.types';
import { DARK_PALETTES, PALETTE_TOKENS, THEMES, type ThemeMeta } from '@/utils/theme';
import styles from './AppearanceSettingsTab.module.scss';

type Mode = 'light' | 'dark' | 'system';
type PaletteMeta = ThemeMeta & { value: Palette };

const PALETTE_THEMES = THEMES.filter((t): t is PaletteMeta => t.value !== 'system');
const LIGHT_THEMES = PALETTE_THEMES.filter((t) => !DARK_PALETTES.has(t.value));
const DARK_THEMES = PALETTE_THEMES.filter((t) => DARK_PALETTES.has(t.value));
const PALETTE_META = Object.fromEntries(PALETTE_THEMES.map((t) => [t.value, t])) as Record<
  Palette,
  PaletteMeta
>;

const MODE_OPTIONS: SegmentOption<Mode>[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
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

const previewTheme = (meta: PaletteMeta) => useUIStore.getState().setThemePreview(meta.value);

const clearPreviewOnClose = (isOpen: boolean) => {
  if (!isOpen) useUIStore.getState().setThemePreview(null);
};

function ThemeChip({ palette }: { palette: Palette }) {
  const { surface, surfaceSecondary, textPrimary } = PALETTE_TOKENS[palette];
  return (
    <span
      aria-hidden="true"
      className={styles.chip}
      style={{
        background: `linear-gradient(90deg, ${surface} 0 34%, ${surfaceSecondary} 34% 67%, ${textPrimary} 67%)`,
      }}
    />
  );
}

function renderThemeItem(meta: PaletteMeta) {
  return (
    <span className={styles.item}>
      <ThemeChip palette={meta.value} />
      <span className={styles['item-label']}>{meta.label}</span>
    </span>
  );
}

function ThemePicker({
  label,
  value,
  themes,
  onSelect,
}: {
  label: string;
  value: Palette;
  themes: PaletteMeta[];
  onSelect: (palette: Palette) => void;
}) {
  return (
    <Dropdown
      value={PALETTE_META[value]}
      items={themes}
      getItemKey={(meta) => meta.value}
      getItemLabel={(meta) => meta.label}
      onSelect={(meta) => onSelect(meta.value)}
      onItemHighlight={previewTheme}
      onOpenChange={clearPreviewOnClose}
      renderItem={renderThemeItem}
      triggerIcon={<ThemeChip palette={value} />}
      ariaLabel={label}
      width="14rem"
      dropdownPosition="auto"
      dropdownAlign="right"
      searchable
      searchPlaceholder="Filter..."
      searchVariant="underline"
    />
  );
}

export function AppearanceSettingsTab() {
  const theme = useUIStore((state) => state.theme);
  const lightTheme = useUIStore((state) => state.lightTheme);
  const darkTheme = useUIStore((state) => state.darkTheme);
  const codeFontSize = useUIStore((state) => state.codeFontSize);
  const diffStyle = useUIStore((state) => state.diffStyle);
  const transcriptWidth = useUIStore((state) => state.transcriptWidth);
  const {
    setTheme,
    setLightTheme,
    setDarkTheme,
    setCodeFontSize,
    setDiffStyle,
    setTranscriptWidth,
  } = useUIStore.getState();

  useMountEffect(() => () => useUIStore.getState().setThemePreview(null));

  const mode: Mode = theme === 'system' ? 'system' : DARK_PALETTES.has(theme) ? 'dark' : 'light';
  const selectMode = (next: Mode) =>
    setTheme(next === 'system' ? 'system' : next === 'dark' ? darkTheme : lightTheme);
  const isSystem = mode === 'system';

  return (
    <div className={styles.appearance}>
      <h2 className={styles['page-title']}>Appearance</h2>

      <SectionCard title="Theme">
        <SettingRow title="Mode">
          <SegmentedControl options={MODE_OPTIONS} value={mode} onChange={selectMode} size="sm" />
        </SettingRow>
        {mode !== 'dark' && (
          <SettingRow
            title="Light theme"
            desc={isSystem ? 'Used while your system is in light mode.' : undefined}
          >
            <ThemePicker
              label="Light theme"
              value={lightTheme}
              themes={LIGHT_THEMES}
              onSelect={isSystem ? setLightTheme : setTheme}
            />
          </SettingRow>
        )}
        {mode !== 'light' && (
          <SettingRow
            title="Dark theme"
            desc={isSystem ? 'Used while your system is in dark mode.' : undefined}
          >
            <ThemePicker
              label="Dark theme"
              value={darkTheme}
              themes={DARK_THEMES}
              onSelect={isSystem ? setDarkTheme : setTheme}
            />
          </SettingRow>
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
