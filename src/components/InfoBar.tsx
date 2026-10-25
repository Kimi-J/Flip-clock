import { useMemo } from "react";
import type { ThemeName } from "@/store/clockStore";

interface InfoBarProps {
  date: Date;
  is24Hour: boolean;
  /** 当前主题(仅 sill 使用:第二行显示轮换治愈小句子替代常规问候) */
  theme?: ThemeName;
}

const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

/** 林间小屋:治愈小句子(每小时轮换一句——手写体的最大价值是承载文字内容,
 *  一句小标语比任何装饰都治愈;具体有画面,不喊口号) */
const HEALING_QUOTES = [
  "今天也要慢慢走",
  "去晒晒太阳吧",
  "风会记得每一片叶子",
  "把日子过成散步",
  "晚一点也没关系",
  "先喝口水，再继续",
  "树在长高，不着急",
  "留一点时间给黄昏",
  "苔藓也在认真生活",
  "雨停了就出门走走",
  "把窗开一条缝",
  "今天已经很好了",
];

function greeting(h: number): string {
  if (h < 5) return "夜深了,注意休息";
  if (h < 9) return "早安,新的一天";
  if (h < 12) return "上午好,保持专注";
  if (h < 14) return "午安,稍作休息";
  if (h < 18) return "下午好,继续加油";
  if (h < 22) return "晚上好,放松一下";
  return "夜安,好梦";
}

export default function InfoBar({ date, is24Hour, theme }: InfoBarProps) {
  const dateText = useMemo(() => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}年${m}月${d}日`;
  }, [date]);

  const week = WEEKDAYS[date.getDay()];
  const period = is24Hour ? "" : date.getHours() >= 12 ? "PM" : "AM";
  // 治愈句按小时轮换;key 变化触发重挂载,配合 CSS 淡入 0.6s
  const quote = HEALING_QUOTES[date.getHours() % HEALING_QUOTES.length];
  const secondLine = theme === "sill" ? quote : greeting(date.getHours());

  return (
    <div
      className="flex flex-col items-center gap-3 select-none"
      style={{ fontSize: "clamp(6px, calc(var(--card-font, 100px) * 0.048), 18px)" }}
    >
      <div className="info-row flex items-center gap-4" style={{ fontFamily: '"Oswald","Noto Sans SC",sans-serif' }}>
        <span className="info-date" style={{ color: "var(--text-secondary)", letterSpacing: "0.12em" }}>{dateText}</span>
        <span
          className="info-badge px-3 py-0.5 rounded-full"
          style={{
            color: "var(--badge-text, var(--accent))",
            background: "var(--badge-bg, var(--accent-soft))",
            border: "1px solid var(--badge-border, var(--panel-border))",
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
        key={secondLine}
        className={`info-greet${theme === "sill" ? " info-quote" : ""}`}
        style={{ color: "var(--text-muted)", letterSpacing: "0.32em", fontFamily: '"Noto Sans SC",sans-serif', fontSize: "0.75em" }}
      >
        {secondLine}
      </div>
    </div>
  );
}
