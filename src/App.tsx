import ConfigPage from "@/pages/ConfigPage";
import Home from "@/pages/Home";

/**
 * 检测运行模式:
 * 1. 优先检查 window.__LAUNCH_MODE__(由 Tauri Rust 端 initialization_script 注入)
 * 2. 回退到 URL query ?mode=(浏览器/开发模式)
 *
 * - normal: 普通桌面应用(带完整交互控件)
 * - saver: 屏保运行态(纯展示,任意输入退出)
 * - config: 配置页(/c 模式)
 * - preview: 预览态(控制面板小窗,纯展示)
 */
function getMode(): "normal" | "saver" | "config" | "preview" {
  // Tauri 屏保模式:Rust 端通过 initialization_script 注入
  if (typeof window !== "undefined" && (window as unknown as Record<string, unknown>).__LAUNCH_MODE__ === "saver") {
    return "saver";
  }
  // 浏览器/开发模式:URL query
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");
  if (mode === "saver") return "saver";
  if (mode === "config") return "config";
  if (mode === "preview") return "preview";
  return "normal";
}

export default function App() {
  const mode = getMode();

  if (mode === "config") {
    return <ConfigPage />;
  }

  // saver 和 preview 隐藏交互控件;normal 保留完整 UI(开发用)
  return <Home saverMode={mode === "saver" || mode === "preview"} />;
}
