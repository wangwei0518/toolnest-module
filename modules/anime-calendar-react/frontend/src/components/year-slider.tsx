import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const yearOffsets = [-2, -1, 0, 1, 2] as const;
const wheelThreshold = 60;
const wheelQueueLimit = 6;
const wheelBaseDuration = 160;
const wheelMinDuration = 64;
const wheelAcceleration = 16;

interface YearSliderProps {
  value: number;
  onChange: (value: number) => void;
  variant?: "default" | "toolbar";
  className?: string;
  "aria-label"?: string;
}

export function YearSlider({
  value,
  onChange,
  variant = "toolbar",
  className,
  "aria-label": ariaLabel = "年份选择器",
}: YearSliderProps) {
  const [previewYear, setPreviewYear] = useState(value);
  const [editing, setEditing] = useState(false);
  const [motionDirection, setMotionDirection] = useState<"forward" | "backward" | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const previewYearRef = useRef(value);
  const wheelDelta = useRef(0);
  const wheelQueue = useRef(0);
  const wheelTimer = useRef<number | null>(null);

  const preview = useCallback((nextYear: number) => {
    const currentPreview = previewYearRef.current;
    if (nextYear !== currentPreview) {
      setMotionDirection(nextYear > currentPreview ? "forward" : "backward");
    }
    previewYearRef.current = nextYear;
    setPreviewYear(nextYear);
  }, []);

  const commit = useCallback((nextYear: number) => {
    preview(nextYear);
    onChange(nextYear);
    setEditing(false);
  }, [onChange, preview]);

  useEffect(() => {
    if (editing) return;
    previewYearRef.current = value;
    setPreviewYear(value);
  }, [editing, value]);

  useEffect(() => {
    if (!editing) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const picker = pickerRef.current;
      if (picker && !picker.contains(event.target as Node)) commit(previewYearRef.current);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [commit, editing]);

  useEffect(() => {
    const picker = pickerRef.current;
    if (!picker || !editing) return undefined;

    const playNextWheelStep = () => {
      if (wheelTimer.current !== null || wheelQueue.current === 0) return;
      const direction = wheelQueue.current > 0 ? 1 : -1;
      wheelQueue.current -= direction;
      const pendingSteps = Math.abs(wheelQueue.current);
      const stepDuration = Math.max(wheelMinDuration, wheelBaseDuration - Math.max(0, pendingSteps - 1) * wheelAcceleration);
      picker.style.setProperty("--tn-anime-year-motion-duration", `${stepDuration}ms`);
      preview(previewYearRef.current + direction);
      wheelTimer.current = window.setTimeout(() => {
        wheelTimer.current = null;
        playNextWheelStep();
      }, stepDuration);
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      wheelDelta.current += event.deltaY;
      while (Math.abs(wheelDelta.current) >= wheelThreshold) {
        const direction = wheelDelta.current > 0 ? 1 : -1;
        wheelDelta.current -= direction * wheelThreshold;
        wheelQueue.current = Math.max(-wheelQueueLimit, Math.min(wheelQueueLimit, wheelQueue.current + direction));
      }
      playNextWheelStep();
    };

    picker.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      picker.removeEventListener("wheel", onWheel);
      if (wheelTimer.current !== null) window.clearTimeout(wheelTimer.current);
      wheelTimer.current = null;
      wheelDelta.current = 0;
      wheelQueue.current = 0;
      picker.style.removeProperty("--tn-anime-year-motion-duration");
    };
  }, [editing, preview]);

  const handleYearClick = (nextYear: number) => {
    if (!editing) {
      setEditing(true);
      return;
    }
    commit(nextYear);
  };

  return (
    <div
      ref={pickerRef}
      className={cn(
        "tn-anime-year-slider__picker",
        variant === "toolbar" && "tn-anime-year-slider__picker--toolbar",
        editing && "is-editing",
        className,
      )}
      aria-label={ariaLabel}
      aria-expanded={editing}
      title="点击当前年份进入编辑模式"
    >
      {yearOffsets.map((offset) => {
        const optionYear = previewYear + offset;
        const selected = offset === 0;
        const entering = (motionDirection === "forward" && offset === 2) || (motionDirection === "backward" && offset === -2);
        return (
          <button
            key={optionYear}
            type="button"
            aria-current={selected ? "date" : undefined}
            className={cn(
              "tn-anime-year-slider__year",
              `tn-anime-year-slider__year--${Math.abs(offset)}`,
              selected && "is-selected",
              entering && `is-entering-${motionDirection}`,
            )}
            onClick={() => handleYearClick(optionYear)}
          >
            {optionYear}
          </button>
        );
      })}
    </div>
  );
}
