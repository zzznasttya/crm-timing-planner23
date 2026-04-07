import React, { useMemo, useState } from "react";
import { formatDisplayDate, getChannelName } from "../../lib/crm-store";

const MONTHS = [
  { index: 0, key: "01", label: "Январь" },
  { index: 1, key: "02", label: "Февраль" },
  { index: 2, key: "03", label: "Март" },
];

function formatNumber(value) {
  return new Intl.NumberFormat("ru-RU").format(Number(value || 0));
}

function getCurrentYear() {
  return String(new Date().getFullYear());
}

function buildMonthRange(year, monthIndex) {
  const start = new Date(Number(year), monthIndex, 1);
  const end = new Date(Number(year), monthIndex + 1, 0);

  const toIso = (date) => {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  return {
    start: toIso(start),
    end: toIso(end),
  };
}

function launchIntersectsMonth(launch, monthRange) {
  if (!launch?.startDate || !launch?.endDate) return false;
  return launch.startDate <= monthRange.end && launch.endDate >= monthRange.start;
}

function requirementIntersectsMonth(requirement, monthRange) {
  const start =
    requirement?.hasFixedDates === "yes" && requirement?.fixedStartDate
      ? requirement.fixedStartDate
      : requirement?.weekStart;
  const end =
    requirement?.hasFixedDates === "yes" && (requirement?.fixedEndDate || requirement?.fixedStartDate)
      ? requirement.fixedEndDate || requirement.fixedStartDate
      : requirement?.weekEnd;

  if (!start || !end) return false;
  return start <= monthRange.end && end >= monthRange.start;
}

function getRequirementChannelNames(requirement, channels) {
  if (!Array.isArray(requirement?.channelIds) || !requirement.channelIds.length) {
    return "Все доступные";
  }

  return requirement.channelIds
    .map((channelId) => getChannelName(channelId, channels))
    .filter(Boolean)
    .join(", ");
}

export default function Q1PlansTab({ launches, requirements, channels }) {
  const [year, setYear] = useState(getCurrentYear);

  const monthSections = useMemo(() => {
    return MONTHS.map((month) => {
      const range = buildMonthRange(year, month.index);
      const monthLaunches = launches.filter((launch) =>
        launchIntersectsMonth(launch, range)
      );
      const monthRequirements = requirements.filter((requirement) =>
        requirementIntersectsMonth(requirement, range)
      );

      return {
        ...month,
        range,
        launches: monthLaunches,
        requirements: monthRequirements,
      };
    });
  }, [year, launches, requirements]);

  const summary = useMemo(() => {
    const totalLaunches = monthSections.reduce(
      (sum, month) => sum + month.launches.length,
      0
    );
    const totalRequirements = monthSections.reduce(
      (sum, month) => sum + month.requirements.length,
      0
    );
    const backlogLaunches = monthSections.reduce(
      (sum, month) =>
        sum +
        month.launches.filter((launch) => launch.planningStatus === "бэклог").length,
      0
    );

    return {
      totalLaunches,
      totalRequirements,
      backlogLaunches,
    };
  }, [monthSections]);

  return (
    <div>
      <div className="toolbar" style={{ marginBottom: "16px" }}>
        <div className="toolbar-left">
          <div>
            <label>Год</label>
            <input
              type="number"
              min="2020"
              max="2100"
              value={year}
              onChange={(event) => setYear(String(event.target.value || getCurrentYear()))}
            />
          </div>
        </div>
        <div className="toolbar-right small muted">
          Q1: январь, февраль и март выбранного года
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
          gap: "12px",
          marginBottom: "16px",
        }}
      >
        <div className="section-card" style={{ margin: 0 }}>
          <div className="muted small">Запусков в Q1</div>
          <div style={{ fontSize: "30px", fontWeight: 800 }}>
            {formatNumber(summary.totalLaunches)}
          </div>
        </div>
        <div className="section-card" style={{ margin: 0 }}>
          <div className="muted small">Бизнес-требований в Q1</div>
          <div style={{ fontSize: "30px", fontWeight: 800 }}>
            {formatNumber(summary.totalRequirements)}
          </div>
        </div>
        <div className="section-card" style={{ margin: 0 }}>
          <div className="muted small">Запусков в бэклоге</div>
          <div style={{ fontSize: "30px", fontWeight: 800 }}>
            {formatNumber(summary.backlogLaunches)}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {monthSections.map((month) => (
          <div key={month.key} className="section-card" style={{ margin: 0 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "12px",
                alignItems: "center",
                flexWrap: "wrap",
                marginBottom: "12px",
              }}
            >
              <div>
                <div style={{ fontSize: "22px", fontWeight: 800 }}>{month.label}</div>
                <div className="small muted">
                  {formatDisplayDate(month.range.start)} —{" "}
                  {formatDisplayDate(month.range.end)}
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  flexWrap: "wrap",
                }}
              >
                <span className="badge">
                  Запуски: {formatNumber(month.launches.length)}
                </span>
                <span className="badge">
                  Требования: {formatNumber(month.requirements.length)}
                </span>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 1fr",
                gap: "16px",
              }}
            >
              <div>
                <div style={{ fontWeight: 800, marginBottom: "10px" }}>Запуски</div>
                <div className="table-wrap">
                  <table className="crm-table" style={{ minWidth: "720px" }}>
                    <thead>
                      <tr>
                        <th>Игра</th>
                        <th>Канал</th>
                        <th>Период</th>
                        <th>База</th>
                        <th>Статус</th>
                      </tr>
                    </thead>
                    <tbody>
                      {month.launches.length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ textAlign: "center", color: "#666" }}>
                            В этом месяце пока нет запусков.
                          </td>
                        </tr>
                      ) : (
                        month.launches.map((launch) => (
                          <tr key={launch.id}>
                            <td>{launch.game || "—"}</td>
                            <td>{getChannelName(launch.channelId, channels)}</td>
                            <td>
                              {formatDisplayDate(launch.startDate)} —{" "}
                              {formatDisplayDate(launch.endDate)}
                            </td>
                            <td>{launch.audience || "—"}</td>
                            <td>{launch.planningStatus || "—"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 800, marginBottom: "10px" }}>
                  Бизнес-требования
                </div>
                <div className="table-wrap">
                  <table className="crm-table" style={{ minWidth: "680px" }}>
                    <thead>
                      <tr>
                        <th>Игра</th>
                        <th>Каналы</th>
                        <th>Окно</th>
                        <th>База</th>
                        <th>Приоритет</th>
                      </tr>
                    </thead>
                    <tbody>
                      {month.requirements.length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ textAlign: "center", color: "#666" }}>
                            В этом месяце пока нет бизнес-требований.
                          </td>
                        </tr>
                      ) : (
                        month.requirements.map((requirement) => {
                          const start =
                            requirement.hasFixedDates === "yes" && requirement.fixedStartDate
                              ? requirement.fixedStartDate
                              : requirement.weekStart;
                          const end =
                            requirement.hasFixedDates === "yes"
                              ? requirement.fixedEndDate || requirement.fixedStartDate
                              : requirement.weekEnd;

                          return (
                            <tr key={requirement.id}>
                              <td>{requirement.game || "—"}</td>
                              <td>{getRequirementChannelNames(requirement, channels)}</td>
                              <td>
                                {start ? formatDisplayDate(start) : "—"}
                                {" — "}
                                {end ? formatDisplayDate(end) : "—"}
                              </td>
                              <td>{requirement.audience || "—"}</td>
                              <td>{requirement.priority ?? "—"}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
