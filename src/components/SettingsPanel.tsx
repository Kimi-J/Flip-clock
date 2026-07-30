import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import {
  BACKGROUND_OPTIONS,
  THEME_OPTIONS,
  useClockStore,
} from "@/store/clockStore";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const {
    theme,
    is24Hour,
    showSeconds,
    showInfoBar,
    backgroundMode,
    screensaverEnabled,
    setTheme,
    toggle24Hour,
    toggleSeconds,
    toggleInfoBar,
    setBackgroundMode,
    setScreensaverEnabled,
  } = useClockStore();

  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const [ssStatus, setSsStatus] = useState<string | null>(null);

  // 初始化时检查屏保注册状态
  useEffect(() => {
    if (!isTauri || !open) return;
    invoke<boolean>("is_screensaver_registered")
      .then((registered) => {
        if (registered !== screensaverEnabled) {
          setScreensaverEnabled(registered);
        }
      })
      .catch(() => {});
  }, [open]);

  const handleScreensaverToggle = () => {
    if (!isTauri) return;
    const next = !screensaverEnabled;
    setSsStatus(null);
    if (next) {
      invoke<string>("register_screensaver")
        .then(() => {
          setScreensaverEnabled(true);
          setSsStatus("屏保已启用");
        })
        .catch((e) => setSsStatus(`启用失败: ${e}`));
    } else {
      invoke("unregister_screensaver")
        .then(() => {
          setScreensaverEnabled(false);
          setSsStatus("屏保已关闭");
        })
        .catch((e) => setSsStatus(`关闭失败: ${e}`));
    }
  };

  // 延迟卸载 + transition 过渡(打开/关闭都有平滑动画)
  // render: 是否挂载 DOM;shown: 是否处于可见态(触发 transition)
  const [render, setRender] = useState(open);
  const [shown, setShown] = useState(false);
  const rafCleanup = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      setRender(true);
      // 双 rAF:第一帧提交初始态(opacity:0),第二帧再激活 shown 触发过渡
      const raf1 = requestAnimationFrame(() => {
        const raf2 = requestAnimationFrame(() => setShown(true));
        // 保存 raf2 用于清理(挂到闭包外的 ref)
        rafCleanup.current = raf2;
      });
      return () => {
        cancelAnimationFrame(raf1);
        if (rafCleanup.current) cancelAnimationFrame(rafCleanup.current);
      };
    } else if (render) {
      setShown(false);
      const t = window.setTimeout(() => setRender(false), 300);
      return () => clearTimeout(t);
    }
  }, [open, render]);

  if (!render) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="设置">
      <div
        className="absolute inset-0 transition-opacity duration-300 ease-out"
        onClick={onClose}
        style={{
          background: "rgba(0,0,0,0.35)",
          opacity: shown ? 1 : 0,
        }}
      />
      <aside
        className="relative h-full w-[340px] max-w-[88vw] glass-panel overflow-y-auto transition-all duration-300 ease-out"
        style={{
          borderLeft: "1px solid var(--panel-border)",
          opacity: shown ? 1 : 0,
          transform: shown ? "translateX(0)" : "translateX(40px)",
        }}
      >
        <header className="sticky top-0 flex items-center justify-between px-6 py-5" style={{ background: "var(--panel-bg)", borderBottom: "1px solid var(--panel-border)" }}>
          <h2 className="text-sm tracking-[0.3em] uppercase" style={{ color: "var(--text-primary)", fontFamily: '"Oswald",sans-serif' }}>
            Settings
          </h2>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
            style={{ color: "var(--text-secondary)" }}
          >
            <X size={16} />
          </button>
        </header>

        <div className="p-6 space-y-8">
          {/* 主题 */}
          <Section title="主题">
            <div className="grid grid-cols-2 gap-3">
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setTheme(opt.value)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all"
                  style={{
                    background: theme === opt.value ? "var(--accent-soft)" : "transparent",
                    border: `1px solid ${theme === opt.value ? "var(--accent)" : "var(--panel-border)"}`,
                  }}
                >
                  <span className="w-6 h-6 rounded-full shrink-0" style={{ background: opt.swatch, boxShadow: "0 1px 4px rgba(0,0,0,0.3)" }} />
                  <span className="text-xs" style={{ color: "var(--text-primary)" }}>{opt.label}</span>
                </button>
              ))}
            </div>
          </Section>

          {/* 制式 */}
          <Section title="时间制式">
            <ToggleRow label="24 小时制" checked={is24Hour} onChange={toggle24Hour} />
          </Section>

          {/* 显示项 */}
          <Section title="显示项">
            <ToggleRow label="显示秒" checked={showSeconds} onChange={toggleSeconds} />
            <ToggleRow label="显示日期信息" checked={showInfoBar} onChange={toggleInfoBar} />
          </Section>

          {/* 背景 */}
          <Section title="背景效果">
            <div className="flex gap-2">
              {BACKGROUND_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setBackgroundMode(opt.value)}
                  className="flex-1 py-2 rounded-lg text-xs transition-all"
                  style={{
                    color: backgroundMode === opt.value ? "var(--bg-from)" : "var(--text-secondary)",
                    background: backgroundMode === opt.value ? "var(--accent)" : "transparent",
                    border: `1px solid ${backgroundMode === opt.value ? "var(--accent)" : "var(--panel-border)"}`,
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </Section>

          {/* 屏幕保护程序 */}
          <Section title="屏幕保护程序">
            <ToggleRow
              label="启用屏幕保护程序"
              checked={screensaverEnabled}
              onChange={handleScreensaverToggle}
            />
            {ssStatus && (
              <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>{ssStatus}</p>
            )}
            {screensaverEnabled && (
              <p className="text-[10px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                系统空闲后将自动启动翻页时钟屏保,移动鼠标或按任意键退出。
              </p>
            )}
          </Section>

          {/* 快捷键提示 */}
          <Section title="快捷键">
            <ul className="space-y-2 text-xs" style={{ color: "var(--text-secondary)" }}>
              <li className="flex justify-between">
                <span>设置</span>
                <Kbd>S</Kbd>
              </li>
              <li className="flex justify-between">
                <span>切换主题</span>
                <Kbd>T</Kbd>
              </li>
              <li className="flex justify-between">
                <span>显示/隐藏秒</span>
                <Kbd>Space</Kbd>
              </li>
              <li className="flex justify-between">
                <span>关闭面板</span>
                <Kbd>Esc</Kbd>
              </li>
            </ul>
          </Section>
        </div>
      </aside>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[11px] tracking-[0.25em] uppercase mb-3" style={{ color: "var(--text-muted)", fontFamily: '"Oswald",sans-serif' }}>
        {title}
      </h3>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs" style={{ color: "var(--text-primary)" }}>{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        className="relative w-11 h-6 rounded-full transition-colors shrink-0"
        style={{ background: checked ? "var(--accent)" : "var(--panel-border)" }}
      >
        <span
          className="absolute top-1/2 left-0.5 w-5 h-5 rounded-full bg-white transition-transform"
          style={{
            transform: `translateY(-50%) translateX(${checked ? "20px" : "0px"})`,
            boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
          }}
        />
      </button>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className="px-2 py-0.5 rounded text-[10px]"
      style={{
        color: "var(--text-primary)",
        background: "var(--panel-border)",
        border: "1px solid var(--panel-border)",
        fontFamily: '"Oswald",monospace',
      }}
    >
      {children}
    </kbd>
  );
}
