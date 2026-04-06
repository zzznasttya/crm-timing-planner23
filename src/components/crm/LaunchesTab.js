import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  getChannelName,
  calculateEndDate,
  detectConflicts,
} from "../../lib/crm-store";

const PLATFORMS = ["АМ", "АО", "АМ+АО"];
const PRIORITIES = ["Высокий", "Средний", "Низкий"];
const CAMPAIGN_TYPES = ["CRM акция", "игровая механика", "пилот / тест"];
const GAMES = ["Матрёшки", "Суперигра", "КНБ", "Алхимия"];

function downloadCSV(content, filename) {
  const blob = new Blob(["\ufeff" + content], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "export.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function getImportedValue(row, keys) {
  for (const key of keys) {
    if (row[key] != null && String(row[key]).trim() !== "") {
      return row[key];
    }
  }
  return "";
}

function normalizeImportedDate(value, XLSX) {
  if (value == null || value === "") return "";

  if (typeof value === "number" && XLSX?.SSF?.parse_date_code) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed?.y && parsed?.m && parsed?.d) {
      const yyyy = String(parsed.y);
      const mm = String(parsed.m).padStart(2, "0");
      const dd = String(parsed.d).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }
  }

  const raw = String(value).trim();
  if (!raw) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const ruMatch = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (ruMatch) {
    const [, dd, mm, yyyy] = ruMatch;
    return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(
      2,
      "0"
    )}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return "";
}

function rowsFromWorksheet(sheet, XLSX) {
  if (!sheet) return [];

  const direct = XLSX.utils.sheet_to_json(sheet, {
    defval: "",
  });
  if (Array.isArray(direct) && direct.length > 0) {
    return direct;
  }

  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
    raw: false,
  });

  if (!Array.isArray(matrix) || matrix.length < 2) {
    matrix.length = 0;
  }

  if (matrix.length >= 2) {
    const [headerRow, ...bodyRows] = matrix;
    const headers = (headerRow || []).map((cell) => String(cell || "").trim());
    if (headers.some(Boolean)) {
      const rows = bodyRows
        .filter(
          (row) =>
            Array.isArray(row) &&
            row.some((cell) => String(cell || "").trim() !== "")
        )
        .map((row) => {
          const obj = {};
          headers.forEach((header, index) => {
            if (!header) return;
            obj[header] = row[index] ?? "";
          });
          return obj;
        });
      if (rows.length > 0) {
        return rows;
      }
    }
  }

  const ref = sheet["!ref"];
  if (!ref) return [];

  const range = XLSX.utils.decode_range(ref);
  const rawMatrix = [];
  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    const row = [];
    for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex += 1) {
      const cellRef = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
      const cell = sheet[cellRef];
      const value = cell?.w ?? cell?.v ?? "";
      row.push(value);
    }
    rawMatrix.push(row);
  }

  if (rawMatrix.length < 2) return [];

  const [headerRow, ...bodyRows] = rawMatrix;
  const headers = headerRow.map((cell) => String(cell || "").trim());
  if (!headers.some(Boolean)) return [];

  return bodyRows
    .filter((row) => row.some((cell) => String(cell || "").trim() !== ""))
    .map((row) => {
      const obj = {};
      headers.forEach((header, index) => {
        if (!header) return;
        obj[header] = row[index] ?? "";
      });
      return obj;
    });
}

function buildExportRows(launches, channels) {
  return launches.map((l) => ({
    Игра: l.game || "",
    Канал: getChannelName(l.channelId, channels),
    "Тип кампании": l.campaignType || "",
    Старт: l.startDate || "",
    Длительность: l.duration || "",
    Конец: l.endDate || "",
    Платформа: l.platform || "",
    База: l.audience || "",
    Приоритет: l.priority || "",
    Статус: l.planningStatus || "",
    Менеджер: l.manager || "",
    Комментарий: l.comment || "",
    Конфликт:
      l.conflictStatus === "conflict" ? (l.issues || []).join("; ") : "OK",
  }));
}

function exportLaunchesToCSV(launches, channels) {
  const rows = buildExportRows(launches, channels);
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ""))]
    .map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
    )
    .join("\n");
}

async function exportLaunchesToExcel(launches, channels) {
  const XLSX = await import("xlsx");
  const rows = buildExportRows(launches, channels);
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = Object.keys(rows[0] || {}).map(() => ({ wch: 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Launches");
  XLSX.writeFile(wb, "launches.xlsx");
}

function findNextFreeSlot(launch, allLaunches, channels) {
  let cursor = launch.startDate;
  for (let i = 0; i < 365; i++) {
    const test = {
      ...launch,
      startDate: cursor,
      endDate: calculateEndDate(cursor, launch.duration),
    };
    if (!detectConflicts(test, allLaunches, channels).length) return cursor;
    const d = new Date(cursor);
    d.setDate(d.getDate() + 1);
    cursor = d.toISOString().slice(0, 10);
  }
  return launch.startDate;
}

async function importLaunchesFromFile(file, channels) {
  const XLSX = await import("xlsx");
  const lower = file.name.toLowerCase();
  let rows = [];
  if (lower.endsWith(".csv")) {
    const text = await file.text();
    const clean = text.replace(/^\uFEFF/, "").trim();
    const [headerLine, ...dataLines] = clean.split(/\r?\n/);
    const headers = headerLine
      .split(",")
      .map((h) => h.replace(/^"|"$/g, "").trim());
    rows = dataLines.filter(Boolean).map((line) => {
      const vals = line.split(",").map((v) => v.replace(/^"|"$/g, "").trim());
      return Object.fromEntries(headers.map((h, i) => [h, vals[i] || ""]));
    });
  } else {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, {
      type: "array",
      cellDates: true,
      raw: false,
    });
    rows = rowsFromWorksheet(wb.Sheets[wb.SheetNames[0]], XLSX);
  }
  if (!rows.length) throw new Error("Файл пустой");

  const imported = rows
    .map((r, idx) => {
      const channelRaw = getImportedValue(r, ["Канал", "Тип коммуникации"]);
      const ch =
        channels.find((c) => c.name === channelRaw || c.id === channelRaw) ||
        channels[0];
      const startDate =
        normalizeImportedDate(
          getImportedValue(r, ["Старт", "Дата запуска"]),
          XLSX
        ) || new Date().toISOString().slice(0, 10);
      const explicitEndDate = normalizeImportedDate(
        getImportedValue(r, ["Конец", "ДО"]),
        XLSX
      );
      const duration =
        Number(getImportedValue(r, ["Длительность"])) || ch?.duration || 5;

      return {
        id: "import-" + Date.now() + "-" + idx,
        game: getImportedValue(r, ["Игра"]) || GAMES[0],
        channelId: ch?.id || "",
        startDate,
        duration,
        endDate: explicitEndDate || calculateEndDate(startDate, duration),
        platform: getImportedValue(r, ["Платформа"]) || "АМ+АО",
        audience: getImportedValue(r, ["База", "Отбор"]) || "",
        priority: getImportedValue(r, ["Приоритет"]) || "Средний",
        planningStatus: getImportedValue(r, ["Статус"]) || "бэклог",
        comment: getImportedValue(r, ["Комментарий", "Коммент"]) || "",
        campaignType:
          getImportedValue(r, ["Тип кампании", "Кампейн", "КП"]) ||
          "CRM акция",
        manager: getImportedValue(r, ["Менеджер", "На ком задача"]) || "",
        issues: [],
        conflictStatus: "ok",
      };
    })
    .filter(
      (item) =>
        item.game ||
        item.channelId ||
        item.startDate ||
        item.endDate ||
        item.comment
    );

  if (!imported.length) {
    throw new Error("Не удалось распознать ни одной строки для импорта");
  }

  return imported.map((item) => {
    const issues = detectConflicts(item, imported, channels);
    return {
      ...item,
      issues,
      conflictStatus: issues.length ? "conflict" : "ok",
    };
  });
}
import {
  generateAIRecommendations,
  buildFullScheduleDraft,
} from "../../lib/planner-core";

const STATUS_OPTIONS = [
  "бэклог",
  "в работе",
  "запуск",
  "запущено",
  "приостановлено",
];

function normalizeStatus(status) {
  if (STATUS_OPTIONS.includes(status)) return status;
  if (status === "Запланирован") return "бэклог";
  if (status === "Активен") return "запущено";
  if (status === "Завершен") return "запущено";
  if (status === "Архив") return "приостановлено";
  return "бэклог";
}

function getStatusStyle(status) {
  const normalized = normalizeStatus(status);

  if (normalized === "бэклог") {
    return { background: "#f3c7c2", color: "#b42318" };
  }

  if (normalized === "в работе") {
    return { background: "#f2d68f", color: "#5f4313" };
  }

  if (normalized === "запуск") {
    return { background: "#f3c29f", color: "#8a4b17" };
  }

  if (normalized === "запущено") {
    return { background: "#c7dfb2", color: "#0f7a4f" };
  }

  if (normalized === "приостановлено") {
    return { background: "#c40000", color: "#ffffff" };
  }

  return { background: "#eef2f7", color: "#111827" };
}

function statusSelectStyle(status) {
  const colors = getStatusStyle(status);

  return {
    ...colors,
    border: "none",
    borderRadius: "16px",
    padding: "8px 30px 8px 12px",
    fontSize: "14px",
    fontWeight: 600,
    outline: "none",
    cursor: "pointer",
    appearance: "none",
    WebkitAppearance: "none",
    MozAppearance: "none",
    minWidth: "140px",
  };
}

function priorityClass(priority) {
  if (priority === "Высокий") return "badge badge-red";
  if (priority === "Средний") return "badge badge-orange";
  return "badge badge-blue";
}

function platformClass(platform) {
  if (platform === "АМ") return "badge badge-purple";
  if (platform === "АО") return "badge badge-green";
  if (platform === "АМ+АО") return "badge badge-blue";
  return "badge";
}

function makeNewLaunch(channels) {
  const channel = channels[0];

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const startDate = `${yyyy}-${mm}-${dd}`;

  const duration = channel?.duration || 5;

  return {
    id: `launch-${Date.now()}`,
    game: GAMES[0],
    channelId: channel?.id || "",
    startDate,
    duration,
    endDate: calculateEndDate(startDate, duration),
    platform: "АМ+АО",
    audience: "",
    priority: "Средний",
    planningStatus: "бэклог",
    comment: "",
    issues: [],
    conflictStatus: "ok",
    campaignType: "CRM акция",
    earliestStartDate: startDate,
    latestStartDate: startDate,
    manager: "",
  };
}

function formatRuDate(dateString) {
  if (!dateString) return "—";
  const [year, month, day] = dateString.split("-");
  return `${day}.${month}.${year}`;
}

function renderAppliedRules(provenance) {
  const hits = provenance?.appliedRules || [];
  if (!hits.length) return null;

  return (
    <div
      style={{
        fontSize: "13px",
        color: "#1d4ed8",
        background: "#eff6ff",
        borderRadius: "12px",
        padding: "10px",
        marginBottom: "10px",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: "6px" }}>
        Правила ассистента
      </div>
      <ul style={{ margin: 0, paddingLeft: "18px" }}>
        {hits.map((hit, index) => (
          <li key={`${hit.ruleId}-${index}`}>
            {hit.notes || hit.effect}
            {Number.isFinite(hit.deltaScore)
              ? ` (${hit.deltaScore > 0 ? "+" : ""}${hit.deltaScore})`
              : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatChannelOptionLabel(channel) {
  if (!channel) return "";
  return channel.status === "active"
    ? channel.name
    : `${channel.name} (inactive)`;
}

function LaunchForm({ value, channels, onChange }) {
  const availableChannels = channels;

  function update(field, val) {
    const next = { ...value, [field]: val };

    if (field === "channelId") {
      const channel = channels.find((c) => c.id === val);
      if (channel) {
        next.duration = channel.duration;
        next.endDate = calculateEndDate(next.startDate, channel.duration);
      }
    }

    if (field === "startDate") {
      next.endDate = calculateEndDate(val, next.duration);
    }

    if (field === "duration") {
      next.duration = Number(val);
      next.endDate = calculateEndDate(next.startDate, Number(val));
    }

    onChange(next);
  }

  return (
    <div className="form-grid">
      <div>
        <label>Игра</label>
        <select
          value={value.game || GAMES[0]}
          onChange={(e) => update("game", e.target.value)}
        >
          {GAMES.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
      </div>

      <div>
        <label>Канал</label>
        <select
          value={value.channelId || ""}
          onChange={(e) => update("channelId", e.target.value)}
          disabled={availableChannels.length === 0}
        >
          {availableChannels.length === 0 ? (
            <option value="">Нет доступных каналов</option>
          ) : (
            availableChannels.map((c) => (
              <option key={c.id} value={c.id}>
                {formatChannelOptionLabel(c)}
              </option>
            ))
          )}
        </select>
      </div>

      <div>
        <label>Дата начала</label>
        <input
          type="date"
          value={value.startDate}
          onChange={(e) => update("startDate", e.target.value)}
        />
      </div>

      <div>
        <label>Длительность</label>
        <input
          type="number"
          min="1"
          value={value.duration}
          onChange={(e) => update("duration", e.target.value)}
        />
      </div>

      <div>
        <label>Дата окончания</label>
        <input value={value.endDate} disabled />
      </div>

      <div>
        <label>Платформа</label>
        <select
          value={value.platform}
          onChange={(e) => update("platform", e.target.value)}
        >
          {PLATFORMS.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </div>

      <div>
        <label>База</label>
        <input
          value={value.audience}
          onChange={(e) => update("audience", e.target.value)}
        />
      </div>

      <div>
        <label>Приоритет</label>
        <select
          value={value.priority}
          onChange={(e) => update("priority", e.target.value)}
        >
          {PRIORITIES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </div>

      <div>
        <label>Статус</label>
        <div className="status-select-wrap">
          <select
            className="status-select-clean"
            value={normalizeStatus(value.planningStatus)}
            onChange={(e) => update("planningStatus", e.target.value)}
            style={statusSelectStyle(value.planningStatus)}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label>Тип кампании</label>
        <select
          value={value.campaignType}
          onChange={(e) => update("campaignType", e.target.value)}
        >
          {CAMPAIGN_TYPES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>

      <div>
        <label>Менеджер</label>
        <input
          value={value.manager || ""}
          onChange={(e) => update("manager", e.target.value)}
        />
      </div>

      <div>
        <label>Ранняя дата старта</label>
        <input
          type="date"
          value={value.earliestStartDate || value.startDate}
          onChange={(e) => update("earliestStartDate", e.target.value)}
        />
      </div>

      <div>
        <label>Поздняя дата старта</label>
        <input
          type="date"
          value={value.latestStartDate || value.startDate}
          onChange={(e) => update("latestStartDate", e.target.value)}
        />
      </div>

      <div className="full-row">
        <label>Комментарий</label>
        <textarea
          rows="3"
          value={value.comment || ""}
          onChange={(e) => update("comment", e.target.value)}
        />
      </div>
    </div>
  );
}

function RecommendationsPanel({
  recommendations,
  onClose,
  onToggleSelect,
  onApplyOne,
  onRejectOne,
  onApplySelected,
  onRejectAll,
}) {
  const selectedCount = recommendations.filter(
    (item) => item.isSelected
  ).length;

  return (
    <div
      style={{
        width: "400px",
        minWidth: "400px",
        borderLeft: "1px solid #e5e7eb",
        paddingLeft: "16px",
      }}
    >
      <div style={{ position: "sticky", top: 0 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "12px",
            marginBottom: "12px",
          }}
        >
          <div>
            <div style={{ fontSize: "18px", fontWeight: 700 }}>
              Рекомендации
            </div>
            <div
              style={{ fontSize: "13px", color: "#6b7280", marginTop: "4px" }}
            >
              С учётом бизнес-требований и памяти ассистента
            </div>
          </div>

          <button className="btn-small" onClick={onClose}>
            Закрыть
          </button>
        </div>

        <div
          style={{
            display: "flex",
            gap: "8px",
            flexWrap: "wrap",
            marginBottom: "14px",
          }}
        >
          <button
            className="btn-small"
            onClick={onApplySelected}
            disabled={!selectedCount}
            style={{ opacity: selectedCount ? 1 : 0.5 }}
          >
            Применить выбранные
          </button>

          <button className="btn-small btn-danger" onClick={onRejectAll}>
            Очистить
          </button>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            maxHeight: "70vh",
            overflow: "auto",
            paddingRight: "4px",
          }}
        >
          {recommendations.map((recommendation) => (
            <div
              key={recommendation.id}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: "16px",
                padding: "14px",
                background: "#fff",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                  marginBottom: "10px",
                }}
              >
                <input
                  type="checkbox"
                  checked={recommendation.isSelected}
                  onChange={() => onToggleSelect(recommendation.id)}
                  style={{ marginTop: "3px" }}
                />

                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: "15px" }}>
                    {recommendation.title}
                  </div>
                  <div
                    style={{
                      color: "#6b7280",
                      fontSize: "13px",
                      marginTop: "4px",
                    }}
                  >
                    {recommendation.game}
                    {recommendation.audience
                      ? ` · ${recommendation.audience}`
                      : ""}
                  </div>
                </div>
              </div>

              <div
                style={{
                  fontSize: "13px",
                  lineHeight: 1.5,
                  marginBottom: "10px",
                }}
              >
                {recommendation.current ? (
                  <div>
                    <div>
                      <strong>Было:</strong>{" "}
                      {recommendation.current.channelName} ·{" "}
                      {formatRuDate(recommendation.current.startDate)} ·{" "}
                      {recommendation.current.duration} дн.
                    </div>
                    <div>
                      <strong>Предлагается:</strong>{" "}
                      {recommendation.suggested.channelName} ·{" "}
                      {formatRuDate(recommendation.suggested.startDate)} ·{" "}
                      {recommendation.suggested.duration} дн.
                    </div>
                  </div>
                ) : (
                  <div>
                    <strong>Создать:</strong>{" "}
                    {recommendation.suggested.channelName} ·{" "}
                    {formatRuDate(recommendation.suggested.startDate)} ·{" "}
                    {recommendation.suggested.duration} дн.
                  </div>
                )}
              </div>

              <div
                style={{
                  fontSize: "13px",
                  color: "#374151",
                  background: "#f9fafb",
                  borderRadius: "12px",
                  padding: "10px",
                  marginBottom: "10px",
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: "6px" }}>
                  Почему
                </div>
                <ul style={{ margin: 0, paddingLeft: "18px" }}>
                  {(recommendation.reasons || []).map((reason, index) => (
                    <li key={index}>{reason}</li>
                  ))}
                </ul>
              </div>

              {renderAppliedRules(recommendation.provenance)}

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  className="btn-small"
                  onClick={() => onApplyOne(recommendation.id)}
                >
                  Применить
                </button>
                <button
                  className="btn-small btn-danger"
                  onClick={() => onRejectOne(recommendation.id)}
                >
                  Отклонить
                </button>
              </div>
            </div>
          ))}

          {!recommendations.length && (
            <div className="muted">Подходящих рекомендаций нет</div>
          )}
        </div>
      </div>
    </div>
  );
}

function DraftPanel({ draft, onClose, onApplyDraft }) {
  return (
    <div
      style={{
        width: "420px",
        minWidth: "420px",
        borderLeft: "1px solid #e5e7eb",
        paddingLeft: "16px",
      }}
    >
      <div style={{ position: "sticky", top: 0 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "12px",
            marginBottom: "12px",
          }}
        >
          <div>
            <div style={{ fontSize: "18px", fontWeight: 700 }}>
              Черновик расписания
            </div>
            <div
              style={{ fontSize: "13px", color: "#6b7280", marginTop: "4px" }}
            >
              С учётом активных правил ассистента
            </div>
          </div>

          <button className="btn-small" onClick={onClose}>
            Закрыть
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "8px",
            marginBottom: "14px",
          }}
        >
          <div
            className="section-card"
            style={{ margin: 0, padding: "10px 12px" }}
          >
            <div className="muted small">Требований</div>
            <div style={{ fontWeight: 700, fontSize: "18px" }}>
              {draft?.summary?.totalRequirements || 0}
            </div>
          </div>

          <div
            className="section-card"
            style={{ margin: 0, padding: "10px 12px" }}
          >
            <div className="muted small">Новых запусков</div>
            <div style={{ fontWeight: 700, fontSize: "18px" }}>
              {draft?.summary?.plannedNew || 0}
            </div>
          </div>

          <div
            className="section-card"
            style={{ margin: 0, padding: "10px 12px" }}
          >
            <div className="muted small">Изменений</div>
            <div style={{ fontWeight: 700, fontSize: "18px" }}>
              {draft?.summary?.plannedChanged || 0}
            </div>
          </div>

          <div
            className="section-card"
            style={{ margin: 0, padding: "10px 12px" }}
          >
            <div className="muted small">Не покрыто</div>
            <div style={{ fontWeight: 700, fontSize: "18px" }}>
              {draft?.summary?.uncovered || 0}
            </div>
          </div>
        </div>

        <div style={{ marginBottom: "12px" }}>
          <button className="btn btn-primary" onClick={onApplyDraft}>
            Применить черновик
          </button>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            maxHeight: "70vh",
            overflow: "auto",
            paddingRight: "4px",
          }}
        >
          {(draft?.plannedActions || []).map((action) => (
            <div
              key={action.id}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: "16px",
                padding: "14px",
                background: "#fff",
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  fontSize: "15px",
                  marginBottom: "6px",
                }}
              >
                {action.title}
              </div>

              <div
                style={{
                  color: "#6b7280",
                  fontSize: "13px",
                  marginBottom: "10px",
                }}
              >
                {action.game}
                {action.audience ? ` · ${action.audience}` : ""}
              </div>

              {action.current ? (
                <div
                  style={{
                    fontSize: "13px",
                    marginBottom: "10px",
                    lineHeight: 1.5,
                  }}
                >
                  <div>
                    <strong>Было:</strong> {action.current.channelName} ·{" "}
                    {formatRuDate(action.current.startDate)}
                  </div>
                  <div>
                    <strong>Станет:</strong> {action.suggested?.channelName} ·{" "}
                    {formatRuDate(action.suggested?.startDate)}
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    fontSize: "13px",
                    marginBottom: "10px",
                    lineHeight: 1.5,
                  }}
                >
                  <strong>Новый запуск:</strong> {action.suggested?.channelName}{" "}
                  · {formatRuDate(action.suggested?.startDate)}
                </div>
              )}

              <div
                style={{
                  fontSize: "13px",
                  color: "#374151",
                  background: "#f9fafb",
                  borderRadius: "12px",
                  padding: "10px",
                  marginBottom: "10px",
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: "6px" }}>
                  Почему
                </div>
                <ul style={{ margin: 0, paddingLeft: "18px" }}>
                  {(action.reasons || []).map((reason, index) => (
                    <li key={index}>{reason}</li>
                  ))}
                </ul>
              </div>

              {renderAppliedRules(action.provenance)}
            </div>
          ))}

          {(draft?.uncoveredRequirements || []).length > 0 && (
            <div
              style={{
                border: "1px solid #fecaca",
                background: "#fff1f2",
                borderRadius: "16px",
                padding: "14px",
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: "8px" }}>
                Не покрыто
              </div>
              <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px" }}>
                {draft.uncoveredRequirements.map((item) => (
                  <li key={item.id}>
                    {item.game}
                    {item.audience ? ` · ${item.audience}` : ""} — {item.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Compact inline form rendered inside a table row ──────────────────────────
function InlineForm({ value, channels, onChange, onSave, onCancel, isNew }) {
  const availableChannels = channels;

  function upd(field, val) {
    const next = { ...value, [field]: val };
    if (field === "channelId") {
      const ch = channels.find((c) => c.id === val);
      if (ch) {
        next.duration = ch.duration;
        next.endDate = calculateEndDate(next.startDate, ch.duration);
      }
    }
    if (field === "startDate")
      next.endDate = calculateEndDate(val, next.duration);
    if (field === "duration") {
      next.duration = Number(val);
      next.endDate = calculateEndDate(next.startDate, Number(val));
    }
    onChange(next);
  }

  return (
    <div style={{ padding: "10px 4px" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: "8px",
          marginBottom: "10px",
        }}
      >
        <div>
          <label>Игра</label>
          <select
            value={value.game || GAMES[0]}
            onChange={(e) => upd("game", e.target.value)}
          >
            {GAMES.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Канал</label>
          <select
            value={value.channelId || ""}
            onChange={(e) => upd("channelId", e.target.value)}
            disabled={availableChannels.length === 0}
          >
            {availableChannels.length === 0 ? (
              <option value="">Нет доступных каналов</option>
            ) : (
              availableChannels.map((c) => (
                <option key={c.id} value={c.id}>
                  {formatChannelOptionLabel(c)}
                </option>
              ))
            )}
          </select>
        </div>
        <div>
          <label>Старт</label>
          <input
            type="date"
            value={value.startDate}
            onChange={(e) => upd("startDate", e.target.value)}
          />
        </div>
        <div>
          <label>Дней</label>
          <input
            type="number"
            min="1"
            value={value.duration}
            onChange={(e) => upd("duration", e.target.value)}
          />
        </div>
        <div>
          <label>Конец</label>
          <input
            value={value.endDate}
            disabled
            style={{ background: "#f4f4f5", color: "#71717a" }}
          />
        </div>
        <div>
          <label>Платформа</label>
          <select
            value={value.platform}
            onChange={(e) => upd("platform", e.target.value)}
          >
            {PLATFORMS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </div>
        <div>
          <label>База</label>
          <input
            value={value.audience || ""}
            onChange={(e) => upd("audience", e.target.value)}
            placeholder="сегмент"
          />
        </div>
        <div>
          <label>Приоритет</label>
          <select
            value={value.priority}
            onChange={(e) => upd("priority", e.target.value)}
          >
            {PRIORITIES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Статус</label>
          <select
            value={normalizeStatus(value.planningStatus)}
            onChange={(e) => upd("planningStatus", e.target.value)}
            style={statusSelectStyle(value.planningStatus)}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Тип</label>
          <select
            value={value.campaignType}
            onChange={(e) => upd("campaignType", e.target.value)}
          >
            {CAMPAIGN_TYPES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div style={{ gridColumn: "span 2" }}>
          <label>Комментарий</label>
          <input
            value={value.comment || ""}
            onChange={(e) => upd("comment", e.target.value)}
            placeholder="необязательно"
          />
        </div>
      </div>
      <div style={{ display: "flex", gap: "8px" }}>
        <button className="btn btn-primary" onClick={onSave}>
          {isNew ? "Добавить" : "Сохранить"}
        </button>
        <button className="btn" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </div>
  );
}

export default function LaunchesTab({
  channels,
  launches,
  assistantContext,
  onAddLaunch,
  onUpdateLaunch,
  onApplyProposals,
  onApplyDraft,
  onImportLaunches,
  onDeleteLaunch,
  onAutoResolve,
  onSuggestBetterSlot,
  onResetData,
  onDownloadTemplate,
}) {
  const [search, setSearch] = useState("");
  const [isRecommendationsOpen, setIsRecommendationsOpen] = useState(false);
  const [isDraftOpen, setIsDraftOpen] = useState(false);
  const [recommendations, setRecommendations] = useState([]);
  const [scheduleDraft, setScheduleDraft] = useState(null);
  // inline editing: null = closed, "new" = add row, id = editing that row
  const [editingId, setEditingId] = useState(null);
  const [editingData, setEditingData] = useState(null);

  const fileInputRef = useRef(null);
  const importTypeRef = useRef("xlsx");

  useEffect(() => {
    function handleHeaderImport(event) {
      importTypeRef.current = event.detail?.type || "xlsx";
      fileInputRef.current?.click();
    }

    function handleHeaderExport(event) {
      const type = event.detail?.type || "xlsx";

      if (type === "csv") {
        downloadCSV(exportLaunchesToCSV(launches, channels));
      } else {
        exportLaunchesToExcel(launches, channels);
      }
    }

    document.addEventListener("crm-trigger-import", handleHeaderImport);
    document.addEventListener("crm-trigger-export", handleHeaderExport);

    return () => {
      document.removeEventListener("crm-trigger-import", handleHeaderImport);
      document.removeEventListener("crm-trigger-export", handleHeaderExport);
    };
  }, [launches, channels]);

  const filtered = useMemo(() => {
    return launches.filter((item) => {
      const gameValue = (item.game || "").toLowerCase();
      const audienceValue = (item.audience || "").toLowerCase();
      const searchValue = search.toLowerCase();

      return (
        !search.trim() ||
        gameValue.includes(searchValue) ||
        audienceValue.includes(searchValue)
      );
    });
  }, [launches, search]);

  function reportImportStatus(message) {
    if (assistantContext?.toast) {
      assistantContext.toast(message);
      return;
    }
    console.info("[launch-import]", message);
  }

  function duplicate(launch) {
    onAddLaunch({
      ...launch,
      id: `launch-${Date.now()}`,
      issues: [],
      conflictStatus: "ok",
    });
  }

  function freeSlot(launch) {
    const next = findNextFreeSlot(launch, launches, channels);

    onUpdateLaunch({
      ...launch,
      startDate: next,
      endDate: calculateEndDate(next, launch.duration),
    });
  }

  async function handleImportFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      reportImportStatus(`Читаю файл: ${file.name}`);
      const importedLaunches = await importLaunchesFromFile(file, channels);
      reportImportStatus(
        `Файл прочитан, найдено ${importedLaunches.length} запуск(ов)`
      );

      const confirmReplace = window.confirm(
        `Импортировать ${importedLaunches.length} запуск(ов)? Текущий список запусков будет заменён.`
      );

      if (confirmReplace && onImportLaunches) {
        try {
          reportImportStatus("Применяю импорт запусков");
          onImportLaunches(importedLaunches);
          reportImportStatus("Импорт запусков завершён");
        } catch (error) {
          console.error("Launch import failed after parsing", error);
          alert(error?.message || "Не удалось применить импорт запусков");
        }
      } else {
        reportImportStatus("Импорт запусков отменён пользователем");
      }
    } catch (error) {
      console.error("Launch import parsing failed", error);
      alert(error?.message || "Не удалось импортировать файл");
    } finally {
      event.target.value = "";
    }
  }

  function handleGenerateRecommendations() {
    const nextRecommendations = generateAIRecommendations({
      launches,
      channels,
      assistantContext,
    }).map((item) => ({
      ...item,
      isSelected:
        assistantContext?.preferences?.autoSelectRecommendations !== false,
    }));

    setRecommendations(nextRecommendations);
    setIsRecommendationsOpen(true);
    setIsDraftOpen(false);
  }

  function handleBuildDraft() {
    const nextDraft = buildFullScheduleDraft({
      launches,
      channels,
      assistantContext,
    });

    setScheduleDraft(nextDraft);
    setIsDraftOpen(true);
    setIsRecommendationsOpen(false);
  }

  function handleToggleRecommendationSelection(id) {
    setRecommendations((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, isSelected: !item.isSelected } : item
      )
    );
  }

  function handleApplyOneRecommendation(id) {
    const recommendation = recommendations.find((item) => item.id === id);
    if (!recommendation) return;

    onApplyProposals([recommendation]);
    setRecommendations((prev) => prev.filter((item) => item.id !== id));
  }

  function handleRejectOneRecommendation(id) {
    setRecommendations((prev) => prev.filter((item) => item.id !== id));
  }

  function handleApplySelectedRecommendations() {
    const selected = recommendations.filter((item) => item.isSelected);
    if (!selected.length) return;

    onApplyProposals(selected);
    setRecommendations((prev) => prev.filter((item) => !item.isSelected));
  }

  function handleRejectAllRecommendations() {
    setRecommendations([]);
    setIsRecommendationsOpen(false);
  }

  function handleApplyDraft() {
    if (!scheduleDraft) return;
    onApplyDraft(scheduleDraft.plannedActions);
    setIsDraftOpen(false);
    setScheduleDraft(null);
  }

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar-left">
          <input
            placeholder="Поиск по игре или базе"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="toolbar-right">
          <button
            className="btn btn-primary"
            onClick={handleGenerateRecommendations}
          >
            Сформировать предложения
          </button>

          <button className="btn btn-primary" onClick={handleBuildDraft}>
            Собрать черновик
          </button>

          <button
            className="btn"
            onClick={() => {
              importTypeRef.current = "xlsx";
              if (fileInputRef.current) {
                fileInputRef.current.value = "";
                fileInputRef.current.click();
              }
            }}
          >
            Импорт Excel
          </button>

          <button
            className="btn"
            onClick={() => exportLaunchesToExcel(launches, channels)}
          >
            Экспорт Excel
          </button>

          {typeof onDownloadTemplate === "function" && (
            <button className="btn" onClick={onDownloadTemplate}>
              Шаблон
            </button>
          )}

          <button
            className="btn"
            onClick={() => {
              if (editingId === "new") {
                setEditingId(null);
                setEditingData(null);
                return;
              }
              setEditingId("new");
              setEditingData(makeNewLaunch(channels));
            }}
          >
            {editingId === "new" ? "Отмена" : "Добавить"}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: "none" }}
            onChange={handleImportFileChange}
          />

          <button className="btn" onClick={onAutoResolve}>
            Разрешить конфликты
          </button>

          <button className="btn btn-danger" onClick={onResetData}>
            Сбросить
          </button>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: "16px",
          alignItems: "flex-start",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th style={{ width: 44 }}></th>
                  <th>Игра</th>
                  <th>Канал</th>
                  <th>Старт</th>
                  <th>Длит.</th>
                  <th>Конец</th>
                  <th>Платформа</th>
                  <th>База</th>
                  <th>Приоритет</th>
                  <th>Статус</th>
                  <th>Конфликт</th>
                  <th>Действия</th>
                </tr>
              </thead>

              <tbody>
                {/* ── New row form ── */}
                {editingId === "new" && editingData && (
                  <tr style={{ background: "#f8faff" }}>
                    <td />
                    <td colSpan={11}>
                      <InlineForm
                        value={editingData}
                        channels={channels}
                        onChange={setEditingData}
                        onSave={() => {
                          onAddLaunch({
                            ...editingData,
                            game: editingData.game || GAMES[0],
                            planningStatus: normalizeStatus(
                              editingData.planningStatus
                            ),
                          });
                          setEditingId(null);
                          setEditingData(null);
                        }}
                        onCancel={() => {
                          setEditingId(null);
                          setEditingData(null);
                        }}
                        isNew
                      />
                    </td>
                  </tr>
                )}

                {filtered.map((launch) => {
                  const isEditing = editingId === launch.id;
                  const row = isEditing ? editingData : launch;
                  return (
                    <React.Fragment key={launch.id}>
                      {isEditing ? (
                        <tr style={{ background: "#f8faff" }}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(launch.id)}
                              onChange={() => toggleSelect(launch.id)}
                              style={{ cursor: "pointer" }}
                            />
                          </td>
                          <td colSpan={11}>
                            <InlineForm
                              value={editingData}
                              channels={channels}
                              onChange={setEditingData}
                              onSave={() => {
                                onUpdateLaunch({
                                  ...editingData,
                                  game: editingData.game || GAMES[0],
                                  planningStatus: normalizeStatus(
                                    editingData.planningStatus
                                  ),
                                });
                                setEditingId(null);
                                setEditingData(null);
                              }}
                              onCancel={() => {
                                setEditingId(null);
                                setEditingData(null);
                              }}
                            />
                          </td>
                        </tr>
                      ) : (
                        <tr
                          style={{ cursor: "pointer" }}
                          onDoubleClick={() => {
                            setEditingId(launch.id);
                            setEditingData({
                              ...launch,
                              planningStatus: normalizeStatus(
                                launch.planningStatus
                              ),
                            });
                          }}
                        >
                          <td onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(launch.id)}
                              onChange={() => toggleSelect(launch.id)}
                              style={{ cursor: "pointer" }}
                            />
                          </td>
                          <td>{launch.game || GAMES[0]}</td>
                          <td>{getChannelName(launch.channelId, channels)}</td>
                          <td>{launch.startDate}</td>
                          <td>{launch.duration}</td>
                          <td>{launch.endDate}</td>
                          <td>
                            <span className={platformClass(launch.platform)}>
                              {launch.platform}
                            </span>
                          </td>
                          <td>{launch.audience || "—"}</td>
                          <td>
                            <span className={priorityClass(launch.priority)}>
                              {launch.priority}
                            </span>
                          </td>
                          <td>
                            <div className="status-select-wrap">
                              <select
                                className="status-select-clean"
                                value={normalizeStatus(launch.planningStatus)}
                                onChange={(e) =>
                                  onUpdateLaunch({
                                    ...launch,
                                    planningStatus: e.target.value,
                                  })
                                }
                                style={statusSelectStyle(launch.planningStatus)}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {STATUS_OPTIONS.map((s) => (
                                  <option key={s}>{s}</option>
                                ))}
                              </select>
                            </div>
                          </td>
                          <td>
                            {launch.conflictStatus === "conflict" ? (
                              <span className="badge badge-red">Конфликт</span>
                            ) : (
                              <span className="badge badge-green-light">
                                Всё ок
                              </span>
                            )}
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <div className="actions">
                              <button
                                className="btn-small"
                                onClick={() => {
                                  setEditingId(launch.id);
                                  setEditingData({
                                    ...launch,
                                    planningStatus: normalizeStatus(
                                      launch.planningStatus
                                    ),
                                  });
                                }}
                              >
                                Ред.
                              </button>
                              <button
                                className="btn-small"
                                onClick={() => duplicate(launch)}
                              >
                                Дубль
                              </button>
                              <button
                                className="btn-small btn-danger"
                                onClick={() => {
                                  if (window.confirm("Удалить?"))
                                    onDeleteLaunch(launch.id);
                                }}
                              >
                                Удалить
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {isRecommendationsOpen && (
          <RecommendationsPanel
            recommendations={recommendations}
            onClose={() => setIsRecommendationsOpen(false)}
            onToggleSelect={handleToggleRecommendationSelection}
            onApplyOne={handleApplyOneRecommendation}
            onRejectOne={handleRejectOneRecommendation}
            onApplySelected={handleApplySelectedRecommendations}
            onRejectAll={handleRejectAllRecommendations}
          />
        )}

        {isDraftOpen && scheduleDraft && (
          <DraftPanel
            draft={scheduleDraft}
            onClose={() => setIsDraftOpen(false)}
            onApplyDraft={handleApplyDraft}
          />
        )}
      </div>
    </div>
  );
}
