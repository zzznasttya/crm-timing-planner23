import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  getChannelName,
  calculateEndDate,
  detectConflicts,
  getChannelDisplayName,
  formatDisplayDate,
} from "../../lib/crm-store";
import WeekRangeNavigator, {
  buildPeriodRange,
  getCurrentWeekStart,
} from "./WeekRangeNavigator";

const PLATFORMS = ["АМ", "АО", "АМ+АО"];
const PRIORITIES = ["0", "1", "2", "3", "4", "5"];
const CAMPAIGN_TYPES = ["CRM акция", "игровая механика", "пилот / тест"];
const GAMES = ["Матрёшки", "Суперигра", "КНБ", "Алхимия"];

function normalizeLaunchPriority(value) {
  const normalized = String(value ?? "").trim();
  if (PRIORITIES.includes(normalized)) return normalized;
  if (normalized === "Высокий") return "1";
  if (normalized === "Средний") return "3";
  if (normalized === "Низкий") return "5";
  return "3";
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

  try {
    const direct = XLSX.utils.sheet_to_json(sheet, {
      defval: "",
      raw: true,
      blankrows: false,
    });
    if (Array.isArray(direct) && direct.length > 0) {
      return direct;
    }
  } catch {}

  let matrix = [];
  try {
    matrix = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      blankrows: false,
      raw: true,
    });
  } catch {
    matrix = [];
  }

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

  const denseData = Array.isArray(sheet)
    ? sheet
    : Array.isArray(sheet["!data"])
    ? sheet["!data"]
    : null;

  if (denseData && denseData.length >= 2) {
    const denseMatrix = denseData.map((row) =>
      Array.isArray(row)
        ? row.map((cell) => cell?.w ?? cell?.v ?? "")
        : []
    );

    const [headerRow, ...bodyRows] = denseMatrix;
    const headers = headerRow.map((cell) => String(cell || "").trim());
    if (headers.some(Boolean)) {
      const rows = bodyRows
        .filter((row) => row.some((cell) => String(cell || "").trim() !== ""))
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
    "База коммуникаций": l.sentBaseCount || "",
    Менеджер: l.manager || "",
    Комментарий: l.comment || "",
    Конфликт:
      l.conflictStatus === "conflict" ? (l.issues || []).join("; ") : "OK",
  }));
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

async function importLaunchesFromFile(file, channels) {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  let wb;

  try {
    wb = XLSX.read(buf, {
      type: "array",
      cellDates: false,
      dense: false,
    });
  } catch (error) {
    throw new Error(error?.message || "Не удалось прочитать Excel-файл");
  }

  const firstSheetName = wb?.SheetNames?.[0];
  const firstSheet = firstSheetName ? wb.Sheets[firstSheetName] : null;
  if (!firstSheetName || !firstSheet) {
    throw new Error("Ошибка при импорте листа");
  }

  const rows = rowsFromWorksheet(firstSheet, XLSX);
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
      const campaignTypeRaw =
        getImportedValue(r, ["Тип кампании", "Кампейн", "КП"]) || "CRM акция";

      return {
        id: "import-" + Date.now() + "-" + idx,
        game: String(getImportedValue(r, ["Игра"]) || GAMES[0]),
        channelId: ch?.id || "",
        startDate,
        duration,
        endDate: explicitEndDate || calculateEndDate(startDate, duration),
        earliestStartDate:
          normalizeImportedDate(getImportedValue(r, ["Ранняя дата"]), XLSX) ||
          startDate,
        latestStartDate:
          normalizeImportedDate(getImportedValue(r, ["Поздняя дата"]), XLSX) ||
          startDate,
        platform: String(getImportedValue(r, ["Платформа"]) || "АМ+АО"),
        audience: String(getImportedValue(r, ["База", "Отбор"]) || ""),
        priority: normalizeLaunchPriority(
          getImportedValue(r, ["Приоритет"]) || "3"
        ),
        planningStatus: String(getImportedValue(r, ["Статус"]) || "бэклог"),
        sentBaseCount: Number(
          getImportedValue(r, ["База коммуникаций", "База комм", "БКП база"])
        ) || "",
        comment: String(getImportedValue(r, ["Комментарий", "Коммент"]) || ""),
        campaignType: String(campaignTypeRaw),
        manager: String(
          getImportedValue(r, ["Менеджер", "На ком задача"]) || ""
        ),
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
  const value = Number(normalizeLaunchPriority(priority));
  if (value <= 1) return "badge badge-red";
  if (value <= 3) return "badge badge-orange";
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
    priority: "3",
    planningStatus: "бэклог",
    sentBaseCount: "",
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
  return formatDisplayDate(dateString);
}

function shiftDateByDays(dateString, days) {
  if (!dateString || !Number.isFinite(days) || days === 0) return dateString;
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateString;
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function getWeekStartFromDateString(dateString) {
  if (!dateString) return null;
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
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
  return getChannelDisplayName(channel) || channel.id;
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
            <option key={p} value={p}>
              {p}
            </option>
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

      {normalizeStatus(value.planningStatus) === "запущено" && (
        <div>
          <label>База коммуникаций</label>
          <input
            type="number"
            min="0"
            value={value.sentBaseCount || ""}
            onChange={(e) => update("sentBaseCount", e.target.value)}
            placeholder="необязательно"
          />
        </div>
      )}

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

const ENABLE_LAUNCH_DRAFT_BUTTON = false;

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
              <option key={p} value={p}>
                {p}
              </option>
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
        {normalizeStatus(value.planningStatus) === "запущено" && (
          <div>
            <label>База коммуникаций</label>
            <input
              type="number"
              min="0"
              value={value.sentBaseCount || ""}
              onChange={(e) => upd("sentBaseCount", e.target.value)}
              placeholder="необязательно"
            />
          </div>
        )}
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
  onBulkUpdateLaunches,
  onBulkDeleteLaunches,
  onApplyDraft,
  onImportLaunches,
  onAutoResolve,
  onResetData,
  onDownloadTemplate,
}) {
  const [search, setSearch] = useState("");
  const [calendarMode, setCalendarMode] = useState("2w");
  const [periodStart, setPeriodStart] = useState(getCurrentWeekStart);
  const [isDraftOpen, setIsDraftOpen] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [lastSelectedId, setLastSelectedId] = useState(null);
  const [editingCell, setEditingCell] = useState(null);
  const [editingCellValue, setEditingCellValue] = useState("");
  const [bulkEdit, setBulkEdit] = useState({
    planningStatus: "",
    priority: "",
    channelId: "",
    shiftDays: "",
  });
  // inline editing: null = closed, "new" = add row, id = editing that row
  const [editingId, setEditingId] = useState(null);
  const [editingData, setEditingData] = useState(null);

  const fileInputRef = useRef(null);

  useEffect(() => {
    function handleHeaderImport(event) {
      fileInputRef.current?.click();
    }

    function handleHeaderExport() {
      exportLaunchesToExcel(launches, channels);
    }

    document.addEventListener("crm-trigger-import", handleHeaderImport);
    document.addEventListener("crm-trigger-export", handleHeaderExport);

    return () => {
      document.removeEventListener("crm-trigger-import", handleHeaderImport);
      document.removeEventListener("crm-trigger-export", handleHeaderExport);
    };
  }, [launches, channels]);

  const filtered = useMemo(() => {
    const safeLaunches = Array.isArray(launches) ? launches : [];
    const period = buildPeriodRange(periodStart, calendarMode);
    const periodStartString = period.start.toISOString().slice(0, 10);
    const periodEndString = period.end.toISOString().slice(0, 10);
    return safeLaunches.filter((item) => {
      const gameValue = (item.game || "").toLowerCase();
      const audienceValue = (item.audience || "").toLowerCase();
      const searchValue = search.toLowerCase();
      const overlapsPeriod =
        item.startDate &&
        item.endDate &&
        item.startDate <= periodEndString &&
        item.endDate >= periodStartString;
      const matchesSearch =
        !search.trim() ||
        gameValue.includes(searchValue) ||
        audienceValue.includes(searchValue);

      return overlapsPeriod && matchesSearch;
    });
  }, [launches, search, periodStart, calendarMode]);

  const selectedLaunches = useMemo(() => {
    const safeLaunches = Array.isArray(launches) ? launches : [];
    return safeLaunches.filter((launch) => selectedIds.has(launch.id));
  }, [launches, selectedIds]);

  useEffect(() => {
    const launchIds = new Set((Array.isArray(launches) ? launches : []).map((item) => item.id));
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => launchIds.has(id)));
      if (next.size === prev.size) return prev;
      return next;
    });
  }, [launches]);

  function reportImportStatus(message) {
    if (assistantContext?.toast) {
      assistantContext.toast(message);
      return;
    }
    console.info("[launch-import]", message);
  }

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setLastSelectedId(id);
  }

  function handleSelectChange(event, id) {
    const shouldSelect = event.target.checked;
    const isRangeSelection = event.nativeEvent?.shiftKey;
    const visibleIds = filtered.map((item) => item.id);

    if (isRangeSelection && lastSelectedId && visibleIds.includes(lastSelectedId)) {
      const startIndex = visibleIds.indexOf(lastSelectedId);
      const endIndex = visibleIds.indexOf(id);

      if (startIndex !== -1 && endIndex !== -1) {
        const [from, to] =
          startIndex <= endIndex
            ? [startIndex, endIndex]
            : [endIndex, startIndex];
        const rangeIds = visibleIds.slice(from, to + 1);

        setSelectedIds((prev) => {
          const next = new Set(prev);
          rangeIds.forEach((rangeId) => {
            if (shouldSelect) {
              next.add(rangeId);
            } else {
              next.delete(rangeId);
            }
          });
          return next;
        });
        setLastSelectedId(id);
        return;
      }
    }

    toggleSelect(id);
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setLastSelectedId(null);
  }

  function updateBulkField(field, value) {
    setBulkEdit((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  function buildNormalizedLaunch(nextLaunch) {
    const next = {
      ...nextLaunch,
      game: nextLaunch.game || GAMES[0],
      planningStatus: normalizeStatus(nextLaunch.planningStatus),
      platform: nextLaunch.platform || "АМ+АО",
      priority: normalizeLaunchPriority(nextLaunch.priority),
      sentBaseCount:
        nextLaunch.sentBaseCount === "" || nextLaunch.sentBaseCount == null
          ? ""
          : Math.max(0, Number(nextLaunch.sentBaseCount) || 0),
    };

    const channel = channels.find((item) => item.id === next.channelId);
    if (channel && (!next.duration || Number(next.duration) <= 0)) {
      next.duration = channel.duration || 5;
    }

    next.duration = Math.max(1, Number(next.duration) || 1);
    next.endDate = calculateEndDate(next.startDate, next.duration);

    const nextAllLaunches = launches.map((launch) =>
      launch.id === next.id ? next : launch
    );
    const issues = detectConflicts(next, nextAllLaunches, channels);

    return {
      ...next,
      issues,
      conflictStatus: issues.length ? "conflict" : "ok",
    };
  }

  function startCellEdit(launch, field) {
    setEditingCell({ id: launch.id, field });
    setEditingCellValue(
      field === "duration"
        ? String(launch[field] ?? "")
        : launch[field] ?? ""
    );
  }

  function cancelCellEdit() {
    setEditingCell(null);
    setEditingCellValue("");
  }

  function saveCellEdit(launch, field, value) {
    let next = { ...launch, [field]: value };

    if (field === "channelId") {
      const channel = channels.find((item) => item.id === value);
      if (channel) {
        next.duration = channel.duration || next.duration || 5;
      }
    }

    if (field === "duration") {
      next.duration = Math.max(1, Number(value) || launch.duration || 1);
    }

    const normalized = buildNormalizedLaunch(next);
    onUpdateLaunch(normalized);
    if (field === "startDate") {
      const nextPeriodStart = getWeekStartFromDateString(normalized.startDate);
      if (nextPeriodStart) {
        setPeriodStart(nextPeriodStart);
      }
    }
    setEditingCell(null);
    setEditingCellValue("");
  }

  function renderCellEditor(launch, field) {
    const commonProps = {
      autoFocus: true,
      onClick: (event) => event.stopPropagation(),
      onKeyDown: (event) => {
        if (event.key === "Enter") {
          saveCellEdit(launch, field, editingCellValue);
        }
        if (event.key === "Escape") {
          cancelCellEdit();
        }
      },
    };

    if (field === "game") {
      return (
        <select
          {...commonProps}
          value={editingCellValue || launch.game || GAMES[0]}
          onChange={(e) => {
            setEditingCellValue(e.target.value);
            saveCellEdit(launch, field, e.target.value);
          }}
          onBlur={cancelCellEdit}
        >
          {GAMES.map((game) => (
            <option key={game} value={game}>
              {game}
            </option>
          ))}
        </select>
      );
    }

    if (field === "channelId") {
      return (
        <select
          {...commonProps}
          value={editingCellValue || launch.channelId || ""}
          onChange={(e) => {
            setEditingCellValue(e.target.value);
            saveCellEdit(launch, field, e.target.value);
          }}
          onBlur={cancelCellEdit}
        >
          {channels.map((channel) => (
            <option key={channel.id} value={channel.id}>
              {formatChannelOptionLabel(channel)}
            </option>
          ))}
        </select>
      );
    }

    if (field === "startDate") {
      return (
        <input
          {...commonProps}
          type="date"
          value={editingCellValue || launch.startDate || ""}
          onChange={(e) => setEditingCellValue(e.target.value)}
          onBlur={() => saveCellEdit(launch, field, editingCellValue)}
        />
      );
    }

    if (field === "duration") {
      return (
        <input
          {...commonProps}
          type="number"
          min="1"
          value={editingCellValue || String(launch.duration || 1)}
          onChange={(e) => setEditingCellValue(e.target.value)}
          onBlur={() => saveCellEdit(launch, field, editingCellValue)}
          style={{ width: "72px" }}
        />
      );
    }

    if (field === "platform") {
      return (
        <select
          {...commonProps}
          value={editingCellValue || launch.platform || "АМ+АО"}
          onChange={(e) => {
            setEditingCellValue(e.target.value);
            saveCellEdit(launch, field, e.target.value);
          }}
          onBlur={cancelCellEdit}
        >
          {PLATFORMS.map((platform) => (
            <option key={platform} value={platform}>
              {platform}
            </option>
          ))}
        </select>
      );
    }

    if (field === "audience") {
      return (
        <input
          {...commonProps}
          type="text"
          value={editingCellValue}
          onChange={(e) => setEditingCellValue(e.target.value)}
          onBlur={() => saveCellEdit(launch, field, editingCellValue)}
        />
      );
    }

    if (field === "priority") {
      return (
        <select
          {...commonProps}
          value={editingCellValue || normalizeLaunchPriority(launch.priority)}
          onChange={(e) => {
            setEditingCellValue(e.target.value);
            saveCellEdit(launch, field, e.target.value);
          }}
          onBlur={cancelCellEdit}
        >
          {PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {priority}
            </option>
          ))}
        </select>
      );
    }

    if (field === "sentBaseCount") {
      return (
        <input
          {...commonProps}
          type="number"
          min="0"
          value={editingCellValue}
          onChange={(e) => setEditingCellValue(e.target.value)}
          onBlur={() => saveCellEdit(launch, field, editingCellValue)}
          style={{ width: "110px" }}
        />
      );
    }

    return null;
  }

  function renderEditableCell(launch, field, content) {
    const isEditing =
      editingCell?.id === launch.id && editingCell?.field === field;

    return (
      <td
          onClick={(event) => {
            event.stopPropagation();
            startCellEdit(launch, field);
          }}
        style={{ cursor: "pointer" }}
      >
        {isEditing ? renderCellEditor(launch, field) : content}
      </td>
    );
  }

  function handleEditSelected() {
    if (selectedLaunches.length !== 1) return;
    const launch = selectedLaunches[0];
    setEditingId(launch.id);
    setEditingData({
      ...launch,
      planningStatus: normalizeStatus(launch.planningStatus),
    });
  }

  function handleDuplicateSelected() {
    if (!selectedLaunches.length) return;
    selectedLaunches.forEach((launch, index) => {
      onAddLaunch({
        ...launch,
        id: `launch-${Date.now()}-${index}`,
        issues: [],
        conflictStatus: "ok",
      });
    });
  }

  function handleApplyBulkEdit() {
    if (!selectedLaunches.length || typeof onBulkUpdateLaunches !== "function") {
      return;
    }

    const shiftDays = Number(bulkEdit.shiftDays || 0);
    const hasShift = Number.isFinite(shiftDays) && shiftDays !== 0;
    const hasStatus = Boolean(bulkEdit.planningStatus);
    const hasPriority = Boolean(bulkEdit.priority);
    const hasChannel = Boolean(bulkEdit.channelId);

    if (!hasShift && !hasStatus && !hasPriority && !hasChannel) {
      reportImportStatus("Сначала выбери хотя бы одно массовое изменение");
      return;
    }

    const draftUpdates = selectedLaunches.map((launch) => {
      const next = { ...launch };

      if (hasStatus) {
        next.planningStatus = bulkEdit.planningStatus;
      }

      if (hasPriority) {
        next.priority = bulkEdit.priority;
      }

      if (hasChannel) {
        const nextChannel = channels.find((channel) => channel.id === bulkEdit.channelId);
        next.channelId = bulkEdit.channelId;
        if (nextChannel?.duration) {
          next.duration = nextChannel.duration;
        }
        next.endDate = calculateEndDate(next.startDate, next.duration);
      }

      if (hasShift) {
        next.startDate = shiftDateByDays(next.startDate, shiftDays);
        next.endDate = calculateEndDate(next.startDate, next.duration);
        next.earliestStartDate = shiftDateByDays(
          next.earliestStartDate || launch.earliestStartDate,
          shiftDays
        );
        next.latestStartDate = shiftDateByDays(
          next.latestStartDate || launch.latestStartDate,
          shiftDays
        );
      }

      return next;
    });

    const draftById = new Map(draftUpdates.map((launch) => [launch.id, launch]));
    const nextAllLaunches = launches.map(
      (launch) => draftById.get(launch.id) || launch
    );
    const nextLaunches = draftUpdates.map((launch) => {
      const issues = detectConflicts(launch, nextAllLaunches, channels);
      return {
        ...launch,
        issues,
        conflictStatus: issues.length ? "conflict" : "ok",
      };
    });

    onBulkUpdateLaunches(nextLaunches);
    const nextPeriodStart = getWeekStartFromDateString(nextLaunches[0]?.startDate);
    if (nextPeriodStart) {
      setPeriodStart(nextPeriodStart);
    }
    clearSelection();
    setBulkEdit({
      planningStatus: "",
      priority: "",
      channelId: "",
      shiftDays: "",
    });
  }

  function handleBulkDelete() {
    if (!selectedLaunches.length || typeof onBulkDeleteLaunches !== "function") {
      return;
    }

    if (!window.confirm(`Удалить выбранные запуски: ${selectedLaunches.length}?`)) {
      return;
    }

    onBulkDeleteLaunches(selectedLaunches.map((launch) => launch.id));
    clearSelection();
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

  function handleBuildDraft() {
    const nextDraft = buildFullScheduleDraft({
      launches,
      channels,
      assistantContext,
    });

    setScheduleDraft(nextDraft);
    setIsDraftOpen(true);
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
          {ENABLE_LAUNCH_DRAFT_BUTTON && (
            <button className="btn btn-primary" onClick={handleBuildDraft}>
              Черновик изменений
            </button>
          )}

          <button
            className="btn"
            onClick={() => {
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

      <WeekRangeNavigator
        mode={calendarMode}
        periodStart={periodStart}
        onModeChange={setCalendarMode}
        onPeriodStartChange={setPeriodStart}
      />

      {selectedLaunches.length > 0 && (
        <div
          className="section-card"
          style={{
            marginBottom: "16px",
            padding: "14px 16px",
            display: "flex",
            flexWrap: "wrap",
            gap: "10px",
            alignItems: "end",
          }}
        >
          <div style={{ minWidth: "160px" }}>
            <div className="muted small">Выбрано</div>
            <div style={{ fontWeight: 700, fontSize: "18px" }}>
              {selectedLaunches.length}
            </div>
          </div>

          <div>
            <label>Статус</label>
            <select
              value={bulkEdit.planningStatus}
              onChange={(e) => updateBulkField("planningStatus", e.target.value)}
            >
              <option value="">Не менять</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label>Приоритет</label>
            <select
              value={bulkEdit.priority}
              onChange={(e) => updateBulkField("priority", e.target.value)}
            >
              <option value="">Не менять</option>
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label>Канал</label>
            <select
              value={bulkEdit.channelId}
              onChange={(e) => updateBulkField("channelId", e.target.value)}
            >
              <option value="">Не менять</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {formatChannelOptionLabel(channel)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label>Сдвиг дат, дней</label>
            <input
              type="number"
              value={bulkEdit.shiftDays}
              onChange={(e) => updateBulkField("shiftDays", e.target.value)}
              placeholder="0"
              style={{ maxWidth: "120px" }}
            />
          </div>

          <button className="btn btn-primary" onClick={handleApplyBulkEdit}>
            Применить к выбранным
          </button>

          {selectedLaunches.length === 1 && (
            <button className="btn" onClick={handleEditSelected}>
              Редактировать
            </button>
          )}

          <button className="btn" onClick={handleDuplicateSelected}>
            {selectedLaunches.length === 1
              ? "Дублировать"
              : "Дублировать выбранные"}
          </button>

          <button className="btn" onClick={clearSelection}>
            Снять выбор
          </button>

          <button className="btn btn-danger" onClick={handleBulkDelete}>
            Удалить выбранные
          </button>
        </div>
      )}

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
                  <th>База комм.</th>
                  <th>Конфликт</th>
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
                          const newLaunch = {
                            ...editingData,
                            game: editingData.game || GAMES[0],
                            planningStatus: normalizeStatus(
                              editingData.planningStatus
                            ),
                          };
                          onAddLaunch(newLaunch);
                          const nextPeriodStart = getWeekStartFromDateString(
                            newLaunch.startDate
                          );
                          if (nextPeriodStart) {
                            setPeriodStart(nextPeriodStart);
                          }
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
                  return (
                    <React.Fragment key={launch.id}>
                      {isEditing ? (
                        <tr style={{ background: "#f8faff" }}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(launch.id)}
                              onChange={(event) =>
                                handleSelectChange(event, launch.id)
                              }
                              style={{ cursor: "pointer" }}
                            />
                          </td>
                          <td colSpan={11}>
                            <InlineForm
                              value={editingData}
                              channels={channels}
                              onChange={setEditingData}
                              onSave={() => {
                                const updatedLaunch = {
                                  ...editingData,
                                  game: editingData.game || GAMES[0],
                                  planningStatus: normalizeStatus(
                                    editingData.planningStatus
                                  ),
                                };
                                onUpdateLaunch(updatedLaunch);
                                const nextPeriodStart = getWeekStartFromDateString(
                                  updatedLaunch.startDate
                                );
                                if (nextPeriodStart) {
                                  setPeriodStart(nextPeriodStart);
                                }
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
                              onChange={(event) =>
                                handleSelectChange(event, launch.id)
                              }
                              style={{ cursor: "pointer" }}
                            />
                          </td>
                          {renderEditableCell(
                            launch,
                            "game",
                            launch.game || GAMES[0]
                          )}
                          {renderEditableCell(
                            launch,
                            "channelId",
                            getChannelName(launch.channelId, channels)
                          )}
                          {renderEditableCell(
                            launch,
                            "startDate",
                            formatRuDate(launch.startDate)
                          )}
                          {renderEditableCell(
                            launch,
                            "duration",
                            launch.duration
                          )}
                          <td>{formatRuDate(launch.endDate)}</td>
                          {renderEditableCell(
                            launch,
                            "platform",
                            <span className={platformClass(launch.platform)}>
                              {launch.platform}
                            </span>
                          )}
                          {renderEditableCell(
                            launch,
                            "audience",
                            launch.audience || "—"
                          )}
                          {renderEditableCell(
                            launch,
                            "priority",
                            <span className={priorityClass(launch.priority)}>
                              {launch.priority}
                            </span>
                          )}
                          <td>
                            <div className="status-select-wrap">
                              <select
                                className="status-select-clean"
                                value={normalizeStatus(launch.planningStatus)}
                                onChange={(e) =>
                                  {
                                    const nextStatus = e.target.value;
                                    onUpdateLaunch({
                                      ...launch,
                                      planningStatus: nextStatus,
                                    });
                                    if (nextStatus === "запущено") {
                                      setEditingId(launch.id);
                                      setEditingData({
                                        ...launch,
                                        planningStatus: nextStatus,
                                      });
                                    }
                                  }
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
                          {normalizeStatus(launch.planningStatus) === "запущено"
                            ? renderEditableCell(
                                launch,
                                "sentBaseCount",
                                launch.sentBaseCount
                                  ? String(launch.sentBaseCount)
                                  : "ввести"
                              )
                            : (
                              <td style={{ color: "#94a3b8" }}>—</td>
                            )}
                          <td>
                            {launch.conflictStatus === "conflict" ? (
                              <span className="badge badge-red">Конфликт</span>
                            ) : (
                              <span className="badge badge-green-light">
                                Всё ок
                              </span>
                            )}
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
