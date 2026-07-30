import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import AmbientBackground from "@/components/AmbientBackground";
import ControlBar from "@/components/ControlBar";
import FlipCardGroup from "@/components/FlipCardGroup";
import InfoBar from "@/components/InfoBar";
import SettingsPanel from "@/components/SettingsPanel";
import { useClockTime } from "@/hooks/useClockTime";
import { useClockStore } from "@/store/clockStore";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export default function Home() {
  const { is24Hour, showSeconds, showInfoBar, backgroundMode, theme, toggleSeconds, setTheme } = useClockStore();
  const time = useClockTime(is24Hour);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [closeBtnVisible, setCloseBtnVisible] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const hideTimer = useRef<number>(0);
  const toastTimer = useRef<number>(0);

  // 鼠标静止后隐藏控制条;鼠标移入右上角时显示关闭按钮
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      setControlsVisible(true);
      clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setControlsVisible(false), 2600);
      // 鼠标在右上角 120×120 区域内时显示关闭按钮
      setCloseBtnVisible(e.clientX > window.innerWidth - 120 && e.clientY < 120);
    };
    const onTouch = () => {
      setControlsVisible(true);
      clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setControlsVisible(false), 2600);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchstart", onTouch);
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 2600);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchstart", onTouch);
      clearTimeout(hideTimer.current);
    };
  }, []);

  // 应用主题到 html 节点
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // 全屏状态监听:Tauri 使用原生窗口全屏,浏览器回退到 Fullscreen API
  useEffect(() => {
    if (!isTauri) {
      const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
      document.addEventListener("fullscreenchange", onFsChange);
      return () => document.removeEventListener("fullscreenchange", onFsChange);
    }
    // Tauri: 监听窗口尺寸变化(全屏切换会触发),并检查初始状态
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    const checkFs = () => getCurrentWindow().isFullscreen().then(setIsFullscreen).catch(() => {});
    listen("tauri://resize", checkFs).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    checkFs();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const toggleFullscreen = () => {
    if (isTauri) {
      getCurrentWindow()
        .isFullscreen()
        .then((fs) => getCurrentWindow().setFullscreen(!fs).then(() => setIsFullscreen(!fs)))
        .catch(() => {});
    } else {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    }
  };

  const handleClose = () => {
    if (isTauri) {
      getCurrentWindow().close().catch(() => {});
    } else {
      window.close();
    }
  };

  const showToast = (msg: string) => {
    clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  };

  // 键盘快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      switch (e.key.toLowerCase()) {
        case "f":
          toggleFullscreen();
          showToast("全屏已切换");
          break;
        case "s":
          setSettingsOpen((v) => !v);
          break;
        case "t": {
          const order: typeof theme[] = ["amber", "minimal", "midnight", "matrix", "noir", "pure"];
          const next = order[(order.indexOf(theme) + 1) % order.length];
          setTheme(next);
          showToast(`主题: ${labelOf(next)}`);
          break;
        }
        case " ":
          e.preventDefault();
          toggleSeconds();
          showToast(showSeconds ? "已隐藏秒" : "已显示秒");
          break;
        case "escape":
          setSettingsOpen(false);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, showSeconds]);

  // 翻页卡尺寸:基于视口动态计算,在原值基础上整体放大约 2 倍(受视口约束)
  // cardH 加大使数字占卡片纵向约 60%(字形约 0.7em / 1.2em ≈ 58%)
  const cardFont = showSeconds ? "min(20vw, 34vh)" : "min(28vw, 46vh)";
  const cardW = showSeconds ? "0.62em" : "0.62em";
  const cardH = "1.2em";

  return (
    <main className="relative h-full w-full overflow-hidden" style={{ color: "var(--text-primary)" }}>
      <AmbientBackground mode={backgroundMode} />

      <ControlBar
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        onOpenSettings={() => setSettingsOpen(true)}
        onClose={handleClose}
        visible={controlsVisible || settingsOpen}
        closeVisible={closeBtnVisible}
      />

      {/* 时钟舞台 */}
      <div className="relative z-10 h-full w-full flex flex-col items-center justify-center select-none">
        <div
          className="animate-fade-in-up flex items-end justify-center"
          style={
            {
              "--card-font": cardFont,
              "--card-w": cardW,
              "--card-h": cardH,
              fontSize: cardFont,
            } as React.CSSProperties
          }
        >
          <FlipCardGroup value={time.hours} />
          <span style={{ width: "0.4em" }} aria-hidden />
          <FlipCardGroup value={time.minutes} />
          {showSeconds && (
            <>
              <span style={{ width: "0.4em" }} aria-hidden />
              <FlipCardGroup value={time.seconds} />
            </>
          )}
        </div>

        {showInfoBar && (
          <div className="mt-[10vh] animate-fade-in-up" style={{ animationDelay: "0.3s" }}>
            <InfoBar date={time.date} is24Hour={is24Hour} />
          </div>
        )}

        {/* 底部品牌细线 */}
        <div
          className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 transition-opacity duration-500"
          style={{ opacity: controlsVisible ? 0.6 : 0 }}
        >
          <span className="h-px w-10" style={{ background: "linear-gradient(90deg,transparent,var(--accent))" }} />
          <span className="text-[10px] tracking-[0.4em] uppercase" style={{ color: "var(--text-muted)", fontFamily: '"Oswald",sans-serif' }}>
            Flip Clock
          </span>
          <span className="h-px w-10" style={{ background: "linear-gradient(90deg,var(--accent),transparent)" }} />
        </div>
      </div>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Toast 提示 */}
      {toast && (
        <div
          key={toast}
          className="fixed bottom-16 left-1/2 z-50 px-5 py-2 rounded-full text-xs animate-toast glass-panel"
          style={{ color: "var(--text-primary)", transform: "translateX(-50%)" }}
        >
          {toast}
        </div>
      )}
    </main>
  );
}

function labelOf(theme: string): string {
  switch (theme) {
    case "amber":
      return "暖琥珀";
    case "minimal":
      return "晨雾白";
    case "midnight":
      return "午夜蓝";
    case "matrix":
      return "矩阵绿";
    case "noir":
      return "极简黑";
    case "pure":
      return "极简白";
    default:
      return theme;
  }
}
