/**
 * 叶落成时 · 落叶动力学与路径生成(纯函数,无 DOM 依赖,可单测)
 *
 * 设计原则(设计文档 §4):目标驱动 + 拒绝采样,而非自由模拟。
 * 先定约束(57.6s 脱离枝头、60.0s 恰好遮住分钟个位数字、随后落向叶堆槽位),
 * 再生成满足约束的飘落路径;覆盖率不达标换种子重试,兜底退化为直线基线。
 */

// ==================== 场景常量(基准分辨率 320×180,壳层等比缩放不感知) ====================

export const SCENE_W = 320;
export const SCENE_H = 180;

/** 内容面板(骨白内壁):四边 20px 留白供投影/叶片飞出 */
export const PANEL = { x: 20, y: 20, w: 280, h: 140 } as const;

/** 目标叶在枝头的锚点(枝梢) */
export const BRANCH_TIP = { x: 250, y: 58 } as const;

/** 银杏叶横置尺寸:数字字框的 ~1.3 倍,足够罩住个位数字(含安全边) */
export const LEAF_W = 96;
export const LEAF_H = 76;

/** 阶段时刻(分钟内秒,浮点) */
export const DETACH_SEC = 57.6;
export const COVER_SEC = 60.0;
export const COVER_WIN: readonly [number, number] = [59.85, 60.15];
/** 覆盖窗口内叶片对数字墨迹的最低覆盖率(墨点判定;字形网格兜底时为 0.85) */
export const COVER_MIN = 0.9;
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
  // 覆盖阻尼:叶子经过数字时摆幅短暂收敛(60s 处 -75%,±0.5s 处 -35%),
  // 视觉上是"飘到数字前稍作稳定",工程上进一步压紧覆盖窗口的横向漂移
  const swayDamp = (t: number) => 1 - 0.75 * Math.exp(-(((t - COVER_SEC) / 0.45) ** 2));

  // ---- 翻面/自旋 ----
  const flipFreq = 0.3 + rng() * 0.25; // Hz
  // 翻面相位与覆盖时刻绑定(同 φ1 的约束求解思路):60.0s 时 |cos|=1 叶片完全正对,
  // 保证覆盖窗口内横向张开度 ≥ 86%,且"叶展全貌遮数字"正是视觉主镜头;
  // 正/反面与频率仍由 seed 决定(±0.15rad 抖动保持多样)
  const flipPhase = (rng() < 0.5 ? 0 : Math.PI) - 2 * Math.PI * flipFreq * COVER_SEC + (rng() - 0.5) * 0.3;
  const rotRate = (rng() * 2 - 1) * 25; // deg/s 慢速进动
  // 覆盖时刻叶形姿态绑定(同 φ1/翻面的约束思路):60.0s 时叶片横置(设计文档
  //  §4.2"银杏横置")——叶柄朝侧、扇面竖向铺开,竖向展开 ~96px 从容罩住数字
  //  全高;正立时收腰叶柄罩不住字形的下半行墨迹(实测只有 ~0.8)。
  //  ±90° 朝向由 seed 决定(±12° 抖动保持多样),叶片一路翻转进入横置扫过数字
  const targetRot = (rng() < 0.5 ? -90 : 90) + (rng() * 2 - 1) * 12;
  const rot0 = targetRot - rotRate * (COVER_SEC - DETACH_SEC);

  // ---- 竖向:A 段混合 easing(0.35·easeInQuad + 0.65·easeInOutSine) ----
  // 末端速度系数 E'(1)=0.7:叶片以 ~0.3 倍平均速度柔和"飘到"数字上,
  // 而非高速掠过——覆盖窗口 ±0.15s 内竖直漂移 ~3px,远在叶片/数字余量内;
  // 视觉上是"飘到数字前稍作停留,再加速落向叶堆"(遮挡工程的根基,§4.2)
  const easeA = (u: number) => 0.35 * u * u + 0.65 * (1 - Math.cos(Math.PI * u)) / 2;
  const v1 = (0.7 * (cy - o.start.y)) / segA; // A 段末端竖直速度

  // ---- B 段(覆盖后→落堆):运动时间 m(气流托停时真实时间被减速映射) ----
  const normalT = 0.55 + rng() * 0.3; // 常规运动时长
  let motionT = style === "gust" ? normalT + 0.25 : style === "straight" ? normalT - 0.05 : normalT;
  let hoverH0 = 0;
  let hoverH1 = 0;
  const HOVER_RATE = 0.12;
  if (style === "hover") {
    // 悬停只允许发生在通过 coverPoint 之后(§4.1),从覆盖后 0.25s 起 ~1.1s
    hoverH0 = 0.25;
    hoverH1 = 1.35;
    motionT = normalT + 0.4;
  }
  const extra = style === "hover" ? (1 - HOVER_RATE) * (hoverH1 - hoverH0) : 0;
  const landSec = COVER_SEC + motionT + extra;

  // 真实时间 τ(覆盖后) → 运动时间 m
  const warp = (tau: number) => {
    if (style !== "hover") return tau;
    if (tau < hoverH0) return tau;
    if (tau < hoverH1) return hoverH0 + HOVER_RATE * (tau - hoverH0);
    return hoverH0 + HOVER_RATE * (hoverH1 - hoverH0) + (tau - hoverH1);
  };

  // B 段竖向抛物线:y = cy + v1·m + ½·a·m²,终点命中槽位
  const ay = (2 * (o.slot.y - cy - v1 * motionT)) / (motionT * motionT);

  // 风卷:路径中段上升环(运动时间中段)
  const gustR = 20 + rng() * 20;
  const gustM0 = motionT * 0.25;
  const gustM1 = motionT * 0.8;
  const gustDir = rng() < 0.5 ? -1 : 1;

  // 直落横滑:落地前横向滑出(末段 30%)
  const slideX = (rng() * 2 - 1) * 26;

  const sample = (t: number): LeafPose => {
    const tc = clamp(t, DETACH_SEC, landSec);

    // ---- 基线 ----
    let bx: number;
    let by: number;
    let z: number;
    let poseScale: number;
    if (tc <= COVER_SEC) {
      const u = (tc - DETACH_SEC) / segA;
      bx = lerp(o.start.x, cx, u);
      by = lerp(o.start.y, cy, easeA(u));
      z = lerp(0.45, 1, u);
      poseScale = 1 + (1 - z) * 0.15; // 近玻璃略放大(纵深)
    } else {
      const m = clamp(warp(tc - COVER_SEC), 0, motionT);
      const mu = m / motionT;
      // 横向 mu² 缓出:覆盖后初速为 0,先"沉"再滑向槽位——
      // 槽位在远处时也不会在覆盖窗口边缘急掠(覆盖率与观感的双重保证)
      bx = lerp(cx, o.slot.x, mu * mu);
      by = cy + v1 * m + 0.5 * ay * m * m;
      z = lerp(1, 1.6, mu);
      // 落向叶堆时向槽位尺寸收拢:后退进纵深的收缩感,与堆中叶片尺寸一致
      poseScale = lerp(1, o.slot.scale, mu);
      if (style === "gust" && m > gustM0 && m < gustM1) {
        const q = (m - gustM0) / (gustM1 - gustM0);
        bx += ((gustR * (1 - Math.cos(2 * Math.PI * q))) / 2) * gustDir;
        by -= gustR * Math.sin(Math.PI * q) * 1.1;
        z -= Math.sin(Math.PI * q) * 0.35; // 上升环中更靠近玻璃
      }
      if (style === "straight" && mu > 0.7) {
        const q = (mu - 0.7) / 0.3;
        bx += slideX * q * q * (3 - 2 * q); // smoothstep 横滑
      }
    }

    // ---- 摆动/自旋/翻面(用真实时间,悬停中叶子仍在抖) ----
    const env = swayEnv(tc) * swayDamp(tc);
    const x = bx + swayX(tc) * env;
    const flipCos = Math.cos(2 * Math.PI * flipFreq * tc + flipPhase);
    const rot = rot0 + rotRate * (tc - DETACH_SEC) + (swayX(tc) - swayX(tc - 0.05)) * env * 1.2;

    return { x, y: by, rot, flipCos, z, scale: poseScale };
  };

  // ---- 覆盖率自检(§4.2):覆盖窗口内叶片包围盒对数字包围盒的面积覆盖率 ----
  const coverage = measureCoverage(sample, o.cover);

  return {
    style,
    landSec,
    coverage,
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

/** 覆盖率采样:有墨点集则判定墨点(诚实定义:看不见跳变 = 墨迹被覆盖),
 *  否则退化为 5×5 网格。取覆盖窗口 [59.85, 60.15] 内最小值。
 *  叶形按姿态(平移/旋转/翻面压缩)反变换到 viewBox 坐标系后逐点判定 */
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
    const flipAbs = Math.max(Math.abs(p.flipCos), 0.3);
    const rad = (-p.rot * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    // 场景 px → viewBox 单位的比例(叶片 96×76 渲染 100×80 的叶形)
    const sx = 100 / LEAF_W;
    const sy = 80 / LEAF_H;
    let inside = 0;
    for (const pt of points) {
      const dx = pt.x - p.x;
      const dy = pt.y - p.y;
      // 逆旋转 → 逆翻面压缩 → viewBox 坐标(叶中心 = (50,40))
      const lx = ((dx * cos - dy * sin) / flipAbs) * sx + 50;
      const ly = (dx * sin + dy * cos) * sy + 40;
      if (pointInBlade(lx, ly)) inside++;
    }
    worst = Math.min(worst, inside / points.length);
  }
  return worst;
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
      wilt: 0.25 + rng() * 0.45,
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

/**
 * 叶堆清空编排:每片叶一条迷你路径。
 * - slide:贴玻璃滑出(z→0,大 blur,向左上出画)
 * - fly:旋转飞向观者(scale→1.4,向上出画)
 * - behind:从数字后方掠过(z→2,向右出画)
 * - stick:彩蛋——"啪"贴上玻璃静停 300ms,再被风带走(每小时随机一片)
 */
export function makeGustPaths(slots: PileSlot[], seed: number): GustPath[] {
  const rng = mulberry32(seed ^ 0x5f3a);
  const xs = slots.map((s) => s.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const stickIdx = Math.floor(rng() * slots.length);

  return slots.map((s, i) => {
    const delay = ((s.x - minX) / Math.max(1, maxX - minX)) * 0.6;
    const roll = rng();
    const kind: GustKind =
      i === stickIdx ? "stick" : roll < 0.34 ? "slide" : roll < 0.67 ? "fly" : "behind";
    const dur = kind === "slide" ? 1.2 : kind === "fly" ? 1.4 : kind === "behind" ? 1.6 : 1.8;
    const spin = (rng() < 0.5 ? -1 : 1) * (180 + rng() * 240);
    const stickAt = { x: 90 + rng() * 60, y: 56 + rng() * 30 };

    const sample = (rawU: number): LeafPose & { scale: number; opacity: number } => {
      const u = clamp(rawU, 0, 1);
      if (kind === "slide") {
        return {
          x: s.x - (s.x - PANEL.x + 70) * easeInQuad(u),
          y: s.y - 44 * Math.sin(Math.PI * u) * 0.8 - 18 * u,
          rot: s.rot + spin * 0.3 * u,
          flipCos: s.flip ? -1 : 1,
          z: lerp(1.6, 0.2, u),
          scale: s.scale,
          opacity: 1,
        };
      }
      if (kind === "fly") {
        return {
          x: s.x + 60 * u,
          y: s.y - (s.y - PANEL.y + 80) * easeInQuad(u),
          rot: s.rot + spin * u,
          flipCos: Math.cos(u * Math.PI * 4),
          z: lerp(1.6, 0, u),
          scale: lerp(s.scale, 1.4, u),
          opacity: 1,
        };
      }
      if (kind === "behind") {
        return {
          x: s.x + (PANEL.x + PANEL.w + 70 - s.x) * easeInOut(u),
          y: s.y - 30 * Math.sin(Math.PI * u),
          rot: s.rot + spin * 0.4 * u,
          flipCos: s.flip ? -1 : 1,
          z: lerp(1.6, 2, u),
          scale: s.scale * 0.95,
          opacity: 0.85,
        };
      }
      // stick:40% 贴上玻璃 → 静停至 70%(≈300ms+) → 滑出
      if (u < 0.4) {
        const q = easeInOut(u / 0.4);
        return {
          x: lerp(s.x, stickAt.x, q),
          y: lerp(s.y, stickAt.y, q),
          rot: lerp(s.rot, -8, q),
          flipCos: 1,
          z: lerp(1.6, 0, q),
          scale: lerp(s.scale, 1.15, q),
          opacity: 1,
        };
      }
      if (u < 0.7) {
        return { x: stickAt.x, y: stickAt.y, rot: -8, flipCos: 1, z: 0, scale: 1.15, opacity: 1 };
      }
      const q = easeInQuad((u - 0.7) / 0.3);
      return {
        x: stickAt.x - (stickAt.x + 80) * q,
        y: stickAt.y - 30 * q,
        rot: -8 - 60 * q,
        flipCos: 1,
        z: 0,
        scale: 1.15,
        opacity: 1,
      };
    };

    return { kind, delay, dur, sample };
  });
}
