import { format, parseISO, eachDayOfInterval } from "date-fns";
import {
  detectConflicts,
  calculateEndDate,
  calculateLatestAllowedStartDate,
  formatDisplayDate,
  getChannelDisplayName,
  getChannelSubtitle,
  getChannelTitle,
} from "./crm-store";
import {
  getRequirementDateConstraints,
  normalizeAudience,
  PLANNABLE_REQUIREMENT_STATUSES,
} from "./requirements-domain";
import { findCatalogEntryForChannel } from "./channel-catalog";
import { getGamePlanningProfile } from "./game-catalog";
import {
  compileAssistantRules,
  evaluateAssistantHardRules,
  evaluateAssistantScoreAdjustments,
  getAssistantDateWindowOverride,
} from "./assistant/rule-engine";
import { getChannelIdentityKey } from "./channel-catalog";

const PLANNED_KB_AUDIENCE = "клиенты с план. начислением кб";
const BALANCE_KB_AUDIENCE = "клиенты с остатками кб";

function recalculateAllConflicts(launches, channels) {
  return launches.map((launch) => {
    const issues = detectConflicts(launch, launches, channels);
    return {
      ...launch,
      issues,
      conflictStatus: issues.length ? "conflict" : "ok",
    };
  });
}

function dateRange(from, to) {
  try {
    const start = parseISO(from);
    const end = parseISO(to);
    if (start > end) return [];
    return eachDayOfInterval({ start, end }).map((d) =>
      format(d, "yyyy-MM-dd")
    );
  } catch {
    return [];
  }
}

function countActiveOnDay(day, launches) {
  return launches.filter(
    (launch) =>
      launch.planningStatus !== "приостановлено" &&
      launch.startDate &&
      launch.endDate &&
      day >= launch.startDate &&
      day <= launch.endDate
  ).length;
}

function countChannelActiveOnDay(day, launches, channelId) {
  return launches.filter(
    (launch) =>
      launch.planningStatus !== "приостановлено" &&
      launch.channelId === channelId &&
      launch.startDate &&
      launch.endDate &&
      day >= launch.startDate &&
      day <= launch.endDate
  ).length;
}

function countChannelLaunchesInWindow(launches, channelId, windowStart, windowEnd) {
  if (!channelId || !windowStart || !windowEnd) return 0;

  return launches.filter(
    (launch) =>
      launch.planningStatus !== "приостановлено" &&
      launch.channelId === channelId &&
      launch.startDate &&
      launch.endDate &&
      launch.startDate <= windowEnd &&
      launch.endDate >= windowStart
  ).length;
}

function buildIntervalDays(startDate, endDate) {
  if (!startDate || !endDate) return [];
  return dateRange(startDate, endDate);
}

function getPriorityTier(priority) {
  const value = Number(priority ?? 3);
  if (value <= 1) return "high";
  if (value <= 3) return "medium";
  return "low";
}

function getPriorityLabel(priority) {
  const tier = getPriorityTier(priority);
  if (tier === "high") return "Высокий";
  if (tier === "medium") return "Средний";
  return "Низкий";
}

function normalizeLaunchPriority(priority) {
  const normalized = String(priority ?? "").trim();
  return ["0", "1", "2", "3", "4", "5"].includes(normalized)
    ? normalized
    : "3";
}

function normalizeLooseText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е");
}

function getChannelDuration(channel) {
  return Math.max(1, Number(channel?.duration) || 5);
}

function isPlannedKBAudience(value) {
  return normalizeLooseText(normalizeAudience(value || "")) === PLANNED_KB_AUDIENCE;
}

function isBalanceKBAudience(value) {
  return normalizeLooseText(normalizeAudience(value || "")) === BALANCE_KB_AUDIENCE;
}

function isRegistryAudience(value) {
  return normalizeLooseText(normalizeAudience(value || "")) === "реестр";
}

function isPushChannel(channel) {
  const token = normalizeLooseText(
    `${channel?.title || ""} ${channel?.subtitle || ""} ${channel?.name || ""}`
  );
  return token.includes("пуш") || token.includes("push");
}

function isPushLaunch(launch, channels = []) {
  const matchedChannel = channels.find((channel) => channel.id === launch?.channelId);
  return isPushChannel(matchedChannel);
}

function buildDateInSameMonth(dateString, dayOfMonth) {
  if (!dateString) return "";
  const parsed = parseISO(dateString);
  if (Number.isNaN(parsed.getTime())) return "";
  const date = new Date(parsed);
  const month = date.getMonth();
  date.setMonth(month + 1, 0);
  const lastDayOfMonth = date.getDate();
  date.setMonth(month, Math.min(dayOfMonth, lastDayOfMonth));
  return format(date, "yyyy-MM-dd");
}

function getMonthKey(dateString) {
  if (!dateString) return "";
  return String(dateString).slice(0, 7);
}

function buildKBAudienceScheduleRule(
  requirement,
  channel,
  pool,
  channels,
  baseWindowStart
) {
  const audience = requirement?.audience;
  if (isWinnersAudience(audience) || isRegistryAudience(audience)) return null;

  const gameProfile = getGamePlanningProfile(requirement?.game);
  const isKBGame = gameProfile.type === "kb_utilization";
  const isPlanned = isPlannedKBAudience(audience) || (isKBGame && !isBalanceKBAudience(audience));
  const isBalance = isBalanceKBAudience(audience);
  if (!isKBGame && !isPlannedKBAudience(audience) && !isBalance) return null;

  const referenceDate =
    baseWindowStart ||
    requirement?.earliestStartDate ||
    requirement?.fixedStartDate ||
    requirement?.weekStart;
  const hardWindowStart = buildDateInSameMonth(referenceDate, isPlanned ? 10 : 20);
  const preferredWindowEnd = buildDateInSameMonth(referenceDate, isPlanned ? 15 : 30);
  const hardWindowEnd = buildDateInSameMonth(referenceDate, isPlanned ? 20 : 30);

  if (!hardWindowStart || !hardWindowEnd) return null;

  const monthKey = getMonthKey(hardWindowStart);
  const preferredPushDays = isPlanned ? [10, 13, 15] : [20, 23, 25];

  const existingPushCount = isPushChannel(channel)
    ? pool.filter((launch) => {
        const sameAudience = isPlanned
          ? isPlannedKBAudience(launch?.audience)
          : isBalanceKBAudience(launch?.audience);
        if (!sameAudience) return false;
        if (getMonthKey(launch?.startDate) !== monthKey) return false;
        return isPushLaunch(launch, channels);
      }).length
    : 0;

  const preferredPushDate =
    isPushChannel(channel) && existingPushCount < preferredPushDays.length
      ? buildDateInSameMonth(referenceDate, preferredPushDays[existingPushCount])
      : "";

  return {
    audienceType: isPlanned ? "planned_kb" : "balance_kb",
    hardWindowStart,
    hardWindowEnd,
    preferredWindowEnd,
    preferredExactDate: preferredPushDate,
  };
}

function daysBetween(from, to) {
  const fromDate = parseISO(from);
  const toDate = parseISO(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return null;
  }
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000);
}

function isWinnersAudience(value) {
  return normalizeAudience(value || "") === "победители";
}

function getWinnerPreferredChannels(channels) {
  const preferredKeys = ["wn-main", "push", "sms"];
  const matched = [];
  const seen = new Set();

  preferredKeys.forEach((key) => {
    const channel = channels.find(
      (item) => findCatalogEntryForChannel(item)?.key === key
    );
    if (!channel) return;

    const identityKey = getChannelIdentityKey(channel);
    if (seen.has(identityKey)) return;
    seen.add(identityKey);
    matched.push(channel);
  });

  return matched;
}

function getChannelFamily(channel) {
  const token = normalizeLooseText(
    `${getChannelTitle(channel)} ${getChannelSubtitle(channel)} ${getChannelDisplayName(
      channel
    )}`
  );

  if (
    token.includes("what s new") ||
    token.includes("whats new") ||
    token.includes("вн")
  ) {
    return "wn";
  }

  if (token.includes("попап") || token.includes("поп ап")) {
    return "popup";
  }

  return "other";
}

function getChannelPairContext(channel) {
  const token = normalizeLooseText(
    `${getChannelTitle(channel)} ${getChannelSubtitle(channel)} ${getChannelDisplayName(
      channel
    )}`
  );

  if (
    token.includes("главн") ||
    token.includes("гэ") ||
    token.includes("main")
  ) {
    return "main";
  }

  if (token.includes("платеж")) {
    return "payments";
  }

  if (
    token.includes("история операций") ||
    token.includes("ио") ||
    token.includes("history")
  ) {
    return "history";
  }

  return null;
}

function expandPairedChannels(sourceChannels, allChannels) {
  const expanded = [...sourceChannels];
  const seen = new Set(
    sourceChannels.map((channel) => getChannelIdentityKey(channel))
  );

  sourceChannels.forEach((channel) => {
    const family = getChannelFamily(channel);
    const context = getChannelPairContext(channel);
    if (!context || (family !== "wn" && family !== "popup")) return;

    const counterpartFamily = family === "wn" ? "popup" : "wn";
    const counterpart = allChannels.find(
      (candidate) =>
        getChannelFamily(candidate) === counterpartFamily &&
        getChannelPairContext(candidate) === context
    );

    if (!counterpart) return;

    const counterpartKey = getChannelIdentityKey(counterpart);
    if (seen.has(counterpartKey)) return;

    seen.add(counterpartKey);
    expanded.push(counterpart);
  });

  return expanded;
}

function getNearestGapDays(candidate, launches) {
  if (isWinnersAudience(candidate.audience || "")) {
    return null;
  }

  let nearest = null;

  launches.forEach((launch) => {
    if (launch.game !== candidate.game) return;
    if (isWinnersAudience(launch.audience || "")) return;
    if (
      normalizeAudience(launch.audience || "") !==
      normalizeAudience(candidate.audience || "")
    ) {
      return;
    }
    if (!launch.startDate || !launch.endDate) return;

    const gaps = [
      daysBetween(launch.endDate, candidate.startDate),
      daysBetween(candidate.endDate, launch.startDate),
    ].filter((value) => value != null);

    gaps.forEach((value) => {
      const absolute = Math.abs(value);
      if (nearest == null || absolute < nearest) {
        nearest = absolute;
      }
    });
  });

  return nearest;
}

function buildBreakdownItem(label, value, description, tone = "neutral") {
  return {
    label,
    value: Number(value.toFixed(1)),
    description,
    tone,
  };
}

function describePressure(score) {
  if (score >= 8) return "низкая нагрузка";
  if (score >= 3) return "умеренная нагрузка";
  return "высокая нагрузка";
}

function normalizeAssistantText(value) {
  return String(value || "").trim().toLowerCase();
}

function isLaunchedStatus(value) {
  return normalizeAssistantText(value) === "запущено";
}

function getManualChannelEffectiveness(channel, channels = []) {
  const rank = Number(channel?.effectivenessRank);
  if (!Number.isFinite(rank) || rank <= 0) return null;

  const rankedChannels = channels.filter((item) => {
    const currentRank = Number(item?.effectivenessRank);
    return Number.isFinite(currentRank) && currentRank > 0;
  });
  const rankedCount = Math.max(rankedChannels.length, 1);
  const score = Math.max(1, rankedCount - rank + 1);

  return {
    rank,
    score: score * 2,
    description: `Канал вручную ранжирован по эффективности и стоит на ${rank}-м месте из ${rankedCount}.`,
    tone:
      rank <= Math.max(1, Math.ceil(rankedCount / 3))
        ? "positive"
        : rank <= Math.max(2, Math.ceil((rankedCount * 2) / 3))
        ? "neutral"
        : "negative",
  };
}

function scoreChannelEffectiveness(
  channel,
  requirement,
  performanceReports = [],
  channels = []
) {
  const manualEffectiveness = getManualChannelEffectiveness(channel, channels);
  if (manualEffectiveness) {
    return {
      score: manualEffectiveness.score,
      description: manualEffectiveness.description,
      tone: manualEffectiveness.tone,
    };
  }

  return {
    score: 0,
    description:
      "Для канала не задан ручной ранг эффективности, поэтому он не получает преимущества при выборе.",
    tone: "neutral",
  };
}

function getEffectivenessPriorityWeight(priorityTier) {
  if (priorityTier === "high") return 1.75;
  if (priorityTier === "medium") return 1.2;
  return 0.8;
}

function deriveAssistantPlanningDirectives(assistantContext = {}) {
  const messages = Array.isArray(assistantContext.messages)
    ? assistantContext.messages
    : [];
  const recentUserText = messages
    .filter((message) => message.role === "user")
    .slice(-8)
    .map((message) => normalizeAssistantText(message.text))
    .join(" ");

  const directives = {
    densityMode: "balanced",
    timingBias: "balanced",
    spacingImportance: "balanced",
    notes: [],
  };

  if (
    recentUserText.includes("плотн") ||
    recentUserText.includes("агрессив") ||
    recentUserText.includes("компакт")
  ) {
    directives.densityMode = "aggressive";
    directives.notes.push("Ассистент учёл запрос на более плотный тайминг.");
  } else if (
    recentUserText.includes("аккурат") ||
    recentUserText.includes("консерват") ||
    recentUserText.includes("осторож") ||
    recentUserText.includes("разнес")
  ) {
    directives.densityMode = "conservative";
    directives.notes.push("Ассистент учёл запрос на более аккуратное размещение.");
  }

  if (
    recentUserText.includes("пораньше") ||
    recentUserText.includes("раньше") ||
    recentUserText.includes("в начале")
  ) {
    directives.timingBias = "early";
    directives.notes.push("Ассистент учёл пожелание ставить запуски раньше.");
  } else if (
    recentUserText.includes("попозже") ||
    recentUserText.includes("позже") ||
    recentUserText.includes("в конце")
  ) {
    directives.timingBias = "late";
    directives.notes.push("Ассистент учёл пожелание сдвигать запуски ближе к концу окна.");
  }

  if (
    recentUserText.includes("равномер") ||
    recentUserText.includes("разнести") ||
    recentUserText.includes("без скученности")
  ) {
    directives.spacingImportance = "high";
    directives.notes.push("Ассистент учёл пожелание распределять запуски равномернее.");
  }

  return directives;
}

function scoreCandidate({
  requirement,
  channel,
  candidate,
  windowStart,
  windowEnd,
  latestEndDate,
  existing,
  compiled,
  maxPerDay,
  assistantDirectives,
  specialScheduleRule,
  performanceReports,
  channels,
}) {
  const endDate = calculateEndDate(candidate.startDate, candidate.duration);
  if (!endDate) return null;
  if (latestEndDate && endDate > latestEndDate) return null;

  candidate.endDate = endDate;

  const intervalDays = buildIntervalDays(candidate.startDate, endDate);
  const dailyPressure = intervalDays.map((day) => countActiveOnDay(day, existing));
  const startDayPressure = dailyPressure[0] || 0;
  const maxObservedPressure = dailyPressure.length
    ? Math.max(...dailyPressure)
    : 0;

  if (maxPerDay != null && maxObservedPressure >= maxPerDay) {
    return null;
  }

  const issues = detectConflicts(
    {
      ...candidate,
      channelId: channel.id,
    },
    existing,
    [channel]
  );
  if (issues.length) {
    return null;
  }

  const windowDates = dateRange(windowStart, windowEnd);
  const windowIndex = Math.max(0, windowDates.indexOf(candidate.startDate));
  const normalizedPosition = windowDates.length > 1
    ? windowIndex / (windowDates.length - 1)
    : 0;
  const channelWindowActiveDays = windowDates.filter(
    (day) => countChannelActiveOnDay(day, existing, channel.id) > 0
  ).length;
  const channelWindowLoadRatio = windowDates.length
    ? channelWindowActiveDays / windowDates.length
    : 0;
  const channelDailyPressure = intervalDays.map((day) =>
    countChannelActiveOnDay(day, existing, channel.id)
  );
  const channelStartPressure = channelDailyPressure[0] || 0;
  const channelPeakPressure = channelDailyPressure.length
    ? Math.max(...channelDailyPressure)
    : 0;

  const priorityTier = getPriorityTier(requirement.priority);
  const gameProfile = getGamePlanningProfile(requirement.game);
  let placementPreferenceScore;
  if (assistantDirectives?.timingBias === "early") {
    placementPreferenceScore = (1 - normalizedPosition) * 16;
  } else if (assistantDirectives?.timingBias === "late") {
    placementPreferenceScore = normalizedPosition * 16;
  } else if (gameProfile.defaultPositioning === "early") {
    placementPreferenceScore = (1 - normalizedPosition) * 20;
  } else {
    placementPreferenceScore =
      gameProfile.type === "anchor_action"
        ? (1 - Math.abs(normalizedPosition - 0.45)) * 12
        : priorityTier === "high"
        ? (1 - normalizedPosition) * 18
        : priorityTier === "medium"
        ? (1 - Math.abs(normalizedPosition - 0.35)) * 10
        : normalizedPosition * 8;
  }

  const pressurePenaltyMultiplier =
    (assistantDirectives?.densityMode === "aggressive"
      ? 2
      : assistantDirectives?.densityMode === "conservative"
      ? 5
      : 4) * gameProfile.pressurePenaltyMultiplier;

  const pressureScore = Math.max(
    0,
    14 - startDayPressure * pressurePenaltyMultiplier
  );

  const channelLoadScore = Math.max(
    0,
    14 -
      channelStartPressure * 4 * gameProfile.channelLoadPenaltyMultiplier -
      channelPeakPressure * 2 * gameProfile.channelLoadPenaltyMultiplier -
      channelWindowLoadRatio * 8 * gameProfile.channelLoadPenaltyMultiplier
  );

  const sameGameGap = getNearestGapDays(candidate, existing);
  const spacingMultiplier =
    assistantDirectives?.spacingImportance === "high"
      ? 2.2
      : assistantDirectives?.densityMode === "aggressive"
      ? 1
      : 1.5;
  const spacingScore =
    sameGameGap == null
      ? 8
      : Math.min(
          16,
          Math.max(0, sameGameGap - 2) * spacingMultiplier * gameProfile.spacingMultiplier
        );

  const assistantScore = evaluateAssistantScoreAdjustments(candidate, compiled);
  const effectiveness = scoreChannelEffectiveness(
    channel,
    requirement,
    performanceReports,
    channels
  );
  const effectivenessWeight = getEffectivenessPriorityWeight(priorityTier);
  const weightedEffectivenessScore =
    effectiveness.score *
    effectivenessWeight *
    gameProfile.effectivenessMultiplier;
  const specialDateScore = (() => {
    if (!specialScheduleRule) return 0;

    if (
      specialScheduleRule.preferredExactDate &&
      candidate.startDate === specialScheduleRule.preferredExactDate
    ) {
      return 28;
    }

    if (
      specialScheduleRule.preferredWindowEnd &&
      candidate.startDate >= specialScheduleRule.hardWindowStart &&
      candidate.startDate <= specialScheduleRule.preferredWindowEnd
    ) {
      return 16;
    }

    if (
      candidate.startDate >= specialScheduleRule.hardWindowStart &&
      candidate.startDate <= specialScheduleRule.hardWindowEnd
    ) {
      return 4;
    }

    return -20;
  })();

  const breakdown = [
    buildBreakdownItem(
      "Приоритет",
      priorityTier === "high" ? 24 : priorityTier === "medium" ? 14 : 8,
      `Приоритет требования ${getPriorityLabel(requirement.priority).toLowerCase()}.`,
      "positive"
    ),
    buildBreakdownItem(
      "Нагрузка дня",
      pressureScore,
      `На дату старта ${startDayPressure} активных запусков, это ${describePressure(
        pressureScore
      )}.`,
      pressureScore >= 8 ? "positive" : pressureScore >= 4 ? "neutral" : "negative"
    ),
    buildBreakdownItem(
      "Загрузка канала",
      channelLoadScore,
      `На старте у канала ${channelStartPressure} активн. запуск(ов), пик в интервале ${channelPeakPressure}, занято ${Math.round(
        channelWindowLoadRatio * 100
      )}% окна.`,
      channelLoadScore >= 8 ? "positive" : channelLoadScore >= 4 ? "neutral" : "negative"
    ),
    buildBreakdownItem(
      "Позиция в окне",
      placementPreferenceScore,
      `Слот находится на ${windowIndex + 1}-й позиции в окне ${formatDisplayDate(
        windowStart
      )} - ${formatDisplayDate(windowEnd)}.`,
      placementPreferenceScore >= 10 ? "positive" : "neutral"
    ),
    buildBreakdownItem(
      "Разнос по игре",
      spacingScore,
      sameGameGap == null
        ? "Поблизости нет других запусков этой игры для той же аудитории."
        : `До ближайшего похожего запуска ${sameGameGap} дн.`,
      spacingScore >= 10 ? "positive" : spacingScore >= 5 ? "neutral" : "negative"
    ),
    buildBreakdownItem(
      "Эффективность канала",
      weightedEffectivenessScore,
      priorityTier === "high"
        ? `Для высокого приоритета планировщик сильнее тянется к более эффективным каналам. ${effectiveness.description}`
        : effectiveness.description,
      effectiveness.tone
    ),
    buildBreakdownItem(
      "Логика игры",
      gameProfile.type === "kb_utilization"
        ? 10
        : gameProfile.type === "anchor_action"
        ? 8
        : 5,
      gameProfile.description,
      "neutral"
    ),
  ];

  if (specialScheduleRule) {
    const exactDate = specialScheduleRule.preferredExactDate;
    const description = exactDate
        ? specialScheduleRule.audienceType === "planned_kb"
          ? `Для аудитории с план. начислением КБ пуши ставятся по последовательности ${formatDisplayDate(
              buildDateInSameMonth(candidate.startDate, 10)
            )}, ${formatDisplayDate(
              buildDateInSameMonth(candidate.startDate, 13)
            )}, ${formatDisplayDate(buildDateInSameMonth(candidate.startDate, 15))}.`
          : `Для аудитории с остатками КБ пуши ставятся по последовательности ${formatDisplayDate(
              buildDateInSameMonth(candidate.startDate, 20)
            )}, ${formatDisplayDate(
              buildDateInSameMonth(candidate.startDate, 23)
            )}, ${formatDisplayDate(buildDateInSameMonth(candidate.startDate, 27))}.`
      : specialScheduleRule.audienceType === "planned_kb"
      ? `Для аудитории с план. начислением КБ используется окно ${formatDisplayDate(
          specialScheduleRule.hardWindowStart
        )} - ${formatDisplayDate(
          specialScheduleRule.hardWindowEnd
        )} с предпочтением старта до ${formatDisplayDate(
          specialScheduleRule.preferredWindowEnd
        )}.`
      : `Для аудитории с остатками КБ используется окно ${formatDisplayDate(
          specialScheduleRule.hardWindowStart
        )} - ${formatDisplayDate(
          specialScheduleRule.hardWindowEnd
        )} с приоритетом запуска после ${formatDisplayDate(
          specialScheduleRule.hardWindowStart
        )}.`;

    breakdown.push(
      buildBreakdownItem(
        "Правило КБ",
        specialDateScore,
        exactDate && candidate.startDate === exactDate
          ? `Старт попал в предпочтительную дату ${formatDisplayDate(exactDate)}. ${description}`
          : description,
        specialDateScore >= 12 ? "positive" : specialDateScore >= 0 ? "neutral" : "negative"
      )
    );
  }

  if (assistantScore.delta) {
    breakdown.push(
      buildBreakdownItem(
        "Правила ассистента",
        assistantScore.delta,
        assistantScore.hits.length
          ? assistantScore.hits.map((hit) => hit.notes || hit.effect).join("; ")
          : "На слот повлияли правила ассистента.",
        assistantScore.delta > 0 ? "positive" : "negative"
      )
    );
  }

  if (assistantDirectives?.notes?.length) {
    breakdown.push(
      buildBreakdownItem(
        "Пожелания ассистенту",
        6,
        assistantDirectives.notes.join(" "),
        "positive"
      )
    );
  }

  const totalScore = breakdown.reduce((sum, item) => sum + item.value, 0);

  return {
    startDate: candidate.startDate,
    endDate,
    score: Number(totalScore.toFixed(1)),
    breakdown: breakdown.sort((a, b) => b.value - a.value),
    appliedRules: assistantScore.hits,
    issues,
  };
}

function pickBestSlot({
  requirement,
  channel,
  windowStart,
  windowEnd,
  latestEndDate,
  existing,
  compiled,
  maxPerDay,
  assistantDirectives,
  specialScheduleRule,
  performanceReports,
  channels,
}) {
  const latestAllowedStart = latestEndDate
    ? calculateLatestAllowedStartDate(latestEndDate, getChannelDuration(channel))
    : "";
  const effectiveWindowEnd =
    latestAllowedStart && latestAllowedStart < windowEnd
      ? latestAllowedStart
      : windowEnd;
  const dates = dateRange(windowStart, effectiveWindowEnd);
  let best = null;
  const alternatives = [];

  for (const date of dates) {
    const candidate = {
      channelId: channel.id,
      game: requirement.game,
      audience: requirement.audience || "",
      platform: "АМ+АО",
      priority: requirement.priority,
      campaignType: "CRM акция",
      duration: getChannelDuration(channel),
      startDate: date,
    };

    const scored = scoreCandidate({
      requirement,
      channel,
      candidate,
      windowStart,
      windowEnd: effectiveWindowEnd,
      latestEndDate,
      existing,
      compiled,
      maxPerDay,
      assistantDirectives,
      specialScheduleRule,
      performanceReports,
      channels,
    });

    if (!scored) continue;

    alternatives.push({
      startDate: scored.startDate,
      endDate: scored.endDate,
      score: scored.score,
    });

    if (!best || scored.score > best.score) {
      best = scored;
    }
  }

  if (!best) return null;

  return {
    ...best,
    alternatives: alternatives
      .sort((a, b) => b.score - a.score)
      .slice(0, 3),
  };
}

function getRequirementWindow(requirement) {
  const constraints = getRequirementDateConstraints(requirement);

  if (requirement.hasFixedDates === "yes" && constraints.earliestStartDate) {
    return {
      start: constraints.earliestStartDate,
      end: constraints.latestStartDate || constraints.earliestStartDate,
      latestEnd:
        constraints.latestEndDate ||
        constraints.latestStartDate ||
        constraints.earliestStartDate,
    };
  }

  return {
    start: requirement.weekStart,
    end: requirement.weekEnd,
    latestEnd: "",
  };
}

function getRequirementTargetChannels(requirement, channels) {
  const winnersChannels = isWinnersAudience(requirement?.audience || "")
    ? getWinnerPreferredChannels(channels)
    : [];

  const source =
    winnersChannels.length > 0
      ? winnersChannels
      : Array.isArray(requirement.channelIds) && requirement.channelIds.length > 0
      ? channels.filter((channel) => requirement.channelIds.includes(channel.id))
      : [...channels];

  const pairedSource =
    winnersChannels.length > 0 ? source : expandPairedChannels(source, channels);

  const seen = new Set();
  return pairedSource.filter((channel) => {
    const key = getChannelIdentityKey(channel);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildLaunchIdentityKey(launch, channels = []) {
  const channel =
    channels.find((item) => item.id === launch?.channelId) ||
    channels.find((item) => item.id === launch?._planningMeta?.channelId) ||
    null;
  const channelKey = channel
    ? getChannelIdentityKey(channel)
    : `id:${launch?.channelId || ""}`;

  return [
    normalizeLooseText(launch?.game || ""),
    channelKey,
    String(launch?.startDate || ""),
    String(launch?.endDate || ""),
    normalizeLooseText(normalizeAudience(launch?.audience || "")),
    normalizeLooseText(launch?.campaignType || ""),
  ].join("::");
}

function dedupeLaunchesByIdentity(launches, channels = []) {
  const byKey = new Map();

  launches.forEach((launch) => {
    const key = buildLaunchIdentityKey(launch, channels);
    const currentScore = Number(launch?._score || launch?._planningMeta?.score || 0);
    const existing = byKey.get(key);
    const existingScore = Number(
      existing?._score || existing?._planningMeta?.score || 0
    );

    if (!existing || currentScore > existingScore) {
      byKey.set(key, launch);
    }
  });

  return Array.from(byKey.values());
}

function buildProposedLaunch({
  requirement,
  channel,
  bestSlot,
  effectiveStart,
  effectiveEnd,
  latestEndDate,
  assistantDirectives,
  specialScheduleRule,
  channelAttempts,
  previousLaunch,
}) {
  return {
    id:
      previousLaunch?.id ||
      `proposed-${channel.id}-${requirement.id}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 6)}`,
    game: requirement.game,
    channelId: channel.id,
    startDate: bestSlot.startDate,
    endDate: bestSlot.endDate,
    duration: getChannelDuration(channel),
    platform: previousLaunch?.platform || "АМ+АО",
    audience: requirement.audience || "",
    priority: normalizeLaunchPriority(requirement.priority),
    planningStatus: previousLaunch?.planningStatus || "бэклог",
    registryStatus: previousLaunch?.registryStatus || "нет",
    sentBaseCount: previousLaunch?.sentBaseCount || "",
    campaignType: previousLaunch?.campaignType || "CRM акция",
    comment: requirement.comment
      ? `[Авто] ${requirement.comment}`
      : "[Авто] Сгенерировано умным планировщиком",
    issues: [],
    conflictStatus: "ok",
    earliestStartDate: effectiveStart,
    latestStartDate: effectiveEnd,
    latestEndDate: latestEndDate || bestSlot.endDate,
    manager: previousLaunch?.manager || "",
    _fromRequirementId: requirement.id,
    _score: bestSlot.score,
    _planningMeta: {
      score: bestSlot.score,
      breakdown: bestSlot.breakdown,
      appliedRules: bestSlot.appliedRules,
      alternatives: bestSlot.alternatives,
      windowStart: effectiveStart,
      windowEnd: effectiveEnd,
      latestEndDate: latestEndDate || bestSlot.endDate,
      channelId: channel.id,
      assistantDirectives,
      specialScheduleRule,
      channelAttempts:
        channelAttempts ||
        previousLaunch?._planningMeta?.channelAttempts ||
        [],
    },
  };
}

function optimizeProposedLaunches({
  proposed,
  requirements,
  channels,
  existingLaunches,
  compiled,
  maxPerDay,
  assistantDirectives,
  performanceReports,
}) {
  if (!Array.isArray(proposed) || proposed.length === 0) return proposed;

  const requirementById = new Map(requirements.map((item) => [item.id, item]));
  const optimized = proposed.map((launch) => ({ ...launch }));
  let pool = [...existingLaunches, ...optimized];

  optimized.forEach((launch, index) => {
    const requirement = requirementById.get(launch._fromRequirementId);
    if (!requirement) return;

    const {
      start: windowStart,
      end: windowEnd,
      latestEnd: latestEndDate,
    } = getRequirementWindow(requirement);
    if (!windowStart || !windowEnd) return;

    const currentScore = Number(launch._score || launch._planningMeta?.score || 0);
    const poolWithoutCurrent = pool.filter((item) => item.id !== launch.id);
    const targetChannels = getRequirementTargetChannels(requirement, channels);
    let bestReplacement = null;

    targetChannels.forEach((channel) => {
      const candidate = {
        channelId: channel.id,
        game: requirement.game,
        audience: requirement.audience || "",
        platform: launch.platform || "АМ+АО",
        priority: requirement.priority,
        campaignType: launch.campaignType || "CRM акция",
        duration: getChannelDuration(channel),
      };

      const hardCheck = evaluateAssistantHardRules(candidate, compiled);
      if (hardCheck.blocked) return;

      const dateOverride = getAssistantDateWindowOverride(requirement, channel.id, compiled);
      let effectiveStart = dateOverride?.start || windowStart;
      let effectiveEnd = dateOverride?.end || windowEnd;
      const specialScheduleRule = buildKBAudienceScheduleRule(
        requirement,
        channel,
        poolWithoutCurrent,
        channels,
        effectiveStart
      );

      if (specialScheduleRule) {
        effectiveStart = specialScheduleRule.hardWindowStart;
        effectiveEnd = specialScheduleRule.hardWindowEnd;
      }

      const bestSlot = pickBestSlot({
        requirement,
        channel,
        windowStart: effectiveStart,
        windowEnd: effectiveEnd,
        latestEndDate,
        existing: poolWithoutCurrent,
        compiled,
        maxPerDay,
        assistantDirectives,
        specialScheduleRule,
        performanceReports,
        channels,
      });

      if (!bestSlot) return;

      const candidateLaunch = buildProposedLaunch({
        requirement,
        channel,
        bestSlot,
        effectiveStart,
        effectiveEnd,
        latestEndDate,
        assistantDirectives,
        specialScheduleRule,
        previousLaunch: launch,
      });
      const issues = detectConflicts(candidateLaunch, poolWithoutCurrent, channels);
      candidateLaunch.issues = issues;
      candidateLaunch.conflictStatus = issues.length ? "conflict" : "ok";

      if (issues.length) return;

      const candidateIdentityKey = buildLaunchIdentityKey(candidateLaunch, channels);
      const occupiedLaunchKeys = new Set(
        poolWithoutCurrent.map((item) => buildLaunchIdentityKey(item, channels))
      );
      if (occupiedLaunchKeys.has(candidateIdentityKey)) {
        return;
      }

      const improvement = Number(bestSlot.score || 0) - currentScore;
      const changesChannel = candidateLaunch.channelId !== launch.channelId;
      const changesDate = candidateLaunch.startDate !== launch.startDate;

      if (
        improvement > 4 ||
        (improvement > 1.5 && (changesChannel || changesDate))
      ) {
        if (
          !bestReplacement ||
          Number(candidateLaunch._score || 0) > Number(bestReplacement._score || 0)
        ) {
          bestReplacement = {
            ...candidateLaunch,
            _planningMeta: {
              ...candidateLaunch._planningMeta,
              optimizedInSecondPass: true,
            },
          };
        }
      }
    });

    if (bestReplacement) {
      optimized[index] = bestReplacement;
      pool = [...existingLaunches, ...optimized];
    }
  });

  return optimized;
}

export async function downloadLaunchesTemplate() {
  const XLSX = await import("xlsx");
  const headers = [
    "Игра",
    "Канал",
    "Тип кампании",
    "Старт",
    "Длительность",
    "Конец",
    "Ранняя дата",
    "Поздняя дата",
    "Поздний срок окончания",
    "Платформа",
    "База",
    "Приоритет",
    "Статус",
    "Реестр",
    "База коммуникаций",
    "Менеджер",
    "Комментарий",
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, headers.map(() => "")]);
  ws["!cols"] = headers.map(() => ({ wch: 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Launches");
  XLSX.writeFile(wb, "launches-template.xlsx");
}

export async function downloadRequirementsTemplate() {
  const XLSX = await import("xlsx");
  const headers = [
    "Неделя с",
    "Неделя до",
    "Игра",
    "Каналы",
    "База",
    "Приоритет",
    "Жесткая привязка к датам",
    "Самая ранняя дата запуска",
    "Самая поздняя дата запуска",
    "Самый поздний срок окончания",
    "Статус",
    "Ожидаемый результат",
    "Комментарий",
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, headers.map(() => "")]);
  ws["!cols"] = headers.map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Requirements");
  XLSX.writeFile(wb, "requirements-template.xlsx");
}

export function buildSchedule({
  requirements = [],
  channels = [],
  rules = [],
  existingLaunches = [],
  performanceReports = [],
  assistantContext = {},
}) {
  const compiled = compileAssistantRules(rules);
  const assistantDirectives = deriveAssistantPlanningDirectives(assistantContext);
  const maxPerDay = compiled.limitOverrides?.daily?.maxLaunchesPerDay ?? null;
  const pool = [...existingLaunches];
  const proposed = [];
  const skipped = [];
  const weeklyCoverage = new Map();
  const seenLaunchKeys = new Set(
    existingLaunches.map((launch) => buildLaunchIdentityKey(launch, channels))
  );

  function getWeekCoverageSet(weekStart, weekEnd) {
    const key = `${weekStart}:${weekEnd}`;
    if (!weeklyCoverage.has(key)) {
      const usedChannelIds = new Set(
        pool
          .filter(
            (launch) =>
              launch.channelId &&
              launch.startDate &&
              launch.endDate &&
              launch.startDate <= weekEnd &&
              launch.endDate >= weekStart
          )
          .map((launch) => launch.channelId)
      );
      weeklyCoverage.set(key, usedChannelIds);
    }

    return weeklyCoverage.get(key);
  }

  const sorted = [...requirements].sort(
    (a, b) => Number(a.priority ?? 3) - Number(b.priority ?? 3)
  );

  for (const req of sorted) {
    if (!PLANNABLE_REQUIREMENT_STATUSES.includes(req.status || "новое")) {
      continue;
    }

    let {
      start: windowStart,
      end: windowEnd,
      latestEnd: latestEndDate,
    } = getRequirementWindow(req);

    if (!windowStart || !windowEnd) {
      skipped.push({ req, reason: "Не задано окно дат" });
      continue;
    }

    const coverageSet = getWeekCoverageSet(
      req.weekStart || windowStart,
      req.weekEnd || windowEnd
    );

    let targetChannels = getRequirementTargetChannels(req, channels);

    if (targetChannels.length === 0) {
      skipped.push({
        req,
        reason: "Нет каналов для этого требования",
      });
      continue;
    }

    const priorityTier = getPriorityTier(req.priority);
    const gameProfile = getGamePlanningProfile(req.game);
    targetChannels = [...targetChannels].sort((a, b) => {
      const requirementConstraints = getRequirementDateConstraints(req);
      const windowCoverageStart =
        requirementConstraints.earliestStartDate || req.weekStart || windowStart;
      const windowCoverageEnd =
        requirementConstraints.latestEndDate || req.weekEnd || latestEndDate || windowEnd;
      const scoreA =
        scoreChannelEffectiveness(a, req, performanceReports, channels).score *
          getEffectivenessPriorityWeight(priorityTier) *
          gameProfile.channelSelectionEffectivenessWeight +
        (coverageSet.has(a.id) ? 0 : gameProfile.channelSelectionCoverageBonus) -
        countChannelLaunchesInWindow(pool, a.id, windowCoverageStart, windowCoverageEnd) *
          4 *
          gameProfile.channelSelectionLoadPenalty;
      const scoreB =
        scoreChannelEffectiveness(b, req, performanceReports, channels).score *
          getEffectivenessPriorityWeight(priorityTier) *
          gameProfile.channelSelectionEffectivenessWeight +
        (coverageSet.has(b.id) ? 0 : gameProfile.channelSelectionCoverageBonus) -
        countChannelLaunchesInWindow(pool, b.id, windowCoverageStart, windowCoverageEnd) *
          4 *
          gameProfile.channelSelectionLoadPenalty;
      return scoreB - scoreA;
    });

    const plannedLaunches = [];
    const channelAttempts = [];

    for (const channel of targetChannels) {
      const candidate = {
        channelId: channel.id,
        game: req.game,
        audience: req.audience || "",
        platform: "АМ+АО",
        priority: req.priority,
        campaignType: "CRM акция",
        duration: getChannelDuration(channel),
      };

      const hardCheck = evaluateAssistantHardRules(candidate, compiled);
      if (hardCheck.blocked) {
        channelAttempts.push({
          channelId: channel.id,
          reason: "Заблокировано правилом ассистента",
          details: hardCheck.hits,
          blocked: true,
        });
        continue;
      }

      const dateOverride = getAssistantDateWindowOverride(req, channel.id, compiled);
      let effectiveStart = dateOverride?.start || windowStart;
      let effectiveEnd = dateOverride?.end || windowEnd;
      let effectiveLatestEnd = latestEndDate || "";
      const specialScheduleRule = buildKBAudienceScheduleRule(
        req,
        channel,
        pool,
        channels,
        effectiveStart
      );

      if (specialScheduleRule) {
        effectiveStart = specialScheduleRule.hardWindowStart;
        effectiveEnd = specialScheduleRule.hardWindowEnd;
        if (!effectiveLatestEnd || effectiveLatestEnd > specialScheduleRule.hardWindowEnd) {
          effectiveLatestEnd = specialScheduleRule.hardWindowEnd;
        }
      }

      const bestSlot = pickBestSlot({
        requirement: req,
        channel,
        windowStart: effectiveStart,
        windowEnd: effectiveEnd,
        latestEndDate: effectiveLatestEnd,
        existing: pool,
        compiled,
        maxPerDay,
        assistantDirectives,
        specialScheduleRule,
        performanceReports,
        channels,
      });

      if (!bestSlot) {
        channelAttempts.push({
          channelId: channel.id,
          reason: "Нет подходящего слота в окне дат",
        });
        continue;
      }

      const newLaunch = buildProposedLaunch({
        requirement: req,
        channel,
        bestSlot,
        effectiveStart,
        effectiveEnd,
        latestEndDate: effectiveLatestEnd,
        assistantDirectives,
        specialScheduleRule,
      });

      const issues = detectConflicts(newLaunch, pool, channels);
      newLaunch.issues = issues;
      newLaunch.conflictStatus = issues.length ? "conflict" : "ok";

      const launchIdentityKey = buildLaunchIdentityKey(newLaunch, channels);
      if (seenLaunchKeys.has(launchIdentityKey)) {
        channelAttempts.push({
          channelId: channel.id,
          reason: "Такой запуск уже есть в плане или среди существующих запусков",
          blocked: true,
          launch: newLaunch,
        });
        continue;
      }

      channelAttempts.push({
        channelId: channel.id,
        reason: "Канал подходит",
        score: bestSlot.score,
        launch: newLaunch,
      });
      plannedLaunches.push(newLaunch);
      proposed.push(newLaunch);
      pool.push(newLaunch);
      seenLaunchKeys.add(launchIdentityKey);
      coverageSet.add(channel.id);
    }

    if (!plannedLaunches.length) {
      skipped.push({
        req,
        reason: channelAttempts[0]?.reason || "Нет подходящего канала или слота",
        details: channelAttempts,
      });
      continue;
    }

    plannedLaunches.forEach((launch) => {
      launch._planningMeta = {
        ...launch._planningMeta,
        channelAttempts,
      };
    });

    if (plannedLaunches.length < targetChannels.length) {
      skipped.push({
        req,
        reason: "Не все каналы удалось поставить без пересечений",
        details: channelAttempts,
      });
    }
  }

  const optimizedProposed = optimizeProposedLaunches({
    proposed,
    requirements,
    channels,
    existingLaunches,
    compiled,
    maxPerDay,
    assistantDirectives,
    performanceReports,
  });

  const finalProposed = dedupeLaunchesByIdentity(optimizedProposed, channels);
  const skippedByRequirementId = new Map(
    skipped
      .filter((item) => item?.req?.id)
      .map((item) => [item.req.id, item])
  );
  const proposedCountByRequirementId = new Map();

  finalProposed.forEach((launch) => {
    const requirementId = launch?._fromRequirementId;
    if (!requirementId) return;
    proposedCountByRequirementId.set(
      requirementId,
      (proposedCountByRequirementId.get(requirementId) || 0) + 1
    );
  });

  const rebuiltSkipped = [];
  sorted.forEach((req) => {
    if (!PLANNABLE_REQUIREMENT_STATUSES.includes(req.status || "новое")) {
      return;
    }

    const { start, end } = getRequirementWindow(req);
    if (!start || !end) {
      rebuiltSkipped.push(
        skippedByRequirementId.get(req.id) || { req, reason: "Не задано окно дат" }
      );
      return;
    }

    const targetChannels = getRequirementTargetChannels(req, channels);
    if (!targetChannels.length) {
      rebuiltSkipped.push(
        skippedByRequirementId.get(req.id) || {
          req,
          reason: "Нет каналов для этого требования",
        }
      );
      return;
    }

    const plannedCount = proposedCountByRequirementId.get(req.id) || 0;
    const previousSkip = skippedByRequirementId.get(req.id);

    if (plannedCount === 0) {
      rebuiltSkipped.push(
        previousSkip || {
          req,
          reason: "Нет подходящего канала или слота",
        }
      );
      return;
    }

    if (plannedCount < targetChannels.length) {
      rebuiltSkipped.push({
        ...(previousSkip || {}),
        req,
        reason: "Не все каналы удалось поставить без пересечений",
        details: previousSkip?.details || [],
      });
    }
  });

  proposed.length = 0;
  proposed.push(...finalProposed);
  skipped.length = 0;
  skipped.push(...rebuiltSkipped);

  proposed.sort((a, b) => {
    const scoreDiff = Number(b._score || 0) - Number(a._score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return String(a.startDate || "").localeCompare(String(b.startDate || ""));
  });

  return { proposed, skipped };
}

export function recalcConflicts(launches, channels) {
  return recalculateAllConflicts(launches, channels);
}

export function buildFullScheduleDraft({ launches }) {
  return { plannedActions: [] };
}
