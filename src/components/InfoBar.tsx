import { useMemo } from "react";

interface InfoBarProps {
  date: Date;
  is24Hour: boolean;
}

const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

function greeting(h: number): string {
  if (h < 5) return "夜深了,注意休息";
  if (h < 9) return "早安,新的一天";
  if (h < 12) return "上午好,保持专注";
  if (h < 14) return "午安,稍作休息";
  if (h < 18) return "下午好,继续加油";
  if (h < 22) return "晚上好,放松一下";
  return "夜安,好梦";
}

export default function InfoBar({ date, is24Hour }: InfoBarProps) {
  const dateText = useMemo(() => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}年${m}月${d}日`;
  }, [date]);

  const week = WEEKDAYS[date.getDay()];
  const period = is24Hour ? "" : date.getHours() >= 12 ? "PM" : "AM";
  const greet = greeting(date.getHours());

  return (
    <div
      className="flex flex-col items-center gap-3 select-none"
      style={{ fontSize: "clamp(6px, calc(var(--card-font, 100px) * 0.048), 18px)" }}
    >
      <div className="flex items-center gap-4" style={{ fontFamily: '"Oswald","Noto Sans SC",sans-serif' }}>
        <span style={{ color: "var(--text-secondary)", letterSpacing: "0.12em" }}>{dateText}</span>
        <span
          className="px-3 py-0.5 rounded-full"
          style={{
            color: "var(--accent)",
            background: "var(--accent-soft)",
            border: "1px solid var(--panel-border)",
            letterSpacing: "0.08em",
            fontSize: "0.85em",
          }}
        >
          {week}
        </span>
        {period && (
          <span style={{ color: "var(--text-secondary)", letterSpacing: "0.2em", fontFamily: '"Anton",sans-serif' }}>
            {period}
          </span>
        )}
      </div>
      <div
        style={{ color: "var(--text-muted)", letterSpacing: "0.32em", fontFamily: '"Noto Sans SC",sans-serif', fontSize: "0.75em" }}
      >
        {greet}
      </div>
    </div>
  );
}
