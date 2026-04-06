import React, { useEffect, useMemo, useState } from "react";
import { getChannelName } from "../../lib/crm-store";

const BKP_STORAGE_KEY = "crm-bkp-limit-v1";
const DEFAULT_LIMIT = 30000000;

function getCurrentMonthValue() {
  return new Date().toISOString().slice(0, 7);
}

function formatNumber(value) {
  return new Intl.NumberFormat("ru-RU").format(Number(value || 0));
}

function loadLimit() {
  try {
    const raw = localStorage.getItem(BKP_STORAGE_KEY);
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LIMIT;
  } catch {
    return DEFAULT_LIMIT;
  }
}

function isLaunchedStatus(value) {
  return String(value || "").trim().toLowerCase() === "запущено";
}

function isPushChannel(launch, channels) {
  const channelName = getChannelName(launch.channelId, channels).toLowerCase();
  return channelName.includes("пуш");
}

export default function BKPTab({ launches, channels }) {
  const [month, setMonth] = useState(getCurrentMonthValue);
  const [limit, setLimit] = useState(loadLimit);

  useEffect(() => {
    try {
      localStorage.setItem(BKP_STORAGE_KEY, String(limit));
    } catch {}
  }, [limit]);

  const report = useMemo(() => {
    const relevantLaunches = (Array.isArray(launches) ? launches : [])
      .filter((launch) => launch.startDate?.slice(0, 7) === month)
      .filter((launch) => isLaunchedStatus(launch.planningStatus))
      .filter((launch) => isPushChannel(launch, channels))
      .map((launch) => ({
        ...launch,
        sentBaseCount: Number(launch.sentBaseCount) || 0,
      }));

    const total = relevantLaunches.reduce(
      (sum, launch) => sum + launch.sentBaseCount,
      0
    );
    const remaining = Math.max(0, limit - total);
    const excess = Math.max(0, total - limit);

    return {
      launches: relevantLaunches,
      total,
      remaining,
      excess,
      usagePercent: limit > 0 ? Math.min(100, (total / limit) * 100) : 0,
    };
  }, [launches, channels, month, limit]);

  return (
    <div>
      <div className="toolbar" style={{ marginBottom: "16px" }}>
        <div className="toolbar-left" style={{ gap: "12px", display: "flex" }}>
          <div>
            <label>Месяц</label>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>

          <div>
            <label>Лимит БКП</label>
            <input
              type="number"
              min="0"
              step="1000"
              value={limit}
              onChange={(e) => setLimit(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: "12px",
          marginBottom: "16px",
        }}
      >
        <div className="section-card" style={{ margin: 0 }}>
          <div className="muted small">Сумма баз пушей</div>
          <div style={{ fontSize: "28px", fontWeight: 800 }}>
            {formatNumber(report.total)}
          </div>
        </div>

        <div className="section-card" style={{ margin: 0 }}>
          <div className="muted small">Лимит</div>
          <div style={{ fontSize: "28px", fontWeight: 800 }}>
            {formatNumber(limit)}
          </div>
        </div>

        <div className="section-card" style={{ margin: 0 }}>
          <div className="muted small">Остаток</div>
          <div style={{ fontSize: "28px", fontWeight: 800, color: "#166534" }}>
            {formatNumber(report.remaining)}
          </div>
        </div>

        <div className="section-card" style={{ margin: 0 }}>
          <div className="muted small">Превышение</div>
          <div style={{ fontSize: "28px", fontWeight: 800, color: "#b42318" }}>
            {formatNumber(report.excess)}
          </div>
        </div>
      </div>

      <div
        className="section-card"
        style={{ margin: "0 0 16px 0", padding: "14px 16px" }}
      >
        <div
          style={{
            height: "12px",
            background: "#eef2f7",
            borderRadius: "999px",
            overflow: "hidden",
            marginBottom: "10px",
          }}
        >
          <div
            style={{
              width: `${Math.min(report.usagePercent, 100)}%`,
              height: "100%",
              background: report.excess > 0 ? "#ef4444" : "#22c55e",
              transition: "width 0.2s ease",
            }}
          />
        </div>
        <div className="muted">
          Использовано {formatNumber(report.total)} из {formatNumber(limit)}.
        </div>
      </div>

      <div className="table-wrap">
        <table className="crm-table">
          <thead>
            <tr>
              <th>Игра</th>
              <th>Канал</th>
              <th>Старт</th>
              <th>Статус</th>
              <th>База коммуникаций</th>
              <th>Комментарий</th>
            </tr>
          </thead>
          <tbody>
            {report.launches.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", color: "#6b7280" }}>
                  В выбранном месяце нет запущенных пушей с указанной базой.
                </td>
              </tr>
            ) : (
              report.launches.map((launch) => (
                <tr key={launch.id}>
                  <td>{launch.game || "—"}</td>
                  <td>{getChannelName(launch.channelId, channels)}</td>
                  <td>{launch.startDate || "—"}</td>
                  <td>{launch.planningStatus || "—"}</td>
                  <td>{formatNumber(launch.sentBaseCount)}</td>
                  <td>{launch.comment || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
