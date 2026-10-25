/**
 * 林间小屋场景层(v5)——纯装饰,无交互:
 * 木屋墙体(plank 纹理)+ 顶/侧梁 + 昼夜相位窗景(天空/日月/林线/窗棂/窗帘)
 * + 壁灯 + 壁炉架(蒸汽杯)+ 书堆 + 桌沿木带 + 两侧松林缘,
 * 以及三层全局质感覆盖(wood-grain soft-light / vignette / grain)。
 *
 * 相位(dawn/day/dusk/night)由 Home 按小时计算后传入,挂在 .cabin 上,
 * CSS 变量(--sky-top/--ambient 等)随之过渡(0.9s)。
 * z 序(main 上下文):cabin z:0(隔离层内自负) < 钟柜 z:16 < 覆盖层 z:30/31/32
 * < 窗口控件/设置面板 z:40——覆盖层不压项目 UI。
 */
import type { CabinPhase } from "@/lib/cabinPhase";

export default function SillScene({ phase }: { phase: CabinPhase }) {
  return (
    <>
      <div className={`cabin phase-${phase}`} aria-hidden="true">
        <div className="ambient-glow" />
        <div className="top-beam" />
        <div className="side-beam left" />
        <div className="side-beam right" />

        <div className="window">
          <div className="window-sky">
            <div className="sun-moon" />
            <div className="forest-layer far" />
            <div className="forest-layer mid" />
            <div className="forest-floor" />
          </div>
          <div className="window-cross-v" />
          <div className="window-cross-h" />
          <div className="curtain" />
        </div>

        <div className="lamp">
          <div className="arm" />
          <div className="shade" />
          <div className="bulb" />
        </div>

        <div className="mantel">
          <div className="mug" />
        </div>
        <div className="book-stack" />
        <div className="table-band" />
        <div className="pine-edge left" />
        <div className="pine-edge right" />
      </div>

      <div className="wood-grain" aria-hidden="true" />
      <div className="vignette" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />
    </>
  );
}
