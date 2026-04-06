import React from "react";
import { addDays, format, startOfWeek } from "date-fns";

export const WEEK_RANGE_OPTIONS = [
  { value: "1w", label: "1 неделя", days: 7 },
  { value: "2w", label: "2 недели", days: 14 },
  { value: "4w", label: "4 недели", days: 28 },
];

export function getWeekRangeDays(mode) {
  return WEEK_RANGE_OPTIONS.find((option) => option.value === mode)?.days || 14;
}

export function getCurrentWeekStart() {
  return startOfWeek(new Date(), { weekStartsOn: 1 });
}

export function buildPeriodRange(periodStart, mode) {
  const days = getWeekRangeDays(mode);
  return {
    start: periodStart,
    end: addDays(periodStart, days - 1),
    days,
  };
}

export default function WeekRangeNavigator({
  mode,
  periodStart,
  onModeChange,
  onPeriodStartChange,
}) {
  const { start, end, days } = buildPeriodRange(periodStart, mode);

  return (
    <div className="calendar-controls">
      <div className="calendar-nav">
        <button
          className="btn"
          onClick={() => onPeriodStartChange(getCurrentWeekStart())}
        >
          Сегодня
        </button>
        <button
          className="btn"
          onClick={() => onPeriodStartChange(addDays(periodStart, -days))}
        >
          ←
        </button>
        <button
          className="btn"
          onClick={() => onPeriodStartChange(addDays(periodStart, days))}
        >
          →
        </button>
        <div className="calendar-range">
          {format(start, "dd.MM.yyyy")} — {format(end, "dd.MM.yyyy")}
        </div>
      </div>

      <div style={{ display: "flex", gap: "8px" }}>
        <select value={mode} onChange={(e) => onModeChange(e.target.value)}>
          {WEEK_RANGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
