import React, { useState } from "react";
import { formatDisplayDate, getChannelName } from "../../lib/crm-store";

function toneStyle(tone) {
  if (tone === "positive") return { color: "#166534", background: "#dcfce7" };
  if (tone === "negative") return { color: "#b91c1c", background: "#fee2e2" };
  return { color: "#92400e", background: "#fef3c7" };
}

export default function ScheduleDraftModal({
  proposed,
  skipped,
  channels,
  onConfirm,
  onClose,
}) {
  const [selected, setSelected] = useState(
    () => new Set(proposed.map((l) => l.id))
  );

  function toggleAll(checked) {
    if (checked) setSelected(new Set(proposed.map((l) => l.id)));
    else setSelected(new Set());
  }

  function toggleOne(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleConfirm() {
    const accepted = proposed.filter((l) => selected.has(l.id));
    onConfirm(accepted);
  }

  const allChecked = selected.size === proposed.length;

  return (
    <div className="modal-backdrop" style={{ zIndex: 200 }}>
      <div
        className="modal"
        style={{
          width: "min(1100px, 100%)",
          maxHeight: "calc(100vh - 48px)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: "14px",
          }}
        >
          <div>
            <h3 style={{ margin: 0 }}>🗓 Предлагаемый тайминг</h3>
            <div
              style={{ fontSize: "13px", color: "#64748b", marginTop: "4px" }}
            >
              Выберите запуски для добавления. Всего предложено:{" "}
              <strong>{proposed.length}</strong>
              {skipped.length > 0 && (
                <span style={{ marginLeft: "12px", color: "#b91c1c" }}>
                  Пропущено: <strong>{skipped.length}</strong>
                </span>
              )}
            </div>
          </div>
          <button className="btn" onClick={onClose} style={{ flexShrink: 0 }}>
            ✕
          </button>
        </div>

        <div style={{ flex: 1, overflow: "auto" }}>
          {proposed.length > 0 && (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  marginBottom: "10px",
                }}
              >
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "13px",
                    fontWeight: 700,
                    margin: 0,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={(e) => toggleAll(e.target.checked)}
                  />
                  Выбрать все
                </label>
                <span className="muted small">
                  {selected.size} из {proposed.length} выбрано
                </span>
              </div>

              <div className="table-wrap">
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}></th>
                      <th>Игра</th>
                      <th>Канал</th>
                      <th>Старт</th>
                      <th>Конец</th>
                      <th>Дней</th>
                      <th>Аудитория</th>
                      <th>Приоритет</th>
                      <th>Score</th>
                      <th>Почему выбран</th>
                      <th>Конфликт</th>
                      <th>Комментарий</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proposed.map((launch) => {
                      const checked = selected.has(launch.id);
                      const planning = launch._planningMeta || {};
                      const topReasons = (planning.breakdown || []).slice(0, 3);
                      const alternatives = (planning.alternatives || [])
                        .filter((item) => item.startDate !== launch.startDate)
                        .slice(0, 2);
                      return (
                        <tr
                          key={launch.id}
                          style={{
                            opacity: checked ? 1 : 0.45,
                            background:
                              launch.conflictStatus === "conflict"
                                ? "#fff8f8"
                                : undefined,
                          }}
                          onClick={() => toggleOne(launch.id)}
                        >
                          <td onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleOne(launch.id)}
                            />
                          </td>
                          <td style={{ fontWeight: 700 }}>{launch.game}</td>
                          <td>{getChannelName(launch.channelId, channels)}</td>
                          <td className="small">
                            {formatDisplayDate(launch.startDate)}
                          </td>
                          <td className="small">
                            {formatDisplayDate(launch.endDate)}
                          </td>
                          <td>{launch.duration}</td>
                          <td>{launch.audience}</td>
                          <td>{launch.priority}</td>
                          <td>
                            <div style={{ fontWeight: 800 }}>
                              {planning.score ?? launch._score ?? "—"}
                            </div>
                            <div className="small muted">
                              Окно:{" "}
                              {formatDisplayDate(
                                planning.windowStart || launch.earliestStartDate
                              )}{" "}
                              —{" "}
                              {formatDisplayDate(
                                planning.windowEnd || launch.latestStartDate
                              )}
                            </div>
                          </td>
                          <td style={{ minWidth: "300px" }}>
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "6px",
                              }}
                            >
                              {topReasons.length > 0 ? (
                                topReasons.map((item) => (
                                  <div key={item.label + item.value}>
                                    <span
                                      style={{
                                        ...toneStyle(item.tone),
                                        borderRadius: "999px",
                                        padding: "2px 8px",
                                        fontSize: "11px",
                                        fontWeight: 700,
                                        marginRight: "6px",
                                        display: "inline-block",
                                      }}
                                    >
                                      {item.label}: {item.value > 0 ? "+" : ""}
                                      {item.value}
                                    </span>
                                    <span className="small">{item.description}</span>
                                  </div>
                                ))
                              ) : (
                                <span className="small muted">
                                  Обоснование пока не сформировано.
                                </span>
                              )}

                              {alternatives.length > 0 && (
                                <div className="small muted">
                                  Альтернативы:{" "}
                                  {alternatives
                                    .map(
                                      (item) =>
                                        `${formatDisplayDate(item.startDate)} (${item.score})`
                                    )
                                    .join(", ")}
                                </div>
                              )}
                            </div>
                          </td>
                          <td>
                            {launch.conflictStatus === "conflict" ? (
                              <span
                                className="badge badge-red"
                                title={launch.issues?.join("\n")}
                              >
                                ⚠ Конфликт
                              </span>
                            ) : (
                              <span className="badge badge-green">OK</span>
                            )}
                          </td>
                          <td className="small muted">{launch.comment}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {proposed.length === 0 && (
            <div
              className="section-card"
              style={{
                textAlign: "center",
                color: "#64748b",
                margin: "24px 0",
              }}
            >
              Планировщик не смог предложить ни одного запуска. Проверьте
              требования и окна дат.
            </div>
          )}

          {skipped.length > 0 && (
            <div style={{ marginTop: "18px" }}>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: "14px",
                  color: "#b91c1c",
                  marginBottom: "8px",
                }}
              >
                Пропущенные позиции ({skipped.length})
              </div>
              <div
                style={{ display: "flex", flexDirection: "column", gap: "6px" }}
              >
                {skipped.map((item, i) => (
                  <div
                    key={i}
                    style={{
                      background: "#fff8f8",
                      border: "1px solid #fecdd3",
                      borderRadius: "12px",
                      padding: "10px 14px",
                      fontSize: "13px",
                      color: "#7f1d1d",
                    }}
                    >
                    <strong>{item.req?.game}</strong> · {item.req?.audience}
                    {item.channelId && (
                      <span style={{ marginLeft: "8px", color: "#b91c1c" }}>
                        [{getChannelName(item.channelId, channels)}]
                      </span>
                    )}
                    <span style={{ marginLeft: "8px", color: "#9f1239" }}>
                      — {item.reason}
                    </span>
                    {Array.isArray(item.details) && item.details.length > 0 && (
                      <div style={{ marginTop: "6px" }}>
                        {item.details
                          .map((detail) => detail.notes || detail.effect)
                          .join("; ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div
          className="modal-actions"
          style={{
            marginTop: "16px",
            borderTop: "1px solid #e5e7eb",
            paddingTop: "14px",
          }}
        >
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn btn-primary"
            onClick={handleConfirm}
            disabled={selected.size === 0}
          >
            Добавить выбранные ({selected.size})
          </button>
        </div>
      </div>
    </div>
  );
}
