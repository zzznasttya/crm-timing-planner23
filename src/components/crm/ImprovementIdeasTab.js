import React, { useMemo, useState } from "react";

function createEmptyIdea() {
  return {
    id: `idea-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: "",
    details: "",
    status: "новое",
    createdAt: new Date().toISOString(),
  };
}

function formatIdeaDate(value) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    }).format(new Date(value));
  } catch {
    return "—";
  }
}

function statusBadgeClass(status) {
  return status === "учтено" ? "badge badge-green" : "badge badge-red";
}

export default function ImprovementIdeasTab({
  ideas,
  onAddIdea,
  onUpdateIdea,
  onDeleteIdea,
}) {
  const [draft, setDraft] = useState(createEmptyIdea());

  const sortedIdeas = useMemo(() => {
    return [...(Array.isArray(ideas) ? ideas : [])].sort((a, b) => {
      const priorityA = a.status === "новое" ? 0 : 1;
      const priorityB = b.status === "новое" ? 0 : 1;
      if (priorityA !== priorityB) return priorityA - priorityB;
      return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    });
  }, [ideas]);

  const stats = useMemo(() => {
    const total = sortedIdeas.length;
    const fresh = sortedIdeas.filter((idea) => idea.status === "новое").length;
    return {
      total,
      fresh,
      completed: total - fresh,
    };
  }, [sortedIdeas]);

  function handleAdd() {
    if (!draft.title.trim() && !draft.details.trim()) return;

    onAddIdea({
      ...draft,
      title: draft.title.trim() || "Без названия",
      details: draft.details.trim(),
    });
    setDraft(createEmptyIdea());
  }

  function handleStatusToggle(idea) {
    onUpdateIdea({
      ...idea,
      status: idea.status === "учтено" ? "новое" : "учтено",
    });
  }

  function handleDelete(idea) {
    const confirmed = window.confirm(
      `Удалить предложение "${idea.title || "Без названия"}"?`
    );
    if (!confirmed) return;
    onDeleteIdea(idea.id);
  }

  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: "12px",
          marginBottom: "16px",
        }}
      >
        <div className="section-card" style={{ margin: 0 }}>
          <div className="muted small">Всего предложений</div>
          <div style={{ fontSize: "24px", fontWeight: 800, marginTop: "4px" }}>
            {stats.total}
          </div>
        </div>
        <div className="section-card" style={{ margin: 0 }}>
          <div className="muted small">Новые</div>
          <div style={{ fontSize: "24px", fontWeight: 800, marginTop: "4px" }}>
            {stats.fresh}
          </div>
        </div>
        <div className="section-card" style={{ margin: 0 }}>
          <div className="muted small">Учтено</div>
          <div style={{ fontSize: "24px", fontWeight: 800, marginTop: "4px" }}>
            {stats.completed}
          </div>
        </div>
      </div>

      <div className="section-card" style={{ marginBottom: "16px" }}>
        <div
          style={{
            display: "grid",
            gap: "12px",
          }}
        >
          <div>
            <label>Коротко</label>
            <input
              value={draft.title}
              onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="Например: улучшить логику КБ-дней"
            />
          </div>
          <div>
            <label>Описание</label>
            <textarea
              rows={4}
              value={draft.details}
              onChange={(e) => setDraft((prev) => ({ ...prev, details: e.target.value }))}
              placeholder="Что именно хочется улучшить или проверить"
            />
          </div>
          <div className="modal-actions" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-primary" onClick={handleAdd}>
              Добавить предложение
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: "12px" }}>
        {sortedIdeas.map((idea) => (
          <div key={idea.id} className="section-card" style={{ margin: 0 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "12px",
                marginBottom: "10px",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: "18px", fontWeight: 800 }}>
                  {idea.title || "Без названия"}
                </div>
                <div className="muted small" style={{ marginTop: "4px" }}>
                  Добавлено {formatIdeaDate(idea.createdAt)}
                </div>
              </div>
              <span className={statusBadgeClass(idea.status)}>
                {idea.status === "учтено" ? "учтено" : "новое"}
              </span>
            </div>

            {idea.details && (
              <div
                style={{
                  color: "#334155",
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  marginBottom: "12px",
                }}
              >
                {idea.details}
              </div>
            )}

            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button className="btn-small" onClick={() => handleStatusToggle(idea)}>
                {idea.status === "учтено" ? "Вернуть в новые" : "Отметить учтённым"}
              </button>
              <button className="btn-small btn-danger" onClick={() => handleDelete(idea)}>
                Удалить
              </button>
            </div>
          </div>
        ))}
      </div>

      {!sortedIdeas.length && (
        <div
          className="section-card"
          style={{ marginTop: "14px", textAlign: "center", color: "#64748b" }}
        >
          Пока нет предложений по улучшению
        </div>
      )}
    </div>
  );
}
