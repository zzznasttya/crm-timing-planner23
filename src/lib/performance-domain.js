import { getChannelDisplayName } from "./crm-store";

const GAME_NAME_MAP = {
  ALCHEMY: "Алхимия",
  KNB: "КНБ",
  SUPERGAME: "Суперигра",
  SUPERIGRA: "Суперигра",
  MATR: "Матрёшки",
  MATRESHKA: "Матрёшки",
  MATRYOSHKI: "Матрёшки",
  ASSOCIATIONS: "Ассоциации",
  DD: "Денежный дождь",
  DOM: "Дом",
  DP: "DP",
  ETAGI: "Этажи",
  KUSH: "Куш",
  MMB: "ММБ",
  MOSHENNIKI: "Мошенники",
  NEIROOFFICE: "Нейроофис",
  NEIROOFICE2: "Нейроофис 2",
  PUSH: "Пуш",
  SMS: "SMS",
  ULET: "Улет",
  ULOVKI: "Уловки",
  WN: "What’s New",
  "100SEC": "100 секунд",
  "100sec": "100 секунд",
};

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeImportedDate(value, XLSX) {
  if (value == null || value === "") return "";

  if (typeof value === "number" && XLSX?.SSF?.parse_date_code) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed?.y && parsed?.m && parsed?.d) {
      const yyyy = String(parsed.y);
      const mm = String(parsed.m).padStart(2, "0");
      const dd = String(parsed.d).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }
  }

  const raw = String(value).trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const ruMatch = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (ruMatch) {
    const [, dd, mm, yyyy] = ruMatch;
    return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(
      2,
      "0"
    )}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return "";
}

function rowsFromWorksheet(sheet, XLSX) {
  if (!sheet) return [];

  try {
    const direct = XLSX.utils.sheet_to_json(sheet, {
      defval: "",
      raw: true,
      blankrows: false,
    });
    if (Array.isArray(direct) && direct.length > 0) {
      return direct;
    }
  } catch {}

  let matrix = [];
  try {
    matrix = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: true,
      blankrows: false,
    });
  } catch {
    matrix = [];
  }

  if (!Array.isArray(matrix)) return [];

  // Reports contain two service rows before the header.
  const headerIndex = matrix.findIndex((row) => {
    const values = Array.isArray(row)
      ? row.map((cell) => String(cell || "").trim())
      : [];
    return values.includes("BAN_START") && values.includes("GAME");
  });

  if (headerIndex >= 0) {
    const headerRow = matrix[headerIndex] || [];
    const bodyRows = matrix.slice(headerIndex + 1);
    const headers = headerRow.map((cell) => String(cell || "").trim());

    return bodyRows
      .filter(
        (row) =>
          Array.isArray(row) &&
          row.some((cell) => String(cell || "").trim() !== "")
      )
      .map((row) => {
        const obj = {};
        headers.forEach((header, index) => {
          if (!header) return;
          obj[header] = row[index] ?? "";
        });
        return obj;
      });
  }

  return [];
}

function normalizeToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/what-s/g, "whats")
    .replace(/what's/g, "whats")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim();
}

export function normalizePerformanceText(value) {
  return normalizeToken(value);
}

function humanizeRawGame(rawGame) {
  const raw = String(rawGame || "").trim();
  if (!raw) return "—";
  if (GAME_NAME_MAP[raw]) return GAME_NAME_MAP[raw];

  return raw
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function normalizePerformanceGame(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return normalizeToken(GAME_NAME_MAP[raw] || raw);
}

export function normalizePerformanceAudience(value) {
  const token = normalizeToken(value);
  if (!token) return "";
  if (token.includes("winners") || token.includes("побед")) {
    return normalizeToken("Победители");
  }
  if (token === "all") return "all";
  return token;
}

function inferAudience(rawDescriptor) {
  const token = normalizeToken(rawDescriptor);
  if (!token) return "";
  if (token.includes("winners") || token.includes("побед")) {
    return "Победители";
  }
  if (token.includes("all")) return "All";
  return "";
}

function inferReportType(fileName, headers) {
  const joinedHeaders = headers.join(" ").toLowerCase();
  const lowerFile = String(fileName || "").toLowerCase();

  if (joinedHeaders.includes("template_sk") || lowerFile.includes("push")) {
    return "push";
  }
  return "banner";
}

function inferChannelHint(sourceType, row) {
  const descriptor = `${row.POINT_NAME || ""} ${row.DIMENSION_1 || ""} ${
    row.TEMPLATE_SK || ""
  }`;
  const token = normalizeToken(descriptor);

  if (token.includes("sms")) return "sms";
  if (sourceType === "push" || token.includes("push")) return "push";
  if (token.includes("popup") || token.includes("поп ап") || token.includes("попап")) {
    return "popup";
  }
  if (token.includes("wn") || token.includes("whats new") || token.includes("what s new")) {
    return "wn";
  }
  if (token.includes("bng")) return "bng";
  if (token.includes("megabanner")) return "banner";
  if (token.includes("banner") || token.includes("баннер")) return "banner";
  if (token.includes("splash") || token.includes("сплэш")) return "splash";
  return sourceType === "banner" ? "banner" : "push";
}

function findChannelByHint(channels, hint) {
  const channelMatchers = {
    push: ["пуш", "push"],
    popup: ["попап", "поп ап", "popup", "popap", "pop up"],
    wn: ["вн", "whats new", "what s new", "wn"],
    bng: ["бнг", "bng"],
    banner: ["баннер", "banner", "бнг", "bng"],
    splash: ["сплэш", "splash"],
    sms: ["sms", "смс"],
  };

  const keywords = channelMatchers[hint] || [hint];

  return (
    channels.find((channel) => {
      const channelToken = normalizeToken(
        `${channel.title || ""} ${channel.subtitle || ""} ${
          channel.name || ""
        }`
      );
      return keywords.some((keyword) => channelToken.includes(normalizeToken(keyword)));
    }) || null
  );
}

function getFallbackChannelName(hint) {
  const labels = {
    push: "Пуш",
    popup: "ПопАп",
    wn: "ВН",
    bng: "БНГ",
    banner: "Баннер",
    splash: "Сплэш",
    sms: "SMS",
  };
  return labels[hint] || "Не сопоставлено";
}

function buildBannerReportRow(row, XLSX, channels, fileName, index) {
  const reportDate = normalizeImportedDate(row.BAN_START, XLSX);
  const rawGame = row.GAME || "";
  const game = humanizeRawGame(rawGame);
  const channelHint = inferChannelHint("banner", row);
  const matchedChannel = findChannelByHint(channels, channelHint);
  const layoutName = String(row.POINT_NAME || "").trim();
  const layoutCode = String(row.DIMENSION_1 || "").trim();
  const deliveredCount = toNumber(row.SHOW);
  const sentCount = toNumber(row["Сумма SENT"]);
  const openedCount = toNumber(row.OPEN);
  const clickedCount = toNumber(row["Сумма CLICK_"]);

  return {
    id: `perf-${Date.now()}-${index}`,
    sourceFile: fileName,
    sourceType: "banner",
    reportDate,
    game,
    rawGame,
    channelId: matchedChannel?.id || "",
    channelName:
      getChannelDisplayName(matchedChannel) || getFallbackChannelName(channelHint),
    channelHint,
    audience: inferAudience(`${layoutName} ${layoutCode}`),
    layoutName,
    layoutCode,
    sentCount,
    deliveredCount,
    openedCount,
    clickedCount,
    convertedCount: clickedCount,
    deliveryRate:
      sentCount > 0 ? deliveredCount / sentCount : toNumber(row["SHOW/SENT"]),
    openRate:
      deliveredCount > 0 ? openedCount / deliveredCount : toNumber(row["OPEN/SHOW"]),
    conversionRate:
      deliveredCount > 0
        ? clickedCount / deliveredCount
        : toNumber(row["CLICK/SHOW"]),
  };
}

function buildPushReportRow(row, XLSX, channels, fileName, index) {
  const reportDate = normalizeImportedDate(row.BAN_START, XLSX);
  const rawGame = row.GAME || "";
  const game = humanizeRawGame(rawGame);
  const channelHint = inferChannelHint("push", row);
  const matchedChannel = findChannelByHint(channels, channelHint);
  const layoutCode = String(row.TEMPLATE_SK || "").trim();
  const deliveredCount = toNumber(row["Сумма DELIVERED_"]);
  const deliveredRate = toNumber(row["DELIVERED/SENT"]);
  const sentCount =
    deliveredCount > 0 && deliveredRate > 0
      ? Math.round(deliveredCount / deliveredRate)
      : 0;
  const clickedCount = toNumber(row["Сумма CLICK_"]);

  return {
    id: `perf-${Date.now()}-${index}`,
    sourceFile: fileName,
    sourceType: "push",
    reportDate,
    game,
    rawGame,
    channelId: matchedChannel?.id || "",
    channelName:
      getChannelDisplayName(matchedChannel) || getFallbackChannelName(channelHint),
    channelHint,
    audience: inferAudience(layoutCode),
    layoutName: layoutCode,
    layoutCode,
    sentCount,
    deliveredCount,
    openedCount: 0,
    clickedCount,
    convertedCount: clickedCount,
    deliveryRate: deliveredRate,
    openRate: null,
    conversionRate:
      deliveredCount > 0
        ? clickedCount / deliveredCount
        : toNumber(row["CLICK/DELIVERED"]),
  };
}

export async function importPerformanceReportsFromFiles(files, channels) {
  const XLSX = await import("xlsx");
  const importedRows = [];

  for (const file of files) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, {
      type: "array",
      cellDates: false,
      dense: false,
    });

    const firstSheetName = workbook?.SheetNames?.[0];
    const firstSheet = firstSheetName ? workbook.Sheets[firstSheetName] : null;
    if (!firstSheetName || !firstSheet) {
      throw new Error(`Ошибка при импорте листа: ${file.name}`);
    }

    const rows = rowsFromWorksheet(firstSheet, XLSX);
    if (!rows.length) {
      throw new Error(`Файл пустой или не распознан: ${file.name}`);
    }

    const headers = Object.keys(rows[0] || {});
    const reportType = inferReportType(file.name, headers);

    rows.forEach((row, index) => {
      const mapped =
        reportType === "push"
          ? buildPushReportRow(row, XLSX, channels, file.name, index)
          : buildBannerReportRow(row, XLSX, channels, file.name, index);

      if (!mapped.reportDate || !mapped.layoutName) return;
      importedRows.push({
        ...mapped,
        importKey: [
          mapped.sourceFile,
          mapped.sourceType,
          mapped.reportDate,
          mapped.game,
          mapped.channelId || mapped.channelName,
          mapped.layoutCode,
        ].join("|"),
      });
    });
  }

  if (!importedRows.length) {
    throw new Error("Не удалось распознать ни одной строки фактической отчётности");
  }

  return importedRows;
}

export function getChannelPerformanceSnapshot({
  channel,
  requirement,
  performanceReports = [],
}) {
  const channelId = channel?.id || "";
  const channelName = normalizeToken(getChannelDisplayName(channel) || channel?.name || "");
  const requirementGame = normalizePerformanceGame(requirement?.game);
  const requirementAudience = normalizePerformanceAudience(requirement?.audience);

  const relevantRows = performanceReports.filter((row) => {
    const rowChannelId = String(row?.channelId || "").trim();
    const rowChannelName = normalizeToken(row?.channelName || "");

    if (channelId) {
      if (rowChannelId) return rowChannelId === channelId;
      if (channelName && rowChannelName) return rowChannelName === channelName;
      return false;
    }

    return channelName && rowChannelName === channelName;
  });

  if (!relevantRows.length) return null;

  const overallRows = relevantRows;
  const gameRows = requirementGame
    ? relevantRows.filter((row) => normalizePerformanceGame(row?.game) === requirementGame)
    : [];
  const audienceRows = requirementAudience
    ? relevantRows.filter(
        (row) => normalizePerformanceAudience(row?.audience) === requirementAudience
      )
    : [];
  const combinedRows =
    requirementGame && requirementAudience
      ? relevantRows.filter(
          (row) =>
            normalizePerformanceGame(row?.game) === requirementGame &&
            normalizePerformanceAudience(row?.audience) === requirementAudience
        )
      : [];

  function aggregate(rows) {
    const sent = rows.reduce((sum, row) => sum + toNumber(row.sentCount), 0);
    const delivered = rows.reduce((sum, row) => sum + toNumber(row.deliveredCount), 0);
    const converted = rows.reduce((sum, row) => sum + toNumber(row.convertedCount), 0);
    const denominator = delivered || sent;
    const rate = denominator > 0 ? converted / denominator : 0;
    const confidence = Math.min(1, rows.length / 6 + denominator / 2000000);

    return {
      rowsCount: rows.length,
      sent,
      delivered,
      converted,
      denominator,
      rate,
      confidence,
    };
  }

  const overall = aggregate(overallRows);
  const byGame = gameRows.length ? aggregate(gameRows) : null;
  const byAudience = audienceRows.length ? aggregate(audienceRows) : null;
  const combined = combinedRows.length ? aggregate(combinedRows) : null;

  const bestMatch = combined || byGame || byAudience || overall;
  const weightedRate = bestMatch.rate * (0.7 + bestMatch.confidence * 0.6);
  const score = Number((weightedRate * 28).toFixed(1));

  let scopeLabel = "по каналу в целом";
  if (combined) scopeLabel = "по сочетанию игры и аудитории";
  else if (byGame) scopeLabel = "по этой игре";
  else if (byAudience) scopeLabel = "по этой аудитории";

  return {
    score,
    rate: bestMatch.rate,
    confidence: bestMatch.confidence,
    rowsCount: bestMatch.rowsCount,
    scopeLabel,
    description: `Есть фактическая конверсия ${bestMatch.rate
      .toFixed(3)
      .replace(".", ",")} ${scopeLabel}; строк отчётности: ${bestMatch.rowsCount}.`,
    tone:
      weightedRate >= 0.12
        ? "positive"
        : weightedRate >= 0.05
        ? "neutral"
        : "negative",
  };
}
