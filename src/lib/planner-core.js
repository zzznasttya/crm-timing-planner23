import { format, parseISO, eachDayOfInterval } from "date-fns";
import {
  detectConflicts,
  calculateEndDate,
  formatDisplayDate,
} from "./crm-store";
import { normalizeAudience } from "./requirements-domain";
import {
  compileAssistantRules,
  evaluateAssistantHardRules,
  evaluateAssistantScoreAdjustments,
  getAssistantDateWindowOverride,
} from "./assistant/rule-engine";

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

function getChannelDuration(channel) {
  return Math.max(1, Number(channel?.duration) || 5);
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

function getChannelHistoryStats(channelId, launches) {
  const history = launches.filter(
    (launch) =>
      launch.channelId === channelId &&
      launch.startDate &&
      launch.planningStatus !== "приостановлено"
  );
  const launched = history.filter((launch) => isLaunchedStatus(launch.planningStatus));
  const measured = launched.filter((launch) => Number(launch.sentBaseCount) > 0);

  const recentCutoff = new Date();
  recentCutoff.setDate(recentCutoff.getDate() - 90);

  const recentLaunched = launched.filter((launch) => {
    const date = parseISO(launch.startDate);
    return !Number.isNaN(date.getTime()) && date >= recentCutoff;
  });

  const averageSentBase = measured.length
    ? measured.reduce((sum, launch) => sum + Number(launch.sentBaseCount || 0), 0) /
      measured.length
    : 0;

  return {
    historyCount: history.length,
    launchedCount: launched.length,
    measuredCount: measured.length,
    recentLaunchedCount: recentLaunched.length,
    averageSentBase,
  };
}

function scoreChannelEffectiveness(channelId, launches) {
  const stats = getChannelHistoryStats(channelId, launches);

  if (!stats.historyCount) {
    return {
      score: 6,
      description: "По каналу пока нет истории, используется нейтральная оценка.",
      tone: "neutral",
    };
  }

  const completionRatio = stats.launchedCount / Math.max(1, stats.historyCount);
  const completionScore = completionRatio * 6;
  const recencyScore = Math.min(6, stats.recentLaunchedCount * 1.5);
  const baseScore = stats.measuredCount
    ? Math.min(10, Math.log10(stats.averageSentBase + 1) * 2.2)
    : 4;
  const total = Number((completionScore + recencyScore + baseScore).toFixed(1));

  const descriptionParts = [
    `История запусков: ${stats.launchedCount} из ${stats.historyCount}.`,
  ];

  if (stats.measuredCount > 0) {
    descriptionParts.push(
      `Средняя база коммуникаций: ${Math.round(stats.averageSentBase).toLocaleString("ru-RU")}.`
    );
  } else {
    descriptionParts.push("База коммуникаций по завершённым запускам пока не указана.");
  }

  if (stats.recentLaunchedCount > 0) {
    descriptionParts.push(`За последние 90 дней запущено: ${stats.recentLaunchedCount}.`);
  }

  return {
    score: total,
    description: descriptionParts.join(" "),
    tone: total >= 12 ? "positive" : total >= 7 ? "neutral" : "negative",
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
  existing,
  compiled,
  maxPerDay,
  assistantDirectives,
}) {
  const endDate = calculateEndDate(candidate.startDate, candidate.duration);
  if (!endDate) return null;

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
  let placementPreferenceScore;
  if (assistantDirectives?.timingBias === "early") {
    placementPreferenceScore = (1 - normalizedPosition) * 16;
  } else if (assistantDirectives?.timingBias === "late") {
    placementPreferenceScore = normalizedPosition * 16;
  } else {
    placementPreferenceScore =
      priorityTier === "high"
        ? (1 - normalizedPosition) * 18
        : priorityTier === "medium"
        ? (1 - Math.abs(normalizedPosition - 0.35)) * 10
        : normalizedPosition * 8;
  }

  const pressurePenaltyMultiplier =
    assistantDirectives?.densityMode === "aggressive"
      ? 2
      : assistantDirectives?.densityMode === "conservative"
      ? 5
      : 4;

  const pressureScore = Math.max(
    0,
    14 - startDayPressure * pressurePenaltyMultiplier
  );

  const channelLoadScore = Math.max(
    0,
    14 -
      channelStartPressure * 4 -
      channelPeakPressure * 2 -
      channelWindowLoadRatio * 8
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
      : Math.min(16, Math.max(0, sameGameGap - 2) * spacingMultiplier);

  const assistantScore = evaluateAssistantScoreAdjustments(candidate, compiled);
  const effectiveness = scoreChannelEffectiveness(channel.id, existing);
  const effectivenessWeight = getEffectivenessPriorityWeight(priorityTier);
  const weightedEffectivenessScore = effectiveness.score * effectivenessWeight;

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
      "Конверсионность канала",
      weightedEffectivenessScore,
      priorityTier === "high"
        ? `Для высокого приоритета планировщик сильнее тянется к более эффективным каналам. ${effectiveness.description}`
        : effectiveness.description,
      effectiveness.tone
    ),
  ];

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
  existing,
  compiled,
  maxPerDay,
  assistantDirectives,
}) {
  const dates = dateRange(windowStart, windowEnd);
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
      windowEnd,
      existing,
      compiled,
      maxPerDay,
      assistantDirectives,
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
    "Платформа",
    "База",
    "Приоритет",
    "Статус",
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
    "Дата с",
    "Дата до",
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
  assistantContext = {},
}) {
  const compiled = compileAssistantRules(rules);
  const assistantDirectives = deriveAssistantPlanningDirectives(assistantContext);
  const maxPerDay = compiled.limitOverrides?.daily?.maxLaunchesPerDay ?? null;
  const pool = [...existingLaunches];
  const proposed = [];
  const skipped = [];
  const weeklyCoverage = new Map();

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
    if (req.status === "отклонено") continue;

    let windowStart;
    let windowEnd;

    if (req.hasFixedDates === "yes" && req.fixedStartDate) {
      windowStart = req.fixedStartDate;
      windowEnd = req.fixedEndDate || req.fixedStartDate;
    } else {
      windowStart = req.weekStart;
      windowEnd = req.weekEnd;
    }

    if (!windowStart || !windowEnd) {
      skipped.push({ req, reason: "Не задано окно дат" });
      continue;
    }

    const coverageSet = getWeekCoverageSet(
      req.weekStart || windowStart,
      req.weekEnd || windowEnd
    );

    let targetChannels = [...channels];
    if (Array.isArray(req.channelIds) && req.channelIds.length > 0) {
      targetChannels = targetChannels.filter((channel) =>
        req.channelIds.includes(channel.id)
      );
    } else {
      const uncoveredChannels = targetChannels.filter(
        (channel) => !coverageSet.has(channel.id)
      );
      if (uncoveredChannels.length > 0) {
        targetChannels = uncoveredChannels;
      }
    }

    if (targetChannels.length === 0) {
      skipped.push({
        req,
        reason: "Нет каналов для этого требования",
      });
      continue;
    }

    const priorityTier = getPriorityTier(req.priority);
    targetChannels = [...targetChannels].sort((a, b) => {
      const scoreA =
        scoreChannelEffectiveness(a.id, pool).score *
        getEffectivenessPriorityWeight(priorityTier);
      const scoreB =
        scoreChannelEffectiveness(b.id, pool).score *
        getEffectivenessPriorityWeight(priorityTier);
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
      const effectiveStart = dateOverride?.start || windowStart;
      const effectiveEnd = dateOverride?.end || windowEnd;

      const bestSlot = pickBestSlot({
        requirement: req,
        channel,
        windowStart: effectiveStart,
        windowEnd: effectiveEnd,
        existing: pool,
        compiled,
        maxPerDay,
        assistantDirectives,
      });

      if (!bestSlot) {
        channelAttempts.push({
          channelId: channel.id,
          reason: "Нет подходящего слота в окне дат",
        });
        continue;
      }

      const newLaunch = {
        id: `proposed-${channel.id}-${req.id}-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 6)}`,
        game: req.game,
        channelId: channel.id,
        startDate: bestSlot.startDate,
        endDate: bestSlot.endDate,
        duration: candidate.duration,
        platform: "АМ+АО",
        audience: candidate.audience,
        priority: normalizeLaunchPriority(req.priority),
        planningStatus: "бэклог",
        sentBaseCount: "",
        campaignType: "CRM акция",
        comment: req.comment
          ? `[Авто] ${req.comment}`
          : "[Авто] Сгенерировано умным планировщиком",
        issues: [],
        conflictStatus: "ok",
        earliestStartDate: effectiveStart,
        latestStartDate: effectiveEnd,
        manager: "",
        _fromRequirementId: req.id,
        _score: bestSlot.score,
        _planningMeta: {
          score: bestSlot.score,
          breakdown: bestSlot.breakdown,
          appliedRules: bestSlot.appliedRules,
          alternatives: bestSlot.alternatives,
          windowStart: effectiveStart,
          windowEnd: effectiveEnd,
          channelId: channel.id,
          assistantDirectives,
        },
      };

      const issues = detectConflicts(newLaunch, pool, channels);
      newLaunch.issues = issues;
      newLaunch.conflictStatus = issues.length ? "conflict" : "ok";
      channelAttempts.push({
        channelId: channel.id,
        reason: "Канал подходит",
        score: bestSlot.score,
        launch: newLaunch,
      });
      plannedLaunches.push(newLaunch);
      proposed.push(newLaunch);
      pool.push(newLaunch);
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
