/** 林间小屋(v5)昼夜相位:窗景光随一天中的时间流转。
 *  晨 5-9 / 昼 9-17 / 暮 17-20 / 夜 其余——与 v5 设计一致 */

export type CabinPhase = "dawn" | "day" | "dusk" | "night";

export function cabinPhase(d: Date): CabinPhase {
  const h = d.getHours();
  if (h >= 5 && h < 9) return "dawn";
  if (h >= 9 && h < 17) return "day";
  if (h >= 17 && h < 20) return "dusk";
  return "night";
}
