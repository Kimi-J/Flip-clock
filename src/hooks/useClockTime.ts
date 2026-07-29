import { useEffect, useState } from "react";

export interface ClockTime {
  hours: number;
  minutes: number;
  seconds: number;
  date: Date;
}

function split(now: Date, is24: boolean): ClockTime {
  let h = now.getHours();
  if (!is24) {
    h = h % 12;
    if (h === 0) h = 12;
  }
  return {
    hours: h,
    minutes: now.getMinutes(),
    seconds: now.getSeconds(),
    date: now,
  };
}

/**
 * 时钟时间 hook,每秒更新一次,与系统时钟对齐到秒边界。
 */
export function useClockTime(is24Hour: boolean): ClockTime {
  const [time, setTime] = useState<ClockTime>(() => split(new Date(), is24Hour));

  useEffect(() => {
    let raf = 0;
    let timer = 0;

    const tick = () => {
      const now = new Date();
      setTime(split(now, is24Hour));
      // 对齐到下一个秒边界
      const ms = now.getMilliseconds();
      timer = window.setTimeout(() => {
        raf = requestAnimationFrame(tick);
      }, 1000 - ms);
    };

    tick();

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [is24Hour]);

  return time;
}
