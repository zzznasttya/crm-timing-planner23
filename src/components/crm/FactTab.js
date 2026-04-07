import React, { useMemo, useRef, useState } from "react";
import { addDays, format } from "date-fns";
import {
  formatDisplayDate,
  getChannelDisplayName,
} from "../../lib/crm-store";
import { useToast } from "./Toast";
import WeekRangeNavigator, {
  buildPeriodRange,
  getCurrentWeekStart,
} from "./WeekRangeNavigator";
import { importPerformanceReportsFromFiles } from "../../lib/performance-domain";

function isLaunchedStatus(value) {
  return String(value || "").trim().toLowerCase() === "запущено";
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function getRowDate(row) {
  return (
    row?.date ||
    row?.reportDate ||
    row?.launchDate ||
    row?.startDate ||
    row?.day ||
    ""
  );
}

function intersectsPeriod(startDate, endDate, firstDay, lastDay) {
  if (!startDate || !endDate) return false;
  return startDate <= lastDay && endDate >= firstDay;
}

function formatInteger(value) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(value || 0));
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1).replace(".", ",")}%`;
}

function getMetricLabel(item) {
  if (item.conversionRate !== null) return formatPercent(item.conversionRate);
  return "нет отчётности";
}

export default function FactTab({
  launches,
  channels,
  performanceReports = [],
  onImportReports,
}) {
  const toast = useToast();
  const fileInputRef = useRef(null);
  const [calendarMode, setCalendarMode] = useState("4w");
  const [periodStart, setPeriodStart] = useState(getCurrentWeekStart);

  const period = buildPeriodRange(periodStart, calendarMode);
  const firstDay = format(period.start, "yyyy-MM-dd");
  const lastDay = format(addDays(period.start, period.days - 1), "yyyy-MM-dd");

  const launchedInPeriod = useMemo(
    () =>
      launches.filter(
        (launch) =>
          isLaunchedStatus(launch?.planningStatus) &&
          intersectsPeriod(launch?.startDate, launch?.endDate, firstDay, lastDay)
      ),
    [launches, firstDay, lastDay]
  );

  const reportsInPeriod = useMemo(
    () =>
      performanceReports.filter((row) => {
        const rowDate = getRowDate(row);
        return rowDate && rowDate >= firstDay && rowDate <= lastDay;
      }),
    [performanceReports, firstDay, lastDay]
  );

  const channelStats = useMemo(() => {
    const byKey = new Map();

    channels.forEach((channel) => {
      byKey.set(`id:${channel.id}`, {
        key: `id:${channel.id}`,
        channel,
        label: getChannelDisplayName(channel) || "Без названия",
        launchesCount: 0,
        reportsCount: 0,
        sent: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        converted: 0,
        fallbackBase: 0,
        conversionRate: null,
        dataSource: "Запуски",
      });
    });

    launchedInPeriod.forEach((launch) => {
      const key = launch.channelId ? `id:${launch.channelId}` : `launch:${launch.id}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          channel: null,
          label: launch.channelName || "Не сопоставлено",
          launchesCount: 0,
          reportsCount: 0,
          sent: 0,
          delivered: 0,
          opened: 0,
          clicked: 0,
          converted: 0,
          fallbackBase: 0,
          conversionRate: null,
          dataSource: "Запуски",
        });
      }

      const item = byKey.get(key);
      item.launchesCount += 1;
      item.fallbackBase += toNumber(launch.sentBaseCount);
    });

    reportsInPeriod.forEach((row) => {
      const key = row.channelId ? `id:${row.channelId}` : `name:${row.channelName || row.channelHint || "unknown"}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          channel: null,
          label: row.channelName || "Не сопоставлено",
          launchesCount: 0,
          reportsCount: 0,
          sent: 0,
          delivered: 0,
          opened: 0,
          clicked: 0,
          converted: 0,
          fallbackBase: 0,
          conversionRate: null,
          dataSource: "Отчётность",
        });
      }

      const item = byKey.get(key);
      item.reportsCount += 1;
      item.sent += toNumber(row.sentCount);
      item.delivered += toNumber(row.deliveredCount);
      item.opened += toNumber(row.openedCount);
      item.clicked += toNumber(row.clickedCount);
      item.converted += toNumber(row.convertedCount);
      item.dataSource = "Отчётность";
    });

    return Array.from(byKey.values())
      .map((item) => {
        const denominator = item.delivered || item.sent;
        return {
          ...item,
          conversionRate:
            item.reportsCount > 0 && denominator > 0
              ? item.converted / denominator
              : null,
        };
      })
      .filter((item) => item.launchesCount > 0 || item.reportsCount > 0)
      .sort((a, b) => {
        const aMetric = a.conversionRate ?? -1;
        const bMetric = b.conversionRate ?? -1;
        if (bMetric !== aMetric) return bMetric - aMetric;
        return (
          b.sent + b.fallbackBase - (a.sent + a.fallbackBase) ||
          b.launchesCount - a.launchesCount
        );
      });
  }, [channels, launchedInPeriod, reportsInPeriod]);

  const totalBase = useMemo(() => {
    const reportedSent = channelStats.reduce((sum, item) => sum + item.sent, 0);
    if (reportedSent > 0) return reportedSent;
    return channelStats.reduce((sum, item) => sum + item.fallbackBase, 0);
  }, [channelStats]);

  const averageConversion = useMemo(() => {
    const rows = channelStats.filter((item) => item.conversionRate !== null);
    if (!rows.length) return null;
    const weightedConverted = rows.reduce((sum, item) => sum + item.converted, 0);
    const weightedBase = rows.reduce(
      (sum, item) => sum + (item.delivered || item.sent),
      0
    );
    return weightedBase > 0 ? weightedConverted / weightedBase : null;
  }, [channelStats]);

  const channelsWithFacts = channelStats.length;
  const bestChannel = channelStats[0] || null;
  const hasRealPerformanceData = reportsInPeriod.length > 0;
  const importedExamples = reportsInPeriod.slice(0, 12);

  async function handleImportChange(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;

    try {
      toast("Читаю фактическую отчётность: " + files.map((file) => file.name).join(", "));
      const imported = await importPerformanceReportsFromFiles(files, channels);
      onImportReports?.(imported);
    } catch (error) {
      toast(error?.message || "Не удалось импортировать фактическую отчётность", "warn");
    }
  }

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar-left">
          <button
            className="btn"
            onClick={() => fileInputRef.current?.click()}
          >
            Импорт отчётности
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            multiple
            style={{ display: "none" }}
            onChange={handleImportChange}
          />
        </div>
        <div className="toolbar-right small muted">
          Поддерживаются файлы banner/push-отчётности в текущем формате
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
          <div className="muted small">Факт-запусков в периоде</div>
          <div style={{ fontSize: "30px", fontWeight: 800 }}>
            {launchedInPeriod.length}
          </div>
          <div className="small muted">только со статусом “запущено”</div>
        </div>
        <div className="section-card" style={{ margin: 0 }}>
          <div className="muted small">Каналов с данными</div>
          <div style={{ fontSize: "30px", fontWeight: 800 }}>
            {channelsWithFacts}
          </div>
          <div className="small muted">
            из {channels.length} доступных каналов
          </div>
        </div>
        <div className="section-card" style={{ margin: 0 }}>
          <div className="muted small">
            {hasRealPerformanceData ? "Отправлено / база" : "База запусков"}
          </div>
          <div style={{ fontSize: "30px", fontWeight: 800 }}>
            {formatInteger(totalBase)}
          </div>
          <div className="small muted">
            {hasRealPerformanceData
              ? "сумма фактических отправок за период"
              : "сумма поля “База коммуникаций” по запущенным"}
          </div>
        </div>
        <div className="section-card" style={{ margin: 0 }}>
          <div className="muted small">Средняя конверсия</div>
          <div style={{ fontSize: "30px", fontWeight: 800 }}>
            {averageConversion === null ? "—" : formatPercent(averageConversion)}
          </div>
          <div className="small muted">
            {hasRealPerformanceData
              ? "по фактической отчётности за выбранный период"
              : "появится после импорта фактической отчётности"}
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
        className="section-card"
        style={{
          marginTop: "16px",
          borderColor: hasRealPerformanceData ? "#dfdfdf" : "#ffd0d0",
          background: hasRealPerformanceData ? "#ffffff" : "#fff5f5",
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: "6px" }}>
          {hasRealPerformanceData
            ? "Конверсионность уже считается по фактическим данным"
            : "Здесь появится настоящая конверсионность каналов"}
        </div>
        <div className="small muted" style={{ maxWidth: "880px" }}>
          {hasRealPerformanceData
            ? "Планировщик сможет опираться на эти метрики при выборе более сильного канала для важных кампаний."
            : "Пока вкладка показывает operational-факт по запущенным кампаниям. После импорта отчётности здесь будут считаться delivered, opens, clicks, conversions и реальная конверсия по каналам."}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(260px, 360px) 1fr",
          gap: "16px",
          marginTop: "16px",
        }}
      >
        <div className="section-card" style={{ margin: 0 }}>
          <div className="muted small">Лучший канал периода</div>
          <div
            style={{
              fontSize: "24px",
              fontWeight: 800,
              lineHeight: 1.05,
              marginTop: "8px",
            }}
          >
            {bestChannel ? bestChannel.label || "Без названия" : "—"}
          </div>
          <div className="small muted" style={{ marginTop: "8px" }}>
            {bestChannel
              ? bestChannel.conversionRate !== null
                ? `Конверсия: ${formatPercent(bestChannel.conversionRate)}`
                : `Пока без конверсии, но с ${bestChannel.launchesCount} запущ. кампаниями`
              : "В выбранном периоде пока нет фактических запусков"}
          </div>
        </div>

        <div className="section-card" style={{ margin: 0 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "12px",
              alignItems: "center",
              marginBottom: "12px",
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontWeight: 800, fontSize: "18px" }}>
              Фактическая эффективность каналов
            </div>
            <div className="small muted">
              {formatDisplayDate(firstDay)} — {formatDisplayDate(lastDay)}
            </div>
          </div>

          {channelStats.length === 0 ? (
            <div className="small muted">
              В выбранном периоде пока нет запусков со статусом “запущено”.
            </div>
          ) : (
            <div className="table-wrap">
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Канал</th>
                    <th>Источник</th>
                    <th>Кампании</th>
                    <th>Отправлено / база</th>
                    <th>Conversions</th>
                    <th>Конверсия</th>
                  </tr>
                </thead>
                <tbody>
                  {channelStats.map((item) => (
                    <tr key={item.channel.id}>
                      <td style={{ fontWeight: 700 }}>{item.label || "Без названия"}</td>
                      <td>
                        <span
                          className={
                            item.reportsCount > 0 ? "badge badge-green-light" : "badge"
                          }
                        >
                          {item.dataSource}
                        </span>
                      </td>
                      <td>{item.reportsCount || item.launchesCount}</td>
                      <td>{formatInteger(item.sent || item.fallbackBase)}</td>
                      <td>
                        {item.reportsCount > 0 ? formatInteger(item.converted) : "—"}
                      </td>
                      <td style={{ fontWeight: 700 }}>{getMetricLabel(item)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="section-card" style={{ marginTop: "16px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "12px",
            alignItems: "center",
            marginBottom: "12px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontWeight: 800, fontSize: "18px" }}>
            Примеры сопоставления макетов
          </div>
          <div className="small muted">
            как именно импорт распознал игру, канал и аудиторию
          </div>
        </div>

        {importedExamples.length === 0 ? (
          <div className="small muted">
            После импорта здесь появятся строки с распознанными макетами и каналами.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="crm-table" style={{ minWidth: "980px" }}>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Игра</th>
                  <th>Канал</th>
                  <th>Аудитория</th>
                  <th>Макет</th>
                  <th>Доставлено / show</th>
                  <th>Клики</th>
                </tr>
              </thead>
              <tbody>
                {importedExamples.map((item) => (
                  <tr key={item.importKey}>
                    <td>{formatDisplayDate(item.reportDate)}</td>
                    <td style={{ fontWeight: 700 }}>{item.game || "—"}</td>
                    <td>{item.channelName || "Не сопоставлено"}</td>
                    <td>{item.audience || "—"}</td>
                    <td className="muted small">{item.layoutName || item.layoutCode || "—"}</td>
                    <td>{formatInteger(item.deliveredCount || item.sentCount)}</td>
                    <td>{formatInteger(item.clickedCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
