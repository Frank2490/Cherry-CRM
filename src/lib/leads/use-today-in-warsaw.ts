"use client";

import { useEffect, useState } from "react";
import { getTodayInWarsaw, millisecondsUntilNextWarsawDay } from "@/lib/leads/dates";

export function useTodayInWarsaw(initialToday: string) {
  const [today, setToday] = useState(initialToday);

  useEffect(() => {
    let timer: number | undefined;
    const updateToday = () => {
      window.clearTimeout(timer);
      timer = undefined;
      // W tle nie utrzymujemy timera. Po powrocie od razu sprawdzamy zegar,
      // także gdy przeglądarka uśpiła kartę na kilka dni.
      if (document.visibilityState === "hidden") return;
      const now = new Date();
      setToday(getTodayInWarsaw(now));
      timer = window.setTimeout(updateToday, millisecondsUntilNextWarsawDay(now));
    };
    updateToday();
    window.addEventListener("focus", updateToday);
    window.addEventListener("pageshow", updateToday);
    document.addEventListener("visibilitychange", updateToday);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", updateToday);
      window.removeEventListener("pageshow", updateToday);
      document.removeEventListener("visibilitychange", updateToday);
    };
  }, []);

  return today;
}
