import { getChannelDisplayName, getChannelSubtitle, getChannelTitle } from "./crm-store";

export const EFFECTIVE_CHANNEL_CATALOG = [
  { key: "banner-home-square", title: "Баннер на главной", subtitle: "квадрат", duration: 5, aliases: ["баннер на главной квадрат"] },
  { key: "ghost-screen", title: "Экран-призрак", subtitle: "", duration: 5, aliases: ["экран призрак"] },
  { key: "wn-main", title: "What's New", subtitle: "главный", duration: 5, aliases: ["whats new главный", "what's new главный", "вн главная"] },
  { key: "popup-main", title: "Попап", subtitle: "главный", duration: 5, aliases: ["попап главный", "поп-ап главный"] },
  { key: "popup-payments", title: "Поп-ап", subtitle: "платежи", duration: 5, aliases: ["попап платежи", "поп-ап платежи"] },
  { key: "banner-payments", title: "Баннер на экране платежей", subtitle: "баннер-растяжка", duration: 5, aliases: ["баннер на экране платежей", "баннер растяжка платежи"] },
  { key: "trainer-success", title: "Тренер", subtitle: "на экране успеха", duration: 5, aliases: ["тренер на экране успеха"] },
  { key: "banner-success", title: "Баннер на экране успеха", subtitle: "", duration: 5, aliases: ["баннер на экране успеха"] },
  { key: "splash-benefit", title: "Сплэш-экран", subtitle: "выгода", duration: 5, aliases: ["сплэш экран выгода"] },
  { key: "wn-benefit", title: "What's New", subtitle: "выгода", duration: 5, aliases: ["whats new выгода", "what's new выгода", "вн выгода"] },
  { key: "megabanner-benefit", title: "Мегабаннер", subtitle: "Моя выгода", duration: 5, aliases: ["мегабаннер моя выгода"] },
  { key: "megabanner-showcase", title: "Мегабаннер", subtitle: "витрина", duration: 5, aliases: ["мегабаннер витрина", "мегабанннер витрина"] },
  { key: "markdown-longread", title: "Маркдаун", subtitle: "Лонгрид", duration: 5, aliases: ["маркдаун лонгрид", "лонгрид"] },
  { key: "carousel", title: "Карусель", subtitle: "", duration: 5, aliases: ["карусель"] },
  { key: "banner-cashback-categories", title: "Баннер", subtitle: "категории кэшбэка", duration: 5, aliases: ["баннер категории кэшбэка"] },
  { key: "popup-history", title: "Поп-ап", subtitle: "история операций", duration: 5, aliases: ["попап история операций", "поп-ап история операций"] },
  { key: "trainer-history", title: "Тренер", subtitle: "над историей операций", duration: 5, aliases: ["тренер над историей операций"] },
  { key: "banner-history", title: "Баннер над историей операций", subtitle: "баннер-растяжка", duration: 5, aliases: ["баннер над историей операций", "баннер растяжка история операций"] },
  { key: "push", title: "Пуш", subtitle: "", duration: 2, aliases: ["пуш", "push"] },
  { key: "email", title: "E-mail", subtitle: "", duration: 5, aliases: ["e-mail", "email"] },
  { key: "digital-ticket", title: "Цифровой талон", subtitle: "", duration: 5, aliases: ["цифровой талон"] },
  { key: "chat-stories", title: "Сториз", subtitle: "в Чатах", duration: 5, aliases: ["сториз в чатах"] },
];

function normalizeLooseText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/what's/g, "whats")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim();
}

export function getChannelIdentityKey(channel) {
  const matchedEntry = findCatalogEntryForChannel(channel);
  if (matchedEntry?.key) {
    return `catalog:${matchedEntry.key}`;
  }

  const title = normalizeLooseText(getChannelTitle(channel));
  const subtitle = normalizeLooseText(getChannelSubtitle(channel));
  const displayName = normalizeLooseText(getChannelDisplayName(channel));
  const fallback = [title, subtitle].filter(Boolean).join("|") || displayName;

  return fallback ? `custom:${fallback}` : `id:${channel?.id || ""}`;
}

function getSearchTexts(channel) {
  const title = getChannelTitle(channel);
  const subtitle = getChannelSubtitle(channel);
  const displayName = getChannelDisplayName(channel);
  return [
    title,
    subtitle,
    displayName,
    `${title} ${subtitle}`.trim(),
    channel?.name || "",
  ]
    .map(normalizeLooseText)
    .filter(Boolean);
}

export function buildCatalogChannel(entry) {
  return {
    id: `catalog-channel-${entry.key}`,
    title: entry.title,
    subtitle: entry.subtitle,
    name: [entry.title, entry.subtitle].filter(Boolean).join(" / "),
    duration: entry.duration || 5,
    iosMinVersion: "All",
    iosMaxVersion: "All",
    androidMinVersion: "All",
    androidMaxVersion: "All",
  };
}

export function findCatalogEntryForChannel(channel) {
  const searchTexts = getSearchTexts(channel);

  return (
    EFFECTIVE_CHANNEL_CATALOG.find((entry) => {
      const candidates = [
        normalizeLooseText(entry.title),
        normalizeLooseText(entry.subtitle),
        normalizeLooseText([entry.title, entry.subtitle].filter(Boolean).join(" ")),
        ...(entry.aliases || []).map(normalizeLooseText),
      ].filter(Boolean);

      return searchTexts.some((text) => candidates.includes(text));
    }) || null
  );
}

export function getCatalogChannelEffectiveness(channel) {
  const entry = findCatalogEntryForChannel(channel);
  if (!entry) return null;

  const index = EFFECTIVE_CHANNEL_CATALOG.findIndex((item) => item.key === entry.key);
  if (index < 0) return null;

  const score = EFFECTIVE_CHANNEL_CATALOG.length - index;
  return {
    entry,
    rank: index + 1,
    score,
    description: `Канал входит в утверждённый CRM-рейтинг эффективности и стоит на ${index + 1}-м месте из ${EFFECTIVE_CHANNEL_CATALOG.length}.`,
  };
}

export function getMissingCatalogChannels(channels = []) {
  return EFFECTIVE_CHANNEL_CATALOG.filter((entry) => {
    return !channels.some((channel) => {
      const match = findCatalogEntryForChannel(channel);
      return match?.key === entry.key;
    });
  }).map(buildCatalogChannel);
}
