import FlipCard from "./FlipCard";

interface FlipCardGroupProps {
  /** 要显示的数值(0-99) */
  value: number;
}

/**
 * 一组翻页卡(两位数),自动补零。
 */
export default function FlipCardGroup({ value }: FlipCardGroupProps) {
  const v = Math.max(0, Math.min(99, Math.floor(value)));
  const tens = Math.floor(v / 10);
  const ones = v % 10;

  return (
    <span className="inline-flex" style={{ gap: "0.04em" }}>
      <FlipCard value={tens} />
      <FlipCard value={ones} />
    </span>
  );
}
