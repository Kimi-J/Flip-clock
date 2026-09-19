import { useEffect, useRef, useState } from "react";
import "./falling.css";
import {
  BRANCH_TIP,
  COVER_SEC,
  DETACH_SEC,
  LEAF_H,
  LEAF_W,
  makeFallPath,
  makeGustPaths,
  mulberry32,
  pileSlots,
  type DigitBox,
  type FallPath,
  type GustPath,
} from "./fallingPhysics";

/**
 * 叶落成时(Falling Time)——小窗皮肤三号。
 * 设计纲领:时间不是"显示出来",而是被一片落叶"换出来"。
 *
 * 实现铁律(设计文档 §3/§10):
 * - 皮肤级唯一 rAF 循环;离散事件(minuteStamp 翻转/落堆/风起)走 React state,
 *   连续动画(风场/摆动/飘落/叶脉)一律 ref 直写 DOM,每帧 setState 是性能红线
 * - 换数钉死在真实分钟边界(60.0s)由 minuteStamp 驱动,永不等叶子;
 *   叶片覆盖只是视觉掩护,不是逻辑依赖
 * - 目标叶(代表当前分钟)可被鼠标风吹得疯狂摆动,但脱离只发生在 57.6s
 */

interface FallingSkinProps {
  scale: number;
  is24Hour: boolean;
  showSeconds: boolean;
}

// ==================== 静态数据(模块级,种子固定) ====================

const SLOTS = pileSlots();

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** 银杏叶轮廓(手写 path,100×80,叶柄在底部中央):
 *  扇形双裂叶,深裂口 + 收腰叶柄 + 波浪叶缘,右裂片略大(不对称才自然) */
const BLADE_D =
  "M50 79 C49.4 71 48.6 64 48 57 C34 55 17 49 9 38 C3 29 5 16 15 9 C23 3 33 3 40 7 C44 9 47 14 50 22 C53 14 56 10 59 8 C66 4 77 4 85 10 C94 17 96 28 90 38 C82 49 66 55 52 57 C51.4 64 50.6 71 50 79 Z";
/** 主叶脉:叶柄(50,77) → 叶尖裂口(50,22),路径方向 = 水分方向 */
const VEIN_MAIN_D = "M50 77 C49.6 62 50 40 50 22";
/** 侧脉:自叶柄顶端呈扇骨状辐射(银杏二叉分枝脉) */
const VEIN_SIDES_D =
  "M47 54 C35 50 22 43 13 32 M47.6 49 C38 41 29 29 21 14 M48.6 45 C44 35 40 24 36 11 M53 54 C65 50 78 43 87 32 M52.4 49 C62 41 71 29 79 14 M51.4 45 C56 35 60 24 64 11";

/** 目标叶"家"位(叶片中心锚在枝梢上方,叶柄搭在枝头) */
const HERO_HOME = { x: BRANCH_TIP.x, y: BRANCH_TIP.y - 18 };

/** 自然风摆参数:非谐波三频叠加(频率比 1 : ~2.17 : ~3.31)+ 慢速呼吸调幅。
 *  单正弦 = 机械节拍器;非谐波叠加的相位关系永不重复,肉眼读不出周期 */
interface SwayParams {
  f1: number;
  f2: number;
  f3: number;
  a1: number;
  a2: number;
  a3: number;
  p1: number;
  p2: number;
  p3: number;
  breathRate: number;
  breathPhase: number;
}

function makeSway(rng: () => number, baseAmp: number): SwayParams {
  const f1 = 0.35 + rng() * 0.3;
  return {
    f1,
    f2: f1 * 2.17 + rng() * 0.12,
    f3: f1 * 3.31 + rng() * 0.2,
    a1: baseAmp,
    a2: baseAmp * (0.3 + rng() * 0.2),
    a3: baseAmp * (0.12 + rng() * 0.15),
    p1: rng() * Math.PI * 2,
    p2: rng() * Math.PI * 2,
    p3: rng() * Math.PI * 2,
    breathRate: 0.04 + rng() * 0.035,
    breathPhase: rng() * Math.PI * 2,
  };
}

/** 摆角(度):三频叠加 × 呼吸包络(振幅在 55%-100% 间缓慢起伏,各叶错相) */
function leafSway(l: SwayParams, t: number): number {
  const breath = 1 - 0.45 * (0.5 + 0.5 * Math.sin(2 * Math.PI * l.breathRate * t + l.breathPhase));
  return (
    (l.a1 * Math.sin(2 * Math.PI * l.f1 * t + l.p1) +
      l.a2 * Math.sin(2 * Math.PI * l.f2 * t + l.p2) +
      l.a3 * Math.sin(2 * Math.PI * l.f3 * t + l.p3)) *
    breath
  );
}

/** 枝条本身:低频主摆 + 更低频漂移(避免纯周期) */
const branchSway = (t: number) =>
  1.4 * Math.sin(2 * Math.PI * 0.22 * t) + 0.6 * Math.sin(2 * Math.PI * 0.077 * t + 2.1);

/** 间歇阵风:~19s 一阵,立方包络让风起风落都有过程(风的"性格",§5) */
const gustEnvelope = (t: number) => Math.max(0, Math.sin((2 * Math.PI * t) / 19 + 1.3)) ** 3;

interface DecorLeaf extends SwayParams {
  x: number;
  y: number;
  size: number;
  flip: boolean;
  gain: number;
  /** 摆动传播延迟:叶柄晚 ~40ms,距枝根越远越晚(§5) */
  delay: number;
}

/** 枝头装饰叶(永不掉落;摆动参数 seed 固定,不随时间变) */
const DECOR: DecorLeaf[] = (() => {
  const rng = mulberry32(20771);
  const spots: [number, number, number][] = [
    // x, y, size —— 沿枝条曲线错落(枝条贴近面板顶缘,避开标题文字)
    [56, 32, 30],
    [91, 24, 25],
    [126, 21, 34],
    [161, 23, 27],
    [195, 30, 36],
    [221, 38, 26],
    [237, 44, 30],
  ];
  return spots.map(([x, y, size], i) => ({
    ...makeSway(rng, 1.6 + rng() * 1.2),
    x,
    y,
    size,
    flip: rng() < 0.4,
    gain: 0.6 + rng() * 0.5,
    delay: 0.2 + i * 0.04 + rng() * 0.03,
  }));
})();

/** 目标叶的摆动性格(比装饰叶更"活",它是主角) */
const HERO_SWAY: SwayParams = (() => makeSway(mulberry32(6151), 3.4))();

// ==================== 小工具 ====================

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 调试参数(仅开发/截图自证用,生产无人传参):
 *  ?fsec=59.95 冻结分钟内秒数(摆出指定时刻的静态姿态)
 *  ?fflip=1   数字层显示下一分钟(配合 fsec 验证"遮挡中换数"不可见) */
const DBG = new URLSearchParams(window.location.search);
const FSEC = DBG.has("fsec") ? parseFloat(DBG.get("fsec")!) : null;
const FFLIP = DBG.get("fflip") === "1";

interface ClockFace {
  hh: string[];
  mm: [string, string];
  dateLine: string;
}

function readClock(is24Hour: boolean): ClockFace {
  const d = new Date(Date.now() + (FFLIP ? 60000 : 0));
  let h = d.getHours();
  if (!is24Hour) {
    h = h % 12;
    if (h === 0) h = 12;
  }
  const hs = is24Hour ? String(h).padStart(2, "0") : String(h);
  const ms = String(d.getMinutes()).padStart(2, "0");
  return {
    hh: hs.split(""),
    mm: [ms[0], ms[1]],
    dateLine: `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, "0")} · ${DOW[d.getDay()]}`,
  };
}

/** 简易银杏(装饰叶/叶堆/风起叶共用;hero 叶结构特殊,单独内联)。
 *  x/y/w/h 仅用于嵌套在 SVG <g> 内的场景(嵌套 svg 不设宽高会塌成视口尺寸);
 *  HTML 上下文由 CSS 撑满父级。 */
function Ginkgo({
  back = false,
  flip = false,
  wilt = 0,
  x,
  y,
  w,
  h,
}: {
  back?: boolean;
  flip?: boolean;
  wilt?: number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}) {
  return (
    <svg
      viewBox="0 0 100 80"
      className="ginkgo"
      x={x}
      y={y}
      width={w}
      height={h}
      style={flip ? { transform: "scaleX(-1)" } : undefined}
      aria-hidden="true"
    >
      <path d={BLADE_D} fill={back ? "url(#ginkgoBack)" : "url(#ginkgoFront)"} />
      {!back && <path d={BLADE_D} fill="url(#ginkgoGlow)" opacity={0.5} />}
      {wilt > 0 && <path d={BLADE_D} fill="url(#ginkgoWilt)" opacity={wilt} />}
      <path d={`${VEIN_MAIN_D} ${VEIN_SIDES_D}`} className="ginkgo__veins" stroke={back ? "#6d7a44" : "#7d8f4a"} />
    </svg>
  );
}

// ==================== 主组件 ====================

/** 单个目标叶的运行态(两片轮转,气流托停时新旧叶并存,§4.3) */
interface HeroState {
  mode: "branch" | "falling" | "hidden";
  path: FallPath | null;
  pathReady: boolean;
  /** 属于哪一分钟(路径生成与 tSec 换算的基准) */
  bornStamp: number;
  slotIdx: number;
  /** 枝头期逐帧记录的实时摆角(脱离瞬间的姿态混合起点) */
  lastAngle: number;
  /** 脱离那一刻的枝头摆角(0.6s 内由此 blend 到路径姿态,消除"换叶"跳变) */
  detachAngle: number;
}

interface GustState {
  leaves: { slot: number; path: GustPath }[];
  /** 风起时刻(ms, Date.now) */
  t0: number;
}

export default function FallingSkin({ scale, is24Hour, showSeconds }: FallingSkinProps) {
  const [clock, setClock] = useState<ClockFace>(() => readClock(is24Hour));
  const [pile, setPile] = useState<number[]>(() => {
    // 中途挂载:按当前分钟数一次性铺好(§4.3);整点分钟内视为已清空
    const m = new Date().getMinutes();
    return Array.from({ length: m }, (_, i) => i);
  });
  const [gust, setGust] = useState<GustState | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const timeRowRef = useRef<HTMLDivElement>(null);
  const minOnesRef = useRef<HTMLSpanElement>(null);
  const secRef = useRef<HTMLSpanElement>(null);
  const glassSpotRef = useRef<HTMLDivElement>(null);
  const heroRefs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const heroInnerRefs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const faceFrontRefs = [useRef<SVGSVGElement>(null), useRef<SVGSVGElement>(null)];
  const faceBackRefs = [useRef<SVGSVGElement>(null), useRef<SVGSVGElement>(null)];
  const wiltRefs = [useRef<SVGPathElement>(null), useRef<SVGPathElement>(null)];
  const veinRefs = [useRef<SVGPathElement>(null), useRef<SVGPathElement>(null)];
  const shadowRefs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const decorRefs = useRef<(HTMLDivElement | null)[]>([]);
  const decorShadowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const pileRefs = useRef(new Map<number, SVGGElement>());
  const gustRefs = useRef<(HTMLDivElement | null)[]>([]);

  // 最新 props 镜像(rAF 闭包读取)
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const showSecondsRef = useRef(showSeconds);
  showSecondsRef.current = showSeconds;
  const is24HourRef = useRef(is24Hour);
  is24HourRef.current = is24Hour;
  const pileMirror = useRef(pile);
  pileMirror.current = pile;
  const gustMirror = useRef(gust);
  gustMirror.current = gust;

  // 12/24 制切换:数字层即时重排(coverPoint 下一分钟重测,§6)
  useEffect(() => {
    setClock(readClock(is24Hour));
  }, [is24Hour]);

  // 等宽数字槽:挂载时 Canvas 实测 0-9 最大字宽写入 CSS 变量。
  // Georgia 数字是比例宽度("1"明显窄),不定宽则每次换数整串重排位偏移
  useEffect(() => {
    const el = timeRowRef.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return;
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    let max = 0;
    for (let d = 0; d <= 9; d++) max = Math.max(max, ctx.measureText(String(d)).width);
    if (max > 0) el.style.setProperty("--digit-w", `${Math.ceil(max + 2)}px`);
  }, []);

  // ==================== 皮肤级唯一 rAF 循环 ====================
  useEffect(() => {
    const S = {
      minStamp: -1,
      lastNow: 0,
      heroes: [
        { mode: "hidden", path: null, pathReady: false, bornStamp: 0, slotIdx: 0, lastAngle: 0, detachAngle: 0 },
        { mode: "hidden", path: null, pathReady: false, bornStamp: 0, slotIdx: 0, lastAngle: 0, detachAngle: 0 },
      ] as HeroState[],
      coverBox: null as DigitBox | null,
      veinLen: [-1, -1] as [number, number],
      // 风场:鼠标速度注入 + 指数衰减(§5)
      wx: 0,
      wy: 0,
      cursor: { x: -9999, y: -9999 },
      decorLag: DECOR.map(() => 0),
      pileOff: new Map<number, { x: number; y: number }>(),
      pileActive: false,
      gustWind: 0,
      pendingGustAt: -1, // 整点分钟内,风起到来的秒数
      glass: { x: 160, y: 90 },
      lastSecText: "",
    };

    // ---- 鼠标风场:速度向量注入(window 级,本窗内皆有效) ----
    const onMove = (e: PointerEvent) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const r = wrap.getBoundingClientRect();
      const s = scaleRef.current || 1;
      S.cursor.x = (e.clientX - r.left) / s;
      S.cursor.y = (e.clientY - r.top) / s;
      S.wx = clamp(S.wx + (e.movementX / s) * 0.05, -30, 30);
      S.wy = clamp(S.wy + (e.movementY / s) * 0.05, -30, 30);
    };
    window.addEventListener("pointermove", onMove);

    // Canvas 实测字形墨盒/墨迹用(复用同一上下文)
    const inkCtx = document.createElement("canvas").getContext("2d");

    /** 把单个数字字符的墨点(步进 2px,alpha>64)换算成场景坐标追加到 out。
     *  canvas 墨盒中心对齐 DOM 墨盒中心(cx,cy),消除基线对齐误差 */
    const collectInk = (
      ctx: CanvasRenderingContext2D,
      font: string,
      ch: string,
      cx: number,
      cy: number,
      out: { x: number; y: number }[],
    ) => {
      const W = 64;
      const H = 96;
      ctx.canvas.width = W;
      ctx.canvas.height = H;
      ctx.font = font;
      ctx.textBaseline = "alphabetic";
      const m = ctx.measureText(ch);
      const asc = m.actualBoundingBoxAscent || 56;
      ctx.fillStyle = "#000";
      ctx.fillText(ch, 4, 4 + asc);
      const img = ctx.getImageData(0, 0, W, H).data;
      let minX = W;
      let minY = H;
      let maxX = 0;
      let maxY = 0;
      const pts: [number, number][] = [];
      for (let y = 0; y < H; y += 2) {
        for (let x = 0; x < W; x += 2) {
          if (img[(y * W + x) * 4 + 3] > 64) {
            pts.push([x, y]);
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (pts.length === 0) return;
      const bcx = (minX + maxX) / 2;
      const bcy = (minY + maxY) / 2;
      for (const [x, y] of pts) out.push({ x: cx + (x - bcx), y: cy + (y - bcy) });
    };

    const measureCoverBox = (): DigitBox | null => {
      const wrap = wrapRef.current;
      const el = minOnesRef.current;
      if (!wrap || !el) return null;
      const s = scaleRef.current || 1;
      const wr = wrap.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      // rect 为缩放后的屏幕坐标,须除以壳层 scale 回到场景基准坐标(§6)。
      // 数字已做等宽槽位:槽中心即锚点基准(墨迹质心会在此基础上再修正)
      let w = r.width / s;
      let h = (r.height / s) * 0.72;
      const cx = (r.left + r.width / 2 - wr.left) / s;
      const cy = (r.top + r.height / 2 - wr.top) / s;
      // Canvas measureText 实测墨盒(actualBoundingBox):遮挡判定以真实墨迹为准
      // (getComputedStyle 的 fontSize 不受 transform 影响,墨盒单位即场景逻辑像素)
      if (inkCtx) {
        const cs = getComputedStyle(el);
        const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        inkCtx.font = font;
        const m = inkCtx.measureText(el.textContent ?? "0");
        const iw = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
        const ih = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
        if (iw > 2 && ih > 2) {
          w = iw;
          h = ih;
        }
        // 墨迹遮罩:旧值(将消失)+ 新值(将出现)的墨点集,二者都必须被遮住
        const cur = el.textContent ?? "0";
        const next = String((parseInt(cur, 10) + 1) % 10);
        const ink: { x: number; y: number }[] = [];
        collectInk(inkCtx, font, cur, cx, cy, ink);
        collectInk(inkCtx, font, next, cx, cy, ink);
        if (ink.length > 20) {
          // 锚点用墨迹质心而非字框中心:笔画偏侧的字形("4"/"7")让叶片
          // 叶心对准墨迹密集处,裂口与收腰自然避向无墨区
          const mx = ink.reduce((a, p) => a + p.x, 0) / ink.length;
          const my = ink.reduce((a, p) => a + p.y, 0) / ink.length;
          return { cx: mx, cy: my, w: w + 6, h: h + 6, ink };
        }
        return { cx, cy, w: w + 6, h: h + 6 };
      }
      // 外扩安全边:叶子要遮住的是"数字 + 3px 边际",换数在肉眼上绝对无缝
      return { cx, cy, w: w + 6, h: h + 6 };
    };

    const updatePile = (next: number[]) => {
      pileMirror.current = next;
      setPile(next);
    };

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = Date.now();
      // 调试冻结:?fsec=xx 时分钟内秒数钉死在指定值(姿态静态可截图;分钟戳仍走真实时间)
      const secAll = FSEC != null ? Math.floor(now / 1000 / 60) * 60 + FSEC : now / 1000;
      const sec = secAll % 60;
      const minStamp = Math.floor(now / 60000);
      const dt = S.lastNow ? Math.min(0.05, (now - S.lastNow) / 1000) : 0.016;
      S.lastNow = now;

      // ---- 分钟边界翻转:换数钉死在 60.0s,由 minuteStamp 直接驱动(§3.2) ----
      if (minStamp !== S.minStamp) {
        const first = S.minStamp === -1;
        S.minStamp = minStamp;
        setClock(readClock(is24HourRef.current));
        const idx = minStamp % 2;
        const h = S.heroes[idx];
        const minuteOfHour = new Date(now).getMinutes();
        if (first) {
          // 中途挂载(§4.3):>57.6s 跳过本分钟落叶;35-57.6s 以衰老进度静态呈现
          h.mode = sec > DETACH_SEC ? "hidden" : "branch";
          // 调试冻结(FSEC):冻结在脱离之后时仍走正常"生成→脱离"流程,
          // 模拟全程在场(否则永远看不到飘落姿态,无法截图自证)
          if (FSEC != null && sec > DETACH_SEC) h.mode = "branch";
        } else {
          // 目标叶再生:00.0s 于枝头淡入(另一片若仍在飘落则并存,互不影响)
          h.mode = "branch";
        }
        h.path = null;
        h.pathReady = false;
        h.bornStamp = minStamp;
        h.slotIdx = minuteOfHour;
        // 整点大事件:新小时第 60 片落堆(≈00.5s)→ 静默 0.5s → 风起(§7)
        if (!first && minuteOfHour === 0) {
          const lastPath = S.heroes[(minStamp - 1 + 2) % 2].path;
          const landInNewMin = lastPath ? Math.max(0, lastPath.landSec - COVER_SEC) : 0.6;
          S.pendingGustAt = Math.max(1.0, landInNewMin + 0.5);
        } else {
          S.pendingGustAt = -1;
        }
      }

      const heroIdx = minStamp % 2;
      const hero = S.heroes[heroIdx];

      // ---- 57.0s:生成路径(此刻重测 coverPoint,12h/显秒/缩放变化都能被覆盖) ----
      if (hero.mode === "branch" && !hero.pathReady && sec >= 57) {
        const box = measureCoverBox();
        if (box) {
          S.coverBox = box;
          hero.path = makeFallPath({
            seed: minStamp,
            start: HERO_HOME,
            cover: box,
            slot: SLOTS[hero.slotIdx],
          });
          hero.pathReady = true;
          // 调试:FSEC 模式下画出实测墨盒(红框)、墨点(红点)与覆盖率,肉眼核对遮挡
          if (FSEC != null && hero.path) {
            const dbg = document.createElement("canvas");
            dbg.width = 320;
            dbg.height = 180;
            dbg.style.cssText = "position:absolute;inset:0;z-index:99;pointer-events:none;";
            const dc = dbg.getContext("2d");
            if (dc) {
              dc.strokeStyle = "red";
              dc.lineWidth = 1.5;
              dc.strokeRect(box.cx - box.w / 2, box.cy - box.h / 2, box.w, box.h);
              if (box.ink) {
                dc.fillStyle = "rgba(255,0,0,0.55)";
                for (const p of box.ink) dc.fillRect(p.x - 0.75, p.y - 0.75, 1.5, 1.5);
              }
              dc.fillStyle = "red";
              dc.font = "10px monospace";
              dc.fillText(`cov=${hero.path.coverage.toFixed(3)} ${hero.path.style}`, 24, 176);
            }
            wrapRef.current?.appendChild(dbg);
          }
        }
      }
      // ---- 57.6s:叶柄断开,目标叶从枝头摘除,注册为前景落叶(§3.2) ----
      // z 序同步提升:枝头期在数字层之后(z1),飘落期在数字层之前(z4);
      // 记录脱离瞬间的枝头摆角,首帧姿态由它混合过渡(不做"换叶"跳变)
      if (hero.mode === "branch" && hero.pathReady && sec >= DETACH_SEC) {
        hero.mode = "falling";
        hero.detachAngle = hero.lastAngle;
        const el = heroRefs[heroIdx].current;
        if (el) el.style.zIndex = "20";
      }

      // ---- 风场结算:鼠标注入衰减 + 阶段风强(50→57.6s ramp up,脱离后回落) ----
      const decay = Math.exp(-2.2 * dt);
      S.wx *= decay;
      S.wy *= decay;
      S.gustWind *= Math.exp(-1.2 * dt);
      let windFactor = 1;
      if (sec > 50 && sec <= DETACH_SEC) windFactor = 1 + ((sec - 50) / 7.6) * 0.8;
      else if (sec > DETACH_SEC) windFactor = Math.max(1, 1.8 - 1.5 * (sec - DETACH_SEC));
      windFactor = Math.max(windFactor, S.gustWind);
      // 间歇阵风(~19s 一阵,立方包络):静态画面也有风的"呼吸感"
      const windTotal = windFactor * (1 + 0.35 * gustEnvelope(secAll));

      // ---- 枝条低频大摆 + 装饰叶(非谐波三频 + 呼吸调幅 + 传播延迟,§5) ----
      const tSec = secAll;
      DECOR.forEach((leaf, i) => {
        const el = decorRefs.current[i];
        const sh = decorShadowRefs.current[i];
        if (!el) return;
        // 鼠标风:响应按距离传播(远处更慢更弱)
        const dx = leaf.x - S.cursor.x;
        const dy = leaf.y - S.cursor.y;
        const dist = Math.hypot(dx, dy);
        const target = (S.wx / (1 + dist / 60)) * 0.9;
        const k = 8 / (1 + dist / 70);
        S.decorLag[i] += (target - S.decorLag[i]) * Math.min(1, dt * k);
        const windAdd = clamp(S.decorLag[i] * 2.2, -18, 18);
        const ang =
          (branchSway(tSec - leaf.delay) * leaf.gain + leafSway(leaf, tSec)) * windTotal + windAdd;
        el.style.transform = `translate(${leaf.x - leaf.size / 2}px, ${leaf.y - (leaf.size * 0.8) / 2}px) rotate(${ang}deg)`;
        if (sh) {
          // 玻璃叶影:摆动位移 ×0.3 的模糊副本(§5)
          sh.style.transform = `translate(${leaf.x - leaf.size / 2 + 6}px, ${leaf.y - (leaf.size * 0.8) / 2 + 8}px) rotate(${ang * 0.3}deg)`;
        }
      });

      // ---- 目标叶(两片轮转) ----
      for (let i = 0; i < 2; i++) {
        const h = S.heroes[i];
        const el = heroRefs[i].current;
        if (!el) continue;
        const shadow = shadowRefs[i].current;

        if (h.mode === "hidden") {
          el.style.opacity = "0";
          el.style.zIndex = "2"; // 归位枝头层级(数字层之后)
          if (shadow) shadow.style.opacity = "0";
          continue;
        }

        if (h.mode === "branch") {
          // 00.0s 淡入再生(2s,混在其他叶间几不可察,§4.3)
          const fade = h.bornStamp === minStamp ? clamp(sec / 2, 0, 1) : 1;
          // 再生生长:本分钟新生的目标叶前 30s 从 0.35 倍小叶 ease-out 长成大叶,
          // 叶位不空缺、生命周期完整(芽 → 成叶 → 衰老 → 脱落)
          const growU = h.bornStamp === minStamp ? clamp(sec / 30, 0, 1) : 1;
          const grow = 0.35 + 0.65 * (1 - (1 - growU) ** 3);
          // 衰老(35→50s):叶柄向叶尖褪色 + 微卷(§3.2)
          const aging = clamp((sec - 35) / 15, 0, 1);
          // 风强期目标叶柄部摆动幅度单独加大(§3.2)
          const heroExtra = sec > 50 && sec <= DETACH_SEC ? 1 + ((sec - 50) / 7.6) * 0.7 : 1;
          const dxh = HERO_HOME.x - S.cursor.x;
          const dyh = HERO_HOME.y - S.cursor.y;
          const distH = Math.hypot(dxh, dyh);
          // 铁律:可被风吹得疯狂摆动,但脱离只发生在 57.6s(摆动照常,不断柄)
          const windAdd = clamp((S.wx / (1 + distH / 60)) * 2.2, -22, 22);
          const ang =
            (branchSway(tSec - 0.3) * 0.9 + leafSway(HERO_SWAY, tSec)) * windTotal * heroExtra +
            windAdd;
          h.lastAngle = ang; // 逐帧记录,脱离瞬间的姿态混合起点
          el.style.opacity = String(fade);
          el.style.transform = `translate(${HERO_HOME.x - LEAF_W / 2}px, ${HERO_HOME.y - LEAF_H / 2}px) rotate(${ang}deg) scale(${grow})`;
          const inner = heroInnerRefs[i].current;
          if (inner) inner.style.transform = `rotateX(${aging * 14}deg) scaleY(${1 - aging * 0.06})`;
          const wilt = wiltRefs[i].current;
          if (wilt) wilt.style.opacity = String(aging);
          // 叶脉水分秒针(§8):鲜活色从叶尖向叶柄回缩,59s 整条枯萎
          const vein = veinRefs[i].current;
          if (vein) {
            if (S.veinLen[i] < 0) S.veinLen[i] = vein.getTotalLength();
            const L = S.veinLen[i];
            vein.style.strokeDasharray = `${L}`;
            vein.style.strokeDashoffset = `${L * clamp(sec / 60, 0, 1)}`;
          }
          const ff = faceFrontRefs[i].current;
          const fb = faceBackRefs[i].current;
          if (ff) ff.style.opacity = "1";
          if (fb) fb.style.opacity = "0";
          if (shadow) shadow.style.opacity = "0";
          continue;
        }

        // falling:tSec 相对其出生分钟(气流托停可跨入下一分钟,§4.3)
        const tFall = secAll - h.bornStamp * 60;
        const path = h.path;
        if (!path) {
          h.mode = "hidden";
          continue;
        }
        if (tFall >= path.landSec) {
          // 落堆:注册进落叶堆(回到场景层 z1),前景元素隐去(§3.2)
          h.mode = "hidden";
          el.style.opacity = "0";
          if (shadow) shadow.style.opacity = "0";
          const next = pileMirror.current.includes(h.slotIdx)
            ? pileMirror.current
            : [...pileMirror.current, h.slotIdx];
          updatePile(next);
          continue;
        }
        const p = path.sample(tFall);
        // 脱离姿态混合(0.6s):角度/翻面/缩放从枝头瞬间姿态平滑过渡到路径
        // 轨迹——首帧不再是"另一片叶子突然出现",而是同一片叶子接着飘
        const blend = clamp((tFall - DETACH_SEC) / 0.6, 0, 1);
        const rot = p.rot * blend + h.detachAngle * (1 - blend);
        const flipC = 1 + (p.flipCos - 1) * blend;
        const scaleB = 1 + (p.scale - 1) * blend;
        const flipAbs = Math.max(Math.abs(flipC), 0.02);
        el.style.opacity = "1";
        el.style.transform = `translate(${p.x - LEAF_W / 2}px, ${p.y - LEAF_H / 2}px) rotate(${rot}deg) scale(${scaleB}) scaleX(${flipAbs})`;
        const ff = faceFrontRefs[i].current;
        const fb = faceBackRefs[i].current;
        if (ff) ff.style.opacity = flipC >= 0 ? "1" : "0";
        if (fb) fb.style.opacity = flipC >= 0 ? "0" : "1";
        const inner = heroInnerRefs[i].current;
        if (inner) inner.style.transform = "";
        // 叶影(z3):锐度映射虚拟深度——贴近数字平面(z=1)时最锐(§6)
        if (shadow) {
          const dz = Math.abs(p.z - 1);
          shadow.style.opacity = String(0.35 * Math.max(0, 1 - dz));
          shadow.style.filter = `blur(${8 * dz}px)`;
          shadow.style.transform = `translate(${p.x - LEAF_W / 2 + 3}px, ${p.y - LEAF_H / 2 + 5}px) rotate(${rot}deg) scale(${scaleB}) scaleX(${flipAbs})`;
        }
      }

      // ---- 整点风起(§7):编排器串行,风起延迟已含"第 60 片落堆 + 静默 0.5s" ----
      if (
        S.pendingGustAt >= 0 &&
        sec >= S.pendingGustAt &&
        !gustMirror.current &&
        pileMirror.current.length > 0
      ) {
        S.pendingGustAt = -1;
        S.gustWind = 6; // 左侧来风冲量 ×6
        const paths = makeGustPaths(
          pileMirror.current.map((si) => SLOTS[si]),
          minStamp,
        );
        const g: GustState = {
          leaves: pileMirror.current.map((si, j) => ({ slot: si, path: paths[j] })),
          t0: now,
        };
        gustMirror.current = g;
        setGust(g);
      }
      const g = gustMirror.current;
      if (g) {
        const gt = (now - g.t0) / 1000;
        let allDone = true;
        g.leaves.forEach((leaf, j) => {
          const el = gustRefs.current[j];
          if (!el) return;
          const local = (gt - leaf.path.delay) / leaf.path.dur;
          if (local < 1) allDone = false;
          const pose = leaf.path.sample(clamp(local, 0, 1));
          const slotDef = SLOTS[leaf.slot];
          const blur = Math.max(0, 0.9 - pose.z) * 7;
          el.style.opacity = String(pose.opacity);
          el.style.transform = `translate(${pose.x - LEAF_W / 2}px, ${pose.y - LEAF_H / 2}px) rotate(${pose.rot}deg) scale(${pose.scale}) scaleX(${Math.abs(pose.flipCos) * (slotDef.flip ? -1 : 1)})`;
          el.style.filter = blur > 0.3 ? `blur(${blur}px)` : "";
        });
        if (allDone) {
          // 全部出画,叶堆清空,场景回到新的一小时(§7)
          gustMirror.current = null;
          setGust(null);
          updatePile([]);
        }
      }

      // ---- 叶堆鼠标推挤:近处叶子被推动,弹簧回位(§5) ----
      if (!g) {
        let anyActive = false;
        for (const si of pileMirror.current) {
          const slot = SLOTS[si];
          const dx = slot.x - S.cursor.x;
          const dy = slot.y - S.cursor.y;
          const dist = Math.hypot(dx, dy);
          const off = S.pileOff.get(si) ?? { x: 0, y: 0 };
          let tx = 0;
          let ty = 0;
          if (dist < 64 && dist > 0.01) {
            const f = ((1 - dist / 64) * 26) / dist;
            tx = dx * f;
            ty = dy * f;
          }
          const rate = tx !== 0 || ty !== 0 ? 10 : 5; // 推开快、回位慢(弹簧感)
          off.x += (tx - off.x) * Math.min(1, dt * rate);
          off.y += (ty - off.y) * Math.min(1, dt * rate);
          S.pileOff.set(si, off);
          if (Math.abs(off.x) > 0.1 || Math.abs(off.y) > 0.1) anyActive = true;
        }
        // 静止时叶堆零动画(性能铁律):仅活动期写 transform
        if (anyActive || S.pileActive) {
          S.pileActive = anyActive;
          for (const si of pileMirror.current) {
            const el = pileRefs.current.get(si);
            if (!el) continue;
            const slot = SLOTS[si];
            const off = S.pileOff.get(si) ?? { x: 0, y: 0 };
            el.style.transform = `translate(${slot.x + off.x}px, ${slot.y + off.y}px) rotate(${slot.rot + off.x * 0.5}deg) scale(${slot.scale})`;
          }
        }
      }

      // ---- 玻璃视差高光(slow mouse = 视差,§2) ----
      const spot = glassSpotRef.current;
      if (spot) {
        S.glass.x += (S.cursor.x - S.glass.x) * Math.min(1, dt * 2);
        S.glass.y += (S.cursor.y - S.glass.y) * Math.min(1, dt * 2);
        spot.style.transform = `translate(${S.glass.x - 70}px, ${S.glass.y - 70}px)`;
      }

      // ---- 显秒开:日期行小字秒数(§8;直写文本,不触发重渲染) ----
      if (showSecondsRef.current && secRef.current) {
        const txt = String(Math.floor(sec)).padStart(2, "0");
        if (txt !== S.lastSecText) {
          S.lastSecText = txt;
          secRef.current.textContent = txt;
        }
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // is24Hour 的 rAF 闭包镜像已在上文与其他镜像一起维护(避免重建循环)

  // ==================== 渲染(离散结构;连续量全在 rAF 里直写) ====================
  return (
    <div className="falling-wrap" ref={wrapRef} style={{ transform: `scale(${scale})` }}>
      <div className="falling-scene">
        {/* z1 场景层:骨白内壁 + 枝条 + 落叶堆(装饰叶/目标叶为 DOM,便于逐叶 rAF) */}
        <svg className="falling-bg" viewBox="0 0 320 180" aria-hidden="true">
          <defs>
            <radialGradient id="fallingWall" cx="42%" cy="38%" r="75%">
              <stop offset="0%" stopColor="#f4f0e8" />
              <stop offset="100%" stopColor="#e8e2d6" />
            </radialGradient>
            <linearGradient id="ginkgoFront" x1="0" y1="1" x2="0.25" y2="0">
              <stop offset="0%" stopColor="#a9c276" />
              <stop offset="55%" stopColor="#d3cd7d" />
              <stop offset="100%" stopColor="#ecd97f" />
            </linearGradient>
            <linearGradient id="ginkgoBack" x1="0" y1="1" x2="0.25" y2="0">
              <stop offset="0%" stopColor="#93a862" />
              <stop offset="55%" stopColor="#b5ad6a" />
              <stop offset="100%" stopColor="#cbb96e" />
            </linearGradient>
            <linearGradient id="ginkgoWilt" x1="0" y1="1" x2="0.25" y2="0">
              <stop offset="0%" stopColor="#a9894f" />
              <stop offset="55%" stopColor="#8a6b3f" />
              <stop offset="100%" stopColor="#6f5330" />
            </linearGradient>
            <radialGradient id="ginkgoGlow" cx="42%" cy="28%" r="65%">
              <stop offset="0%" stopColor="rgba(255,252,230,0.55)" />
              <stop offset="100%" stopColor="rgba(255,252,230,0)" />
            </radialGradient>
          </defs>
          <rect x="20" y="20" width="280" height="140" rx="10" fill="url(#fallingWall)" stroke="rgba(58,47,40,0.06)" />
          <path
            d="M24 40 C 88 14, 168 16, 250 58"
            fill="none"
            stroke="#6b4f35"
            strokeWidth="3"
            strokeLinecap="round"
          />
          {/* 落叶堆(z1,先落在下;风起时由前景编排器接管,此处不渲染) */}
          {!gust &&
            pile.map((si) => {
              const s = SLOTS[si];
              return (
                <g
                  key={si}
                  ref={(el) => {
                    if (el) pileRefs.current.set(si, el);
                    else pileRefs.current.delete(si);
                  }}
                  style={{
                    transform: `translate(${s.x}px, ${s.y}px) rotate(${s.rot}deg) scale(${s.scale})`,
                  }}
                >
                  {/* 叶片中心锚在槽位点(旋转围绕落点);嵌套 svg 必须显式宽高 */}
                  <Ginkgo back={s.flip} wilt={s.wilt} x={-48} y={-38} w={96} h={76} />
                </g>
              );
            })}
        </svg>

        {/* 玻璃叶影:装饰叶的模糊副本,opacity 极低(§5) */}
        {DECOR.map((leaf, i) => (
          <div
            key={`sh${i}`}
            className="falling-decor-shadow"
            ref={(el) => {
              decorShadowRefs.current[i] = el;
            }}
            style={{
              width: leaf.size,
              height: leaf.size * 0.8,
              transform: `translate(${leaf.x - leaf.size / 2 + 6}px, ${leaf.y - (leaf.size * 0.8) / 2 + 8}px)`,
            }}
          >
            <Ginkgo flip={leaf.flip} />
          </div>
        ))}

        {/* 枝头装饰叶(永不掉落) */}
        {DECOR.map((leaf, i) => (
          <div
            key={i}
            className="falling-decor"
            ref={(el) => {
              decorRefs.current[i] = el;
            }}
            style={{
              width: leaf.size,
              height: leaf.size * 0.8,
              transform: `translate(${leaf.x - leaf.size / 2}px, ${leaf.y - (leaf.size * 0.8) / 2}px)`,
            }}
          >
            <Ginkgo flip={leaf.flip} wilt={0.12} />
          </div>
        ))}

        {/* z2 数字层(DOM 文本,非 SVG text:字体渲染与混合模式接收更稳) */}
        <div className="falling-digits">
          <div className="falling-title">FALLING TIME</div>
          <div className="falling-time" ref={timeRowRef}>
            {clock.hh.map((c, i) => (
              <span key={`h${i}`}>{c}</span>
            ))}
            <span className="falling-colon">:</span>
            <span>{clock.mm[0]}</span>
            <span ref={minOnesRef}>{clock.mm[1]}</span>
          </div>
          <div className="falling-date">
            {clock.dateLine}
            {showSeconds && (
              <>
                {" · "}
                <span ref={secRef}>00</span>
              </>
            )}
          </div>
        </div>

        {/* z3 叶影层:只在飘落期间有内容,multiply 只压在数字与背景上(§2) */}
        {[0, 1].map((i) => (
          <div key={`shadow${i}`} className="falling-leaf-shadow" ref={shadowRefs[i]}>
            <svg viewBox="0 0 100 80" className="ginkgo" aria-hidden="true">
              <path d={BLADE_D} fill="#2a2018" />
            </svg>
          </div>
        ))}

        {/* z4 目标叶 ×2(轮转):枝头 → 脱离 → 飘落 → 落堆 */}
        {[0, 1].map((i) => (
          <div key={`hero${i}`} className="falling-hero" ref={heroRefs[i]} style={{ opacity: 0 }}>
            <div className="falling-hero__inner" ref={heroInnerRefs[i]}>
              <svg viewBox="0 0 100 80" className="ginkgo falling-hero__face" ref={faceFrontRefs[i]} aria-hidden="true">
                <path d={BLADE_D} fill="url(#ginkgoFront)" />
                <path d={BLADE_D} fill="url(#ginkgoGlow)" opacity={0.5} />
                <path d={BLADE_D} fill="url(#ginkgoWilt)" ref={wiltRefs[i]} opacity={0} />
                <path d={VEIN_SIDES_D} className="ginkgo__veins" stroke="#7d8f4a" />
                <path d={VEIN_MAIN_D} className="ginkgo__veins" stroke="#7a5c36" strokeWidth="1.4" />
                <path d={VEIN_MAIN_D} className="ginkgo__veins" stroke="#6f8f3e" strokeWidth="1.4" ref={veinRefs[i]} />
              </svg>
              <svg
                viewBox="0 0 100 80"
                className="ginkgo falling-hero__face falling-hero__face--back"
                ref={faceBackRefs[i]}
                aria-hidden="true"
              >
                <path d={BLADE_D} fill="url(#ginkgoBack)" />
                <path d={BLADE_D} fill="url(#ginkgoWilt)" opacity={0.3} />
                <path d={`${VEIN_MAIN_D} ${VEIN_SIDES_D}`} className="ginkgo__veins" stroke="#6d7a44" />
              </svg>
            </div>
          </div>
        ))}

        {/* 整点风起:叶堆转交 rAF 编排器(每片一条迷你路径),结束即销毁(§7) */}
        {gust &&
          gust.leaves.map((leaf, j) => (
            <div
              key={`g${leaf.slot}`}
              className="falling-gust-leaf"
              ref={(el) => {
                gustRefs.current[j] = el;
              }}
              style={{
                zIndex: leaf.path.kind === "behind" ? 5 : 20,
                transform: `translate(${SLOTS[leaf.slot].x - LEAF_W / 2}px, ${SLOTS[leaf.slot].y - LEAF_H / 2}px)`,
              }}
            >
              <Ginkgo back={SLOTS[leaf.slot].flip} wilt={SLOTS[leaf.slot].wilt} />
            </div>
          ))}

        {/* z5 玻璃层:极弱线性高光 + 鼠标视差径向高光,不拦截任何事件 */}
        <div className="falling-glass">
          <div className="falling-glass__spot" ref={glassSpotRef} />
        </div>
      </div>
    </div>
  );
}
