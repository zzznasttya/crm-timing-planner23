function normalizeString(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function scopeMatches(rule, candidate) {
  const scope = rule.scope || {};

  if (
    scope.game &&
    normalizeString(scope.game) !== normalizeString(candidate.game)
  ) {
    return false;
  }

  if (
    scope.audience &&
    normalizeString(scope.audience) !== normalizeString(candidate.audience)
  ) {
    return false;
  }

  if (
    scope.channelId &&
    normalizeString(scope.channelId) !== normalizeString(candidate.channelId)
  ) {
    return false;
  }

  return true;
}

export function compileAssistantRules(rules = []) {
  const activeRules = rules.filter(
    (rule) => rule.enabled !== false && rule.status === "active"
  );

  const hardExclusionPredicates = [];
  const scoreAdjusters = [];
  const limitOverrides = {
    daily: {},
  };
  const dateBindings = [];
  const uiPreferences = {};

  activeRules.forEach((rule) => {
    if (rule.type === "channel_exclusion") {
      const excluded = Array.isArray(rule.payload?.excludedChannelIds)
        ? rule.payload.excludedChannelIds
        : [];

      hardExclusionPredicates.push((candidate) => {
        if (!scopeMatches(rule, candidate)) return null;
        if (!excluded.includes(candidate.channelId)) return null;

        return {
          blocked: true,
          hit: {
            ruleId: rule.id,
            effect: "candidate_excluded",
            notes: "Канал исключён правилом ассистента",
          },
        };
      });
    }

    if (rule.type === "channel_priority") {
      const weights = rule.payload?.weights || {};

      scoreAdjusters.push((candidate) => {
        if (!scopeMatches(rule, candidate)) return null;

        const delta = Number(weights[candidate.channelId] || 0);
        if (!delta) return null;

        return {
          delta,
          hit: {
            ruleId: rule.id,
            effect: delta > 0 ? "score_boost" : "score_penalty",
            deltaScore: delta,
            notes: "Приоритет канала задан ассистентом",
          },
        };
      });
    }

    if (rule.type === "daily_limit") {
      if (Number.isFinite(Number(rule.payload?.maxLaunchesPerDay))) {
        limitOverrides.daily.maxLaunchesPerDay = Number(
          rule.payload.maxLaunchesPerDay
        );
      }
    }

    if (rule.type === "hard_date_binding") {
      dateBindings.push(rule);
    }

    if (rule.type === "auto_apply_preference") {
      uiPreferences.autoApplyDraft = rule.payload?.autoApplyDraft || "prompt";
    }
  });

  return {
    activeRules,
    hardExclusionPredicates,
    scoreAdjusters,
    limitOverrides,
    dateBindings,
    uiPreferences,
  };
}

export function getAssistantDateWindowOverride(
  requirement,
  candidateChannelId,
  compiled
) {
  if (!compiled?.dateBindings?.length) return null;

  const matched = compiled.dateBindings.find((rule) => {
    const scope = rule.scope || {};

    if (
      scope.game &&
      normalizeString(scope.game) !== normalizeString(requirement.game)
    ) {
      return false;
    }

    if (
      scope.audience &&
      normalizeString(scope.audience) !== normalizeString(requirement.audience)
    ) {
      return false;
    }

    if (
      scope.channelId &&
      normalizeString(scope.channelId) !== normalizeString(candidateChannelId)
    ) {
      return false;
    }

    return true;
  });

  if (!matched) return null;

  return {
    start: matched.payload?.windowStart || null,
    end: matched.payload?.windowEnd || matched.payload?.windowStart || null,
    ruleId: matched.id,
  };
}

export function evaluateAssistantHardRules(candidate, compiled) {
  const hits = [];

  for (const predicate of compiled?.hardExclusionPredicates || []) {
    const result = predicate(candidate);
    if (result?.blocked) {
      if (result.hit) hits.push(result.hit);
      return {
        blocked: true,
        hits,
      };
    }
  }

  return {
    blocked: false,
    hits,
  };
}

export function evaluateAssistantScoreAdjustments(candidate, compiled) {
  let delta = 0;
  const hits = [];

  for (const adjuster of compiled?.scoreAdjusters || []) {
    const result = adjuster(candidate);
    if (!result) continue;

    delta += Number(result.delta || 0);
    if (result.hit) hits.push(result.hit);
  }

  return {
    delta,
    hits,
  };
}
