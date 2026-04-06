import {
  createEmptyRequirement,
  getWeekRange,
  normalizeAudience,
  normalizeRequirement,
} from "../requirements-domain";

const AUDIENCE_ALIASES = {
  акб: "АКБ",
  "а к б": "АКБ",
  rg: "РГ",
  рг: "РГ",
  winners: "Победители",
  победители: "Победители",
  staff: "Стафф",
  стафф: "Стафф",
  "500к": "500 к",
  "500 к": "500 к",
  реестр: "Реестр",
  "клиенты с план начислением кб": "Клиенты с план. начислением КБ",
  "клиенты с план. начислением кб": "Клиенты с план. начислением КБ",
  "клиенты с остатками кб": "Клиенты с остатками КБ",
};

const NUMBER_WORDS = {
  один: 1,
  одна: 1,
  two: 2,
  два: 2,
  три: 3,
  four: 4,
  четыре: 4,
  пять: 5,
  шесть: 6,
  семь: 7,
  восемь: 8,
  девять: 9,
  десять: 10,
};

function createRule({
  type,
  scope = {},
  payload = {},
  confidence = 0.8,
  messageId,
  messageText,
  priority = 50,
}) {
  const now = new Date().toISOString();

  return {
    id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    enabled: true,
    priority,
    scope,
    payload,
    createdAt: now,
    updatedAt: now,
    source: {
      messageId,
      excerpt: messageText.slice(0, 240),
    },
    confidence,
    status: "pending",
  };
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[.,!?;:()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchChannelIds(text, channels) {
  const normalized = normalizeText(text);

  return channels
    .filter((channel) => {
      const id = String(channel.id || "").toLowerCase();
      const name = String(channel.name || "").toLowerCase();
      return normalized.includes(id) || normalized.includes(name);
    })
    .map((channel) => channel.id);
}

function matchGameNames(text, games = []) {
  const normalized = normalizeText(text);

  return games.filter((game) =>
    normalized.includes(String(game || "").toLowerCase())
  );
}

function parseAudience(text) {
  const normalized = normalizeText(text);
  const found = Object.keys(AUDIENCE_ALIASES).find((item) =>
    normalized.includes(item)
  );
  return found ? normalizeAudience(AUDIENCE_ALIASES[found]) : "";
}

function parseNumber(text) {
  const match = String(text || "").match(/(\d+)/);
  if (match) return Number(match[1]);

  const normalized = normalizeText(text);
  const foundWord = Object.keys(NUMBER_WORDS).find((word) =>
    normalized.includes(word)
  );
  return foundWord ? NUMBER_WORDS[foundWord] : null;
}

function getWeekRangeFromOffset(offsetWeeks = 0) {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() + diff + offsetWeeks * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const toValue = (date) => {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  return {
    weekStart: toValue(monday),
    weekEnd: toValue(sunday),
  };
}

function toDateValue(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getFixedDateWindow(offsetDays = 0) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  const value = toDateValue(date);

  return {
    hasFixedDates: "yes",
    fixedStartDate: value,
    fixedEndDate: value,
    source: "relative-fixed",
  };
}

function extractDateWindow(text) {
  const normalized = normalizeText(text);
  const explicitDates = String(text || "").match(/\b20\d{2}-\d{2}-\d{2}\b/g) || [];

  if (explicitDates.length > 0) {
    return {
      hasFixedDates: "yes",
      fixedStartDate: explicitDates[0],
      fixedEndDate: explicitDates[1] || explicitDates[0],
      source: "explicit",
    };
  }

  if (normalized.includes("на следующей неделе")) {
    return {
      hasFixedDates: "no",
      ...getWeekRangeFromOffset(1),
      source: "relative",
    };
  }

  if (normalized.includes("на этой неделе")) {
    return {
      hasFixedDates: "no",
      ...getWeekRangeFromOffset(0),
      source: "relative",
    };
  }

  if (normalized.includes("через неделю")) {
    return {
      hasFixedDates: "no",
      ...getWeekRangeFromOffset(2),
      source: "relative",
    };
  }

  if (
    normalized.includes("сегодня") ||
    normalized.includes("на сегодня")
  ) {
    return getFixedDateWindow(0);
  }

  if (
    normalized.includes("завтра") ||
    normalized.includes("на завтра")
  ) {
    return getFixedDateWindow(1);
  }

  if (
    normalized.includes("послезавтра") ||
    normalized.includes("на послезавтра")
  ) {
    return getFixedDateWindow(2);
  }

  if (
    normalized.includes("в начале недели") ||
    normalized.includes("поближе к началу недели")
  ) {
    return {
      hasFixedDates: "no",
      ...getWeekRangeFromOffset(0),
      source: "relative-start",
    };
  }

  if (
    normalized.includes("в конце недели") ||
    normalized.includes("ближе к концу недели")
  ) {
    return {
      hasFixedDates: "no",
      ...getWeekRangeFromOffset(0),
      source: "relative-end",
    };
  }

  return {
    hasFixedDates: "no",
    ...getWeekRangeFromOffset(0),
    source: "default",
  };
}

function inferPriority(text) {
  const normalized = normalizeText(text);
  if (
    normalized.includes("срочно") ||
    normalized.includes("важно") ||
    normalized.includes("приоритетно") ||
    normalized.includes("критично") ||
    normalized.includes("как можно скорее")
  ) {
    return "1";
  }
  if (
    normalized.includes("высокий приоритет") ||
    normalized.includes("повыше приоритет")
  ) {
    return "2";
  }
  if (normalized.includes("низкий приоритет")) {
    return "5";
  }
  if (
    normalized.includes("можно позже") ||
    normalized.includes("не срочно") ||
    normalized.includes("спокойно")
  ) {
    return "4";
  }
  return "3";
}

function extractIntent(text) {
  const normalized = normalizeText(text);

  if (
    normalized.includes("почему") ||
    normalized.includes("объясни") ||
    normalized.includes("why") ||
    normalized.includes("что учел") ||
    normalized.includes("что учёл") ||
    normalized.includes("поясни")
  ) {
    return "question";
  }

  if (
    normalized.includes("сдвинь") ||
    normalized.includes("перенеси") ||
    normalized.includes("измени") ||
    normalized.includes("подвинь") ||
    normalized.includes("замени")
  ) {
    return "update";
  }

  if (
    normalized.includes("поставь") ||
    normalized.includes("запланируй") ||
    normalized.includes("нужен запуск") ||
    normalized.includes("нужно") ||
    normalized.includes("добавь") ||
    normalized.includes("давай поставим") ||
    normalized.includes("хочу") ||
    normalized.includes("нужно разместить") ||
    normalized.includes("нужно поставить") ||
    normalized.includes("можно поставить")
  ) {
    return "planning_request";
  }

  if (
    normalized.includes("не использовать") ||
    normalized.includes("приоритет") ||
    normalized.includes("не больше") ||
    normalized.includes("жестк")
  ) {
    return "rule";
  }

  return "note";
}

function buildRequirementAction({
  text,
  channels,
  games,
  messageId,
}) {
  const normalized = normalizeText(text);
  const game = matchGameNames(normalized, games)[0] || games[0] || "Матрёшки";
  const channelIds = matchChannelIds(normalized, channels);
  const audience = parseAudience(normalized);
  const dateWindow = extractDateWindow(text);
  const priority = inferPriority(text);
  const hasStrongDateSignal = dateWindow.source === "explicit" || dateWindow.source === "relative";
  const defaultRequirement = createEmptyRequirement();

  const launchWords = [
    "поставь",
    "запланируй",
    "нужен запуск",
    "добавь запуск",
    "нужно размещение",
    "собери тайминг",
    "давай поставим",
    "нужно поставить",
    "нужно запланировать",
    "можно поставить",
    "хочу запуск",
    "хочу размещение",
  ];

  if (!launchWords.some((word) => normalized.includes(word))) {
    return null;
  }

  const confidenceSignals = [
    game ? 0.22 : 0,
    audience ? 0.18 : 0,
    channelIds.length ? 0.18 : 0,
    hasStrongDateSignal ? 0.18 : 0,
    normalizeText(text).length > 20 ? 0.08 : 0,
  ];
  const confidence = Math.min(
    0.9,
    Number((0.18 + confidenceSignals.reduce((sum, item) => sum + item, 0)).toFixed(2))
  );

  return {
    id: `action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: "create_requirement",
    confidence,
    sourceMessageId: messageId,
    payload: {
      requirement: normalizeRequirement({
        id: `requirement-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        game,
        channelIds,
        audience: audience || defaultRequirement.audience,
        priority,
        hasFixedDates: dateWindow.hasFixedDates,
        fixedStartDate: dateWindow.fixedStartDate || "",
        fixedEndDate: dateWindow.fixedEndDate || "",
        weekStart: dateWindow.weekStart || getWeekRange(defaultRequirement.weekStart).weekStart,
        weekEnd: dateWindow.weekEnd || getWeekRange(defaultRequirement.weekStart).weekEnd,
        desiredResult: "",
        comment: `[Из ассистента] ${text}`.slice(0, 240),
        status: "новое",
      }),
    },
  };
}

function extractChannelExclusion(text, channels, messageId) {
  const normalized = normalizeText(text);

  const exclusionPatterns = [
    "не использовать",
    "избегать",
    "исключить",
    "убрать",
    "не ставить",
    "не трогать",
    "never use",
    "avoid",
    "exclude",
  ];

  const matched = exclusionPatterns.some((pattern) =>
    normalized.includes(pattern)
  );
  if (!matched) return [];

  const matchedChannels = matchChannelIds(normalized, channels);
  if (!matchedChannels.length) return [];

  const audience = parseAudience(normalized);

  return [
    createRule({
      type: "channel_exclusion",
      scope: {
        audience,
      },
      payload: {
        excludedChannelIds: matchedChannels,
      },
      confidence: 0.9,
      messageId,
      messageText: text,
      priority: 90,
    }),
  ];
}

function extractChannelPriority(text, channels, games, messageId) {
  const normalized = normalizeText(text);

  const positivePatterns = [
    "предпочт",
    "приоритет",
    "лучше использовать",
    "лучше",
    "предпочесть",
    "ставить через",
    "prefer",
    "prioritize",
    "priority",
  ];

  const matched = positivePatterns.some((pattern) =>
    normalized.includes(pattern)
  );
  if (!matched) return [];

  const matchedChannels = matchChannelIds(normalized, channels);
  if (!matchedChannels.length) return [];

  const matchedGames = matchGameNames(normalized, games);
  const weights = matchedChannels.reduce((acc, channelId) => {
    acc[channelId] = 15;
    return acc;
  }, {});

  return [
    createRule({
      type: "channel_priority",
      scope: {
        game: matchedGames[0] || "",
        audience: parseAudience(normalized),
      },
      payload: {
        weights,
      },
      confidence: 0.82,
      messageId,
      messageText: text,
      priority: 70,
    }),
  ];
}

function extractDailyLimit(text, messageId) {
  const normalized = normalizeText(text);

  const patterns = [
    "не больше",
    "макс",
    "максимум",
    "не более",
    "max",
    "no more than",
  ];
  const launchWords = ["запуск", "запусков", "размещ", "launch", "placement"];

  const matched =
    patterns.some((pattern) => normalized.includes(pattern)) &&
    launchWords.some((pattern) => normalized.includes(pattern));

  if (!matched) return [];

  const value = parseNumber(normalized);
  if (!Number.isFinite(value)) return [];

  return [
    createRule({
      type: "daily_limit",
      payload: {
        maxLaunchesPerDay: value,
      },
      confidence: 0.88,
      messageId,
      messageText: text,
      priority: 80,
    }),
  ];
}

function extractHardDateBinding(text, channels, games, messageId) {
  const normalized = normalizeText(text);
  const hasBindingWords =
    normalized.includes("жестк") ||
    normalized.includes("привяз") ||
    normalized.includes("строго") ||
    normalized.includes("обязательно") ||
    normalized.includes("fixed date") ||
    normalized.includes("hard date");

  const dates = String(text || "").match(/\b20\d{2}-\d{2}-\d{2}\b/g) || [];
  if (!hasBindingWords || !dates.length) return [];

  const matchedChannels = matchChannelIds(normalized, channels);
  const matchedGames = matchGameNames(normalized, games);

  return [
    createRule({
      type: "hard_date_binding",
      scope: {
        game: matchedGames[0] || "",
        channelId: matchedChannels[0] || "",
        audience: parseAudience(normalized),
      },
      payload: {
        windowStart: dates[0],
        windowEnd: dates[1] || dates[0],
      },
      confidence: 0.92,
      messageId,
      messageText: text,
      priority: 95,
    }),
  ];
}

function extractAutoApplyPreference(text, messageId) {
  const normalized = normalizeText(text);

  const patterns = [
    "применяй автоматически",
    "автоприменение",
    "auto apply",
    "apply automatically",
  ];

  if (!patterns.some((pattern) => normalized.includes(pattern))) return [];

  return [
    createRule({
      type: "auto_apply_preference",
      payload: {
        autoApplyDraft: "always",
      },
      confidence: 0.75,
      messageId,
      messageText: text,
      priority: 40,
    }),
  ];
}

export function extractRulesFromMessage({
  text,
  messageId,
  channels = [],
  games = [],
}) {
  const rules = [
    ...extractChannelExclusion(text, channels, messageId),
    ...extractChannelPriority(text, channels, games, messageId),
    ...extractDailyLimit(text, messageId),
    ...extractHardDateBinding(text, channels, games, messageId),
    ...extractAutoApplyPreference(text, messageId),
  ];

  const unique = [];
  const seen = new Set();

  rules.forEach((rule) => {
    const key = JSON.stringify({
      type: rule.type,
      scope: rule.scope,
      payload: rule.payload,
    });

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(rule);
    }
  });

  return unique;
}

export function extractAssistantActions({
  text,
  messageId,
  channels = [],
  games = [],
}) {
  const intent = extractIntent(text);
  const rules = extractRulesFromMessage({ text, messageId, channels, games });
  const actions = [];

  const requirementAction = buildRequirementAction({
    text,
    channels,
    games,
    messageId,
  });

  if (requirementAction) {
    actions.push(requirementAction);
  }

  return {
    intent,
    rules,
    actions,
    understanding: {
      audience: parseAudience(text),
      channelIds: matchChannelIds(text, channels),
      games: matchGameNames(text, games),
      dateWindow: extractDateWindow(text),
    },
    shouldRebuildSchedule:
      actions.some((action) => action.type === "create_requirement") ||
      rules.length > 0,
  };
}
