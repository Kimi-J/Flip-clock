import { useMemo } from "react";
import type { BackgroundMode } from "@/store/clockStore";

interface AmbientBackgroundProps {
  mode: BackgroundMode;
}

/**
 * 氛围背景层。
 * - minimal(极简):仅基础径向渐变,纯净无装饰
 * - aurora(极光):3 层柔和光晕缓慢漂移,颜色跟随主题强调色
 * - starry(星空):闪烁星点 + 1 层淡光晕,营造夜空感
 *
 * 光晕颜色用 color-mix(accent, transparent) 而非 --bg-glow 变量,
 * 确保所有主题(含极简黑/极简白)都有可见且协调的光晕。
 */
export default function AmbientBackground({ mode }: AmbientBackgroundProps) {
  // 星点:60 个,随机位置/大小/闪烁周期
  const stars = useMemo(
    () =>
      Array.from({ length: 60 }, () => ({
        left: Math.random() * 100,
        top: Math.random() * 100,
        size: 1 + Math.random() * 2,
        delay: Math.random() * 6,
        duration: 2 + Math.random() * 4,
        peak: 0.4 + Math.random() * 0.6, // 闪烁峰值亮度
      })),
    [],
  );

  // 光晕颜色:跟随主题强调色,极淡
  const glowColor = "color-mix(in srgb, var(--accent) 11%, transparent)";
  const glowColorSoft = "color-mix(in srgb, var(--accent) 7%, transparent)";

  return (
    <div className="fixed inset-0 z-0 overflow-hidden" aria-hidden>
      {/* 基础径向渐变背景(所有模式共有) */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 120% at 50% 40%, var(--bg-via) 0%, var(--bg-from) 60%, var(--bg-to) 100%)",
        }}
      />

      {/* 极光:垂直光幕叠加,极光色谱(翠绿/青/紫/粉),blur + skew 流动波动 */}
      {mode === "aurora" && (
        <>
          {/* 主光带:翠绿→青,左侧 */}
          <div
            className="absolute"
            style={{
              width: "34%",
              height: "85%",
              left: "4%",
              top: "-5%",
              background:
                "linear-gradient(180deg, transparent 0%, rgba(0,255,157,0.55) 35%, rgba(0,212,255,0.5) 65%, transparent 100%)",
              filter: "blur(50px)",
              transformOrigin: "top center",
              animation: "aurora-wave-a 20s ease-in-out infinite",
              opacity: 0.55,
            }}
          />
          {/* 中光带:青→紫,中部偏左 */}
          <div
            className="absolute"
            style={{
              width: "26%",
              height: "78%",
              left: "33%",
              top: "-3%",
              background:
                "linear-gradient(180deg, transparent 0%, rgba(0,212,255,0.45) 30%, rgba(168,85,247,0.5) 70%, transparent 100%)",
              filter: "blur(60px)",
              transformOrigin: "top center",
              animation: "aurora-wave-b 25s ease-in-out infinite",
              opacity: 0.5,
            }}
          />
          {/* 右光带:紫→粉,右侧 */}
          <div
            className="absolute"
            style={{
              width: "30%",
              height: "72%",
              left: "63%",
              top: "-2%",
              background:
                "linear-gradient(180deg, transparent 0%, rgba(168,85,247,0.45) 35%, rgba(236,72,153,0.45) 70%, transparent 100%)",
              filter: "blur(55px)",
              transformOrigin: "top center",
              animation: "aurora-wave-c 22s ease-in-out infinite",
              opacity: 0.5,
            }}
          />
          {/* 底部弥散宽幕:翠绿,呼吸 */}
          <div
            className="absolute"
            style={{
              width: "60%",
              height: "45%",
              left: "20%",
              bottom: "-10%",
              background:
                "linear-gradient(180deg, transparent 0%, rgba(0,255,157,0.35) 50%, transparent 100%)",
              filter: "blur(80px)",
              animation: "aurora-breathe 28s ease-in-out infinite",
              opacity: 0.4,
            }}
          />
        </>
      )}

      {/* 星空:淡光晕 + 闪烁星点 */}
      {mode === "starry" && (
        <>
          <div
            className="absolute rounded-full"
            style={{
              width: "55vmax",
              height: "55vmax",
              left: "20%",
              top: "15%",
              background: `radial-gradient(circle, ${glowColorSoft} 0%, transparent 70%)`,
              filter: "blur(70px)",
              animation: "glow-drift-slow 32s ease-in-out infinite",
            }}
          />
          <div className="absolute inset-0">
            {stars.map((s, i) => (
              <span
                key={i}
                className="absolute rounded-full"
                style={{
                  left: `${s.left}%`,
                  top: `${s.top}%`,
                  width: `${s.size}px`,
                  height: `${s.size}px`,
                  background: "var(--accent)",
                  boxShadow: `0 0 ${s.size * 2.5}px var(--accent)`,
                  animation: `star-twinkle ${s.duration}s ease-in-out ${s.delay}s infinite`,
                  // 闪烁峰值通过 CSS 变量传入 keyframes
                  ["--peak" as string]: s.peak,
                } as React.CSSProperties}
              />
            ))}
          </div>
        </>
      )}

      {/* 噪点纹理(极简模式下也保留极淡噪点增加质感,主题可通过 --noise-opacity 关闭) */}
      <div className="absolute inset-0 noise-layer pointer-events-none" />

      <style>{`
        @keyframes star-twinkle {
          0%, 100% { opacity: 0.12; transform: scale(0.8); }
          50% { opacity: var(--peak, 0.8); transform: scale(1.1); }
        }
      `}</style>
    </div>
  );
}
