export function parseRuleFromText(text) {
  if (!text) return null;

  const normalized = text.toLowerCase();

  // === 1. лимит пушей в неделю ===
  const weeklyMatch = normalized.match(/(\d+)\s*пуш[аов]*\s*в\s*неделю/);

  if (weeklyMatch) {
    const limit = Number(weeklyMatch[1]);

    const days = [];

    if (normalized.includes("пн")) days.push(1);
    if (normalized.includes("вт")) days.push(2);
    if (normalized.includes("ср")) days.push(3);
    if (normalized.includes("чт")) days.push(4);
    if (normalized.includes("пт")) days.push(5);
    if (normalized.includes("сб")) days.push(6);
    if (normalized.includes("вс")) days.push(0);

    return {
      type: "limit",
      scope: "weekly",
      value: limit,
      constraints: { days },
      description: text,
    };
  }

  // === 2. минимум 1 запуск канала в неделю ===
  if (
    normalized.includes("каждый") &&
    normalized.includes("канал") &&
    normalized.includes("недел")
  ) {
    return {
      type: "channel_min_per_week",
      value: 1,
      description: text,
    };
  }

  return null;
}
