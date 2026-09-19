/**
 * 叶落成时 · 落叶动力学与路径生成(纯函数,无 DOM 依赖,可单测)
 *
 * 设计原则(设计文档 §4):目标驱动 + 拒绝采样,而非自由模拟。
 * 先定约束(59.2s 脱离枝头、60.0s 恰好遮住分钟个位数字、随后落向叶堆槽位),
 * 再生成满足约束的飘落路径;覆盖率不达标换种子重试,兜底退化为直线基线。
 */

// ==================== 场景常量(基准分辨率 320×180,壳层等比缩放不感知) ====================

export const SCENE_W = 320;
export const SCENE_H = 180;

/** 内容面板(骨白内壁):四边 20px 留白供投影/叶片飞出 */
export const PANEL = { x: 20, y: 20, w: 280, h: 140 } as const;

/** 枝梢(枝条末端上翘处):目标叶的叶柄锚点 */
export const BRANCH_TIP = { x: 250, y: 74 } as const;

/** 银杏叶横置尺寸:数字字框的 ~1.3 倍,足够罩住个位数字(含安全边) */
export const LEAF_W = 96;
export const LEAF_H = 76;

/** 阶段时刻(分钟内秒,浮点) */
export const DETACH_SEC = 59.2;
export const COVER_SEC = 60.0;
export const COVER_WIN: readonly [number, number] = [59.85, 60.15];
/** 覆盖窗口内叶片的遮挡要求(墨点判定):必须 1.0——所有墨点全程在叶形内,
 *  且中心时刻离叶形边界还有安全边距(见 measureCoverage)。"基本遮住"等于没遮 */
export const COVER_MIN = 1.0;
/** 覆盖率自检的最大重试次数(之后走直线兜底) */
export const MAX_TRIES = 8;

// ==================== 基础类型 ====================

export interface Vec {
  x: number;
  y: number;
}

/** 数字字形包围盒(场景坐标):测量后由组件传入。
 *  ink 为可选的真实墨点集(场景绝对坐标)——遮挡判定以墨迹为准:
 *  字形矩形的四角本就无墨,用矩形网格判定会把"罩不住空角"误判为失败 */
export interface DigitBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
  ink?: Vec[];
}

export interface PileSlot {
  x: number;
  y: number;
  rot: number;
  scale: number;
  flip: boolean;
  /** 平躺程度(scaleX 压缩,0.5-1):真叶堆里的叶子不都是完全展开平贴的,
   *  侧躺/半横的占多数——1 才是"立着",更小是更横 */
  flat: number;
  /** 枯萎程度(0-1),落堆叶片各有各的枯法 */
  wilt: number;
}

/** 某一帧的叶片姿态:z 为虚拟深度(0=玻璃,1=数字平面,1.6=叶堆平面) */
export interface LeafPose {
  x: number;
  y: number;
  rot: number;
  /** 翻面余弦:符号决定正/反面,绝对值决定横向压缩(scaleX) */
  flipCos: number;
  z: number;
  /** 整体缩放:飘落末段向槽位尺寸收拢(纵深后退感) */
  scale: number;
}

export type FallStyle = "sway" | "gust" | "straight" | "hover";

export interface FallPath {
  style: FallStyle;
  /** 落堆时刻(分钟内秒,>60 表示跨入下一分钟) */
  landSec: number;
  /** 覆盖窗口内实测最低覆盖率(0-1) */
  coverage: number;
  /** 落地时朝外的是否为背面:由飘落路径自然决定(落地前朝向随机),
   *  叶堆按此渲染,落堆瞬间无换面跳变 */
  landBack: boolean;
  /** t 为分钟内秒(可 >60 跨分钟),返回叶片姿态 */
  sample: (t: number) => LeafPose;
}

// ==================== 种子随机(可复现:同一分钟重来路径一致) ====================

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ==================== 落叶路径生成 ====================

export interface FallOpts {
  /** 分钟编号(随机性可复现) */
  seed: number;
  /** 目标叶在枝头的位置(场景坐标) */
  start: Vec;
  /** 分钟个位数字的字形包围盒 */
  cover: DigitBox;
  /** 本分钟落叶堆目标槽位 */
  slot: PileSlot;
}

interface Candidate extends FallPath {
  ok: boolean;
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 构造一条候选路径;forceCalm 为兜底模式(零摆动,基线硬约束过数字) */
function buildCandidate(o: FallOpts, attempt: number, forceCalm: boolean): Candidate {
  const rng = mulberry32((o.seed + attempt * 7919) >>> 0);

  // ---- 风格骰子:70% 摇摆 / 15% 风卷 / 10% 直落横滑 / 5% 气流托停 ----
  const styleRoll = rng();
  const style: FallStyle = forceCalm
    ? "straight"
    : styleRoll < 0.7
      ? "sway"
      : styleRoll < 0.85
        ? "gust"
        : styleRoll < 0.95
          ? "straight"
          : "hover";

  const cx = o.cover.cx;
  const cy = o.cover.cy;
  const segA = COVER_SEC - DETACH_SEC; // 2.4s 脱离→覆盖

  // ---- 摆动参数(双正弦 + 微噪声) ----
  let a1 = 6 + rng() * 6;
  const w1 = 1.8 + rng() * 0.8;
  const a2 = 2 + rng() * 3;
  const w2 = 3.5 + rng() * 2;
  const phi2 = rng() * Math.PI * 2;
  const a3 = 1.5;
  const w3 = 7.3;
  const phi3 = rng() * Math.PI * 2;
  if (style === "straight") {
    a1 *= 0.15;
  }
  if (forceCalm) {
    a1 = 0;
  }
  const amp2 = forceCalm ? 0 : a2;
  const amp3 = forceCalm ? 0 : a3;

  // 约束求解:x(60s) 必须等于数字中心。基线过 coverPoint,故要求 sway(60)=0:
  // a1·sin(w1·60+φ1) = -(a2·sin(w2·60+φ2) + a3·sin(w3·60+φ3))
  const rest = -(amp2 * Math.sin(w2 * COVER_SEC + phi2) + amp3 * Math.sin(w3 * COVER_SEC + phi3));
  let amp1 = a1;
  if (Math.abs(rest) > amp1) amp1 = Math.abs(rest) + 0.5; // 摆动幅度自适应,约束优先
  let phi1 = 0;
  if (amp1 > 0) {
    const s = clamp(rest / amp1, -1, 1);
    const base = Math.asin(s);
    // asin 双解按种子取支,保持相位多样性
    phi1 = (rng() < 0.5 ? base : Math.PI - base) - w1 * COVER_SEC;
  }
  const swayX = (t: number) =>
    amp1 * Math.sin(w1 * t + phi1) + amp2 * Math.sin(w2 * t + phi2) + amp3 * Math.sin(w3 * t + phi3);
  // 摆动淡入包络:脱离瞬间摆幅为 0(位置/速度连续,设计文档 §3.2"初始速度=当前摆动速度"),
  // 0.9s 后满幅;覆盖时刻(60s)env=1,约束求解与覆盖率自检不受影响
  const swayEnv = (t: number) => clamp((t - DETACH_SEC) / 0.9, 0, 1);
  // 覆盖阻尼:叶子经过数字时摆幅收敛一半即可(安全边距判定兜底),
  // 摆动不在数字前"屏住",飘落读起来才连贯
  const swayDamp = (t: number) => 1 - 0.55 * Math.exp(-(((t - COVER_SEC) / 0.7) ** 2));

  // ---- 翻面/自旋 ----
  const flipFreq = 0.3 + rng() * 0.25; // Hz
  // 翻面相位与覆盖时刻绑定(同 φ1 的约束求解思路):60.0s 时 |cos|=1 叶片完全正对,
  // 保证覆盖窗口内横向张开度 ≥ 86%,且"叶展全貌遮数字"正是视觉主镜头;
  // 正/反面比例 3:1(正面枯褐 : 背面青绿),频率与 ±0.1rad 抖动由 seed 决定
  const flipPhase = (rng() < 0.25 ? Math.PI : 0) - 2 * Math.PI * flipFreq * COVER_SEC + (rng() - 0.5) * 0.2;
  // 翻面时间在覆盖后减速:过数字前翻转照常(前半段的灵动感),过数字后
  // ~0.5s 内转速平滑衰减到 10%(下半段近乎不再翻面,安静落槽),
  // 落槽吸附(settle)再把它收拢到槽位正反面。rate 用 smoothstep 衰减,
  // flipTime 是其解析积分,相位连续无跳变
  const flipTime = (tc: number) => {
    if (tc <= COVER_SEC) return tc;
    const tau = tc - COVER_SEC;
    if (tau >= 0.5) return COVER_SEC + 0.2875 + 0.1 * (tau - 0.5);
    const u = tau / 0.5;
    return COVER_SEC + 0.5 * (u - 0.85 * (u - (u ** 3 - 0.5 * u ** 4)));
  };
  const rotRate = (rng() * 2 - 1) * 25; // deg/s 慢速进动
  // 覆盖时刻叶形姿态绑定(同 φ1/翻面的约束思路):60.0s 时叶片横置(设计文档
  //  §4.2"银杏横置")——叶柄朝侧、扇面竖向铺开,竖向展开 ~96px 从容罩住数字
  //  全高;±90° 朝向由 seed 决定(±6° 抖动,再大有效遮挡宽度会被削掉)
  const targetRot = (rng() < 0.5 ? -90 : 90) + (rng() * 2 - 1) * 6;
  const rot0 = targetRot - rotRate * (COVER_SEC - DETACH_SEC);
  // 覆盖增稳:经过数字时叶片微微张开(峰值 +16% 在 60.0s,高斯包络)——
  // 银杏有裂口/收腰,纯靠几何对齐的"有效遮罩"只是内接矩形;张开一点,
  // 完全遮挡就从运气变成构造性保证。落槽末段随 settle 收回到槽位尺寸
  const coverBoost = (t: number) => 1 + 0.16 * Math.exp(-(((t - COVER_SEC) / 0.5) ** 2));

  // ---- 运动曲线:Hermite 样条,速度全程连续 ----
  // 60.0s 经过数字只是路径上一个精确途经点(端点构造约束),不再减速停留;
  // A/B 两段在覆盖点共享速度,落槽端速度为 0(软着陆内置在曲线里)
  const hermite = (p0: number, v0: number, p1: number, v1: number, dur: number) => {
    return (tau: number) => {
      const u = clamp(tau / dur, 0, 1);
      const u2 = u * u;
      const u3 = u2 * u;
      return (
        (2 * u3 - 3 * u2 + 1) * p0 +
        (u3 - 2 * u2 + u) * dur * v0 +
        (-2 * u3 + 3 * u2) * p1 +
        (u3 - u2) * dur * v1
      );
    };
  };

  // ---- B 段(覆盖后→落堆):运动时间 m(气流托停时真实时间被减速映射) ----
  const normalT = 0.42 + rng() * 0.22; // 常规运动时长(快速落下)
  let motionT = style === "gust" ? normalT + 0.25 : style === "straight" ? normalT - 0.05 : normalT;
  let hoverH0 = 0;
  let hoverH1 = 0;
  const HOVER_RATE = 0.12;
  if (style === "hover") {
    // 悬停只允许发生在通过 coverPoint 之后(§4.1),从覆盖后 0.2s 起 ~0.9s
    hoverH0 = 0.2;
    hoverH1 = 1.1;
    motionT = normalT + 0.3;
  }
  const extra = style === "hover" ? (1 - HOVER_RATE) * (hoverH1 - hoverH0) : 0;
  // 槽位偏远时延长运动时间:横向漂移速度设上限,远处槽位是"边落边飘过去",
  // 而不是在短时间内被快速横向"吸过去"(纯体感,与覆盖约束无关)
  const dxSlot = o.slot.x - cx;
  motionT += clamp(Math.abs(dxSlot) / 520, 0, 0.35);
  const landSec = COVER_SEC + motionT + extra;

  // 覆盖点速度:竖向视为匀加速下落(= 2×平均速度),横向为小漂移匀速率;
  // B 段以此初速度续接,终点速度 0——整条曲线无加速断点
  const vcy = (2 * (cy - o.start.y)) / segA;
  const vcx = (cx - o.start.x) / segA;
  const segAx = hermite(o.start.x, 0, cx, vcx, segA);
  const segAy = hermite(o.start.y, 0, cy, vcy, segA);
  const segBx = hermite(cx, vcx, o.slot.x, 0, motionT);
  const segBy = hermite(cy, vcy, o.slot.y, 0, motionT);

  // 真实时间 τ(覆盖后) → 运动时间 m
  const warp = (tau: number) => {
    if (style !== "hover") return tau;
    if (tau < hoverH0) return tau;
    if (tau < hoverH1) return hoverH0 + HOVER_RATE * (tau - hoverH0);
    return hoverH0 + HOVER_RATE * (hoverH1 - hoverH0) + (tau - hoverH1);
  };

  // 风卷:路径中段上升环(运动时间中段)
  const gustR = 20 + rng() * 20;
  const gustM0 = motionT * 0.25;
  const gustM1 = motionT * 0.8;
  const gustDir = rng() < 0.5 ? -1 : 1;

  // 直落横滑:落地前横向滑出再滑回(sin 鼓包,净位移为 0——终点必须精确落在槽位)
  const slideX = (rng() * 2 - 1) * 26;

  // 终点姿态收敛(§4 落堆):路径终点必须与槽位渲染姿态完全一致,否则落堆
  // 瞬间从空中姿态"闪现"成槽位姿态。旋转角按 mod 360 取离自然终点最近的圈数
  const rotNatEnd = rot0 + rotRate * (landSec - DETACH_SEC);
  const rotFinal = o.slot.rot + 360 * Math.round((rotNatEnd - o.slot.rot) / 360);

  const sample = (t: number): LeafPose => {
    const tc = clamp(t, DETACH_SEC, landSec);

    // ---- 基线 ----
    let bx: number;
    let by: number;
    let z: number;
    let poseScale: number;
    // 终点收敛度(B 段末 30% 渐入):姿态/翻面吸附到槽位姿态
    let settle = 0;
    if (tc <= COVER_SEC) {
      const tm = tc - DETACH_SEC;
      bx = segAx(tm);
      by = segAy(tm);
      z = lerp(0.45, 1, tm / segA);
      poseScale = (1 + (1 - z) * 0.15) * coverBoost(tc); // 近玻璃略放大(纵深)
    } else {
      const m = clamp(warp(tc - COVER_SEC), 0, motionT);
      const mu = m / motionT;
      // Hermite 主曲线:速度自覆盖点连续继承,落槽端双轴速度收敛到 0
      bx = segBx(m);
      by = segBy(m);
      // z 落到 1.75(略低于叶堆平面 1.6):叶影在入槽前已软到近乎不可见,
      // 落堆后影子消失的那一下就不会有残留跳变
      z = lerp(1, 1.75, mu);
      const su = clamp((mu - 0.7) / 0.3, 0, 1);
      settle = su * su * (3 - 2 * su);
      // 落向叶堆时向槽位尺寸收拢(覆盖增稳随 settle 收回,终点精确等于槽位尺寸)
      poseScale = lerp(1, o.slot.scale, mu) * (1 + (coverBoost(tc) - 1) * (1 - settle));
      if (style === "gust" && m > gustM0 && m < gustM1) {
        const q = (m - gustM0) / (gustM1 - gustM0);
        bx += ((gustR * (1 - Math.cos(2 * Math.PI * q))) / 2) * gustDir;
        by -= gustR * Math.sin(Math.PI * q) * 1.1;
        z -= Math.sin(Math.PI * q) * 0.35; // 上升环中更靠近玻璃
      }
      if (style === "straight" && mu > 0.7) {
        const q = (mu - 0.7) / 0.3;
        bx += slideX * Math.sin(Math.PI * q) * (1 - settle); // 滑出再滑回,终点零偏移
      }
    }

    // ---- 摆动/自旋/翻面(用真实时间,悬停中叶子仍在抖) ----
    // (1-settle):落槽末段摆动同步收敛到 0,终点姿态与槽位完全一致
    const env = swayEnv(tc) * swayDamp(tc) * (1 - settle);
    const x = bx + swayX(tc) * env;
    let flipCos = Math.cos(2 * Math.PI * flipFreq * flipTime(tc) + flipPhase);
    let rot = rot0 + rotRate * (tc - DETACH_SEC) + (swayX(tc) - swayX(tc - 0.05)) * env * 1.2;
    if (settle > 0) {
      // 落槽吸附:翻面收敛到槽位平躺程度,但正/反面保持自然朝向(符号不变)——
      // 落地前哪面朝外是路径随机的,叶堆按 landBack 渲染,无换面跳变
      const sgn = flipCos >= 0 ? 1 : -1;
      flipCos = lerp(flipCos, sgn * o.slot.flat, settle);
      rot = lerp(rot, rotFinal, settle);
    }

    return { x, y: by, rot, flipCos, z, scale: poseScale };
  };

  // ---- 覆盖率自检(§4.2):覆盖窗口内叶片包围盒对数字包围盒的面积覆盖率 ----
  const coverage = measureCoverage(sample, o.cover);
  // 落地朝向(翻面在覆盖后近乎冻结,落槽吸附保号——落地符号即此处符号)
  const landBack = Math.cos(2 * Math.PI * flipFreq * flipTime(landSec) + flipPhase) < 0;

  return {
    style,
    landSec,
    coverage,
    landBack,
    sample,
    ok: coverage >= COVER_MIN,
  };
}

/** 银杏叶轮廓多边形(viewBox 100×80 坐标,与组件 BLADE_D 同形,顺时针)。
 *  覆盖率自检必须对真实叶形判定:椭圆近似会漏掉裂口/收腰处的"透字区" */
const BLADE_POLY: readonly [number, number][] = [
  [50, 79], [48.5, 66], [48, 57], [38, 55], [26, 51], [16, 45], [9, 38], [5, 29],
  [7, 19], [15, 9], [25, 4], [34, 4], [40, 7], [46, 13], [50, 22], [54, 13],
  [59, 8], [68, 4], [78, 5], [85, 10], [93, 19], [95, 28], [90, 38], [82, 47],
  [70, 53], [58, 56], [52, 57], [51.5, 66],
];

/** 射线法点是否在叶形多边形内(px/py 为 viewBox 100×80 坐标) */
function pointInBlade(px: number, py: number): boolean {
  let inside = false;
  for (let i = 0, j = BLADE_POLY.length - 1; i < BLADE_POLY.length; j = i++) {
    const [xi, yi] = BLADE_POLY[i];
    const [xj, yj] = BLADE_POLY[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 点到叶形多边形边界的最短距离(viewBox 单位):墨点离裂口/收腰太近,
 *  窗口内叶片微移就会漏出——"完全遮住"必须带安全边距 */
function bladeEdgeDist(px: number, py: number): number {
  let best = Infinity;
  for (let i = 0, j = BLADE_POLY.length - 1; i < BLADE_POLY.length; j = i++) {
    const [xi, yi] = BLADE_POLY[i];
    const [xj, yj] = BLADE_POLY[j];
    const ex = xj - xi;
    const ey = yj - yi;
    const len2 = ex * ex + ey * ey || 1;
    const u = clamp(((px - xi) * ex + (py - yi) * ey) / len2, 0, 1);
    const dx = px - (xi + ex * u);
    const dy = py - (yi + ey * u);
    const d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** 场景坐标 → 叶形 viewBox 坐标(逆平移/旋转/翻面压缩/整体缩放) */
function toBlade(pt: Vec, p: LeafPose): Vec {
  const flipAbs = Math.max(Math.abs(p.flipCos), 0.3);
  const sc = Math.max(p.scale, 0.05);
  const rad = (-p.rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = pt.x - p.x;
  const dy = pt.y - p.y;
  return {
    x: ((dx * cos - dy * sin) / (flipAbs * sc)) * (100 / LEAF_W) + 50,
    y: ((dx * sin + dy * cos) / sc) * (80 / LEAF_H) + 40,
  };
}

/** 覆盖率采样:有墨点集则判定墨点(诚实定义:看不见跳变 = 墨迹被覆盖),
 *  否则退化为 5×5 网格。两重判定:
 *  1) 覆盖窗口 [59.85, 60.15] 全程:所有点都在叶形内;
 *  2) 中心时刻 60.0s 加严:所有点离叶形边界 ≥ 4 单位(≈3.8px)——
 *     叶片在窗口内仍在微移,贴边遮住等于没遮住 */
function measureCoverage(sample: (t: number) => LeafPose, box: DigitBox): number {
  // 待测点(场景坐标):墨点集或字形盒网格
  const points: Vec[] = [];
  if (box.ink && box.ink.length > 0) {
    points.push(...box.ink);
  } else {
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        points.push({
          x: box.cx - box.w / 2 + (box.w * (i + 0.5)) / 5,
          y: box.cy - box.h / 2 + (box.h * (j + 0.5)) / 5,
        });
      }
    }
  }
  let worst = 1;
  for (let t = COVER_WIN[0]; t <= COVER_WIN[1] + 1e-6; t += 0.03) {
    const p = sample(t);
    let inside = 0;
    for (const pt of points) {
      const b = toBlade(pt, p);
      if (pointInBlade(b.x, b.y)) inside++;
    }
    worst = Math.min(worst, inside / points.length);
    if (worst < 1) break; // 全程含边界判定,中心时刻漏了就不必再算
  }
  if (worst < 1) return worst;
  // 中心时刻加严:安全边距判定
  const p0 = sample(COVER_SEC);
  for (const pt of points) {
    const b = toBlade(pt, p0);
    if (!pointInBlade(b.x, b.y) || bladeEdgeDist(b.x, b.y) < 4) return 0.99;
  }
  return 1;
}

/**
 * 目标驱动 + 拒绝采样:锚点(墨迹质心)+ 小网格偏移寻优。
 * 银杏叶形有收腰与裂口,叶心正对字心未必最优——允许叶片在 ±8px 网格内
 * 错身,让裂口/叶柄避开笔画(对"4"这类偏侧字形尤其关键)。
 * 每个种子依次尝试偏移,首个达标即收;仍不满足则直线兜底(牺牲飘逸感)。
 * 注意:换数逻辑永不依赖本函数结果,遮挡只是视觉掩护(§4.2)。
 */
const COVER_OFFSETS: readonly Vec[] = [
  { x: 0, y: 0 },
  { x: -6, y: -5 },
  { x: 6, y: -5 },
  { x: -6, y: 5 },
  { x: 6, y: 5 },
];

export function makeFallPath(o: FallOpts): FallPath {
  let best: Candidate | null = null;
  let done = false;
  for (let i = 0; i < MAX_TRIES && !done; i++) {
    for (const off of COVER_OFFSETS) {
      const c = buildCandidate(
        { ...o, cover: { ...o.cover, cx: o.cover.cx + off.x, cy: o.cover.cy + off.y } },
        i,
        false,
      );
      if (!best || c.coverage > best.coverage) best = c;
      if (c.ok) {
        done = true;
        break;
      }
    }
  }
  if (!best?.ok) {
    for (const off of COVER_OFFSETS) {
      const calm = buildCandidate(
        { ...o, cover: { ...o.cover, cx: o.cover.cx + off.x, cy: o.cover.cy + off.y } },
        MAX_TRIES,
        true,
      );
      if (calm.coverage > (best?.coverage ?? 0)) best = calm;
    }
  }
  return best as Candidate;
}

// ==================== 落叶堆槽位(§7:槽位制,不做刚体碰撞) ====================

/**
 * 60 个槽位的确定性伪随机布局:x 以中右部为重心聚集(三角分布),
 * y 两层错落贴面板底边,每槽 rotation/scale/正反/枯萎随机。
 * 槽位尺寸明显小于飘落叶(0.34-0.5):叶堆是"进度条",不能喧宾夺主。
 * 第 N 分钟落叶落向第 N 槽。
 */
export function pileSlots(): PileSlot[] {
  const rng = mulberry32(9407);
  const slots: PileSlot[] = [];
  const cx = 190;
  for (let i = 0; i < 60; i++) {
    const r1 = rng();
    const r2 = rng();
    const x = clamp(cx + (r1 + r2 - 1) * 95, PANEL.x + 26, PANEL.x + PANEL.w - 22);
    const layer = i % 2;
    const y = PANEL.y + PANEL.h - 14 + layer * 6 + rng() * 4;
    slots.push({
      x,
      y,
      rot: (rng() * 2 - 1) * 70,
      scale: 0.34 + rng() * 0.16,
      flip: rng() < 0.5,
      // 随便落:多数侧躺/半横(0.5-0.85),少数完全展开
      flat: 0.5 + rng() * 0.5,
      // 落堆叶都是"走完一生的叶子":目标叶落地时衰老度已拉满(wilt=1),
      // 槽位枯萎度必须在同一量级,否则落堆瞬间颜色跳变
      wilt: 0.85 + rng() * 0.15,
    });
  }
  return slots;
}

// ==================== 整点风起(§7:10:59 → 11:00 大事件) ====================

export type GustKind = "slide" | "fly" | "behind" | "stick";

export interface GustPath {
  kind: GustKind;
  /** 风起后延迟(风从左到右传播,0-0.6s) */
  delay: number;
  dur: number;
  /** u ∈ [0,1](已扣除 delay),返回叶片姿态与整体缩放/透明度 */
  sample: (u: number) => LeafPose & { scale: number; opacity: number };
}

const easeInQuad = (u: number) => u * u;
const easeInOut = (u: number) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u));
const easeOutCubic = (u: number) => 1 - (1 - u) ** 3;

/**
 * 叶堆清空编排(整点风起):与最后一片目标叶脱离同一刻(59 分 59.2s)全堆起飞。
 * 每片叶一条两阶段路径,各不相同:
 * - 阶段 A(0→0.35):从槽位向上跃起、散向窗口各处的随机空中位置(飘满窗口)
 * - 阶段 B(0.35→1):加速飞向各自的出画口——约 45% 顶部、25% 左侧、30% 右侧,
 *   出口位置逐叶随机;全程叠加垂直于主方向的正弦飘舞与持续旋转
 * - behind:从数字层后方掠过(z→2),一律向右出画
 * - stick:彩蛋——"啪"贴上玻璃静停片刻,再被风带走(每小时随机一片)
 */
export function makeGustPaths(slots: PileSlot[], seed: number): GustPath[] {
  const rng = mulberry32(seed ^ 0x5f3a);
  const xs = slots.map((s) => s.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const stickIdx = Math.floor(rng() * slots.length);

  return slots.map((s, i) => {
    // 风从左到右传播(0-0.5s)
    const delay = ((s.x - minX) / Math.max(1, maxX - minX)) * 0.5;
    const roll = rng();
    const kind: GustKind =
      i === stickIdx ? "stick" : roll < 0.25 ? "behind" : roll < 0.6 ? "fly" : "slide";
    const dur = 2.0 + rng() * 0.8;
    const spin = (rng() < 0.5 ? -1 : 1) * (120 + rng() * 200);
    const stickAt = { x: 90 + rng() * 60, y: 56 + rng() * 30 };

    // 阶段 A 终点:窗口上半区的随机空中位置(飘满窗口)
    const midX = PANEL.x + 10 + rng() * (PANEL.w - 20);
    const midY = PANEL.y + 6 + rng() * PANEL.h * 0.55;
    // 阶段 B 终点:各自的出画口(behind 固定向右,从数字后方掠过)
    let exit: Vec;
    if (kind === "behind") {
      exit = { x: SCENE_W + 80, y: midY - 20 - rng() * 40 };
    } else {
      const er = rng();
      if (er < 0.45) exit = { x: midX + (rng() - 0.3) * 140, y: -80 }; // 顶部飘出
      else if (er < 0.7) exit = { x: -80, y: midY - 30 + (rng() - 0.5) * 60 }; // 左侧飘出
      else exit = { x: SCENE_W + 80, y: midY - 20 + (rng() - 0.5) * 80 }; // 右侧飘出
    }
    // 飘舞扰动参数(频率/相位/幅度逐叶不同)
    const wobA = 6 + rng() * 10;
    const wobF = 1.5 + rng() * 2;
    const wobP = rng() * Math.PI * 2;
    // 主方向(用于把扰动投射到路径的法线上)
    const dirx = exit.x - s.x;
    const diry = exit.y - s.y;
    const dirL = Math.hypot(dirx, diry) || 1;

    const sample = (rawU: number): LeafPose & { scale: number; opacity: number } => {
      const u = clamp(rawU, 0, 1);
      // 起飞时叶片从槽位的平躺姿态(半横)逐渐展开:前 30% 完成 flat→1
      const fq = clamp(u / 0.3, 0, 1);
      const flat = lerp(s.flat, 1, fq * fq * (3 - 2 * fq));

      // stick:40% 贴上玻璃 → 静停至 62% → 滑出左上
      if (kind === "stick") {
        if (u < 0.4) {
          const q = easeInOut(u / 0.4);
          return {
            x: lerp(s.x, stickAt.x, q),
            y: lerp(s.y, stickAt.y, q),
            rot: lerp(s.rot, -8, q),
            flipCos: flat,
            z: lerp(1.6, 0, q),
            scale: lerp(s.scale, 1.15, q),
            opacity: 1,
          };
        }
        if (u < 0.62) {
          return { x: stickAt.x, y: stickAt.y, rot: -8, flipCos: 1, z: 0, scale: 1.15, opacity: 1 };
        }
        const q = easeInQuad((u - 0.62) / 0.38);
        return {
          x: stickAt.x - (stickAt.x + 90) * q,
          y: stickAt.y - 36 * q,
          rot: -8 - 60 * q,
          flipCos: 1,
          z: 0,
          scale: 1.15,
          opacity: q > 0.8 ? 1 - (q - 0.8) / 0.2 : 1,
        };
      }

      let x: number;
      let y: number;
      let z: number;
      let scale: number;
      if (u < 0.35) {
        // 阶段 A:向上跃起散开(先快后慢)
        const q = easeOutCubic(u / 0.35);
        x = lerp(s.x, midX, q);
        y = lerp(s.y, midY, q) - 18 * Math.sin(Math.PI * q); // 跃起的弧线
        z = lerp(1.6, 0.5, q);
        scale = lerp(s.scale, 1.05, q);
      } else {
        // 阶段 B:加速飞向出画口
        const q = easeInQuad((u - 0.35) / 0.65);
        x = lerp(midX, exit.x, q);
        y = lerp(midY, exit.y, q);
        z = kind === "behind" ? lerp(0.5, 2, q) : kind === "fly" ? lerp(0.5, 0, q) : lerp(0.5, 0.2, q);
        scale = lerp(1.05, kind === "fly" ? 1.4 : 1.0, q);
      }
      // 飘舞:主方向法线上的正弦扰动
      const wob = wobA * Math.sin(2 * Math.PI * wobF * u + wobP);
      x += (-diry / dirL) * wob;
      y += (dirx / dirL) * wob * 0.5;
      // 出画前渐隐
      const opacity = u > 0.85 ? 1 - (u - 0.85) / 0.15 : 1;
      return {
        x,
        y,
        rot: s.rot + spin * u,
        flipCos: Math.cos(u * Math.PI * (2 + wobF)) * flat,
        z,
        scale,
        opacity,
      };
    };

    return { kind, delay, dur, sample };
  });
}
