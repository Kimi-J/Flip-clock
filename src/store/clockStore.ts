import { create } from "zustand";
import { emit } from "@tauri-apps/api/event";

export type ThemeName = "amber" | "minimal" | "midnight" | "matrix" | "noir" | "pure" | "voxel" | "synthwave" | "ink" | "clay";
export type BackgroundMode = "minimal" | "aurora" | "starry";
/** 小窗皮肤:与全屏主题正交的独立维度,皮肤自带完整配色与窗口几何 */
export type WidgetSkinName = "ticket" | "mecha" | "falling";

export interface ClockSettings {
  theme: ThemeName;
  is24Hour: boolean;
  showSeconds: boolean;
  showInfoBar: boolean;
  backgroundMode: BackgroundMode;
  screensaverEnabled: boolean;
  /** 小窗专属:显示秒(与全屏 showSeconds 相互独立) */
  widgetShowSeconds: boolean;
  /** 小窗专属:皮肤选择 */
  widgetSkin: WidgetSkinName;
}

const DEFAULTS: ClockSettings = {
  theme: "amber",
  is24Hour: true,
  showSeconds: true,
  showInfoBar: true,
  backgroundMode: "minimal",
  screensaverEnabled: false,
  widgetShowSeconds: true,
  widgetSkin: "ticket",
};

/** 部分设置补全为完整设置(缺省项回落默认值) */
function applyDefaults(s: Partial<ClockSettings>): ClockSettings {
  return {
    theme: s.theme ?? DEFAULTS.theme,
    is24Hour: s.is24Hour ?? DEFAULTS.is24Hour,
    showSeconds: s.showSeconds ?? DEFAULTS.showSeconds,
    showInfoBar: s.showInfoBar ?? DEFAULTS.showInfoBar,
    backgroundMode: s.backgroundMode ?? DEFAULTS.backgroundMode,
    screensaverEnabled: s.screensaverEnabled ?? DEFAULTS.screensaverEnabled,
    widgetShowSeconds: s.widgetShowSeconds ?? DEFAULTS.widgetShowSeconds,
    widgetSkin: s.widgetSkin ?? DEFAULTS.widgetSkin,
  };
}

interface ClockStore extends ClockSettings {
  setTheme: (t: ThemeName) => void;
  toggle24Hour: () => void;
  toggleSeconds: () => void;
  toggleInfoBar: () => void;
  setBackgroundMode: (m: BackgroundMode) => void;
  setScreensaverEnabled: (v: boolean) => void;
  toggleWidgetSeconds: () => void;
  setWidgetSkin: (s: WidgetSkinName) => void;
  /** 多窗口同步:用事件携带的最新快照(或 localStorage)恢复设置 */
  rehydrate: (patch?: Partial<ClockSettings>) => void;
}

const STORAGE_KEY = "flip-clock-settings-v1";

function loadSettings(): Partial<ClockSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return applyUrlOverrides({});
    const parsed = JSON.parse(raw) as Partial<ClockSettings> & { backgroundMode?: string };
    // 旧值迁移:particles→starry, solid→minimal(aurora 保持)
    const bg = parsed.backgroundMode as string | undefined;
    if (bg === "particles") parsed.backgroundMode = "starry";
    else if (bg === "solid") parsed.backgroundMode = "minimal";
    return applyUrlOverrides(parsed);
  } catch {
    return applyUrlOverrides({});
  }
}

/** 调试覆写(仅开发/截图用):?skin=ticket|mecha|falling 强制皮肤,不落盘 */
function applyUrlOverrides(s: Partial<ClockSettings>): Partial<ClockSettings> {
  try {
    const skin = new URLSearchParams(window.location.search).get("skin");
    if (skin === "ticket" || skin === "mecha" || skin === "falling") s.widgetSkin = skin;
  } catch {
    /* 非浏览器环境忽略 */
  }
  return s;
}

const saved = loadSettings();

export const useClockStore = create<ClockStore>((set) => ({
  ...applyDefaults(saved),
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
  toggleWidgetSeconds: () => {
    set((s) => {
      const widgetShowSeconds = !s.widgetShowSeconds;
      persist(getSnapshot({ widgetShowSeconds }));
      return { widgetShowSeconds };
    });
  },
  setWidgetSkin: (widgetSkin) => {
    set({ widgetSkin });
    persist(getSnapshot({ widgetSkin }));
  },
  rehydrate: (patch) => {
    set(applyDefaults(patch ?? loadSettings()));
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
    widgetShowSeconds: patch.widgetShowSeconds ?? s.widgetShowSeconds,
    widgetSkin: patch.widgetSkin ?? s.widgetSkin,
  };
}

function persist(s: ClockSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* 忽略写入失败 */
  }
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    // 多窗口同步:广播给同进程所有窗口(事件携带完整快照,接收方直接应用;自身接收幂等,无回环)
    emit("settings-sync", s).catch(() => {});
  }
}

export const THEME_OPTIONS: { value: ThemeName; label: string; swatch: string }[] = [
  { value: "noir", label: "极简黑", swatch: "linear-gradient(135deg,#1a1a1a,#000000)" },
  { value: "pure", label: "极简白", swatch: "linear-gradient(135deg,#ededed,#ffffff)" },
  { value: "amber", label: "暖琥珀", swatch: "linear-gradient(135deg,#f4a261,#e76f51)" },
  { value: "minimal", label: "晨雾白", swatch: "linear-gradient(135deg,#f5efe0,#e8dfc8)" },
  { value: "midnight", label: "午夜蓝", swatch: "linear-gradient(135deg,#5b9dff,#7850dc)" },
  { value: "matrix", label: "矩阵绿", swatch: "linear-gradient(135deg,#00ff88,#003322)" },
  { value: "voxel", label: "像素界", swatch: "linear-gradient(135deg,#3a1f5c,#00f0ff)" },
  { value: "synthwave", label: "霓虹波", swatch: "linear-gradient(135deg,#ff006e,#3a0ca3)" },
  { value: "ink", label: "水墨韵", swatch: "linear-gradient(135deg,#e8e4dc,#2a2a2a)" },
  { value: "clay", label: "奶芙紫", swatch: "linear-gradient(135deg,#f7f3ff,#a78bfa)" },
];

export const BACKGROUND_OPTIONS: { value: BackgroundMode; label: string }[] = [
  { value: "minimal", label: "极简" },
  { value: "aurora", label: "极光" },
  { value: "starry", label: "星空" },
];

/** 小窗皮肤选项(新皮肤在此追加) */
export const WIDGET_SKIN_OPTIONS: { value: WidgetSkinName; label: string }[] = [
  { value: "ticket", label: "票根" },
  { value: "mecha", label: "机械台钟" },
  { value: "falling", label: "叶落成时" },
];
