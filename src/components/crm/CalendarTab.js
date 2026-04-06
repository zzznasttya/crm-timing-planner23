import React, { useMemo, useState } from "react";
import { addDays, format, startOfWeek } from "date-fns";
import {
  calculateCRMPressure,
  getChannelName,
  GAMES,
} from "../../lib/crm-store";

function getPressureLevel(pressure) {
  if (pressure <= 6) return "low";
  if (pressure <= 10) return "medium";
  return "high";
}

export default function CalendarTab({ launches, channels }) {
  const [mode, setMode] = useState("2w");
  const [periodStart, setPeriodStart] = useState(
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );

  const daysCount = mode === "2w" ? 14 : 30;

  const days = useMemo(() => {
    return Array.from({ length: daysCount }, (_, i) => addDays(periodStart, i));
  }, [periodStart, daysCount]);

  function prevPeriod() {
    setPeriodStart(addDays(periodStart, -daysCount));
  }

  function nextPeriod() {
    setPeriodStart(addDays(periodStart, daysCount));
  }

  function todayPeriod() {
    setPeriodStart(startOfWeek(new Date(), { weekStartsOn: 1 }));
  }

  function isLaunchActiveOnDay(launch, dayString) {
    return dayString >= launch.startDate && dayString <= launch.endDate;
  }

  function getLaunchTitle(launch) {
    return launch.game || launch.name || GAMES[0];
  }

  function getCellClassName(launch, dayString) {
    const active = isLaunchActiveOnDay(launch, dayString);
    if (!active) return "calendar-cell";

    let className = "calendar-cell calendar-cell-active";

    if (launch.conflictStatus === "conflict") {
      className += " calendar-cell-conflict";
    }

    return className;
  }

  return (
    <div>
      <div className="calendar-controls">
        <div className="calendar-nav">
          <button className="btn" onClick={todayPeriod}>
            Сегодня
          </button>
          <button className="btn" onClick={prevPeriod}>
            ←
          </button>
          <button className="btn" onClick={nextPeriod}>
            →
          </button>
          <div className="calendar-range">
            {format(days[0], "dd.MM.yyyy")} —{" "}
            {format(days[days.length - 1], "dd.MM.yyyy")}
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="2w">2 недели</option>
            <option value="month">Месяц</option>
          </select>
        </div>
      </div>

      <div
        className="calendar-grid"
        style={{
          gridTemplateColumns:
            mode === "2w" ? "220px repeat(14, 1fr)" : "220px repeat(30, 1fr)",
        }}
      >
        <div className="calendar-header sticky-col">Запуск</div>

        {days.map((day) => {
          const dayString = format(day, "yyyy-MM-dd");
          const pressure = calculateCRMPressure(dayString, launches);
          const level = getPressureLevel(pressure);

          return (
            <div
              key={dayString}
              className={`calendar-header pressure-${level}`}
            >
              <div>{format(day, "dd.MM")}</div>
              <div className="calendar-pressure">{pressure}</div>
            </div>
          );
        })}

        {launches.map((launch) => (
          <React.Fragment key={launch.id}>
            <div className="calendar-row-title sticky-col">
              <div className="card-title small">{getLaunchTitle(launch)}</div>
              <div className="muted small">
                {getChannelName(launch.channelId, channels)} · {launch.platform}
              </div>
              <div className="muted small">{launch.audience || "—"}</div>
            </div>

            {days.map((day) => {
              const dayString = format(day, "yyyy-MM-dd");

              return (
                <div
                  key={launch.id + dayString}
                  className={getCellClassName(launch, dayString)}
                  title={
                    isLaunchActiveOnDay(launch, dayString)
                      ? `${getLaunchTitle(launch)}\n${launch.startDate} — ${
                          launch.endDate
                        }\n${getChannelName(launch.channelId, channels)}\n${
                          launch.audience || "—"
                        }`
                      : ""
                  }
                />
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
