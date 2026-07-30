import { Maximize, Minimize, Settings, X } from "lucide-react";

interface ControlBarProps {
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
  visible: boolean;
  closeVisible: boolean;
}

export default function ControlBar({
  isFullscreen,
  onToggleFullscreen,
  onOpenSettings,
  onClose,
  visible,
  closeVisible,
}: ControlBarProps) {
  return (
    <>
      {/* 关闭按钮:鼠标移入右上角区域时显示 */}
      <button
        onClick={onClose}
        aria-label="关闭"
        className="fixed top-5 right-5 z-40 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 hover:scale-110"
        style={{
          opacity: closeVisible ? 1 : 0,
          pointerEvents: closeVisible ? "auto" : "none",
          color: "var(--text-secondary)",
          background: "var(--panel-bg)",
          border: "1px solid var(--panel-border)",
          backdropFilter: "blur(12px)",
        }}
      >
        <X size={16} />
      </button>

      {/* 全屏 + 设置:鼠标活动时显示 */}
      <div
        className="fixed top-5 right-[68px] z-30 flex items-center gap-2 transition-opacity duration-500"
        style={{ opacity: visible ? 1 : 0, pointerEvents: visible ? "auto" : "none" }}
      >
        <button
          onClick={onToggleFullscreen}
          aria-label={isFullscreen ? "退出全屏" : "全屏"}
          className="w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-110"
          style={{
            color: "var(--text-secondary)",
            background: "var(--panel-bg)",
            border: "1px solid var(--panel-border)",
            backdropFilter: "blur(12px)",
          }}
        >
          {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
        </button>
        <button
          onClick={onOpenSettings}
          aria-label="设置"
          className="w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-110 hover:rotate-45"
          style={{
            color: "var(--accent)",
            background: "var(--panel-bg)",
            border: "1px solid var(--panel-border)",
            backdropFilter: "blur(12px)",
          }}
        >
          <Settings size={16} />
        </button>
      </div>
    </>
  );
}
