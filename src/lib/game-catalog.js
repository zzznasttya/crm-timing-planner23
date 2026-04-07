export const GAME_CATALOG = [
  { name: "Матрёшки", planningType: "kb_utilization" },
  { name: "Суперигра", planningType: "kb_utilization" },
  { name: "КНБ", planningType: "kb_utilization" },
  { name: "Пуш и куш", planningType: "anchor_action" },
  { name: "Алхимия", planningType: "anchor_action" },
];

export const GAMES = GAME_CATALOG.map((item) => item.name);

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е");
}

export function getGamePlanningProfile(gameName) {
  const normalized = normalizeText(gameName);
  const matched = GAME_CATALOG.find(
    (item) => normalizeText(item.name) === normalized
  );

  if (matched?.planningType === "kb_utilization") {
    return {
      type: "kb_utilization",
      label: "Игра на утилизацию КБ",
      effectivenessMultiplier: 1.35,
      channelSelectionEffectivenessWeight: 1.45,
      channelSelectionLoadPenalty: 0.55,
      channelSelectionCoverageBonus: 2,
      pressurePenaltyMultiplier: 0.85,
      channelLoadPenaltyMultiplier: 0.9,
      spacingMultiplier: 0.9,
      defaultPositioning: "early",
      description:
        "Для игр на утилизацию КБ планировщик сильнее тянется к конверсионным каналам и более ранним слотам внутри окна.",
    };
  }

  if (matched?.planningType === "anchor_action") {
    return {
      type: "anchor_action",
      label: "Игра на якорное действие",
      effectivenessMultiplier: 0.95,
      channelSelectionEffectivenessWeight: 1.05,
      channelSelectionLoadPenalty: 1.35,
      channelSelectionCoverageBonus: 6,
      pressurePenaltyMultiplier: 1.15,
      channelLoadPenaltyMultiplier: 1.15,
      spacingMultiplier: 1.4,
      defaultPositioning: "balanced",
      description:
        "Для игр на якорное действие планировщик осторожнее относится к перегрузке и сильнее разносит коммуникации.",
    };
  }

  return {
    type: "default",
    label: "Базовая логика",
    effectivenessMultiplier: 1,
    channelSelectionEffectivenessWeight: 1,
    channelSelectionLoadPenalty: 1,
    channelSelectionCoverageBonus: 4,
    pressurePenaltyMultiplier: 1,
    channelLoadPenaltyMultiplier: 1,
    spacingMultiplier: 1,
    defaultPositioning: "balanced",
    description: "Для игры используется базовая логика планирования.",
  };
}
