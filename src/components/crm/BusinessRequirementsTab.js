import React, { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "./Toast";
import {
  AUDIENCE_OPTIONS,
  PRIORITY_OPTIONS,
  REQUIREMENT_STATUS_OPTIONS as STATUS_OPTIONS,
  WEEK_OPTIONS,
  createEmptyRequirement,
  formatDate,
  getClosestWeekStart,
  getMonday,
  getWeekRange,
  normalizeFixedDateMode,
  normalizePriority,
  normalizeRequirement,
} from "../../lib/requirements-domain";

const FIXED_DATE_OPTIONS = [
  { value: "no", label: "Нет" },
  { value: "yes", label: "Да" },
];

function priorityBadgeClass(priority) {
  const value = Number(priority);

  if (value >= 4) return "badge badge-red";
  if (value >= 2) return "badge badge-orange";
  return "badge badge-blue";
}

function statusBadgeClass(status) {
  if (status === "согласовано") return "badge badge-green";
  if (status === "в работе") return "badge badge-blue";
  if (status === "отклонено") return "badge badge-red";
  return "badge";
}

function getChannelNames(channelIds, channels) {
  if (!Array.isArray(channelIds) || !channelIds.length) return "—";

  return channelIds
    .map(
      (channelId) =>
        channels.find((item) => item.id === channelId)?.name || channelId
    )
    .join(", ");
}

function getFixedDateLabel(item) {
  if (item.hasFixedDates !== "yes") return "Нет";
  if (item.fixedStartDate && item.fixedEndDate) {
    return `${item.fixedStartDate} - ${item.fixedEndDate}`;
  }
  if (item.fixedStartDate) return item.fixedStartDate;
  return "Да";
}

function buildExportRows(requirements, channels) {
  return requirements.map((item) => ({
    "Неделя с": item.weekStart || "",
    "Неделя до": item.weekEnd || "",
    Игра: item.game || "",
    Каналы:
      getChannelNames(item.channelIds, channels) === "—"
        ? ""
        : getChannelNames(item.channelIds, channels),
    База: item.audience || "",
    Приоритет: normalizePriority(item.priority),
    "Жесткая привязка к датам": item.hasFixedDates === "yes" ? "Да" : "Нет",
    "Дата с": item.fixedStartDate || "",
    "Дата до": item.fixedEndDate || "",
    Статус: item.status || "новое",
    "Ожидаемый результат": item.desiredResult || "",
    Комментарий: item.comment || "",
  }));
}

async function exportRequirementsToExcel(requirements, channels) {
  const XLSX = await import("xlsx");
  const rows = buildExportRows(requirements, channels);

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet["!cols"] = [
    { wch: 14 },
    { wch: 14 },
    { wch: 16 },
    { wch: 30 },
    { wch: 28 },
    { wch: 10 },
    { wch: 22 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 28 },
    { wch: 36 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Business Requirements");
  XLSX.writeFile(
    workbook,
    `business-requirements-${formatDate(new Date())}.xlsx`
  );
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
      raw: true,
      blankrows: false,
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
      if (rows.length > 0) return rows;
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
      row.push(cell?.w ?? cell?.v ?? "");
    }
    rawMatrix.push(row);
  }

  if (rawMatrix.length < 2) return [];

  const [headerRow, ...bodyRows] = rawMatrix;
  const headers = (headerRow || []).map((cell) => String(cell || "").trim());
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

function findChannelIdByImportedName(channelName, channels) {
  const byName = channels.find((channel) => channel.name === channelName);
  if (byName) return byName.id;

  const byId = channels.find((channel) => channel.id === channelName);
  if (byId) return byId.id;

  return "";
}

function parseImportedChannelIds(value, channels) {
  if (!value) return [];

  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => findChannelIdByImportedName(item, channels))
    .filter(Boolean);
}

async function importRequirementsFromFile(file, channels) {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  let workbook;

  try {
    workbook = XLSX.read(buffer, {
      type: "array",
      cellDates: false,
      dense: false,
    });
  } catch (error) {
    throw new Error(error?.message || "Не удалось прочитать Excel-файл");
  }

  const firstSheetName = workbook?.SheetNames?.[0];
  const sheet = firstSheetName ? workbook.Sheets[firstSheetName] : null;
  if (!firstSheetName || !sheet) {
    throw new Error("Ошибка при импорте листа");
  }

  const rows = rowsFromWorksheet(sheet, XLSX);

  if (!rows.length) {
    throw new Error("Файл пустой или не содержит строк для импорта");
  }

  return rows.map((row, index) => {
    const weekStart = getClosestWeekStart(
      normalizeImportedDate(row["Неделя с"], XLSX) || formatDate(getMonday())
    );
    const range = getWeekRange(weekStart);
    const fixedModeRaw =
      String(row["Жесткая привязка к датам"] || row["Фиксация по датам"] || "")
        .trim()
        .toLowerCase() === "да"
        ? "yes"
        : "no";

    return normalizeRequirement({
      id: `requirement-import-${Date.now()}-${index}-${Math.random()
        .toString(36)
        .slice(2, 6)}`,
      weekStart,
      weekEnd: row["Неделя до"] || range.weekEnd,
      game: row["Игра"] || "Матрёшки",
      channelIds: parseImportedChannelIds(
        row["Каналы"] || row["Канал"],
        channels
      ),
      audience: row["База"] || AUDIENCE_OPTIONS[0],
      priority: row["Приоритет"] || "3",
      hasFixedDates: fixedModeRaw,
      fixedStartDate: normalizeImportedDate(row["Дата с"], XLSX) || "",
      fixedEndDate:
        normalizeImportedDate(row["Дата до"], XLSX) ||
        normalizeImportedDate(row["Дата с"], XLSX) ||
        "",
      desiredResult: row["Ожидаемый результат"] || "",
      comment: row["Комментарий"] || "",
      status: row["Статус"] || "новое",
    });
  });
}

function RequirementInlineForm({
  value,
  channels,
  onChange,
  onSave,
  onCancel,
  isNew,
}) {
  function upd(field, val) {
    const next = { ...value, [field]: val };

    if (field === "weekStart") {
      const ws = getClosestWeekStart(val);
      const range = getWeekRange(ws);
      next.weekStart = range.weekStart;
      next.weekEnd = range.weekEnd;
    }

    if (field === "priority") {
      next.priority = normalizePriority(val);
    }

    if (field === "channelIds") {
      next.channelIds = Array.isArray(val) ? val : [];
    }

    if (field === "hasFixedDates") {
      next.hasFixedDates = normalizeFixedDateMode(val);
      if (next.hasFixedDates !== "yes") {
        next.fixedStartDate = "";
        next.fixedEndDate = "";
      }
    }

    if (field === "fixedStartDate") {
      next.fixedStartDate = val;
      if (!next.fixedEndDate) {
        next.fixedEndDate = val;
      }
    }

    if (field === "fixedEndDate") {
      next.fixedEndDate = val;
    }

    onChange(next);
  }

  return (
    <div style={{ padding: "10px 4px" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: "8px",
          marginBottom: "10px",
        }}
      >
        <div>
          <label>Неделя</label>
          <select
            value={getClosestWeekStart(value.weekStart)}
            onChange={(e) => upd("weekStart", e.target.value)}
          >
            {WEEK_OPTIONS.map((o) => (
              <option key={o.weekStart} value={o.weekStart}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Игра</label>
          <select
            value={value.game}
            onChange={(e) => upd("game", e.target.value)}
          >
            {["Матрёшки", "Суперигра", "КНБ", "Алхимия"].map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Приоритет</label>
          <select
            value={normalizePriority(value.priority)}
            onChange={(e) => upd("priority", e.target.value)}
          >
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>База</label>
          <select
            value={value.audience}
            onChange={(e) => upd("audience", e.target.value)}
          >
            {AUDIENCE_OPTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Жёсткие даты</label>
          <select
            value={normalizeFixedDateMode(value.hasFixedDates)}
            onChange={(e) => upd("hasFixedDates", e.target.value)}
          >
            {FIXED_DATE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {value.hasFixedDates === "yes" && (
          <>
            <div>
              <label>Дата с</label>
              <input
                type="date"
                value={value.fixedStartDate || ""}
                onChange={(e) => upd("fixedStartDate", e.target.value)}
              />
            </div>

            <div>
              <label>Дата до</label>
              <input
                type="date"
                value={value.fixedEndDate || ""}
                onChange={(e) => upd("fixedEndDate", e.target.value)}
              />
            </div>
          </>
        )}

        <div style={{ gridColumn: "span 2" }}>
          <label>Каналы</label>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "6px",
              padding: "8px",
              border: "1px solid #e4e4e7",
              borderRadius: "10px",
              background: "#fff",
            }}
          >
            {channels.map((ch) => {
              const checked = (value.channelIds || []).includes(ch.id);

              return (
                <label
                  key={ch.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                    fontSize: "13px",
                    cursor: "pointer",
                    padding: "4px 8px",
                    borderRadius: "6px",
                    background: checked ? "#dbeafe" : "#f4f4f5",
                    border: checked
                      ? "1px solid #93c5fd"
                      : "1px solid transparent",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const ids = value.channelIds || [];
                      upd(
                        "channelIds",
                        checked
                          ? ids.filter((id) => id !== ch.id)
                          : [...ids, ch.id]
                      );
                    }}
                    style={{ width: "13px", height: "13px", margin: 0 }}
                  />
                  {ch.name}
                </label>
              );
            })}
          </div>
        </div>

        <div style={{ gridColumn: "span 2" }}>
          <label>Ожидаемый результат</label>
          <input
            value={value.desiredResult || ""}
            onChange={(e) => upd("desiredResult", e.target.value)}
            placeholder="необязательно"
          />
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

export default function BusinessRequirementsTab({
  requirements = [],
  channels = [],
  onAddRequirement,
  onUpdateRequirement,
  onDeleteRequirement,
  onImportRequirements,
  onDownloadTemplate,
}) {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editingData, setEditingData] = useState(null);

  const fileInputRef = useRef(null);

  function handleOpenCreate() {
    setEditingId("new");
    setEditingData(createEmptyRequirement());
  }

  function handleCloseEditor() {
    setEditingId(null);
    setEditingData(null);
  }

  function handleSaveNew(data) {
    const normalized = normalizeRequirement({
      ...data,
      status: data?.status || "новое",
    });

    if (typeof onAddRequirement === "function") {
      onAddRequirement(normalized);
    }

    handleCloseEditor();
    if (toast) toast("Требование добавлено");
  }

  function handleSaveEdit(data) {
    const original =
      requirements.find((item) => item.id === data?.id) || data || {};

    const normalized = normalizeRequirement({
      ...original,
      ...data,
      status: data?.status || original?.status || "новое",
    });

    if (typeof onUpdateRequirement === "function") {
      onUpdateRequirement(normalized);
    }

    handleCloseEditor();
    if (toast) toast("Требование сохранено");
  }

  function handleDelete(id) {
    if (!window.confirm("Удалить бизнес-требование?")) return;

    if (typeof onDeleteRequirement === "function") {
      onDeleteRequirement(id);
    }

    if (toast) toast("Требование удалено");
  }

  async function handleImportFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      if (toast) toast(`Читаю файл: ${file.name}`);
      const importedRequirements = await importRequirementsFromFile(
        file,
        channels
      );
      if (toast) {
        toast(
          `Файл прочитан, найдено ${importedRequirements.length} бизнес-требовани(й)`
        );
      }

      const confirmReplace = window.confirm(
        `Импортировать ${importedRequirements.length} бизнес-требовани(й)? Текущий список будет заменён.`
      );

      if (confirmReplace) {
        if (toast) toast("Применяю импорт бизнес-требований");

        if (typeof onImportRequirements === "function") {
          onImportRequirements(importedRequirements);
        } else {
          requirements.forEach((item) => {
            if (typeof onDeleteRequirement === "function") {
              onDeleteRequirement(item.id);
            }
          });

          importedRequirements.forEach((item) => {
            if (typeof onAddRequirement === "function") {
              onAddRequirement(item);
            }
          });
        }

        handleCloseEditor();
        if (toast) toast("Импорт завершён");
      } else if (toast) {
        toast("Импорт бизнес-требований отменён");
      }
    } catch (error) {
      console.error("Business requirements import failed", error);
      alert(error?.message || "Не удалось импортировать файл");
    } finally {
      event.target.value = "";
    }
  }

  useEffect(() => {
    function handleImport() {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
        fileInputRef.current.click();
      }
    }

    function handleExport() {
      exportRequirementsToExcel(requirements, channels);
    }

    document.addEventListener(
      "crm-trigger-business-requirements-import",
      handleImport
    );
    document.addEventListener(
      "crm-trigger-business-requirements-export",
      handleExport
    );

    return () => {
      document.removeEventListener(
        "crm-trigger-business-requirements-import",
        handleImport
      );
      document.removeEventListener(
        "crm-trigger-business-requirements-export",
        handleExport
      );
    };
  }, [requirements, channels]);

  const filtered = useMemo(() => {
    const normalizedRequirements = Array.isArray(requirements)
      ? requirements.map((item) => normalizeRequirement(item))
      : [];

    const q = search.trim().toLowerCase();
    if (!q) return normalizedRequirements;

    return normalizedRequirements.filter((item) => {
      const channelText = getChannelNames(
        item.channelIds,
        channels
      ).toLowerCase();
      const weekText = `${item.weekStart} - ${item.weekEnd}`.toLowerCase();
      const fixedDateText = getFixedDateLabel(item).toLowerCase();

      return (
        (item.game || "").toLowerCase().includes(q) ||
        (item.audience || "").toLowerCase().includes(q) ||
        (item.comment || "").toLowerCase().includes(q) ||
        (item.desiredResult || "").toLowerCase().includes(q) ||
        channelText.includes(q) ||
        weekText.includes(q) ||
        fixedDateText.includes(q)
      );
    });
  }, [requirements, search, channels]);

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar-left">
          <input
            placeholder="Поиск по игре, неделе, каналам, базе, датам, комментарию"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="toolbar-right">
          <button className="btn" onClick={handleOpenCreate}>
            Добавить бизнес-требование
          </button>

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
            onClick={() => exportRequirementsToExcel(requirements, channels)}
          >
            Экспорт Excel
          </button>

          {typeof onDownloadTemplate === "function" && (
            <button className="btn" onClick={onDownloadTemplate}>
              Шаблон
            </button>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: "none" }}
        onChange={handleImportFileChange}
      />

      <div className="table-wrap">
        <table className="crm-table">
          <thead>
            <tr>
              <th>Неделя</th>
              <th>Игра</th>
              <th>Каналы</th>
              <th>База</th>
              <th>Приоритет</th>
              <th>Фиксация по датам</th>
              <th>Статус</th>
              <th>Комментарий</th>
              <th>Действия</th>
            </tr>
          </thead>

          <tbody>
            {editingId === "new" && editingData && (
              <tr style={{ background: "#f8faff" }}>
                <td colSpan={9}>
                  <RequirementInlineForm
                    value={editingData}
                    channels={channels}
                    onChange={setEditingData}
                    onSave={() => handleSaveNew(editingData)}
                    onCancel={handleCloseEditor}
                    isNew
                  />
                </td>
              </tr>
            )}

            {filtered.map((item) => {
              const isEditing = editingId === item.id;

              return (
                <React.Fragment key={item.id}>
                  {isEditing ? (
                    <tr style={{ background: "#f8faff" }}>
                      <td colSpan={9}>
                        <RequirementInlineForm
                          value={editingData}
                          channels={channels}
                          onChange={setEditingData}
                          onSave={() => handleSaveEdit(editingData)}
                          onCancel={handleCloseEditor}
                        />
                      </td>
                    </tr>
                  ) : (
                    <tr
                      style={{ cursor: "pointer" }}
                      onDoubleClick={() => {
                        setEditingId(item.id);
                        setEditingData(normalizeRequirement(item));
                      }}
                    >
                      <td>
                        {item.weekStart} — {item.weekEnd}
                      </td>
                      <td>{item.game}</td>
                      <td>{getChannelNames(item.channelIds, channels)}</td>
                      <td>{item.audience || "—"}</td>
                      <td>
                        <span className={priorityBadgeClass(item.priority)}>
                          {normalizePriority(item.priority)}
                        </span>
                      </td>
                      <td>{getFixedDateLabel(item)}</td>
                      <td>
                        <span className={statusBadgeClass(item.status)}>
                          {item.status}
                        </span>
                      </td>
                      <td className="muted small">{item.comment || "—"}</td>
                      <td>
                        <div className="actions">
                          <button
                            className="btn-small"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingId(item.id);
                              setEditingData(normalizeRequirement(item));
                            }}
                          >
                            Ред.
                          </button>

                          <button
                            className="btn-small btn-danger"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(item.id);
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

            {!filtered.length && (
              <tr>
                <td
                  colSpan="9"
                  className="muted"
                  style={{ textAlign: "center" }}
                >
                  Нет бизнес-требований
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
