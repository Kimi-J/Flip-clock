import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useClockStore, WIDGET_SKIN_OPTIONS, type WidgetSkinName } from "@/store/clockStore";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * 小窗弹出设置菜单:独立置顶小窗(wmenu-),可超出小窗本体边界完整显示。
 * - 打开即聚焦;失焦(点击菜单外任意处)/Esc/点击四周留白 → 自关
 * - 显示秒/皮肤切换即时生效(settings-sync 广播到小窗窗口),菜单保持打开
 * - 回全屏:先自关再切换形态;退出:exit_app 关闭整个进程
 * - 复用 .widget-menu 样式与 data-skin 配色选择器(与皮肤联动)
 */
export default function WidgetMenuPage() {
  const { widgetShowSeconds, toggleWidgetSeconds, widgetSkin, setWidgetSkin } = useClockStore();

  const closeSelf = () => {
    if (isTauri) getCurrentWindow().close().catch(() => {});
  };

  // 透明窗口:html/body/#root 必须透明(四周留白供 CSS 阴影)
  useEffect(() => {
    const root = document.getElementById("root");
    const prev = [document.documentElement.style.background, document.body.style.background, root?.style.background ?? ""];
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    if (root) root.style.background = "transparent";
    return () => {
      document.documentElement.style.background = prev[0];
      document.body.style.background = prev[1];
      if (root) root.style.background = prev[2];
    };
  }, []);

  // 失焦/Esc 自关(点击菜单外任意处即失焦,等效"点击外部关闭")
  useEffect(() => {
    if (!isTauri) return;
    let un: (() => void) | undefined;
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (!focused) closeSelf();
      })
      .then((fn) => {
        un = fn;
      })
      .catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSelf();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      un?.();
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const selectSkin = (skin: WidgetSkinName) => {
    setWidgetSkin(skin);
    if (isTauri) invoke("set_widget_skin", { skin }).catch(() => {});
  };

  const backToFullscreen = () => {
    if (!isTauri) return;
    // 先落命令再自关:窗口销毁会中断未完成的 invoke
    invoke("set_window_mode", { mode: "fullscreen" })
      .catch(() => {})
      .finally(() => closeSelf());
  };

  const exitApp = () => {
    if (isTauri) invoke("exit_app").catch(() => {});
  };

  return (
    <div
      className="widget-root wmenu-root"
      data-skin={widgetSkin}
      onClick={(e) => {
        // 点击菜单内容之外的透明留白 = 关闭
        if (e.target === e.currentTarget) closeSelf();
      }}
    >
      <div className="widget-menu wmenu-pop" role="menu">
        <button role="menuitemcheckbox" aria-checked={widgetShowSeconds} onClick={toggleWidgetSeconds}>
          <span className="widget-menu__tick">{widgetShowSeconds ? "✓" : ""}</span>
          显示秒
        </button>
        {WIDGET_SKIN_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            role="menuitemradio"
            aria-checked={widgetSkin === opt.value}
            onClick={() => selectSkin(opt.value)}
          >
            <span className="widget-menu__tick">{widgetSkin === opt.value ? "✓" : ""}</span>
            皮肤 · {opt.label}
          </button>
        ))}
        <button role="menuitem" onClick={backToFullscreen}>
          <span className="widget-menu__tick" />
          回到全屏
        </button>
        <button role="menuitem" onClick={exitApp}>
          <span className="widget-menu__tick" />
          退出
        </button>
      </div>
    </div>
  );
}
