import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import AmbientBackground from "@/components/AmbientBackground";
import ControlBar from "@/components/ControlBar";
import FlipCardGroup from "@/components/FlipCardGroup";
import InfoBar from "@/components/InfoBar";
import SettingsPanel from "@/components/SettingsPanel";
import { useClockTime } from "@/hooks/useClockTime";
import { THEME_OPTIONS, useClockStore } from "@/store/clockStore";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

interface HomeProps {
  /** 屏保运行态:隐藏所有交互控件,纯展示,任意输入退出 */
  saverMode?: boolean;
}

export default function Home({ saverMode = false }: HomeProps) {
  const { is24Hour, showSeconds, showInfoBar, backgroundMode, theme, toggleSeconds, setTheme } = useClockStore();
  const time = useClockTime(is24Hour);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const hideTimer = useRef<number>(0);
  const toastTimer = useRef<number>(0);

  // 控制按钮组:任意鼠标活动显示,静止 4s 后隐藏;鼠标在右上角控制区内不隐藏
  useEffect(() => {
    if (saverMode) {
      // 屏保模式:任意鼠标移动/点击/按键即退出
      let lastX = -1, lastY = -1;
      const onMove = (e: MouseEvent) => {
        if (lastX < 0) { lastX = e.clientX; lastY = e.clientY; return; }
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        if (Math.sqrt(dx * dx + dy * dy) > 3) exitSaver();
      };
      const onClick = () => exitSaver();
      const onKey = () => exitSaver();
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mousedown", onClick);
      window.addEventListener("keydown", onKey);
      return () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mousedown", onClick);
        window.removeEventListener("keydown", onKey);
      };
    }
    // 鼠标在右上角控制区(180×100,覆盖按钮组+余量)内时不自动隐藏
    const inCorner = (x: number, y: number) => x > window.innerWidth - 180 && y < 100;
    const onMove = (e: MouseEvent) => {
      // 光标同步恢复(直接操作样式,不等 React 渲染,避免首次移动不出现)
      document.body.style.cursor = "";
      setControlsVisible(true);
      clearTimeout(hideTimer.current);
      if (!inCorner(e.clientX, e.clientY)) {
        hideTimer.current = window.setTimeout(() => setControlsVisible(false), 4000);
      }
    };
    const onTouch = () => {
      setControlsVisible(true);
      clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setControlsVisible(false), 4000);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchstart", onTouch);
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 4000);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchstart", onTouch);
      clearTimeout(hideTimer.current);
    };
  }, [saverMode]);

  // 光标隐藏:与控制条共用同一计时/区域逻辑——静止 4s 隐藏,任意鼠标活动立即恢复,右上角控制区内不隐藏
  // CSS cursor:none 由 Chromium 的 WM_SETCURSOR 链路在 WebView 客户区(=整个全屏窗口)生效,鼠标移出窗口/失焦由系统自动恢复
  useEffect(() => {
    if (saverMode) return;
    const show = controlsVisible || settingsOpen;
    document.body.style.cursor = show ? "" : "none";
    return () => {
      document.body.style.cursor = "";
    };
  }, [controlsVisible, settingsOpen, saverMode]);

  // 应用主题到 html 节点
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const exitSaver = () => {
    if (isTauri) {
      // 屏保多窗口模式:退出整个进程,一次性关闭所有显示器上的窗口
      invoke("exit_saver").catch(() => {});
    } else {
      window.close();
    }
  };

  const handleMinimize = () => {
    if (isTauri) {
      getCurrentWindow().minimize().catch(() => {});
    }
  };

  const handleClose = () => {
    if (isTauri) {
      // 用户主动点 X:退出整个进程,关闭所有显示器上的窗口。
      // 不能用 getCurrentWindow().close()——那只关当前窗口,其他显示器残留
      invoke("exit_app").catch(() => {});
    } else {
      window.close();
    }
  };

  const showToast = (msg: string) => {
    clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  };

  // 键盘快捷键(屏保模式下禁用)
  useEffect(() => {
    if (saverMode) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      switch (e.key.toLowerCase()) {
        case "s":
          setSettingsOpen((v) => !v);
          break;
        case "t": {
          // 与设置面板同序:直接复用 THEME_OPTIONS,避免两处维护不同步
          const order = THEME_OPTIONS.map((o) => o.value);
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
  }, [theme, showSeconds, saverMode]);

  // 翻页卡尺寸:基于视口动态计算,在原值基础上整体放大约 2 倍(受视口约束)
  // cardH 加大使数字占卡片纵向约 60%(字形约 0.7em / 1.2em ≈ 58%)
  // 加 max 下限:屏保预览窗口(控制面板小显示器)视口极小,避免时间缩到不可读
  // voxel 主题:字号等比缩小 25%(Press Start 2P 视觉偏大),但卡片尺寸保持不变
  //   → cardW/cardH 改用 px(基于 cardFontBase 计算),不随字号缩放;
  //   → cardFont 单独缩小,只影响数字大小;
  //   → 其他主题 cardW/cardH 仍用 em(随字号等比缩放,保持原行为)
  const voxelScale = theme === "voxel" ? 0.88 : 1;
  const cardFontBase = showSeconds ? "max(32px, min(20vw, 34vh))" : "max(48px, min(28vw, 46vh))";
  const cardFont = voxelScale !== 1 ? `calc(${cardFontBase} * ${voxelScale})` : cardFontBase;
  // voxel 用 px 绝对单位(基于未缩放的 cardFontBase),卡片尺寸保持和其他主题一致
  const cardW = theme === "voxel" ? `calc(${cardFontBase} * 0.62)` : showSeconds ? "0.62em" : "0.62em";
  const cardH = theme === "voxel" ? `calc(${cardFontBase} * 1.2)` : "1.2em";

  return (
    <main
      className="relative h-full w-full overflow-hidden"
      style={
        {
          color: "var(--text-primary)",
          "--card-font": cardFont,
        } as React.CSSProperties
      }
    >
      <AmbientBackground mode={backgroundMode} />

      {!saverMode && (
        <ControlBar
          onMinimize={handleMinimize}
          onOpenSettings={() => setSettingsOpen(true)}
          onClose={handleClose}
          visible={controlsVisible || settingsOpen}
        />
      )}

      {/* 时钟舞台 */}
      <div className="relative z-10 h-full w-full flex flex-col items-center justify-center select-none">
        <div
          className="animate-fade-in-up flex items-end justify-center"
          style={
            {
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

        {/* 底部品牌细线(仅非屏保模式) */}
        {!saverMode && (
          <div
            className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 transition-opacity duration-300"
            style={{ opacity: controlsVisible ? 0.6 : 0 }}
          >
            <span className="h-px w-10" style={{ background: "linear-gradient(90deg,transparent,var(--accent))" }} />
            <span className="text-[10px] tracking-[0.4em] uppercase" style={{ color: "var(--text-muted)", fontFamily: '"Oswald",sans-serif' }}>
              Flip Clock
            </span>
            <span className="h-px w-10" style={{ background: "linear-gradient(90deg,var(--accent),transparent)" }} />
          </div>
        )}
      </div>

      {!saverMode && <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />}

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
    case "voxel":
      return "像素界";
    case "synthwave":
      return "霓虹波";
    case "ink":
      return "水墨韵";
    case "clay":
      return "奶芙紫";
    default:
      return theme;
  }
}
