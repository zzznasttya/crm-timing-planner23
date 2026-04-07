import { useEffect, useState } from "react";
import { normalizeAudience } from "./requirements-domain";
export { GAMES } from "./game-catalog";

const STORAGE_KEY = "crm-store-v1";
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

export function calculateEndDate(startDate, duration) {
  if (!startDate) return "";

  const totalDays = Math.max(1, Number(duration) || 1);
  const start = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(start.getTime())) return "";

  start.setDate(start.getDate() + totalDays - 1);
  return start.toISOString().slice(0, 10);
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
      messages,
      rules,
      preferences,
    });
  }, [launches, channels, performanceReports, requirements, messages, rules, preferences]);

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

  return {
    launches,
    channels,
    performanceReports,
    requirements,
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

    setPerformanceReports,

    addRequirement,
    updateRequirement,
    deleteRequirement,
    replaceRequirements,

    setMessages,
    setRules,
    setPreferences,
  };
}
