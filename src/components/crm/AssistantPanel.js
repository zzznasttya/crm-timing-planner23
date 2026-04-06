import React, { useMemo, useState } from "react";
import { extractAssistantActions } from "../../lib/assistant/rule-extractor";
import { GAMES } from "../../lib/crm-store";

function badgeStyle(status) {
  if (status === "active") {
    return {
      background: "#dcfce7",
      color: "#166534",
    };
  }

  if (status === "rejected") {
    return {
      background: "#fee2e2",
      color: "#b91c1c",
    };
  }

  return {
    background: "#fef3c7",
    color: "#92400e",
  };
}

function ruleTypeLabel(type) {
  if (type === "channel_exclusion") return "Исключение канала";
  if (type === "channel_priority") return "Приоритет канала";
  if (type === "daily_limit") return "Лимит в день";
  if (type === "hard_date_binding") return "Жёсткие даты";
  if (type === "auto_apply_preference") return "Автоприменение";
  return type;
}

function formatWindow(dateWindow) {
  if (!dateWindow) return "";

  if (dateWindow.hasFixedDates === "yes") {
    const start = dateWindow.fixedStartDate || "";
    const end = dateWindow.fixedEndDate || start;
    if (!start) return "";
    return start === end ? start : `${start} - ${end}`;
  }

  if (dateWindow.weekStart && dateWindow.weekEnd) {
    return `${dateWindow.weekStart} - ${dateWindow.weekEnd}`;
  }

  return "";
}

function buildUnderstandingSummary(understanding, actions) {
  const requirementAction = actions.find(
    (action) => action.type === "create_requirement"
  );
  const requirement = requirementAction?.payload?.requirement;
  const parts = [];

  if (requirement?.game) {
    parts.push(`игра: ${requirement.game}`);
  } else if (understanding?.games?.[0]) {
    parts.push(`игра: ${understanding.games[0]}`);
  }

  if (requirement?.audience || understanding?.audience) {
    parts.push(`аудитория: ${requirement?.audience || understanding.audience}`);
  }

  const channelCount = Array.isArray(requirement?.channelIds)
    ? requirement.channelIds.length
    : Array.isArray(understanding?.channelIds)
      ? understanding.channelIds.length
      : 0;

  if (channelCount > 0) {
    parts.push(
      channelCount === 1
        ? "канал указан явно"
        : `каналов указано: ${channelCount}`
    );
  }

  const windowLabel = formatWindow(
    requirementAction?.payload?.requirement || understanding?.dateWindow
  );
  if (windowLabel) {
    parts.push(`окно: ${windowLabel}`);
  }

  return parts;
}

function buildAssistantAnswer({
  intent,
  newRules,
  actions,
  scheduleDraft,
  understanding,
}) {
  const parts = [];

  if (intent === "planning_request") {
    parts.push("Я распознал запрос на планирование.");
  } else if (intent === "rule") {
    parts.push("Я распознал новое ограничение для планировщика.");
  } else if (intent === "question") {
    parts.push("Я распознал запрос на объяснение или проверку тайминга.");
  } else if (intent === "update") {
    parts.push("Я распознал запрос на изменение уже существующего плана.");
  }

  if (actions.length > 0) {
    const requirementCount = actions.filter(
      (action) => action.type === "create_requirement"
    ).length;
    if (requirementCount > 0) {
      parts.push(`Создал требований: ${requirementCount}.`);
    }
  }

  const understandingParts = buildUnderstandingSummary(understanding, actions);
  if (understandingParts.length > 0) {
    parts.push(`Понял так: ${understandingParts.join(", ")}.`);
  }

  if (newRules.length > 0) {
    const labels = newRules.map((rule) => ruleTypeLabel(rule.type)).join(", ");
    parts.push(`Предложил правила: ${labels}.`);
  }

  if (scheduleDraft) {
    parts.push(
      `Пересчитал тайминг: предложено ${scheduleDraft.proposed.length}, пропущено ${scheduleDraft.skipped.length}.`
    );
  }

  if (!parts.length) {
    return "Я сохранил сообщение в память, но пока не смог уверенно превратить его в правило или действие для тайминга.";
  }

  return parts.join(" ");
}

export default function AssistantPanel({
  channels,
  messages,
  rules,
  preferences,
  onApplyAssistantActions,
  onMessagesChange,
  onRulesChange,
  onPreferencesChange,
}) {
  const [input, setInput] = useState("");

  const sortedRules = useMemo(() => {
    return [...rules].sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }, [rules]);

  function handleSend() {
    const text = input.trim();
    if (!text) return;

    const userMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: "user",
      text,
      createdAt: new Date().toISOString(),
      extractedRuleIds: [],
    };

    const interpreted = extractAssistantActions({
      text,
      messageId: userMessage.id,
      channels,
      games: GAMES,
    });
    const proposedRules = interpreted.rules;
    const actionSummary = Array.isArray(interpreted.actions)
      ? interpreted.actions.map((action) => action.type)
      : [];

    const nextUserMessage = {
      ...userMessage,
      extractedRuleIds: proposedRules.map((rule) => rule.id),
      extractedActionTypes: actionSummary,
    };

    const nextRules = [...rules, ...proposedRules].map((rule) => {
      if (
        preferences.autoActivateHighConfidenceRules &&
        rule.status === "pending" &&
        rule.confidence >= preferences.confidenceThreshold
      ) {
        return {
          ...rule,
          status: "active",
          updatedAt: new Date().toISOString(),
        };
      }

      return rule;
    });

    let automationResult = null;
    if (typeof onApplyAssistantActions === "function") {
      automationResult = onApplyAssistantActions({
        intent: interpreted.intent,
        actions: interpreted.actions,
        rules: nextRules,
        shouldRebuildSchedule: interpreted.shouldRebuildSchedule,
      });
    }

    const assistantMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: "assistant",
      text: buildAssistantAnswer({
        intent: interpreted.intent,
        newRules: proposedRules,
        actions: interpreted.actions,
        scheduleDraft: automationResult?.scheduleDraft || null,
        understanding: interpreted.understanding,
      }),
      createdAt: new Date().toISOString(),
      extractedRuleIds: proposedRules.map((rule) => rule.id),
      extractedActionTypes: actionSummary,
    };

    onMessagesChange([...messages, nextUserMessage, assistantMessage]);
    onRulesChange(nextRules);
    setInput("");
  }

  function updateRule(ruleId, patch) {
    onRulesChange(
      rules.map((rule) =>
        rule.id === ruleId
          ? {
              ...rule,
              ...patch,
              updatedAt: new Date().toISOString(),
            }
          : rule
      )
    );
  }

  function removeRule(ruleId) {
    onRulesChange(rules.filter((rule) => rule.id !== ruleId));
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1.1fr 0.9fr",
        gap: "16px",
      }}
    >
      <div
        className="section-card"
        style={{
          margin: 0,
          minHeight: "520px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: "18px", marginBottom: "8px" }}>
          Assistant
        </div>

        <div
          style={{
            flex: 1,
            overflow: "auto",
            border: "1px solid #e5e7eb",
            borderRadius: "14px",
            padding: "12px",
            background: "#fff",
          }}
        >
          {messages.length === 0 && (
            <div className="muted">
              Можно писать и командами, и более живыми фразами: «не ставь пуш
              для АКБ», «давай на следующей неделе баннер для Матрёшек»,
              «сделай аккуратнее и не больше трёх запусков в день».
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              style={{
                marginBottom: "12px",
                display: "flex",
                justifyContent:
                  message.role === "user" ? "flex-end" : "flex-start",
              }}
            >
              <div
                style={{
                  maxWidth: "82%",
                  background: message.role === "user" ? "#eff6ff" : "#f8fafc",
                  border: "1px solid #dbeafe",
                  borderRadius: "14px",
                  padding: "10px 12px",
                  whiteSpace: "pre-wrap",
                  fontSize: "14px",
                  lineHeight: 1.4,
                }}
              >
                <div
                  style={{
                    fontSize: "11px",
                    color: "#64748b",
                    marginBottom: "4px",
                    textTransform: "uppercase",
                  }}
                >
                  {message.role === "user" ? "Ты" : "Assistant"}
                </div>
                <div>{message.text}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
          <textarea
            rows="3"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Напиши ограничение, пожелание или просьбу к таймингу"
            style={{
              flex: 1,
              border: "1px solid #d1d5db",
              borderRadius: "12px",
              padding: "10px 12px",
              resize: "vertical",
            }}
          />
          <button className="btn btn-primary" onClick={handleSend}>
            Отправить
          </button>
        </div>
      </div>

      <div
        className="section-card"
        style={{
          margin: 0,
          minHeight: "520px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: "18px", marginBottom: "8px" }}>
          Память и правила
        </div>

        <div
          style={{
            marginBottom: "12px",
            display: "grid",
            gap: "8px",
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "14px",
            }}
          >
            <input
              type="checkbox"
              checked={preferences.autoActivateHighConfidenceRules}
              onChange={(e) =>
                onPreferencesChange({
                  ...preferences,
                  autoActivateHighConfidenceRules: e.target.checked,
                })
              }
            />
            Автоактивировать правила с высокой уверенностью
          </label>
        </div>

        <div
          style={{
            flex: 1,
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          {sortedRules.length === 0 && (
            <div className="muted">Пока нет сохранённых правил.</div>
          )}

          {sortedRules.map((rule) => (
            <div
              key={rule.id}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: "14px",
                padding: "12px",
                background: "#fff",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "8px",
                  marginBottom: "8px",
                }}
              >
                <div style={{ fontWeight: 700 }}>
                  {ruleTypeLabel(rule.type)}
                </div>
                <span
                  style={{
                    ...badgeStyle(rule.status),
                    padding: "4px 8px",
                    borderRadius: "999px",
                    fontSize: "12px",
                    fontWeight: 700,
                  }}
                >
                  {rule.status}
                </span>
              </div>

              <div
                style={{
                  fontSize: "13px",
                  color: "#475569",
                  marginBottom: "8px",
                }}
              >
                confidence: {(Number(rule.confidence || 0) * 100).toFixed(0)}%
              </div>

              <div
                style={{
                  fontSize: "13px",
                  background: "#f8fafc",
                  borderRadius: "10px",
                  padding: "10px",
                  marginBottom: "8px",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                <strong>Scope:</strong>{" "}
                {JSON.stringify(rule.scope || {}, null, 2)}
                {"\n"}
                <strong>Payload:</strong>{" "}
                {JSON.stringify(rule.payload || {}, null, 2)}
              </div>

              <div
                style={{
                  fontSize: "12px",
                  color: "#64748b",
                  marginBottom: "10px",
                }}
              >
                Источник: {rule.source?.excerpt || "—"}
              </div>

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  className="btn-small"
                  onClick={() =>
                    updateRule(rule.id, { status: "active", enabled: true })
                  }
                >
                  Активировать
                </button>
                <button
                  className="btn-small"
                  onClick={() =>
                    updateRule(rule.id, { status: "pending", enabled: true })
                  }
                >
                  В pending
                </button>
                <button
                  className="btn-small btn-danger"
                  onClick={() =>
                    updateRule(rule.id, { status: "rejected", enabled: false })
                  }
                >
                  Отклонить
                </button>
                <button
                  className="btn-small btn-danger"
                  onClick={() => removeRule(rule.id)}
                >
                  Удалить
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
