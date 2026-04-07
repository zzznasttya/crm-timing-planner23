import React, { useMemo, useState } from "react";
import {
  calculateEndDate,
  detectConflicts,
  formatDisplayDate,
  getChannelName,
} from "../../lib/crm-store";

function toneStyle(tone) {
  if (tone === "positive") return { color: "#166534", background: "#dcfce7" };
  if (tone === "negative") return { color: "#b91c1c", background: "#fee2e2" };
  return { color: "#92400e", background: "#fef3c7" };
}

function cloneLaunch(launch) {
  return {
    ...launch,
    _planningMeta: launch._planningMeta
      ? {
          ...launch._planningMeta,
          breakdown: Array.isArray(launch._planningMeta.breakdown)
            ? [...launch._planningMeta.breakdown]
            : [],
          appliedRules: Array.isArray(launch._planningMeta.appliedRules)
            ? [...launch._planningMeta.appliedRules]
            : [],
          alternatives: Array.isArray(launch._planningMeta.alternatives)
            ? [...launch._planningMeta.alternatives]
            : [],
          channelAttempts: Array.isArray(launch._planningMeta.channelAttempts)
            ? [...launch._planningMeta.channelAttempts]
            : [],
        }
      : undefined,
    issues: Array.isArray(launch.issues) ? [...launch.issues] : [],
  };
}

function hasLaunchChanged(original, current) {
  const keys = [
    "channelId",
    "startDate",
    "endDate",
    "duration",
    "audience",
    "priority",
    "comment",
    "platform",
  ];
  return keys.some((key) => String(original?.[key] ?? "") !== String(current?.[key] ?? ""));
}

function recalculateDraftConflicts(launches, channels) {
  return launches.map((launch) => {
    const issues = detectConflicts(launch, launches, channels);
    return {
      ...launch,
      issues,
      conflictStatus: issues.length ? "conflict" : "ok",
    };
  });
}

function decisionBadge(decision, modified) {
  if (decision === "rejected") {
    return <span className="badge badge-red">Отклонено</span>;
  }
  if (decision !== "accepted") {
    return <span className="badge">На проверке</span>;
  }
  if (modified) {
    return <span className="badge badge-orange">Изменено</span>;
  }
  return <span className="badge badge-green">Принять</span>;
}

function compactReasonList(planning, launch) {
  const topReasons = (planning.breakdown || []).slice(0, 3);
  const alternatives = (planning.alternatives || [])
    .filter((item) => item.startDate !== launch.startDate)
    .slice(0, 2);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
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
              {item.label}
            </span>
            <span className="small">{item.description}</span>
          </div>
        ))
      ) : (
        <span className="small muted">Обоснование пока не сформировано.</span>
      )}

      {alternatives.length > 0 && (
        <div className="small muted">
          Альтернативы:{" "}
          {alternatives.map((item) => formatDisplayDate(item.startDate)).join(", ")}
        </div>
      )}
    </div>
  );
}

export default function ScheduleDraftModal({
  proposed,
  skipped,
  channels,
  onConfirm,
  onClose,
}) {
  const [draftLaunches, setDraftLaunches] = useState(() =>
    proposed.map((launch) => cloneLaunch(launch))
  );
  const [decisions, setDecisions] = useState(() =>
    Object.fromEntries(proposed.map((launch) => [launch.id, "pending"]))
  );
  const [editingId, setEditingId] = useState(null);

  const originalById = useMemo(
    () => Object.fromEntries(proposed.map((launch) => [launch.id, launch])),
    [proposed]
  );

  const acceptedCount = draftLaunches.filter(
    (launch) => decisions[launch.id] === "accepted"
  ).length;

  const pendingCount = draftLaunches.filter(
    (launch) => !decisions[launch.id] || decisions[launch.id] === "pending"
  ).length;

  const modifiedCount = draftLaunches.filter((launch) =>
    hasLaunchChanged(originalById[launch.id], launch)
  ).length;

  function setDecision(id, decision) {
    setDecisions((prev) => ({
      ...prev,
      [id]: decision,
    }));
    if (decision === "rejected" && editingId === id) {
      setEditingId(null);
    }
  }

  function toggleAllAccepted(checked) {
    setDecisions(
      Object.fromEntries(
        draftLaunches.map((launch) => [
          launch.id,
          checked ? "accepted" : "rejected",
        ])
      )
    );
    if (!checked) {
      setEditingId(null);
    }
  }

  function updateLaunch(id, patch) {
    setDraftLaunches((prev) => {
      const nextLaunches = prev.map((launch) => {
        if (launch.id !== id) return launch;
        const next = { ...launch, ...patch };
        if ("channelId" in patch) {
          const nextChannel = channels.find((channel) => channel.id === patch.channelId);
          if (nextChannel?.duration) {
            next.duration = Math.max(1, Number(nextChannel.duration) || 1);
          }
        }
        if ("startDate" in patch || "duration" in patch) {
          next.duration = Math.max(1, Number(next.duration) || 1);
          next.endDate = calculateEndDate(next.startDate, next.duration);
        }
        return next;
      });
      return recalculateDraftConflicts(nextLaunches, channels);
    });
    setDecisions((prev) => ({
      ...prev,
      [id]: "accepted",
    }));
  }

  function resetLaunch(id) {
    const original = originalById[id];
    if (!original) return;
    setDraftLaunches((prev) =>
      recalculateDraftConflicts(
        prev.map((launch) => (launch.id === id ? cloneLaunch(original) : launch)),
        channels
      )
    );
    setDecisions((prev) => ({
      ...prev,
      [id]: "pending",
    }));
    setEditingId(null);
  }

  function handleConfirm() {
    const accepted = draftLaunches.filter(
      (launch) => decisions[launch.id] === "accepted"
    );
    onConfirm(accepted);
  }

  const allAccepted = acceptedCount === draftLaunches.length;

  return (
    <div className="modal-backdrop" style={{ zIndex: 200 }}>
      <div
        className="modal"
        style={{
          width: "min(1200px, 100%)",
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
            gap: "18px",
            marginBottom: "16px",
          }}
        >
          <div>
            <h3 style={{ margin: 0 }}>Предлагаемый тайминг</h3>
            <div style={{ fontSize: "13px", color: "#64748b", marginTop: "6px" }}>
              Для каждого предложения можно выбрать действие: принять, отклонить
              или изменить перед добавлением.
            </div>
          </div>

          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <span className="badge">На проверке: {pendingCount}</span>
            <span className="badge badge-green-light">
              Принять: {acceptedCount}
            </span>
            <span className="badge badge-orange">Изменено: {modifiedCount}</span>
            {skipped.length > 0 && (
              <span className="badge badge-red">Пропущено: {skipped.length}</span>
            )}
            <button className="btn" onClick={onClose} style={{ flexShrink: 0 }}>
              Закрыть
            </button>
          </div>
        </div>

        <div style={{ marginBottom: "12px", display: "flex", gap: "10px", alignItems: "center" }}>
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
              checked={allAccepted}
              onChange={(e) => toggleAllAccepted(e.target.checked)}
            />
            Принять все
          </label>
          <span className="muted small">
            Будут добавлены только предложения со статусом «Принять».
          </span>
        </div>

        <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: "14px" }}>
          {draftLaunches.length > 0 ? (
            draftLaunches.map((launch) => {
              const original = originalById[launch.id];
              const decision = decisions[launch.id] || "accepted";
              const modified = hasLaunchChanged(original, launch);
              const planning = launch._planningMeta || {};
              const isRejected = decision === "rejected";
              const isEditing = editingId === launch.id;

              return (
                <div
                  key={launch.id}
                  className="section-card"
                  style={{
                    padding: "16px",
                    opacity: isRejected ? 0.55 : 1,
                    borderColor:
                      launch.conflictStatus === "conflict" ? "#fca5a5" : undefined,
                    background:
                      launch.conflictStatus === "conflict" ? "#fff8f8" : undefined,
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 1fr)",
                      gap: "18px",
                      alignItems: "start",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "8px",
                          alignItems: "center",
                          marginBottom: "10px",
                        }}
                      >
                        <div style={{ fontWeight: 800, fontSize: "18px" }}>
                          {launch.game}
                        </div>
                        {decisionBadge(decision, modified)}
                        {launch.conflictStatus === "conflict" && (
                          <span
                            className="badge badge-red"
                            title={launch.issues?.join("\n")}
                          >
                            Конфликт
                          </span>
                        )}
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(2, minmax(160px, 1fr))",
                          gap: "10px 16px",
                          marginBottom: "14px",
                          fontSize: "14px",
                        }}
                      >
                        <div>
                          <div className="muted small">Канал</div>
                          <div>{getChannelName(launch.channelId, channels)}</div>
                        </div>
                        <div>
                          <div className="muted small">Аудитория</div>
                          <div>{launch.audience || "—"}</div>
                        </div>
                        <div>
                          <div className="muted small">Период запуска</div>
                          <div>
                            {formatDisplayDate(launch.startDate)} —{" "}
                            {formatDisplayDate(launch.endDate)}
                          </div>
                        </div>
                        <div>
                          <div className="muted small">Длительность / приоритет</div>
                          <div>
                            {launch.duration} дн. / {launch.priority}
                          </div>
                        </div>
                        <div>
                          <div className="muted small">Допустимое окно</div>
                          <div>
                            {formatDisplayDate(
                              planning.windowStart || launch.earliestStartDate
                            )}{" "}
                            —{" "}
                            {formatDisplayDate(
                              planning.windowEnd || launch.latestStartDate
                            )}
                          </div>
                        </div>
                        <div />
                      </div>

                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "8px",
                          marginBottom: isEditing ? "14px" : 0,
                        }}
                      >
                        <button
                          className={
                            decision === "accepted" ? "btn btn-primary" : "btn"
                          }
                          onClick={() => setDecision(launch.id, "accepted")}
                        >
                          Принять
                        </button>
                        <button
                          className={isEditing ? "btn btn-primary" : "btn"}
                          onClick={() =>
                            setEditingId((prev) =>
                              prev === launch.id ? null : launch.id
                            )
                          }
                        >
                          {isEditing ? "Скрыть правки" : "Изменить"}
                        </button>
                        <button
                          className={
                            decision === "rejected" ? "btn btn-danger" : "btn"
                          }
                          onClick={() => setDecision(launch.id, "rejected")}
                        >
                          Отклонить
                        </button>
                        {decision === "pending" && (
                          <span className="small muted" style={{ alignSelf: "center" }}>
                            Выбери действие для этого предложения
                          </span>
                        )}
                        {modified && (
                          <button className="btn" onClick={() => resetLaunch(launch.id)}>
                            Сбросить изменения
                          </button>
                        )}
                      </div>

                      {isEditing && (
                        <div
                          style={{
                            marginTop: "14px",
                            padding: "14px",
                            border: "1px solid #e5e7eb",
                            borderRadius: "14px",
                            background: "#fafafa",
                          }}
                        >
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "repeat(2, minmax(180px, 1fr))",
                              gap: "12px 16px",
                            }}
                          >
                            <div>
                              <label>Канал</label>
                              <select
                                value={launch.channelId || ""}
                                onChange={(e) =>
                                  updateLaunch(launch.id, { channelId: e.target.value })
                                }
                              >
                                {channels.map((channel) => (
                                  <option key={channel.id} value={channel.id}>
                                    {getChannelName(channel.id, channels)}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label>Старт</label>
                              <input
                                type="date"
                                value={launch.startDate || ""}
                                onChange={(e) =>
                                  updateLaunch(launch.id, { startDate: e.target.value })
                                }
                              />
                            </div>
                            <div>
                              <label>Длительность</label>
                              <input
                                type="number"
                                min="1"
                                value={launch.duration || 1}
                                onChange={(e) =>
                                  updateLaunch(launch.id, {
                                    duration: Math.max(1, Number(e.target.value) || 1),
                                  })
                                }
                              />
                            </div>
                            <div>
                              <label>Конец</label>
                              <input value={formatDisplayDate(launch.endDate)} disabled />
                            </div>
                            <div>
                              <label>Аудитория</label>
                              <input
                                type="text"
                                value={launch.audience || ""}
                                onChange={(e) =>
                                  updateLaunch(launch.id, { audience: e.target.value })
                                }
                              />
                            </div>
                            <div>
                              <label>Приоритет</label>
                              <select
                                value={String(launch.priority ?? "3")}
                                onChange={(e) =>
                                  updateLaunch(launch.id, { priority: e.target.value })
                                }
                              >
                                {["0", "1", "2", "3", "4", "5"].map((priority) => (
                                  <option key={priority} value={priority}>
                                    {priority}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div style={{ gridColumn: "1 / -1" }}>
                              <label>Комментарий</label>
                              <input
                                type="text"
                                value={launch.comment || ""}
                                onChange={(e) =>
                                  updateLaunch(launch.id, { comment: e.target.value })
                                }
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    <div>{compactReasonList(planning, launch)}</div>
                  </div>
                </div>
              );
            })
          ) : (
            <div
              className="section-card"
              style={{ textAlign: "center", color: "#64748b", margin: "24px 0" }}
            >
              Планировщик не смог предложить ни одного запуска. Проверьте
              требования и окна дат.
            </div>
          )}

          {skipped.length > 0 && (
            <div style={{ marginTop: "4px" }}>
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
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
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
                          .map((detail) => detail.notes || detail.effect || detail.reason)
                          .filter(Boolean)
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
            disabled={acceptedCount === 0}
          >
            Добавить принятые ({acceptedCount})
          </button>
        </div>
      </div>
    </div>
  );
}
