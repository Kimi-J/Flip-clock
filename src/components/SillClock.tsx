import { SillFlipCardGroup } from "@/components/SillFlipCard";
import type { ClockTime } from "@/hooks/useClockTime";

const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

interface SillClockProps {
  time: ClockTime;
  /** 全屏设置:显示秒(与 InfoBar 的 showInfoBar 各自独立) */
  showSeconds: boolean;
  /** 显示日期信息(关 → 柜体 date-plaque 折叠收起,卡片放大) */
  showInfoBar: boolean;
}

/**
 * 林间小屋钟柜(v5)——胡桃木壁挂柜:四角黄铜螺帽 + 品牌行 + 三组翻页卡
 * (双翻片折叠,SillFlipCard)+ 黄铜分隔点 + 底部日期铭牌。
 * 不渲染项目通用 InfoBar:日期即柜内铭牌(date-chip),由 showInfoBar 控制显隐。
 */
export default function SillClock({ time, showSeconds, showInfoBar }: SillClockProps) {
  const d = time.date;
  const dateText = `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, "0")}月${String(
    d.getDate(),
  ).padStart(2, "0")}日 · ${WEEKDAYS[d.getDay()]}`;

  return (
    <div className="clock-wrap" aria-label="林间小屋翻页时钟">
      <div
        className={`clock-cabinet${showSeconds ? "" : " no-seconds"}${
          showInfoBar ? "" : " no-date"
        }`}
      >
        <span className="cabinet-screw s1" aria-hidden="true" />
        <span className="cabinet-screw s2" aria-hidden="true" />
        <span className="cabinet-screw s3" aria-hidden="true" />
        <span className="cabinet-screw s4" aria-hidden="true" />

        <div className="brand-row" aria-hidden="true">
          <span className="brand-mark">Wildwood Cabin / No. 07</span>
          <span className="local-note">Local cabin time</span>
        </div>

        <div className="time-row">
          <SillFlipCardGroup value={time.hours} />
          <div className="separator hours-sep" aria-hidden="true" />
          <SillFlipCardGroup value={time.minutes} />
          <div className="separator seconds-sep" aria-hidden="true" />
          <SillFlipCardGroup value={time.seconds} className="seconds-slot" />
        </div>

        <div className="date-plaque">
          <div className="date-chip">{dateText}</div>
        </div>
      </div>
    </div>
  );
}
