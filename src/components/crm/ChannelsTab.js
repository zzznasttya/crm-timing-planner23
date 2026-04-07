import React, { useEffect, useMemo, useState } from "react";
import {
  getChannelDisplayName,
  getChannelSubtitle,
  getChannelTitle,
} from "../../lib/crm-store";

function createEmptyChannel() {
  return {
    id: `channel-${Date.now()}`,
    title: "",
    subtitle: "",
    effectivenessRank: "",
    duration: 5,
    iosMinVersion: "All",
    iosMaxVersion: "All",
    androidMinVersion: "All",
    androidMaxVersion: "All",
  };
}

function normalizeEffectivenessRank(value) {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
}

function normalizeChannelDraft(channel) {
  const title = getChannelTitle(channel);
  const subtitle = getChannelSubtitle(channel);

  return {
    id: channel.id || `channel-${Date.now()}`,
    title,
    subtitle,
    name: getChannelDisplayName({ title, subtitle }) || channel.name || "",
    effectivenessRank: normalizeEffectivenessRank(channel.effectivenessRank),
    duration: Number(channel.duration) || 5,
    iosMinVersion: channel.iosMinVersion || "All",
    iosMaxVersion: channel.iosMaxVersion || "All",
    androidMinVersion: channel.androidMinVersion || "All",
    androidMaxVersion: channel.androidMaxVersion || "All",
  };
}

function buildDuplicateChannel(channel, copyNumber = 1) {
  const baseTitle = getChannelTitle(channel) || "Канал";
  const copySuffix = copyNumber > 1 ? ` (копия ${copyNumber})` : " (копия)";

  return normalizeChannelDraft({
    ...channel,
    id: `channel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: `${baseTitle}${copySuffix}`,
    subtitle: getChannelSubtitle(channel),
  });
}

function versionLabel(min, max) {
  const safeMin = min || "All";
  const safeMax = max || "All";

  if (safeMin === "All" && safeMax === "All") return "All versions";
  if (safeMin === safeMax) return safeMin;
  return `${safeMin} — ${safeMax}`;
}

function ChannelForm({ value, onChange }) {
  function update(field, fieldValue) {
    onChange({
      ...value,
      [field]: fieldValue,
    });
  }

  return (
    <div className="form-grid">
      <div className="full-row">
        <label>Заголовок канала</label>
        <input
          value={value.title || ""}
          onChange={(e) => update("title", e.target.value)}
          placeholder="Например: Пуш"
        />
      </div>

      <div className="full-row">
        <label>Подзаголовок канала</label>
        <input
          value={value.subtitle || ""}
          onChange={(e) => update("subtitle", e.target.value)}
          placeholder="Например: победителям"
        />
      </div>

      <div>
        <label>Эффективность</label>
        <input
          type="number"
          min="1"
          value={value.effectivenessRank ?? ""}
          onChange={(e) => update("effectivenessRank", e.target.value)}
          placeholder="1 = самый эффективный"
        />
      </div>

      <div>
        <label>Длительность, дней</label>
        <input
          type="number"
          min="1"
          value={value.duration ?? ""}
          onChange={(e) => update("duration", e.target.value)}
        />
      </div>

      <div>
        <label>iOS min version</label>
        <input
          value={value.iosMinVersion}
          onChange={(e) => update("iosMinVersion", e.target.value)}
          placeholder="All или 12.0"
        />
      </div>

      <div>
        <label>iOS max version</label>
        <input
          value={value.iosMaxVersion}
          onChange={(e) => update("iosMaxVersion", e.target.value)}
          placeholder="All или 18.0"
        />
      </div>

      <div>
        <label>Android min version</label>
        <input
          value={value.androidMinVersion}
          onChange={(e) => update("androidMinVersion", e.target.value)}
          placeholder="All или 8.0"
        />
      </div>

      <div>
        <label>Android max version</label>
        <input
          value={value.androidMaxVersion}
          onChange={(e) => update("androidMaxVersion", e.target.value)}
          placeholder="All или 16.0"
        />
      </div>
    </div>
  );
}

export default function ChannelsTab({
  channels,
  onAddChannel,
  onBulkAddChannels,
  onBulkDeleteChannels,
  onUpdateChannel,
  onDeleteChannel,
}) {
  const [search, setSearch] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [draft, setDraft] = useState(createEmptyChannel());
  const [editing, setEditing] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [lastSelectedId, setLastSelectedId] = useState(null);

  const filteredChannels = useMemo(() => {
    const q = search.trim().toLowerCase();
    const source = !q
      ? channels
      : channels.filter((channel) => {
      const text = [
        getChannelDisplayName(channel),
        channel.title,
        channel.subtitle,
        channel.id,
        channel.iosMinVersion,
        channel.iosMaxVersion,
        channel.androidMinVersion,
        channel.androidMaxVersion,
      ]
        .join(" ")
        .toLowerCase();

      return text.includes(q);
    });

    return [...source].sort((a, b) => {
      const rankA = normalizeEffectivenessRank(a.effectivenessRank);
      const rankB = normalizeEffectivenessRank(b.effectivenessRank);

      if (rankA != null && rankB != null && rankA !== rankB) {
        return rankA - rankB;
      }
      if (rankA != null) return -1;
      if (rankB != null) return 1;

      return getChannelDisplayName(a).localeCompare(getChannelDisplayName(b), "ru");
    });
  }, [channels, search]);

  const stats = useMemo(() => {
    const total = channels.length;
    const avgDuration = total
      ? (
          channels.reduce(
            (sum, item) => sum + (Number(item.duration) || 0),
            0
          ) / total
        ).toFixed(1)
      : "0.0";

    return {
      total,
      avgDuration,
    };
  }, [channels]);

  const selectedChannels = useMemo(
    () => filteredChannels.filter((channel) => selectedIds.has(channel.id)),
    [filteredChannels, selectedIds]
  );

  useEffect(() => {
    const channelIds = new Set((Array.isArray(channels) ? channels : []).map((item) => item.id));
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => channelIds.has(id)));
      if (next.size === prev.size) return prev;
      return next;
    });
  }, [channels]);

  function handleOpenCreate() {
    setDraft(createEmptyChannel());
    setIsCreateOpen(true);
  }

  function handleSaveCreate() {
    const normalized = normalizeChannelDraft(draft);
    onAddChannel(normalized);
    setIsCreateOpen(false);
  }

  function handleOpenEdit(channel) {
    setEditing(normalizeChannelDraft(channel));
    setIsEditOpen(true);
  }

  function handleSaveEdit() {
    onUpdateChannel(normalizeChannelDraft(editing));
    setIsEditOpen(false);
  }

  function handleDelete(channel) {
    const confirmed = window.confirm(
      `Удалить канал "${getChannelDisplayName(channel) || channel.id}"?`
    );

    if (!confirmed) return;

    onDeleteChannel(channel.id);
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setLastSelectedId(null);
  }

  function handleSelectChange(event, id) {
    const shouldSelect = event.target.checked;
    const isRangeSelection = event.nativeEvent?.shiftKey;
    const visibleIds = filteredChannels.map((channel) => channel.id);

    if (isRangeSelection && lastSelectedId && visibleIds.includes(lastSelectedId)) {
      const startIndex = visibleIds.indexOf(lastSelectedId);
      const endIndex = visibleIds.indexOf(id);

      if (startIndex !== -1 && endIndex !== -1) {
        const [from, to] =
          startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
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

    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (shouldSelect) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
    setLastSelectedId(id);
  }

  function handleDuplicateSelected() {
    if (!selectedChannels.length) return;

    const duplicates = selectedChannels.map((channel, index) =>
      buildDuplicateChannel(channel, index + 1)
    );

    if (typeof onBulkAddChannels === "function") {
      onBulkAddChannels(duplicates);
    } else {
      duplicates.forEach((channel) => onAddChannel(channel));
    }

    clearSelection();
  }

  function handleDeleteSelected() {
    if (!selectedChannels.length) return;

    const confirmed = window.confirm(
      `Удалить выбранные каналы: ${selectedChannels.length}?`
    );
    if (!confirmed) return;

    const ids = selectedChannels.map((channel) => channel.id);
    if (typeof onBulkDeleteChannels === "function") {
      onBulkDeleteChannels(ids);
    } else {
      ids.forEach((id) => onDeleteChannel(id));
    }

    clearSelection();
  }

  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: "12px",
          marginBottom: "16px",
        }}
      >
        <div className="section-card" style={{ margin: 0 }}>
          <div className="muted small">Всего каналов</div>
          <div style={{ fontSize: "24px", fontWeight: 800, marginTop: "4px" }}>
            {stats.total}
          </div>
        </div>

        <div className="section-card" style={{ margin: 0 }}>
          <div className="muted small">Мин. длительность</div>
          <div style={{ fontSize: "24px", fontWeight: 800, marginTop: "4px" }}>
            {channels.length
              ? Math.min(...channels.map((item) => Number(item.duration) || 0))
              : 0}
          </div>
        </div>

        <div className="section-card" style={{ margin: 0 }}>
          <div className="muted small">Макс. длительность</div>
          <div style={{ fontSize: "24px", fontWeight: 800, marginTop: "4px" }}>
            {channels.length
              ? Math.max(...channels.map((item) => Number(item.duration) || 0))
              : 0}
          </div>
        </div>

        <div className="section-card" style={{ margin: 0 }}>
          <div className="muted small">Средняя длительность</div>
          <div style={{ fontSize: "24px", fontWeight: 800, marginTop: "4px" }}>
            {stats.avgDuration}
          </div>
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar-left" style={{ flex: 1 }}>
          <input
            placeholder="Поиск по названию и версиям"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: "420px" }}
          />
        </div>

        <div className="toolbar-right">
          <button className="btn btn-primary" onClick={handleOpenCreate}>
            Добавить канал
          </button>
        </div>
      </div>

      {selectedChannels.length > 0 && (
        <div
          className="section-card"
          style={{
            marginBottom: "16px",
            padding: "14px 16px",
            display: "flex",
            flexWrap: "wrap",
            gap: "10px",
            alignItems: "center",
          }}
        >
          <div style={{ minWidth: "160px" }}>
            <div className="muted small">Выбрано каналов</div>
            <div style={{ fontWeight: 700, fontSize: "18px" }}>
              {selectedChannels.length}
            </div>
          </div>

          <button className="btn btn-primary" onClick={handleDuplicateSelected}>
            Дублировать выбранные
          </button>

          <button className="btn" onClick={clearSelection}>
            Снять выбор
          </button>

          <button className="btn btn-danger" onClick={handleDeleteSelected}>
            Удалить выбранные
          </button>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: "14px",
        }}
      >
        {filteredChannels.map((channel) => {
          const isSelected = selectedIds.has(channel.id);
          return (
            <div
              key={channel.id}
              className="section-card"
              style={{
                margin: 0,
                padding: "16px",
                borderRadius: "20px",
                border: isSelected ? "2px solid #ef4444" : undefined,
                boxShadow: isSelected ? "0 0 0 3px rgba(239, 68, 68, 0.08)" : undefined,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "12px",
                  marginBottom: "14px",
                }}
              >
                <div onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(event) => handleSelectChange(event, channel.id)}
                    style={{ cursor: "pointer", width: "16px", height: "16px" }}
                  />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "17px",
                      fontWeight: 800,
                      color: "#0f172a",
                      wordBreak: "break-word",
                    }}
                  >
                    {getChannelTitle(channel) || "Без названия"}
                  </div>

                  {getChannelSubtitle(channel) && (
                    <div
                      style={{
                        fontSize: "13px",
                        color: "#7c2d2d",
                        marginTop: "2px",
                        wordBreak: "break-word",
                        fontWeight: 600,
                      }}
                    >
                      {getChannelSubtitle(channel)}
                    </div>
                  )}

                  <div
                    style={{
                      marginTop: "8px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "4px 10px",
                      borderRadius: "999px",
                      background:
                        normalizeEffectivenessRank(channel.effectivenessRank) != null
                          ? "rgba(239, 68, 68, 0.12)"
                          : "#f3f4f6",
                      color:
                        normalizeEffectivenessRank(channel.effectivenessRank) != null
                          ? "#b91c1c"
                          : "#6b7280",
                      fontSize: "12px",
                      fontWeight: 700,
                    }}
                  >
                    {normalizeEffectivenessRank(channel.effectivenessRank) != null
                      ? `Эффективность #${normalizeEffectivenessRank(
                          channel.effectivenessRank
                        )}`
                      : "Эффективность не задана"}
                  </div>

                </div>

              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: "10px",
                  marginBottom: "14px",
                }}
              >
                <div
                  style={{
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: "14px",
                    padding: "10px 12px",
                  }}
                >
                  <div className="muted small">Длительность</div>
                  <div style={{ marginTop: "4px", fontWeight: 700 }}>
                    {channel.duration} дн.
                  </div>
                </div>

                <div
                  style={{
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: "14px",
                    padding: "10px 12px",
                  }}
                >
                  <div className="muted small">Платформы</div>
                  <div style={{ marginTop: "4px", fontWeight: 700 }}>
                    iOS / Android
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gap: "10px",
                  marginBottom: "16px",
                }}
              >
                <div
                  style={{
                    background: "#ffffff",
                    border: "1px solid #e5e7eb",
                    borderRadius: "14px",
                    padding: "10px 12px",
                  }}
                >
                  <div className="muted small">iOS версии</div>
                  <div
                    style={{
                      marginTop: "4px",
                      fontWeight: 600,
                      color: "#111827",
                      wordBreak: "break-word",
                    }}
                  >
                    {versionLabel(channel.iosMinVersion, channel.iosMaxVersion)}
                  </div>
                </div>

                <div
                  style={{
                    background: "#ffffff",
                    border: "1px solid #e5e7eb",
                    borderRadius: "14px",
                    padding: "10px 12px",
                  }}
                >
                  <div className="muted small">Android версии</div>
                  <div
                    style={{
                      marginTop: "4px",
                      fontWeight: 600,
                      color: "#111827",
                      wordBreak: "break-word",
                    }}
                  >
                    {versionLabel(
                      channel.androidMinVersion,
                      channel.androidMaxVersion
                    )}
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  flexWrap: "wrap",
                }}
              >
                <button
                  className="btn-small"
                  onClick={() => handleOpenEdit(channel)}
                >
                  Редактировать
                </button>

                <button
                  className="btn-small"
                  onClick={() =>
                    (typeof onBulkAddChannels === "function"
                      ? onBulkAddChannels([buildDuplicateChannel(channel)])
                      : onAddChannel(buildDuplicateChannel(channel)))
                  }
                >
                  Дублировать
                </button>

                <button
                  className="btn-small btn-danger"
                  onClick={() => handleDelete(channel)}
                >
                  Удалить
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {!filteredChannels.length && (
        <div
          className="section-card"
          style={{
            marginTop: "14px",
            textAlign: "center",
            color: "#64748b",
          }}
        >
          Ничего не найдено
        </div>
      )}

      {isCreateOpen && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Добавить канал</h3>
            <ChannelForm value={draft} onChange={setDraft} />

            <div className="modal-actions">
              <button className="btn" onClick={() => setIsCreateOpen(false)}>
                Отмена
              </button>
              <button className="btn btn-primary" onClick={handleSaveCreate}>
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {isEditOpen && editing && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Редактировать канал</h3>
            <ChannelForm value={editing} onChange={setEditing} />

            <div className="modal-actions">
              <button className="btn" onClick={() => setIsEditOpen(false)}>
                Отмена
              </button>
              <button className="btn btn-primary" onClick={handleSaveEdit}>
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
