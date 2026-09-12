import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { X } from "lucide-react";
import FlipCardGroup from "@/components/FlipCardGroup";
import { useClockTime, type ClockTime } from "@/hooks/useClockTime";
import { useClockStore, WIDGET_SKIN_OPTIONS, type WidgetSkinName } from "@/store/clockStore";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

/** 各皮肤基准窗口尺寸(逻辑像素,Rust 建窗同值):缩放比例 = 当前窗口 / 基准 */
const SKIN_BASE: Record<WidgetSkinName, { w: number; h: number }> = {
  ticket: { w: 340, h: 152 },
  mecha: { w: 304, h: 156 },
};

/** 缩放手柄(右上角留给 X,只设其余三角;API 的 ResizeDirection 是未导出联合,用字面量) */
const RESIZE_HANDLES = [
  { key: "nw", dir: "NorthWest", cursor: "nwse-resize", style: { top: 3, left: 3 } },
  { key: "sw", dir: "SouthWest", cursor: "nesw-resize", style: { bottom: 3, left: 3 } },
  { key: "se", dir: "SouthEast", cursor: "nwse-resize", style: { bottom: 3, right: 3 } },
] as const;

/**
 * 桌面小部件:多皮肤壳层(拖拽/缩放/菜单/关闭为公共交互,皮肤只管票面)。
 * - 皮肤自带完整配色与窗口几何,不跟随全屏主题,也不强制套用彼此的尺寸
 * - 票根(ticket):里程计式滚动数字;机械台钟(mecha):复用 FlipCardGroup 翻页动画
 * - 显示秒为小窗独立设置(widgetShowSeconds),右键菜单与全屏设置面板互通
 */
export default function WidgetPage() {
  const { is24Hour, widgetShowSeconds, widgetSkin, toggleWidgetSeconds, setWidgetSkin } = useClockStore();
  const time = useClockTime(is24Hour);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const base = SKIN_BASE[widgetSkin];

  // 窗口缩放 → 皮肤整体等比缩放(transform 等比,布局零改动);换肤后基准变了也要重算
  const [scale, setScale] = useState(() => Math.min(window.innerWidth / base.w, window.innerHeight / base.h));
  useEffect(() => {
    const update = () => setScale(Math.min(window.innerWidth / base.w, window.innerHeight / base.h));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [base.w, base.h]);

  // 皮肤同步:Rust 侧(settings.json)是建窗几何的依据,前端 store 是权威方。
  // 挂载与每次换肤都调一次;皮肤未变时 Rust 端幂等 no-op,不会重置用户保存的缩放
  useEffect(() => {
    if (isTauri) invoke("set_widget_skin", { skin: widgetSkin }).catch(() => {});
  }, [widgetSkin]);

  // 透明窗口:html/body/#root 必须透明(默认主题底色会挡住桌面,异形轮廓无从谈起)
  useEffect(() => {
    const root = document.getElementById("root");
    const prev = [document.documentElement.style.background, document.body.style.background, root?.style.background ?? ""];
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    if (root) root.style.background = "transparent";
    return () => {
      document.documentElement.style.background = prev[0];
      document.body.style.background = prev[1];
      if (root) root.style.background = prev[2];
    };
  }, []);

  const backToFullscreen = () => {
    setMenu(null);
    if (isTauri) invoke("set_window_mode", { mode: "fullscreen" }).catch(() => {});
  };

  const exitApp = () => {
    if (isTauri) invoke("exit_app").catch(() => {});
  };

  const selectSkin = (skin: WidgetSkinName) => {
    setMenu(null);
    setWidgetSkin(skin); // Rust 侧同步由上方 effect 完成
  };

  // 手动拖拽:不用原生 startDragging——Windows 原生移动会把窗口"标题栏"
  // 钳制在屏幕顶边之内(无标题栏也受限),且会吞掉本次点击。
  // 改为 pointer 捕获 + setPosition 手动移动:任意方向无限制;
  // 4px 阈值内松手仍算点击(双击/右键语义保留)。
  const dragRef = useRef<{
    sx: number;
    sy: number;
    wx: number;
    wy: number;
    dpr: number;
    moved: boolean;
  } | null>(null);
  const onDragPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !isTauri) return;
    const win = getCurrentWindow();
    win
      .outerPosition()
      .then((pos) => {
        dragRef.current = {
          sx: e.screenX,
          sy: e.screenY,
          wx: pos.x,
          wy: pos.y,
          dpr: window.devicePixelRatio || 1,
          moved: false,
        };
      })
      .catch(() => {});
    // 指针捕获:移出窗口边界后仍能持续收到 move 事件(拖到屏幕边缘不断线)
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onDragPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = (e.screenX - d.sx) * d.dpr;
    const dy = (e.screenY - d.sy) * d.dpr;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) <= 4) return;
    d.moved = true;
    getCurrentWindow()
      .setPosition(new PhysicalPosition(Math.round(d.wx + dx), Math.round(d.wy + dy)))
      .catch(() => {});
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  return (
    <div
      className="widget-root"
      data-skin={widgetSkin}
      onClick={() => menu && setMenu(null)}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({
          // 菜单含皮肤组(5 项)时更高,y 需留足空间防触底截断
          x: Math.min(e.clientX, window.innerWidth - 132),
          y: Math.min(e.clientY, window.innerHeight - 176),
        });
      }}
    >
      {/* 拖拽面:任意位置可拖(手动阈值拖拽);按钮/手柄置于区外,避免吞点击 */}
      <div
        className="widget-drag"
        onPointerDown={onDragPointerDown}
        onPointerMove={onDragPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={backToFullscreen}
      >
        {widgetSkin === "mecha" ? (
          <MechaSkin scale={scale} time={time} showSeconds={widgetShowSeconds} />
        ) : (
          <TicketSkin scale={scale} time={time} is24Hour={is24Hour} showSeconds={widgetShowSeconds} />
        )}
      </div>

      {/* 悬停显露:关闭钮(退出进程,与全屏 X 语义一致)+ 三角缩放手柄 */}
      <button className="widget-x" aria-label="关闭" onClick={exitApp}>
        <X size={12} />
      </button>
      {RESIZE_HANDLES.map((h) => (
        <span
          key={h.key}
          className="widget-rh"
          style={{ ...h.style, cursor: h.cursor }}
          aria-label={`${h.key} 缩放`}
          onMouseDown={(e) => {
            if (e.button !== 0 || !isTauri) return;
            e.preventDefault();
            getCurrentWindow().startResizeDragging(h.dir).catch(() => {});
          }}
        />
      ))}

      {/* 右键迷你菜单 */}
      {menu && (
        <div className="widget-menu" style={{ left: menu.x, top: menu.y }}>
          <button onClick={toggleWidgetSeconds}>
            <span className="widget-menu__tick">{widgetShowSeconds ? "✓" : ""}</span>
            显示秒
          </button>
          {WIDGET_SKIN_OPTIONS.map((opt) => (
            <button key={opt.value} onClick={() => selectSkin(opt.value)}>
              <span className="widget-menu__tick">{widgetSkin === opt.value ? "✓" : ""}</span>
              皮肤 · {opt.label}
            </button>
          ))}
          <button onClick={backToFullscreen}>回到全屏</button>
          <button onClick={exitApp}>退出</button>
        </div>
      )}
    </div>
  );
}

/** 皮肤公共属性:票面随窗口等比缩放 */
interface SkinProps {
  scale: number;
  time: ClockTime;
  showSeconds: boolean;
}

/**
 * 机械台钟(Split-Flap)皮肤:深色金属机身 + 贯穿铰链轴 + 沉头螺丝 + 近黑卡仓。
 * 回归翻页动画(FlipCardGroup 复用)——机械翻页正是它的灵魂。
 * 无微倾(rotate 0°),机身 264×116,窗口 304×156(四边 20px 留白供投影)。
 */
function MechaSkin({ scale, time, showSeconds }: SkinProps) {
  return (
    <div className="mecha-wrap" style={{ transform: `scale(${scale})` }}>
      <div className="mecha">
        <span className="mecha__screw mecha__screw--tl" />
        <span className="mecha__screw mecha__screw--tr" />
        <span className="mecha__screw mecha__screw--bl" />
        <span className="mecha__screw mecha__screw--br" />
        <div className="mecha__slot">
          <div
            className="mecha__cards"
            style={{ "--card-font": showSeconds ? "46px" : "56px" } as React.CSSProperties}
          >
            <FlipCardGroup value={time.hours} />
            <span className="mecha__colon" aria-hidden="true">
              <i />
              <i />
            </span>
            <FlipCardGroup value={time.minutes} />
            {showSeconds && (
              <>
                <span className="mecha__colon" aria-hidden="true">
                  <i />
                  <i />
                </span>
                <FlipCardGroup value={time.seconds} />
              </>
            )}
          </div>
          {/* 铰链轴:贯穿卡仓中缝(= 翻页卡翻转轴),z-index 压翻片 */}
          <span className="mecha__hinge" aria-hidden="true">
            <i className="mecha__cap mecha__cap--l" />
            <i className="mecha__cap mecha__cap--r" />
          </span>
        </div>
        <div className="mecha__engrave">FLIP CLOCK</div>
      </div>
    </div>
  );
}

/**
 * 票根(Ticket Stub)皮肤:米白纸面 + 虚线撕裂分隔 + 半圆撕口 + 油墨数字。
 * 数字无卡片、无翻页:里程计式滚动(WipeDigit)。
 */
function TicketSkin({ scale, time, is24Hour, showSeconds }: SkinProps & { is24Hour: boolean }) {
  // 条形码:手写宽窄相间图案(条宽 1-4px、间隔 1-2px,Code39 风格),固定不变
  const bars: [number, number][] = [
    [2, 1], [1, 2], [3, 1], [1, 1], [4, 1], [1, 2], [1, 1], [2, 1], [3, 2],
    [1, 1], [1, 1], [4, 1], [1, 2], [2, 1], [1, 1], [3, 1], [1, 2], [2, 1],
  ];

  const d = time.date;
  const dateText = `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, "0")}月${String(d.getDate()).padStart(2, "0")}日 ${WEEKDAYS[d.getDay()]}`;
  const period = is24Hour ? "" : d.getHours() >= 12 ? "PM" : "AM";
  const stubNo = `Nº ${String(time.hours).padStart(2, "0")}${String(time.minutes).padStart(2, "0")}`;

  return (
    <div className="ticket-wrap" style={{ transform: `rotate(-1.5deg) scale(${scale})` }}>
      <div className="ticket skin-ticket">
        <div className="ticket__main">
          <div className="ticket__top">ADMIT ONE · FLIP CLOCK</div>
          <div className="ticket__cards">
            <WipeGroup value={time.hours} />
            <span className="ticket__colon">:</span>
            <WipeGroup value={time.minutes} />
            {showSeconds && (
              <>
                <span className="ticket__colon">:</span>
                <WipeGroup value={time.seconds} />
              </>
            )}
          </div>
          <div className="ticket__date">
            {dateText}
            {period && ` · ${period}`}
          </div>
        </div>
        <div className="ticket__perf" />
        <div className="ticket__stub">
          <div className="ticket__barcode">
            {bars.map(([w, g], i) => (
              <span key={i} style={{ width: `${w}px`, marginRight: `${g}px` }} />
            ))}
          </div>
          <div className="ticket__no">{stubNo}</div>
        </div>
        <span className="ticket__stamp">VALID</span>
      </div>
    </div>
  );
}

/**
 * 单个滚动数字(里程表式):值变化时旧值上滚渐隐、新值自下入位渐显(340ms),
 * 行程约 1/3 字高,结束后卸载过渡层。无卡片、无 3D 翻页。
 */
function WipeDigit({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const [rolling, setRolling] = useState(false);

  useEffect(() => {
    if (value === shown) return;
    setRolling(true);
    const t = window.setTimeout(() => {
      setShown(value);
      setRolling(false);
    }, 340);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <span className="roll-digit" aria-label={String(rolling ? value : shown)}>
      <span className={rolling ? "roll-digit__layer roll-digit__layer--out" : "roll-digit__layer"}>
        {shown}
      </span>
      {rolling && <span className="roll-digit__layer roll-digit__layer--in">{value}</span>}
    </span>
  );
}

/** 一组两位滚动数字,自动补零 */
function WipeGroup({ value }: { value: number }) {
  const v = Math.max(0, Math.min(99, Math.floor(value)));
  return (
    <span className="inline-flex" style={{ gap: "2px" }}>
      <WipeDigit value={Math.floor(v / 10)} />
      <WipeDigit value={v % 10} />
    </span>
  );
}
