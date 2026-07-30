import { create } from "zustand";

export type ThemeName = "amber" | "minimal" | "midnight" | "matrix" | "noir" | "pure";
export type BackgroundMode = "minimal" | "aurora" | "starry";

export interface ClockSettings {
  theme: ThemeName;
  is24Hour: boolean;
  showSeconds: boolean;
  showInfoBar: boolean;
  backgroundMode: BackgroundMode;
  screensaverEnabled: boolean;
}

interface ClockStore extends ClockSettings {
  setTheme: (t: ThemeName) => void;
  toggle24Hour: () => void;
  toggleSeconds: () => void;
  toggleInfoBar: () => void;
  setBackgroundMode: (m: BackgroundMode) => void;
  setScreensaverEnabled: (v: boolean) => void;
}

const STORAGE_KEY = "flip-clock-settings-v1";

function loadSettings(): Partial<ClockSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<ClockSettings> & { backgroundMode?: string };
    // 旧值迁移:particles→starry, solid→minimal(aurora 保持)
    const bg = parsed.backgroundMode as string | undefined;
    if (bg === "particles") parsed.backgroundMode = "starry";
    else if (bg === "solid") parsed.backgroundMode = "minimal";
    return parsed;
  } catch {
    return {};
  }
}

const saved = loadSettings();

export const useClockStore = create<ClockStore>((set) => ({
  theme: saved.theme ?? "amber",
  is24Hour: saved.is24Hour ?? true,
  showSeconds: saved.showSeconds ?? true,
  showInfoBar: saved.showInfoBar ?? true,
  backgroundMode: saved.backgroundMode ?? "minimal",
  screensaverEnabled: saved.screensaverEnabled ?? false,
  setTheme: (theme) => {
    set({ theme });
    persist(getSnapshot({ theme }));
  },
  toggle24Hour: () => {
    set((s) => {
      const is24Hour = !s.is24Hour;
      persist(getSnapshot({ is24Hour }));
      return { is24Hour };
    });
  },
  toggleSeconds: () => {
    set((s) => {
      const showSeconds = !s.showSeconds;
      persist(getSnapshot({ showSeconds }));
      return { showSeconds };
    });
  },
  toggleInfoBar: () => {
    set((s) => {
      const showInfoBar = !s.showInfoBar;
      persist(getSnapshot({ showInfoBar }));
      return { showInfoBar };
    });
  },
  setBackgroundMode: (backgroundMode) => {
    set({ backgroundMode });
    persist(getSnapshot({ backgroundMode }));
  },
  setScreensaverEnabled: (screensaverEnabled) => {
    set({ screensaverEnabled });
    persist(getSnapshot({ screensaverEnabled }));
  },
}));

function getSnapshot(patch: Partial<ClockSettings>): ClockSettings {
  const s = useClockStore.getState();
  return {
    theme: patch.theme ?? s.theme,
    is24Hour: patch.is24Hour ?? s.is24Hour,
    showSeconds: patch.showSeconds ?? s.showSeconds,
    showInfoBar: patch.showInfoBar ?? s.showInfoBar,
    backgroundMode: patch.backgroundMode ?? s.backgroundMode,
    screensaverEnabled: patch.screensaverEnabled ?? s.screensaverEnabled,
  };
}

function persist(s: ClockSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* 忽略写入失败 */
  }
}

export const THEME_OPTIONS: { value: ThemeName; label: string; swatch: string }[] = [
  { value: "noir", label: "极简黑", swatch: "linear-gradient(135deg,#1a1a1a,#000000)" },
  { value: "pure", label: "极简白", swatch: "linear-gradient(135deg,#ededed,#ffffff)" },
  { value: "amber", label: "暖琥珀", swatch: "linear-gradient(135deg,#f4a261,#e76f51)" },
  { value: "minimal", label: "晨雾白", swatch: "linear-gradient(135deg,#f5efe0,#e8dfc8)" },
  { value: "midnight", label: "午夜蓝", swatch: "linear-gradient(135deg,#5b9dff,#7850dc)" },
  { value: "matrix", label: "矩阵绿", swatch: "linear-gradient(135deg,#00ff88,#003322)" },
];

export const BACKGROUND_OPTIONS: { value: BackgroundMode; label: string }[] = [
  { value: "minimal", label: "极简" },
  { value: "aurora", label: "极光" },
  { value: "starry", label: "星空" },
];
