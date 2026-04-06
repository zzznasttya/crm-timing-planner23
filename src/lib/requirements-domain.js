export const PRIORITY_OPTIONS = ["0", "1", "2", "3", "4", "5"];
export const REQUIREMENT_STATUS_OPTIONS = [
  "новое",
  "в работе",
  "согласовано",
  "отклонено",
];
export const AUDIENCE_OPTIONS = [
  "АКБ",
  "победители",
  "РГ",
  "стафф",
  "500 к",
  "реестр",
  "клиенты с план. начислением КБ",
  "клиенты с остатками КБ",
];

const DEFAULT_GAME = "Матрёшки";

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function formatDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function getMonday(dateString) {
  const date = dateString ? new Date(dateString) : new Date();
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(date.getDate() + diff);
  return monday;
}

export function getWeekRange(startDate) {
  const monday = getMonday(startDate);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  return {
    weekStart: formatDate(monday),
    weekEnd: formatDate(sunday),
  };
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function buildWeekOptions() {
  const todayMonday = getMonday();
  const startBase = addDays(todayMonday, -7 * 12);
  const options = [];

  for (let i = 0; i < 80; i += 1) {
    const weekStartDate = addDays(startBase, i * 7);
    const weekEndDate = addDays(weekStartDate, 6);

    options.push({
      value: formatDate(weekStartDate),
      weekStart: formatDate(weekStartDate),
      weekEnd: formatDate(weekEndDate),
      label: `${formatDate(weekStartDate)} - ${formatDate(weekEndDate)}`,
    });
  }

  return options;
}

export const WEEK_OPTIONS = buildWeekOptions();

export function normalizePriority(value) {
  const normalized = String(value ?? "").trim();
  return PRIORITY_OPTIONS.includes(normalized) ? normalized : "3";
}

export function normalizeFixedDateMode(value) {
  return value === "yes" ? "yes" : "no";
}

export function normalizeChannelIds(requirement) {
  if (Array.isArray(requirement?.channelIds)) {
    return requirement.channelIds.filter(Boolean);
  }

  if (requirement?.channelId) {
    return [requirement.channelId];
  }

  return [];
}

export function normalizeAudience(value) {
  const raw = String(value || "").trim();
  if (!raw) return AUDIENCE_OPTIONS[0];

  const normalized = normalizeText(raw);
  const match = AUDIENCE_OPTIONS.find(
    (option) => normalizeText(option) === normalized
  );
  if (match) return match;

  if (normalized === "акб") return "АКБ";
  if (normalized === "рг") return "РГ";
  return raw;
}

export function getClosestWeekStart(weekStart) {
  if (!weekStart) {
    return (
      WEEK_OPTIONS.find(
        (item) =>
          item.weekStart === getWeekRange(formatDate(getMonday())).weekStart
      )?.weekStart || WEEK_OPTIONS[0].weekStart
    );
  }

  const exact = WEEK_OPTIONS.find((item) => item.weekStart === weekStart);
  if (exact) return exact.weekStart;

  const normalized = getWeekRange(weekStart).weekStart;
  const normalizedExact = WEEK_OPTIONS.find(
    (item) => item.weekStart === normalized
  );
  if (normalizedExact) return normalizedExact.weekStart;

  return WEEK_OPTIONS[0].weekStart;
}

export function createEmptyRequirement() {
  const todayMonday = getMonday();
  const range = getWeekRange(formatDate(todayMonday));

  return {
    id: `requirement-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    weekStart: range.weekStart,
    weekEnd: range.weekEnd,
    game: DEFAULT_GAME,
    channelIds: [],
    audience: AUDIENCE_OPTIONS[0],
    priority: "3",
    hasFixedDates: "no",
    fixedStartDate: "",
    fixedEndDate: "",
    desiredResult: "",
    comment: "",
    status: "новое",
  };
}

export function normalizeRequirement(item) {
  const safeWeekStart = getClosestWeekStart(
    item?.weekStart || formatDate(getMonday())
  );
  const safeRange = getWeekRange(safeWeekStart);
  const hasFixedDates = normalizeFixedDateMode(item?.hasFixedDates);
  const fixedStartDate =
    hasFixedDates === "yes" ? String(item?.fixedStartDate || "").trim() : "";
  const fixedEndDate =
    hasFixedDates === "yes"
      ? String(item?.fixedEndDate || item?.fixedStartDate || "").trim()
      : "";

  return {
    id:
      item?.id ||
      `requirement-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    weekStart: safeRange.weekStart,
    weekEnd: safeRange.weekEnd,
    game: item?.game || DEFAULT_GAME,
    channelIds: normalizeChannelIds(item),
    audience: normalizeAudience(item?.audience),
    priority: normalizePriority(item?.priority),
    hasFixedDates,
    fixedStartDate,
    fixedEndDate,
    desiredResult: item?.desiredResult || "",
    comment: item?.comment || "",
    status: REQUIREMENT_STATUS_OPTIONS.includes(item?.status)
      ? item.status
      : "новое",
  };
}

export function getRequirementFingerprint(item) {
  const normalized = normalizeRequirement(item);
  return JSON.stringify({
    game: normalized.game,
    channelIds: [...normalized.channelIds].sort(),
    audience: normalizeText(normalized.audience),
    priority: normalized.priority,
    hasFixedDates: normalized.hasFixedDates,
    fixedStartDate: normalized.fixedStartDate,
    fixedEndDate: normalized.fixedEndDate,
    weekStart: normalized.weekStart,
    weekEnd: normalized.weekEnd,
    comment: normalizeText(normalized.comment),
  });
}
