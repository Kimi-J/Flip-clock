import { useEffect } from "react";
import {
  BACKGROUND_OPTIONS,
  THEME_OPTIONS,
  useClockStore,
} from "@/store/clockStore";

/**
 * 屏保配置页(/c 模式)。
 * 独立全页面,直接展示所有设置项,供 C# 宿主配置窗口加载。
 */
export default function ConfigPage() {
  const {
    theme,
    is24Hour,
    showSeconds,
    showInfoBar,
    backgroundMode,
    setTheme,
    toggle24Hour,
    toggleSeconds,
    toggleInfoBar,
    setBackgroundMode,
  } = useClockStore();

  // 应用主题
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return (
    <div className="min-h-screen w-full flex items-start justify-center py-12 px-4" style={{ background: "var(--bg-from)", color: "var(--text-primary)" }}>
      <div className="w-full max-w-md space-y-8">
        <header className="text-center">
          <h1 className="text-lg tracking-[0.3em] uppercase" style={{ fontFamily: '"Oswald",sans-serif' }}>
            Flip Clock 设置
          </h1>
        </header>

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
                <span className="text-xs">{opt.label}</span>
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
      </div>
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
      <span className="text-xs">{label}</span>
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
