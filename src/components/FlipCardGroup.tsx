import FlipCard, { type FlipVariant } from "./FlipCard";

interface FlipCardGroupProps {
  /** 要显示的数值(0-99) */
  value: number;
  /** 动画变体(透传给 FlipCard):gummy 控制翻页时长与落地余韵,默认经典翻页 */
  variant?: FlipVariant;
}

/**
 * 一组翻页卡(两位数),自动补零。
 */
export default function FlipCardGroup({ value, variant }: FlipCardGroupProps) {
  const v = Math.max(0, Math.min(99, Math.floor(value)));
  const tens = Math.floor(v / 10);
  const ones = v % 10;

  return (
    <span className="inline-flex" style={{ gap: "0.04em" }}>
      <FlipCard value={tens} variant={variant} />
      <FlipCard value={ones} variant={variant} />
    </span>
  );
}
