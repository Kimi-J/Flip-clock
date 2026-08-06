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

      {/* 极光:垂直光幕叠加,极光色谱(翠绿/青/紫/粉),radial-gradient 自柔光 + skew 流动波动 */}
      {mode === "aurora" && (
        <>
          {/* 主光带:翠绿→青,左侧。radial-gradient 中心向边缘渐隐,无需 blur 即可柔光 */}
          <div
            className="absolute"
            style={{
              width: "45%",
              height: "95%",
              left: "0%",
              top: "-8%",
              background:
                "radial-gradient(ellipse 60% 50% at 50% 45%, rgba(0,255,157,0.55) 0%, rgba(0,212,255,0.4) 45%, transparent 75%)",
              transformOrigin: "top center",
              animation: "aurora-wave-a 20s ease-in-out infinite",
              willChange: "transform, opacity",
              opacity: 0.55,
            }}
          />
          {/* 中光带:青→紫,中部偏左 */}
          <div
            className="absolute"
            style={{
              width: "38%",
              height: "90%",
              left: "28%",
              top: "-6%",
              background:
                "radial-gradient(ellipse 55% 50% at 50% 50%, rgba(0,212,255,0.45) 0%, rgba(168,85,247,0.4) 50%, transparent 75%)",
              transformOrigin: "top center",
              animation: "aurora-wave-b 25s ease-in-out infinite",
              willChange: "transform, opacity",
              opacity: 0.5,
            }}
          />
          {/* 右光带:紫→粉,右侧 */}
          <div
            className="absolute"
            style={{
              width: "42%",
              height: "85%",
              left: "58%",
              top: "-5%",
              background:
                "radial-gradient(ellipse 55% 50% at 50% 48%, rgba(168,85,247,0.45) 0%, rgba(236,72,153,0.4) 50%, transparent 75%)",
              transformOrigin: "top center",
              animation: "aurora-wave-c 22s ease-in-out infinite",
              willChange: "transform, opacity",
              opacity: 0.5,
            }}
          />
          {/* 底部弥散宽幕:翠绿,呼吸 */}
          <div
            className="absolute"
            style={{
              width: "70%",
              height: "55%",
              left: "15%",
              bottom: "-15%",
              background:
                "radial-gradient(ellipse 60% 60% at 50% 50%, rgba(0,255,157,0.35) 0%, transparent 70%)",
              animation: "aurora-breathe 28s ease-in-out infinite",
              willChange: "transform, opacity",
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
