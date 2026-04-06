export const ASSISTANT_STORAGE_KEYS = {
  messages: "crm-assistant:v1:messages",
  rules: "crm-assistant:v1:rules",
  preferences: "crm-assistant:v1:preferences",
};

const DEFAULT_PREFERENCES = {
  autoSelectRecommendations: true,
  requireApplyConfirmation: true,
  autoActivateHighConfidenceRules: false,
  confidenceThreshold: 0.85,
  showProvenanceByDefault: true,
};

function safeParse(raw, fallback) {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function loadAssistantMessages() {
  const parsed = safeParse(
    localStorage.getItem(ASSISTANT_STORAGE_KEYS.messages),
    []
  );

  if (!Array.isArray(parsed)) return [];

  return parsed.map((item) => ({
    id:
      item.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: item.role === "assistant" ? "assistant" : "user",
    text: String(item.text || ""),
    createdAt: item.createdAt || new Date().toISOString(),
    extractedRuleIds: Array.isArray(item.extractedRuleIds)
      ? item.extractedRuleIds
      : [],
  }));
}

export function saveAssistantMessages(messages) {
  localStorage.setItem(
    ASSISTANT_STORAGE_KEYS.messages,
    JSON.stringify(Array.isArray(messages) ? messages.slice(-500) : [])
  );
}

export function loadAssistantRules() {
  const parsed = safeParse(
    localStorage.getItem(ASSISTANT_STORAGE_KEYS.rules),
    []
  );

  if (!Array.isArray(parsed)) return [];

  return parsed.map((rule) => ({
    id:
      rule.id || `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: rule.type || "note",
    enabled: rule.enabled !== false,
    priority: Number.isFinite(Number(rule.priority))
      ? Number(rule.priority)
      : 50,
    scope: rule.scope || {},
    payload: rule.payload || {},
    createdAt: rule.createdAt || new Date().toISOString(),
    updatedAt: rule.updatedAt || new Date().toISOString(),
    source: rule.source || {},
    confidence: typeof rule.confidence === "number" ? rule.confidence : 0.7,
    status: ["pending", "active", "rejected"].includes(rule.status)
      ? rule.status
      : "pending",
  }));
}

export function saveAssistantRules(rules) {
  localStorage.setItem(
    ASSISTANT_STORAGE_KEYS.rules,
    JSON.stringify(Array.isArray(rules) ? rules : [])
  );
}

export function loadAssistantPreferences() {
  const parsed = safeParse(
    localStorage.getItem(ASSISTANT_STORAGE_KEYS.preferences),
    DEFAULT_PREFERENCES
  );

  return {
    ...DEFAULT_PREFERENCES,
    ...(parsed || {}),
  };
}

export function saveAssistantPreferences(preferences) {
  localStorage.setItem(
    ASSISTANT_STORAGE_KEYS.preferences,
    JSON.stringify({
      ...DEFAULT_PREFERENCES,
      ...(preferences || {}),
    })
  );
}

export function buildAssistantContext({ messages, rules, preferences }) {
  return {
    messages: Array.isArray(messages) ? messages : [],
    rules: Array.isArray(rules) ? rules : [],
    preferences: {
      ...DEFAULT_PREFERENCES,
      ...(preferences || {}),
    },
  };
}
