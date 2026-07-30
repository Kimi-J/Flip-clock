import ConfigPage from "@/pages/ConfigPage";
import Home from "@/pages/Home";

/**
 * 根据 URL query ?mode= 区分运行模式:
 * - 无 query:普通模式(开发/浏览器直接访问,带完整交互控件)
 * - mode=saver:屏保运行态(纯展示,由宿主处理退出)
 * - mode=config:配置页(/c 模式)
 * - mode=preview:预览态(控制面板小窗,纯展示)
 */
function getMode(): "normal" | "saver" | "config" | "preview" {
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
