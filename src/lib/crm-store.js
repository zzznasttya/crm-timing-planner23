import { useEffect, useState } from "react";
import { normalizeAudience } from "./requirements-domain";
export { GAMES } from "./game-catalog";

const STORAGE_KEY = "crm-store-v1";
const IMPROVEMENT_IDEAS_STORAGE_KEY = "crm-improvement-ideas-v1";
const DEFAULT_PREFERENCES = {
  autoActivateHighConfidenceRules: false,
  confidenceThreshold: 0.8,
};

function isWinnersAudience(value) {
  return normalizeAudience(value || "") === "победители";
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function save(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function loadImprovementIdeas(persisted = {}) {
  try {
    const dedicatedRaw = localStorage.getItem(IMPROVEMENT_IDEAS_STORAGE_KEY);
    if (dedicatedRaw) {
      const parsed = JSON.parse(dedicatedRaw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}

  return Array.isArray(persisted.improvementIdeas)
    ? persisted.improvementIdeas
    : [];
}

function saveImprovementIdeas(ideas) {
  try {
    localStorage.setItem(
      IMPROVEMENT_IDEAS_STORAGE_KEY,
      JSON.stringify(Array.isArray(ideas) ? ideas : [])
    );
  } catch {}
}

export function calculateEndDate(startDate, duration) {
  if (!startDate) return "";

  const totalDays = Math.max(1, Number(duration) || 1);
  const match = String(startDate)
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";

  const [, yyyy, mm, dd] = match;
  const start = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  if (Number.isNaN(start.getTime())) return "";

  start.setDate(start.getDate() + totalDays - 1);

  const endYear = start.getFullYear();
  const endMonth = String(start.getMonth() + 1).padStart(2, "0");
  const endDay = String(start.getDate()).padStart(2, "0");
  return `${endYear}-${endMonth}-${endDay}`;
}

export function calculateLatestAllowedStartDate(latestEndDate, duration) {
  if (!latestEndDate) return "";

  const totalDays = Math.max(1, Number(duration) || 1);
  const match = String(latestEndDate)
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";

  const [, yyyy, mm, dd] = match;
  const latestEnd = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  if (Number.isNaN(latestEnd.getTime())) return "";

  latestEnd.setDate(latestEnd.getDate() - (totalDays - 1));

  const startYear = latestEnd.getFullYear();
  const startMonth = String(latestEnd.getMonth() + 1).padStart(2, "0");
  const startDay = String(latestEnd.getDate()).padStart(2, "0");
  return `${startYear}-${startMonth}-${startDay}`;
}

export function formatDisplayDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "—";

  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, yyyy, mm, dd] = match;
    return `${dd}.${mm}.${yyyy.slice(2)}`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;

  const dd = String(parsed.getDate()).padStart(2, "0");
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const yy = String(parsed.getFullYear()).slice(2);
  return `${dd}.${mm}.${yy}`;
}

export function getChannelTitle(channel = {}) {
  return channel.title || channel.name || "";
}

export function getChannelSubtitle(channel = {}) {
  return channel.subtitle || "";
}

export function getChannelDisplayName(channel = {}) {
  const title = getChannelTitle(channel).trim();
  const subtitle = getChannelSubtitle(channel).trim();

  if (title && subtitle) return `${title} / ${subtitle}`;
  if (title) return title;
  if (subtitle) return subtitle;
  return "";
}

export function getChannelName(channelId, channels = []) {
  const channel = channels.find((item) => item.id === channelId);
  return getChannelDisplayName(channel) || "—";
}

export function calculateCRMPressure(dayString, launches = []) {
  return launches.filter(
    (launch) =>
      launch.planningStatus !== "приостановлено" &&
      launch.startDate &&
      launch.endDate &&
      dayString >= launch.startDate &&
      dayString <= launch.endDate
  ).length;
}

export function detectConflicts(launch, launches = [], channels = []) {
  const issues = [];
  const currentAudience = normalizeAudience(launch.audience || "");

  if (!launch.channelId) {
    issues.push("Не выбран канал");
  }

  if (!launch.startDate || !launch.endDate) {
    issues.push("Не задан период запуска");
  }

  if (launch.startDate && launch.endDate && launch.startDate > launch.endDate) {
    issues.push("Дата окончания раньше даты старта");
  }

  if (isWinnersAudience(currentAudience)) {
    return issues;
  }

  const overlaps = launches.filter((item) => {
    if (!item || item.id === launch.id) return false;
    if (!item.startDate || !item.endDate || !launch.startDate || !launch.endDate) {
      return false;
    }

    const intersects =
      item.startDate <= launch.endDate && item.endDate >= launch.startDate;
    if (!intersects) return false;

    if (item.channelId !== launch.channelId) return false;

    const otherAudience = normalizeAudience(item.audience || "");
    if (isWinnersAudience(otherAudience)) return false;
    return !currentAudience || !otherAudience || currentAudience === otherAudience;
  });

  if (overlaps.length) {
    issues.push("Пересечение по каналу и аудитории");
  }

  return issues;
}

export function useCRMStore() {
  const persisted = load();

  const [launches, setLaunches] = useState(persisted.launches || []);
  const [channels, setChannels] = useState(persisted.channels || []);
  const [performanceReports, setPerformanceReports] = useState(
    Array.isArray(persisted.performanceReports) ? persisted.performanceReports : []
  );
  const [requirements, setRequirements] = useState(
    persisted.requirements || []
  );
  const [improvementIdeas, setImprovementIdeas] = useState(
    loadImprovementIdeas(persisted)
  );
  const [messages, setMessages] = useState(persisted.messages || []);
  const [rules, setRules] = useState(
    Array.isArray(persisted.rules) ? persisted.rules : []
  );
  const [preferences, setPreferences] = useState({
    ...DEFAULT_PREFERENCES,
    ...(persisted.preferences || {}),
  });

  useEffect(() => {
    save({
      launches,
      channels,
      performanceReports,
      requirements,
      improvementIdeas,
      messages,
      rules,
      preferences,
    });
  }, [
    launches,
    channels,
    performanceReports,
    requirements,
    improvementIdeas,
    messages,
    rules,
    preferences,
  ]);

  useEffect(() => {
    saveImprovementIdeas(improvementIdeas);
  }, [improvementIdeas]);

  // ───── Launches ─────
  function addLaunch(launch) {
    setLaunches((prev) => [...prev, launch]);
  }

  function updateLaunch(launch) {
    setLaunches((prev) => prev.map((l) => (l.id === launch.id ? launch : l)));
  }

  function deleteLaunch(id) {
    setLaunches((prev) => prev.filter((l) => l.id !== id));
  }

  // 🔥 ключевой фикс для undo
  function replaceLaunches(nextLaunches) {
    setLaunches(Array.isArray(nextLaunches) ? nextLaunches : []);
  }

  // ───── Channels ─────
  function addChannel(channel) {
    setChannels((prev) => [...prev, channel]);
  }

  function updateChannel(channel) {
    setChannels((prev) => prev.map((c) => (c.id === channel.id ? channel : c)));
  }

  function deleteChannel(id) {
    setChannels((prev) => prev.filter((c) => c.id !== id));
  }

  function replaceChannels(nextChannels) {
    setChannels(Array.isArray(nextChannels) ? nextChannels : []);
  }

  // ───── Requirements ─────
  function addRequirement(req) {
    setRequirements((prev) => [...prev, req]);
  }

  function updateRequirement(req) {
    setRequirements((prev) => prev.map((r) => (r.id === req.id ? req : r)));
  }

  function deleteRequirement(id) {
    setRequirements((prev) => prev.filter((r) => r.id !== id));
  }

  function replaceRequirements(nextRequirements) {
    setRequirements(Array.isArray(nextRequirements) ? nextRequirements : []);
  }

  // ───── Improvement ideas ─────
  function addImprovementIdea(idea) {
    setImprovementIdeas((prev) => [...prev, idea]);
  }

  function updateImprovementIdea(idea) {
    setImprovementIdeas((prev) =>
      prev.map((item) => (item.id === idea.id ? idea : item))
    );
  }

  function deleteImprovementIdea(id) {
    setImprovementIdeas((prev) => prev.filter((item) => item.id !== id));
  }

  function replaceImprovementIdeas(nextIdeas) {
    setImprovementIdeas(Array.isArray(nextIdeas) ? nextIdeas : []);
  }

  return {
    launches,
    channels,
    performanceReports,
    requirements,
    improvementIdeas,
    messages,
    rules,
    preferences,

    addLaunch,
    updateLaunch,
    deleteLaunch,
    replaceLaunches,

    addChannel,
    updateChannel,
    deleteChannel,
    replaceChannels,

    setPerformanceReports,

    addRequirement,
    updateRequirement,
    deleteRequirement,
    replaceRequirements,

    addImprovementIdea,
    updateImprovementIdea,
    deleteImprovementIdea,
    replaceImprovementIdeas,

    setMessages,
    setRules,
    setPreferences,
  };
}
