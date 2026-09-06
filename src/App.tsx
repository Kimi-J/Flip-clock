import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import ConfigPage from "@/pages/ConfigPage";
import Home from "@/pages/Home";
import WidgetPage from "@/pages/WidgetPage";
import { useClockStore, type ClockSettings } from "@/store/clockStore";

/**
 * 检测运行模式:
 * 1. 优先检查 window.__LAUNCH_MODE__(由 Tauri Rust 端 initialization_script 注入)
 * 2. 回退到 URL query ?mode=(浏览器/开发模式)
 *
 * - normal: 普通桌面应用(带完整交互控件)
 * - saver: 屏保运行态(纯展示,任意输入退出)
 * - config: 配置页(/c 模式)
 * - preview: 预览态(控制面板小窗,纯展示)
 * - widget: 桌面小部件(置顶票根小窗,拖拽移动)
 */
function getMode(): "normal" | "saver" | "config" | "preview" | "widget" {
  // Tauri 注入(屏保/小部件):Rust 端通过 initialization_script 注入
  if (typeof window !== "undefined") {
    const injected = (window as unknown as Record<string, unknown>).__LAUNCH_MODE__;
    if (injected === "saver") return "saver";
    if (injected === "widget") return "widget";
  }
  // 浏览器/开发模式:URL query
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");
  if (mode === "saver") return "saver";
  if (mode === "config") return "config";
  if (mode === "preview") return "preview";
  if (mode === "widget") return "widget";
  return "normal";
}

export default function App() {
  const mode = getMode();

  // 多窗口设置同步:任一窗口修改设置后,其余窗口即时应用。
  // 事件携带完整设置快照,不依赖各窗口 localStorage 的可见性时序。
  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | undefined;
    listen<ClockSettings>("settings-sync", (e) => {
      useClockStore.getState().rehydrate(e.payload);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      unlisten?.();
    };
  }, []);

  if (mode === "config") {
    return <ConfigPage />;
  }

  if (mode === "widget") {
    return <WidgetPage />;
  }

  // saver 和 preview 隐藏交互控件;normal 保留完整 UI(开发用)
  return <Home saverMode={mode === "saver" || mode === "preview"} />;
}
