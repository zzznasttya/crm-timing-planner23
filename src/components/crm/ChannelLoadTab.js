import React, { useMemo, useState } from "react";
import { addDays, format } from "date-fns";
import { formatDisplayDate, getChannelDisplayName } from "../../lib/crm-store";
import WeekRangeNavigator, {
  buildPeriodRange,
  getCurrentWeekStart,
} from "./WeekRangeNavigator";

function isLaunchActiveOnDay(launch, dayString) {
  return (
    launch?.startDate &&
    launch?.endDate &&
    dayString >= launch.startDate &&
    dayString <= launch.endDate
  );
}

function getDayStrings(periodStart, daysCount) {
  return Array.from({ length: daysCount }, (_, index) =>
    format(addDays(periodStart, index), "yyyy-MM-dd")
  );
}

function getLoadTone(ratio) {
  if (ratio >= 0.7) return "#b43a3a";
  if (ratio >= 0.35) return "#17181a";
  return "#cfcfcf";
}

export default function ChannelLoadTab({ launches, channels }) {
  const [calendarMode, setCalendarMode] = useState("2w");
  const [periodStart, setPeriodStart] = useState(getCurrentWeekStart);

  const today = format(new Date(), "yyyy-MM-dd");
  const period = buildPeriodRange(periodStart, calendarMode);
  const dayStrings = useMemo(
    () => getDayStrings(period.start, period.days),
    [period.start, period.days]
  );

  const channelLoad = useMemo(() => {
    return channels.map((channel) => {
      const currentLaunches = launches.filter(
        (launch) =>
          launch.channelId === channel.id && isLaunchActiveOnDay(launch, today)
      );

      const timeline = dayStrings.map((day) =>
        launches.filter(
          (launch) =>
            launch.channelId === channel.id && isLaunchActiveOnDay(launch, day)
        ).length
      );

      const activeDays = timeline.filter((count) => count > 0).length;
      const peakDailyLoad = timeline.length ? Math.max(...timeline) : 0;
      const periodLaunches = launches.filter(
        (launch) =>
          launch.channelId === channel.id &&
          launch.startDate &&
          launch.endDate &&
          launch.startDate <= dayStrings[dayStrings.length - 1] &&
          launch.endDate >= dayStrings[0]
      );

      return {
        channel,
        currentLaunches,
        currentLoad: currentLaunches.length,
        timeline,
        activeDays,
        peakDailyLoad,
        periodLaunches,
        loadRatio: period.days ? activeDays / period.days : 0,
      };
    });
  }, [channels, launches, today, dayStrings, period.days]);

  const activeNowCount = channelLoad.filter((item) => item.currentLoad > 0).length;
  const busiestNow = [...channelLoad].sort(
    (a, b) => b.currentLoad - a.currentLoad || b.peakDailyLoad - a.peakDailyLoad
  )[0];
  const averageLoad = channelLoad.length
    ? channelLoad.reduce((sum, item) => sum + item.loadRatio, 0) / channelLoad.length
    : 0;

  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
          gap: "12px",
          marginBottom: "16px",
        }}
      >
        <div className="section-card">
          <div className="muted small">Активно сейчас</div>
          <div style={{ fontSize: "30px", fontWeight: 800 }}>{activeNowCount}</div>
          <div className="small muted">каналов из {channels.length}</div>
        </div>
        <div className="section-card">
          <div className="muted small">Средняя загрузка периода</div>
          <div style={{ fontSize: "30px", fontWeight: 800 }}>
            {Math.round(averageLoad * 100)}%
          </div>
          <div className="small muted">
            доля дней, где канал занят хотя бы одним запуском
          </div>
        </div>
        <div className="section-card">
          <div className="muted small">Самый занятый сейчас</div>
          <div style={{ fontSize: "22px", fontWeight: 800 }}>
            {busiestNow?.currentLoad
              ? getChannelDisplayName(busiestNow.channel) || "—"
              : "—"}
          </div>
          <div className="small muted">
            {busiestNow?.currentLoad
              ? `${busiestNow.currentLoad} активн. запуск(ов)`
              : "все каналы сейчас свободны"}
          </div>
        </div>
      </div>

      <WeekRangeNavigator
        mode={calendarMode}
        periodStart={periodStart}
        onModeChange={setCalendarMode}
        onPeriodStartChange={setPeriodStart}
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "14px",
          marginTop: "16px",
        }}
      >
        {channelLoad.map((item) => {
          const displayName = getChannelDisplayName(item.channel) || "Без названия";
          const maxBarValue = Math.max(1, item.peakDailyLoad);
          const activeNow = item.currentLoad > 0;

          return (
            <div key={item.channel.id} className="section-card">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "16px",
                  alignItems: "flex-start",
                  marginBottom: "14px",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div
                    style={{
                      display: "flex",
                      gap: "10px",
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ fontSize: "20px", fontWeight: 800 }}>
                      {displayName}
                    </div>
                    <span
                      className={
                        activeNow ? "badge badge-green-light" : "badge"
                      }
                    >
                      {activeNow
                        ? `Сейчас активен: ${item.currentLoad}`
                        : "Сейчас свободен"}
                    </span>
                  </div>
                  <div className="small muted" style={{ marginTop: "4px" }}>
                    {formatDisplayDate(dayStrings[0])} —{" "}
                    {formatDisplayDate(dayStrings[dayStrings.length - 1])}
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3,minmax(110px,1fr))",
                    gap: "10px",
                    minWidth: "340px",
                    flex: 1,
                  }}
                >
                  <div>
                    <div className="muted small">Занятые дни</div>
                    <div style={{ fontWeight: 800, fontSize: "18px" }}>
                      {item.activeDays} / {period.days}
                    </div>
                  </div>
                  <div>
                    <div className="muted small">Запусков в периоде</div>
                    <div style={{ fontWeight: 800, fontSize: "18px" }}>
                      {item.periodLaunches.length}
                    </div>
                  </div>
                  <div>
                    <div className="muted small">Пик в день</div>
                    <div style={{ fontWeight: 800, fontSize: "18px" }}>
                      {item.peakDailyLoad}
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: "12px" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "10px",
                    alignItems: "center",
                    marginBottom: "6px",
                  }}
                >
                  <div className="muted small">Загрузка за период</div>
                  <div style={{ fontWeight: 700, fontSize: "13px" }}>
                    {Math.round(item.loadRatio * 100)}%
                  </div>
                </div>
                <div
                  style={{
                    height: "10px",
                    borderRadius: "999px",
                    background: "#efefef",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.max(4, Math.round(item.loadRatio * 100))}%`,
                      height: "100%",
                      borderRadius: "999px",
                      background: getLoadTone(item.loadRatio),
                    }}
                  />
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${dayStrings.length}, minmax(8px, 1fr))`,
                  gap: "4px",
                  alignItems: "end",
                  minHeight: "92px",
                }}
              >
                {item.timeline.map((count, index) => (
                  <div
                    key={dayStrings[index]}
                    title={`${formatDisplayDate(dayStrings[index])}: ${count} запуск(ов)`}
                    style={{
                      height: `${count === 0 ? 10 : 10 + (count / maxBarValue) * 58}px`,
                      borderRadius: "999px",
                      background:
                        count === 0
                          ? "#e5e5e5"
                          : count === item.peakDailyLoad
                          ? "#b43a3a"
                          : "#17181a",
                      opacity: count === 0 ? 0.7 : 1,
                    }}
                  />
                ))}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${dayStrings.length}, minmax(8px, 1fr))`,
                  gap: "4px",
                  marginTop: "8px",
                }}
              >
                {dayStrings.map((day, index) => (
                  <div
                    key={day + "-label"}
                    style={{
                      fontSize: "10px",
                      color: "#666",
                      textAlign: "center",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {index === 0 ||
                    index === dayStrings.length - 1 ||
                    index % 7 === 0
                      ? format(new Date(`${day}T00:00:00`), "dd.MM")
                      : ""}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
