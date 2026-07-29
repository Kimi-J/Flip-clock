import { useEffect, useRef, useState } from "react";

interface FlipCardProps {
  /** 当前显示的数字 0-9 */
  value: number;
}

/**
 * 单个翻页卡:单片双面 180° 连续翻转。
 *
 * 结构:
 *  - 静态上半卡:始终显示 current 的上半(翻转开始时立即变新值,被翻片正面遮挡)
 *  - 静态下半卡:翻转中显示 previous(旧值下半),结束后变 current(新值下半)
 *  - 翻片(翻转时存在):绕中线连续旋转 0 → 180deg
 *      · 正面(0°朝外,位于上半):显示 previous 旧值上半
 *      · 背面(180°朝外,位于下半):显示 current 新值下半
 *
 * 时序:
 *  0°→90° :翻片正面旧值上半遮挡上半卡;下半卡仍是旧值下半 → 观众看到完整旧值
 *  90°→180°:翻片翻过中线,正面消失,上半卡新值上半露出;翻片背面新值下半朝外覆盖下半卡 → 观众看到完整新值
 *  结束    :移除翻片,上下半卡均为新值
 */
export default function FlipCard({ value }: FlipCardProps) {
  const [current, setCurrent] = useState(value);
  const [previous, setPrevious] = useState(value);
  const [flipping, setFlipping] = useState(false);
  const timerRef = useRef<number>(0);

  useEffect(() => {
    if (value === current) return;
    setPrevious(current);
    setCurrent(value); // 上半卡立即变新值(被翻片正面遮挡,观众不可见)
    setFlipping(true);
    timerRef.current = window.setTimeout(() => {
      setFlipping(false); // 下半卡此时回到 current
    }, 600);
    return () => clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <span className="flip-unit" aria-label={String(current)}>
      {/* 静态上半卡:显示新值上半 */}
      <span className="flip-static flip-static--top">
        <span className="flip-static__digit">{current}</span>
      </span>
      {/* 静态下半卡:翻转中显旧值下半,结束后显新值下半 */}
      <span className="flip-static flip-static--bottom">
        <span className="flip-static__digit">{flipping ? previous : current}</span>
      </span>

      {flipping && (
        <span className="flip-leaf is-flipping">
          {/* 正面:旧值上半 */}
          <span className="flip-leaf__face flip-leaf__face--front">
            <span className="flip-leaf__digit">{previous}</span>
          </span>
          {/* 背面:新值下半 */}
          <span className="flip-leaf__face flip-leaf__face--back">
            <span className="flip-leaf__digit">{current}</span>
          </span>
        </span>
      )}
    </span>
  );
}
