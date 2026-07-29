import { Maximize, Minimize, Settings } from "lucide-react";

interface ControlBarProps {
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onOpenSettings: () => void;
  visible: boolean;
}

export default function ControlBar({
  isFullscreen,
  onToggleFullscreen,
  onOpenSettings,
  visible,
}: ControlBarProps) {
  return (
    <div
      className="fixed top-5 right-5 z-30 flex items-center gap-2 transition-opacity duration-500"
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
  );
}
