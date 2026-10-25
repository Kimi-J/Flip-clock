import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

/**
 * 林间小屋专属翻页卡(v5)——双翻片折叠机械结构,与经典单叶 180° 翻转不同:
 *  - 上翻片(top-flap):旧值上半,0.32s 向前向下折下(rotateX 0→-90°,origin bottom)
 *  - 下翻片(bottom-flap):新值下半,延迟 0.30s,0.42s 展开(rotateX 90°→0°,origin top)
 *  - 静态上半卡:翻页开始即换新值(被上翻片遮挡,观众不可见)
 *  - 静态下半卡:整个翻页期保持旧值,由下翻片自上而下"盖棺"——
 *    落幕(760ms)与翻片卸载同帧,静态卡翻到新值,零内容跳变
 *
 * 三个工程要点(踩坑修复,对齐本项目成熟主题 FlipCard/gummy):
 * 1. 同帧提交:文本切换(setState)与 is-flipping class 挂载必须在同一帧。
 *    flushSync 强制同步渲染后立刻挂 class——否则中间会露出一帧
 *    "上新半 + 下旧半"的半新半旧卡面,即用户感知的"翻页数字抽搐一下"。
 * 2. 翻片条件挂载:随 flipping 状态 mount/unmount(同 FlipCard 的 flip-leaf),
 *    不搞"常驻 + opacity:0"。静态文字自始至终以同一种抗锯齿方式渲染,
 *    避免合成层灰度 AA 与静态次像素 AA 在落幕揭开瞬间的亮度差。
 * 3. 受光静态化:卡面(背景/描边/inset)由静态面规则逐像素共用,
 *    运动明暗只由翻片内遮罩层 opacity 供给且终帧归零——
 *    不动画 filter/box-shadow(gummy 注释原话:"翻片带外影会在落定卸载时骤减")。
 */
interface SillFlipCardProps {
  /** 单位数字 0-9 */
  value: number;
}

export default function SillFlipCard({ value }: SillFlipCardProps) {
  const [shown, setShown] = useState(value);
  const [prev, setPrev] = useState(value);
  const [flipping, setFlipping] = useState(false);
  const timersRef = useRef<number[]>([]);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value === shown) return;
    const timers = timersRef.current;
    // 1) 同帧提交文本;2) 同步挂 is-flipping(先摘再强制回流重启动画,
    //    覆盖上一轮未播完就被打断的情况);两步之间无绘制,杜绝抽搐帧
    flushSync(() => {
      setPrev(shown);
      setShown(value);
      setFlipping(true);
    });
    const el = cardRef.current;
    if (el) {
      el.classList.remove("is-flipping");
      void el.offsetWidth;
      el.classList.add("is-flipping");
    }
    timers.push(
      window.setTimeout(() => {
        // 落幕与翻片卸载同帧:静态下半卡此时翻到新值,且其卡面与下翻片
        // 逐像素一致(共用面规则),揭开零亮度跳变
        flushSync(() => setFlipping(false));
        cardRef.current?.classList.remove("is-flipping");
      }, 760),
    );
    return () => {
      timers.forEach(clearTimeout);
      timersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div ref={cardRef} className="flip-card" aria-label={String(shown)}>
      <div className="card-body">
        {/* 静态上半卡:新值(翻页中立即可见,被上翻片折叠遮挡) */}
        <div className="flip-half top">
          <span className="num">{shown}</span>
        </div>
        {/* 静态下半卡:整个翻页期保持旧值,落幕同帧翻到新值 */}
        <div className="flip-half bottom">
          <span className="num">{flipping ? prev : shown}</span>
        </div>
        {flipping && (
          <>
            {/* 上翻片:旧值上半,向前折下 */}
            <div className="flip-flap top-flap" aria-hidden="true">
              <span className="num">{prev}</span>
            </div>
            {/* 下翻片:新值下半,展开盖棺(遮罩层渐明至透明) */}
            <div className="flip-flap bottom-flap" aria-hidden="true">
              <span className="num">{shown}</span>
            </div>
          </>
        )}
        <div className="split-line" aria-hidden="true" />
        <span className="roller left" aria-hidden="true" />
        <span className="roller right" aria-hidden="true" />
      </div>
    </div>
  );
}

/** 一组两位翻页卡(十位 + 个位),自动补零;className 供 no-seconds 隐藏等场景挂载 */
export function SillFlipCardGroup({ value, className }: { value: number; className?: string }) {
  const v = Math.max(0, Math.min(99, Math.floor(value)));
  return (
    <span className={`card-pair${className ? ` ${className}` : ""}`}>
      <SillFlipCard value={Math.floor(v / 10)} />
      <SillFlipCard value={v % 10} />
    </span>
  );
}
