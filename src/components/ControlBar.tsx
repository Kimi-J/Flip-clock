import { Minimize, Settings, X } from "lucide-react";

interface ControlBarProps {
  onMinimize: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
  visible: boolean;
}

/** 按钮基础样式(统一 200ms 过渡,悬停缩放一致) */
const btnBase =
  "w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110";

export default function ControlBar({
  onMinimize,
  onOpenSettings,
  onClose,
  visible,
}: ControlBarProps) {
  return (
    // 单一按钮组:最小化 / 设置 / 关闭,同进同退
    <div
      className="fixed top-5 right-5 z-40 flex items-center gap-2 transition-opacity duration-300"
      style={{ opacity: visible ? 1 : 0, pointerEvents: visible ? "auto" : "none" }}
    >
      <button
        onClick={onMinimize}
        aria-label="最小化"
        className={btnBase}
        style={{
          color: "var(--text-secondary)",
          background: "var(--panel-bg)",
          border: "1px solid var(--panel-border)",
          backdropFilter: "blur(12px)",
        }}
      >
        <Minimize size={16} />
      </button>
      <button
        onClick={onOpenSettings}
        aria-label="设置"
        className={`${btnBase} hover:rotate-45`}
        style={{
          color: "var(--accent)",
          background: "var(--panel-bg)",
          border: "1px solid var(--panel-border)",
          backdropFilter: "blur(12px)",
        }}
      >
        <Settings size={16} />
      </button>
      <button
        onClick={onClose}
        aria-label="关闭"
        className={btnBase}
        style={{
          color: "var(--text-secondary)",
          background: "var(--panel-bg)",
          border: "1px solid var(--panel-border)",
          backdropFilter: "blur(12px)",
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
