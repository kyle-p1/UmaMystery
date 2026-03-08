"use strict";

const fs = require("fs/promises");
const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { characters: bundledCharacters, sourceUrl: bundledCharacterSourceUrl } = require("./characters.js");

const characters = Array.isArray(bundledCharacters) ? bundledCharacters : [];

const PORT = Number(process.env.PORT || 3000);
const MAX_NAME_LENGTH = 30;
const MAX_QUESTION_LENGTH = 180;
const MAX_GUESSER_STRIKES = 3;
const HOLDER_CHARACTER_MODE_RANDOM = "random";
const HOLDER_CHARACTER_MODE_HOLDER_CHOICE = "holder_choice";
const CHARACTER_SOURCE_URL = bundledCharacterSourceUrl || "https://umamusu.wiki/List_of_Characters";
const CHARACTER_FILE_PATH = path.resolve(__dirname, "characters.js");
const CHARACTER_SYNC_TIMEOUT_MS = Number(process.env.CHARACTER_SYNC_TIMEOUT_MS || 12000);
const SHOULD_SKIP_CHARACTER_SYNC = String(process.env.SKIP_CHARACTER_SYNC || "").trim() === "1";

const NON_CHARACTER_PAGE_TITLES = new Set([
  "main page",
  "recent changes",
  "random page",
  "contributing",
  "guidelines",
  "contents",
  "read",
  "discussion",
  "create account",
  "log in",
  "main",
  "gallery",
  "irl",
  "party dash",
  "race outfit",
  "starting future",
  "list of albums",
  "list of live events",
  "list of media",
  "list of merchandise",
  "new player guide",
  "list of skills",
  "list of trainees",
  "list of support cards"
]);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const lobbies = new Map();
const characterImageCache = new Map();

app.use(express.static(path.resolve(__dirname)));
app.get("/api/characters", (request, response) => {
  response.json({
    count: characters.length,
    characters
  });
});

function normalizeWikiTitle(rawTitle) {
  return String(rawTitle || "")
    .replace(/[_\s]+/g, " ")
    .trim();
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function decodeWikiPath(rawPath) {
  const value = String(rawPath || "").trim();
  if (!value) {
    return "";
  }

  const withoutFragment = value.split("#")[0].split("?")[0];
  try {
    return decodeURIComponent(withoutFragment);
  } catch (_error) {
    return withoutFragment;
  }
}

function normalizeCharacterName(rawValue) {
  return decodeHtmlEntities(String(rawValue || ""))
    .replace(/[_\s]+/g, " ")
    .trim();
}

function simplifyNameForCompare(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isLikelyCharacterName(name) {
  const value = normalizeCharacterName(name);
  if (!value) {
    return false;
  }

  if (value.length < 2 || value.length > 80) {
    return false;
  }

  if (value.includes(":")) {
    return false;
  }

  if (value.includes("/")) {
    return false;
  }

  if (!/[a-z]/i.test(value)) {
    return false;
  }

  const lower = value.toLowerCase();
  if (lower.startsWith("list of ") || lower.startsWith("list_of_")) {
    return false;
  }

  if (NON_CHARACTER_PAGE_TITLES.has(lower)) {
    return false;
  }

  return true;
}

function slugifyCharacterName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildCharacterEntries(names) {
  const uniqueNames = [...new Set(
    names
      .map((name) => normalizeCharacterName(name))
      .filter((name) => isLikelyCharacterName(name))
  )].sort((left, right) => left.localeCompare(right));

  const usedIds = new Set();

  return uniqueNames.map((name) => {
    const baseId = `uma-${slugifyCharacterName(name) || "character"}`;
    let id = baseId;
    let suffix = 2;

    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }

    usedIds.add(id);

    return {
      id,
      name,
      wikiTitle: name,
      source: CHARACTER_SOURCE_URL
    };
  });
}

function buildCharactersModuleSource(nextCharacters) {
  const serializedCharacters = JSON.stringify(nextCharacters, null, 2);

  return [
    "(function (root, factory) {",
    "  const payload = factory();",
    "",
    "  if (typeof module === \"object\" && module.exports) {",
    "    module.exports = payload;",
    "  }",
    "",
    "  if (typeof window !== \"undefined\") {",
    "    window.GUESS_WHO_CHARACTERS = payload.characters;",
    "    window.GUESS_WHO_CHARACTER_SOURCE = payload.sourceUrl;",
    "  }",
    "})(typeof globalThis !== \"undefined\" ? globalThis : this, function () {",
    "  \"use strict\";",
    "",
    `  const sourceUrl = ${JSON.stringify(CHARACTER_SOURCE_URL)};`,
    "",
    `  const characters = ${serializedCharacters};`,
    "",
    "  return {",
    "    sourceUrl,",
    "    characters",
    "  };",
    "});",
    ""
  ].join("\n");
}

function replaceCharacters(nextCharacters) {
  characters.length = 0;
  for (const character of nextCharacters) {
    characters.push(character);
  }
}

async function persistCharactersFile(nextCharacters) {
  const nextContent = buildCharactersModuleSource(nextCharacters);

  try {
    const currentContent = await fs.readFile(CHARACTER_FILE_PATH, "utf8");
    if (currentContent === nextContent) {
      return false;
    }
  } catch (_error) {
    // Ignore read errors and attempt to write.
  }

  await fs.writeFile(CHARACTER_FILE_PATH, nextContent, "utf8");
  return true;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = CHARACTER_SYNC_TIMEOUT_MS) {
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 12000;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCharacterNamesFromCategory(categoryTitle) {
  const collected = new Set();
  let continueToken = null;

  for (let page = 0; page < 12; page += 1) {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      list: "categorymembers",
      cmtitle: categoryTitle,
      cmtype: "page",
      cmlimit: "500",
      origin: "*"
    });

    if (continueToken) {
      params.set("cmcontinue", continueToken);
    }

    const url = `https://umamusu.wiki/api.php?${params.toString()}`;
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      throw new Error(`category request failed (${response.status})`);
    }

    const payload = await response.json();
    const rows = payload && payload.query ? payload.query.categorymembers : null;
    if (!Array.isArray(rows)) {
      break;
    }

    for (const row of rows) {
      const title = normalizeCharacterName(row && row.title);
      if (isLikelyCharacterName(title)) {
        collected.add(title);
      }
    }

    continueToken = payload && payload.continue ? payload.continue.cmcontinue : null;
    if (!continueToken) {
      break;
    }
  }

  return [...collected];
}

async function fetchCharacterNamesFromListPage() {
  const response = await fetchWithTimeout(CHARACTER_SOURCE_URL);
  if (!response.ok) {
    throw new Error(`list page request failed (${response.status})`);
  }

  const html = await response.text();
  const collected = new Set();

  const mainContentStart = html.indexOf("id=\"mw-content-text\"");
  const mainContentEnd = mainContentStart >= 0
    ? html.indexOf("<div class=\"printfooter\"", mainContentStart)
    : -1;

  const scopedHtml = mainContentStart >= 0
    ? html.slice(mainContentStart, mainContentEnd > mainContentStart ? mainContentEnd : undefined)
    : html;

  const linkPattern = /<a\b[^>]*href=["']\/([^"'#?]+)["'][^>]*>([^<]+)<\/a>/gi;

  while (true) {
    const match = linkPattern.exec(scopedHtml);
    if (!match) {
      break;
    }

    const hrefName = normalizeCharacterName(decodeWikiPath(match[1]));
    const textName = normalizeCharacterName(match[2]);
    const candidate = hrefName || textName;

    if (!isLikelyCharacterName(candidate)) {
      continue;
    }

    const hrefKey = simplifyNameForCompare(hrefName || candidate);
    const textKey = simplifyNameForCompare(textName);
    if (textKey && hrefKey && textKey !== hrefKey) {
      continue;
    }

    collected.add(candidate);
  }

  return [...collected];
}

async function fetchLatestCharacterNames() {
  const categoryCandidates = [
    "Category:Characters",
    "Category:Uma_Musume_Characters",
    "Category:Umamusume_Characters",
    "Category:Character"
  ];

  for (const categoryTitle of categoryCandidates) {
    try {
      const names = await fetchCharacterNamesFromCategory(categoryTitle);
      if (names.length >= 20) {
        return names;
      }
    } catch (_error) {
      // Fall through to next source.
    }
  }

  return fetchCharacterNamesFromListPage();
}

async function syncCharactersOnLaunch() {
  if (SHOULD_SKIP_CHARACTER_SYNC) {
    console.log(`[characters] Skipping sync (SKIP_CHARACTER_SYNC=1). Using bundled list (${characters.length}).`);
    return;
  }

  const bundledCount = characters.length;

  try {
    const latestNames = await fetchLatestCharacterNames();
    const nextCharacters = buildCharacterEntries(latestNames);

    const minimumAcceptableCount = Math.max(20, Math.floor(Math.max(20, bundledCount) * 0.6));
    if (nextCharacters.length < minimumAcceptableCount) {
      throw new Error(`received only ${nextCharacters.length} character names`);
    }

    replaceCharacters(nextCharacters);
    const wroteFile = await persistCharactersFile(nextCharacters);
    const fileStatus = wroteFile ? "updated characters.js" : "characters.js already current";

    console.log(`[characters] Synced ${nextCharacters.length} characters from wiki (${fileStatus}).`);
  } catch (error) {
    const reason = error && error.message ? error.message : String(error);
    console.warn(`[characters] Sync failed: ${reason}. Using bundled list (${bundledCount}).`);
  }
}

function toAbsoluteWikiUrl(rawUrl) {
  const cleaned = decodeHtmlEntities(String(rawUrl || "").trim());
  if (!cleaned) {
    return null;
  }

  if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) {
    return cleaned;
  }

  if (cleaned.startsWith("//")) {
    return `https:${cleaned}`;
  }

  if (cleaned.startsWith("/")) {
    return `https://umamusu.wiki${cleaned}`;
  }

  return `https://umamusu.wiki/${cleaned}`;
}

function extractMetaImageFromHtml(html) {
  if (!html) {
    return null;
  }

  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["'][^>]*>/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return toAbsoluteWikiUrl(match[1]);
    }
  }

  return null;
}

function extractImageUrlFromImageTag(tag) {
  if (!tag) {
    return null;
  }

  const srcsetMatch = tag.match(/\bsrcset=["']([^"']+)["']/i);
  if (srcsetMatch && srcsetMatch[1]) {
    const entries = srcsetMatch[1]
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

    if (entries.length) {
      const largestEntry = entries[entries.length - 1];
      const urlCandidate = largestEntry.split(/\s+/)[0];
      const absolute = toAbsoluteWikiUrl(urlCandidate);
      if (absolute) {
        return absolute;
      }
    }
  }

  const srcMatch = tag.match(/\bsrc=["']([^"']+)["']/i);
  if (srcMatch && srcMatch[1]) {
    return toAbsoluteWikiUrl(srcMatch[1]);
  }

  return null;
}

function extractRaceOutfitImageFromHtml(html) {
  if (!html) {
    return null;
  }

  const racePanelMatch = html.match(
    /<article[^>]+id=["']tabber-tabpanel-Race_Outfit-\d+["'][^>]*>([\s\S]*?)<\/article>/i
  );

  if (!racePanelMatch || !racePanelMatch[1]) {
    return null;
  }

  const racePanelHtml = racePanelMatch[1];
  const imageTagMatch = racePanelHtml.match(/<img\b[^>]*>/i);
  if (!imageTagMatch || !imageTagMatch[0]) {
    return null;
  }

  return extractImageUrlFromImageTag(imageTagMatch[0]);
}

async function fetchWikiPageHtml(title) {
  try {
    const pagePath = encodeURIComponent(title).replace(/%20/g, "_");
    const pageResponse = await fetch(`https://umamusu.wiki/${pagePath}`);
    if (!pageResponse.ok) {
      return null;
    }

    return pageResponse.text();
  } catch (_error) {
    return null;
  }
}

async function fetchImagesFromPageHtml(title) {
  const html = await fetchWikiPageHtml(title);
  if (!html) {
    return {
      raceImage: null,
      metaImage: null
    };
  }

  return {
    raceImage: extractRaceOutfitImageFromHtml(html),
    metaImage: extractMetaImageFromHtml(html)
  };
}

async function fetchPageImageFromWikiApi(title) {
  try {
    const apiUrl = `https://umamusu.wiki/api.php?action=query&format=json&formatversion=2&prop=pageimages&piprop=thumbnail&pithumbsize=900&redirects=1&titles=${encodeURIComponent(title)}&origin=*`;
    const apiResponse = await fetch(apiUrl);
    if (!apiResponse.ok) {
      return null;
    }

    const payload = await apiResponse.json();
    const pages = payload && payload.query && Array.isArray(payload.query.pages)
      ? payload.query.pages
      : [];

    for (const page of pages) {
      const imageUrl = page && page.thumbnail && typeof page.thumbnail.source === "string"
        ? page.thumbnail.source
        : null;
      if (imageUrl) {
        return imageUrl;
      }
    }

    return null;
  } catch (_error) {
    return null;
  }
}

async function searchClosestWikiTitle(title) {
  try {
    const searchUrl = `https://umamusu.wiki/api.php?action=query&format=json&formatversion=2&list=search&srlimit=1&srsearch=${encodeURIComponent(title)}&origin=*`;
    const searchResponse = await fetch(searchUrl);
    if (!searchResponse.ok) {
      return null;
    }

    const payload = await searchResponse.json();
    const searchRows = payload && payload.query && Array.isArray(payload.query.search)
      ? payload.query.search
      : [];

    if (!searchRows.length || !searchRows[0] || !searchRows[0].title) {
      return null;
    }

    return String(searchRows[0].title);
  } catch (_error) {
    return null;
  }
}

async function resolveCharacterImage(title) {
  const normalizedTitle = normalizeWikiTitle(title);
  if (!normalizedTitle) {
    return null;
  }

  const candidates = [...new Set([
    normalizedTitle,
    normalizedTitle.replace(/\s+/g, "_"),
    normalizedTitle.replace(/\./g, "")
  ])];

  let firstMetaFallback = null;

  for (const candidate of candidates) {
    const pageImages = await fetchImagesFromPageHtml(candidate);
    if (pageImages.raceImage) {
      return pageImages.raceImage;
    }

    if (!firstMetaFallback && pageImages.metaImage) {
      firstMetaFallback = pageImages.metaImage;
    }
  }

  if (firstMetaFallback) {
    return firstMetaFallback;
  }

  for (const candidate of candidates) {
    const apiImage = await fetchPageImageFromWikiApi(candidate);
    if (apiImage) {
      return apiImage;
    }
  }

  const searchedTitle = await searchClosestWikiTitle(normalizedTitle);
  if (searchedTitle) {
    const searchedImages = await fetchImagesFromPageHtml(searchedTitle);
    if (searchedImages.raceImage) {
      return searchedImages.raceImage;
    }

    if (searchedImages.metaImage) {
      return searchedImages.metaImage;
    }

    const searchedApiImage = await fetchPageImageFromWikiApi(searchedTitle);
    if (searchedApiImage) {
      return searchedApiImage;
    }
  }

  return null;
}

app.get("/api/character-image", async (request, response) => {
  const title = normalizeWikiTitle(request.query.title);
  if (!title) {
    response.status(400).json({ error: "Missing title." });
    return;
  }

  if (characterImageCache.has(title)) {
    response.json({ title, imageUrl: characterImageCache.get(title) });
    return;
  }

  try {
    const imageUrl = await resolveCharacterImage(title);
    characterImageCache.set(title, imageUrl);
    response.json({ title, imageUrl });
  } catch (_error) {
    response.status(502).json({ error: "Image lookup failed." });
  }
});

function nowTimestamp() {
  return new Date().toISOString();
}

function sanitizeName(rawName) {
  const name = String(rawName || "").trim();
  if (!name) {
    return null;
  }

  return name.slice(0, MAX_NAME_LENGTH);
}

function normalizeLobbyCode(rawCode) {
  const compact = String(rawCode || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (compact.length <= 6) {
    return compact;
  }

  return compact.slice(-6);
}

function sanitizeHolderCharacterMode(rawMode) {
  const mode = String(rawMode || "").trim().toLowerCase();
  if (mode === HOLDER_CHARACTER_MODE_HOLDER_CHOICE) {
    return HOLDER_CHARACTER_MODE_HOLDER_CHOICE;
  }
  return HOLDER_CHARACTER_MODE_RANDOM;
}

function sanitizeConfig(rawConfig, playerCount) {
  const safePlayerCount = Math.max(2, Number(playerCount || 2));
  const holderCap = Math.max(1, safePlayerCount - 1);

  const parsedHolders = Number.parseInt(rawConfig && rawConfig.holdersCount, 10);
  const parsedQuestions = Number.parseInt(rawConfig && rawConfig.questionLimit, 10);
  const parsedTeams = Number.parseInt(rawConfig && rawConfig.teamCount, 10);

  return {
    holdersCount: Number.isNaN(parsedHolders)
      ? 1
      : Math.min(Math.max(parsedHolders, 1), holderCap),
    questionLimit: Number.isNaN(parsedQuestions)
      ? 15
      : Math.min(Math.max(parsedQuestions, 1), 200),
    teamCount: Number.isNaN(parsedTeams)
      ? 2
      : Math.min(Math.max(parsedTeams, 1), 8),
    holderCharacterMode: sanitizeHolderCharacterMode(rawConfig && rawConfig.holderCharacterMode),
    sameQuestionForAllTargets: Boolean(rawConfig && rawConfig.sameQuestionForAllTargets)
  };
}

function shuffle(items) {
  const clone = [...items];
  for (let index = clone.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    const temp = clone[index];
    clone[index] = clone[randomIndex];
    clone[randomIndex] = temp;
  }
  return clone;
}

function generateLobbyCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  while (true) {
    let code = "";
    for (let index = 0; index < 6; index += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }

    if (!lobbies.has(code)) {
      return code;
    }
  }
}

function findLobbyBySocketId(socketId) {
  for (const lobby of lobbies.values()) {
    if (lobby.players.some((player) => player.id === socketId)) {
      return lobby;
    }
  }
  return null;
}

function getPlayer(lobby, playerId) {
  return lobby.players.find((player) => player.id === playerId) || null;
}

function addGameLog(game, message) {
  game.log.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    message,
    timestamp: nowTimestamp()
  });

  if (game.log.length > 120) {
    game.log.shift();
  }
}

function unsolvedHolderIds(game) {
  return game.holderIds.filter((holderId) => {
    const assignment = game.assignments[holderId];
    return assignment && assignment.role === "holder" && !assignment.solved;
  });
}

function activeGuesserIds(game) {
  return game.guesserOrder.filter((guesserId) => {
    const assignment = game.assignments[guesserId];
    return assignment && assignment.role === "guesser" && !assignment.eliminated;
  });
}

function holderCharacterIds(game, excludedHolderId = "") {
  const ids = new Set();

  for (const [playerId, assignment] of Object.entries(game.assignments)) {
    if (playerId === excludedHolderId) {
      continue;
    }

    if (assignment && assignment.role === "holder" && assignment.character && assignment.character.id) {
      ids.add(assignment.character.id);
    }
  }

  return ids;
}

function holdersMissingCharacter(game) {
  return game.holderIds.filter((holderId) => {
    const assignment = game.assignments[holderId];
    return assignment && assignment.role === "holder" && !assignment.solved && !assignment.character;
  });
}

function hasPendingHolderCharacterSelection(game) {
  return holdersMissingCharacter(game).length > 0;
}

function assignRandomCharacterToHolder(game, holderId) {
  const assignment = game.assignments[holderId];
  if (!assignment || assignment.role !== "holder") {
    return null;
  }

  const takenCharacterIds = holderCharacterIds(game, holderId);
  const availableCharacters = shuffle(characters.filter((character) => !takenCharacterIds.has(character.id)));

  if (!availableCharacters.length) {
    return null;
  }

  assignment.character = availableCharacters[0];
  return assignment.character;
}

function finishGame(lobby, side, reason) {
  const game = lobby.game;
  if (!game || game.winner) {
    return;
  }

  let winnerIds = [];
  if (side === "guessers") {
    winnerIds = activeGuesserIds(game);
  } else {
    winnerIds = unsolvedHolderIds(game);
    if (!winnerIds.length) {
      winnerIds = game.holderIds.filter((holderId) => Boolean(game.assignments[holderId]));
    }
  }

  const teamNumbers = [...new Set(
    winnerIds
      .map((playerId) => getPlayer(lobby, playerId))
      .filter(Boolean)
      .map((player) => player.team)
  )];

  game.winner = {
    side,
    reason,
    winnerIds,
    teamNumbers,
    finishedAt: nowTimestamp()
  };

  const reasonText = reason === "all_holders_solved"
    ? "all holder characters were guessed"
    : reason === "question_limit_reached"
      ? "question limit reached"
      : reason === "no_guessers"
        ? "no active guessers left"
        : reason;

  addGameLog(game, `${side === "guessers" ? "Guessers" : "Holders"} win (${reasonText}).`);
}

function advanceTurn(lobby, fromPlayerId) {
  const game = lobby.game;
  if (!game || game.winner) {
    return;
  }

  const guessers = activeGuesserIds(game);
  if (!guessers.length) {
    finishGame(lobby, "holders", "no_guessers");
    return;
  }

  const currentIndex = guessers.indexOf(fromPlayerId);
  const startIndex = currentIndex >= 0 ? currentIndex : -1;
  const nextIndex = (startIndex + 1) % guessers.length;
  game.turnPlayerId = guessers[nextIndex];
}

function finalizePendingQuestionIfReady(lobby) {
  const game = lobby.game;
  if (!game || !game.pendingQuestion || game.winner) {
    return;
  }

  const pending = game.pendingQuestion;
  const unresolvedTargets = pending.targetIds.filter((targetId) => Boolean(game.assignments[targetId]));
  pending.targetIds = unresolvedTargets;

  if (!pending.targetIds.length) {
    addGameLog(game, "Pending question auto-resolved because all targets left the lobby.");
    game.pendingQuestion = null;
    if (game.questionsRemaining <= 0) {
      finishGame(lobby, "holders", "question_limit_reached");
      return;
    }
    advanceTurn(lobby, pending.askerId);
    return;
  }

  const allAnswered = pending.targetIds.every((targetId) => Boolean(pending.answers[targetId]));
  if (!allAnswered) {
    return;
  }

  const summary = pending.targetIds
    .map((targetId) => {
      const player = getPlayer(lobby, targetId);
      const label = player ? player.name : targetId;
      return `${label}: ${pending.answers[targetId]}`;
    })
    .join(" | ");

  addGameLog(game, `Answers -> ${summary}`);
  game.pendingQuestion = null;

  if (game.questionsRemaining <= 0) {
    finishGame(lobby, "holders", "question_limit_reached");
    return;
  }

  advanceTurn(lobby, pending.askerId);
}

function evaluateWinState(lobby) {
  const game = lobby.game;
  if (!game || game.winner) {
    return;
  }

  if (!activeGuesserIds(game).length) {
    finishGame(lobby, "holders", "no_guessers");
    return;
  }

  if (!unsolvedHolderIds(game).length) {
    finishGame(lobby, "guessers", "all_holders_solved");
  }
}

function startGame(lobby) {
  const playerIds = lobby.players.map((player) => player.id);
  if (playerIds.length < 2) {
    return { error: "Need at least two players to start." };
  }

  lobby.config = sanitizeConfig(lobby.config, playerIds.length);
  const holderCount = Math.min(Math.max(lobby.config.holdersCount, 1), playerIds.length - 1);

  const shuffledPlayers = shuffle(playerIds);
  const holderIds = shuffledPlayers.slice(0, holderCount);
  const guesserIds = shuffledPlayers.slice(holderCount);

  if (!guesserIds.length) {
    return { error: "At least one guesser is required." };
  }

  const pickedCharacters = shuffle(characters).slice(0, holderIds.length);
  const assignments = {};

  for (let index = 0; index < holderIds.length; index += 1) {
    assignments[holderIds[index]] = {
      role: "holder",
      solved: false,
      character: lobby.config.holderCharacterMode === HOLDER_CHARACTER_MODE_HOLDER_CHOICE
        ? null
        : pickedCharacters[index]
    };
  }

  for (const guesserId of guesserIds) {
    assignments[guesserId] = {
      role: "guesser",
      strikes: 0,
      eliminated: false
    };
  }

  const randomTurnPlayer = guesserIds[Math.floor(Math.random() * guesserIds.length)];

  lobby.game = {
    startedAt: nowTimestamp(),
    questionLimit: lobby.config.questionLimit,
    questionsRemaining: lobby.config.questionLimit,
    assignments,
    holderIds,
    guesserOrder: guesserIds,
    turnPlayerId: randomTurnPlayer,
    pendingQuestion: null,
    winner: null,
    log: []
  };

  addGameLog(lobby.game, `Game started. ${holderIds.length} player(s) are holders.`);

  if (lobby.config.holderCharacterMode === HOLDER_CHARACTER_MODE_HOLDER_CHOICE) {
    addGameLog(lobby.game, "Holders must choose a character (or request random) before guessers can ask questions.");
  }

  const turnPlayer = getPlayer(lobby, randomTurnPlayer);
  if (turnPlayer) {
    addGameLog(lobby.game, `Random start: ${turnPlayer.name} takes the first turn.`);
  }

  return { error: null };
}

function buildLobbyView(lobby, viewerId) {
  const game = lobby.game;

  const players = lobby.players.map((player) => {
    const assignment = game ? game.assignments[player.id] : null;
    const isViewer = player.id === viewerId;
    const canReveal = game && assignment && assignment.role === "holder" && (isViewer || assignment.solved || Boolean(game.winner));

    return {
      id: player.id,
      name: player.name,
      team: player.team,
      role: assignment ? assignment.role : "unassigned",
      solved: Boolean(assignment && assignment.solved),
      secretCharacter: canReveal ? assignment.character : null
    };
  });

  let gameView = null;
  if (game) {
    const assignmentView = {};
    for (const [playerId, assignment] of Object.entries(game.assignments)) {
      const canReveal = assignment.role === "holder"
        && (playerId === viewerId || assignment.solved || Boolean(game.winner));

      assignmentView[playerId] = {
        role: assignment.role,
        solved: Boolean(assignment.solved),
        strikes: assignment.role === "guesser"
          ? Math.max(0, Number.parseInt(assignment.strikes, 10) || 0)
          : 0,
        eliminated: assignment.role === "guesser" ? Boolean(assignment.eliminated) : false,
        character: canReveal ? assignment.character : null
      };
    }

    gameView = {
      startedAt: game.startedAt,
      turnPlayerId: game.turnPlayerId,
      questionLimit: game.questionLimit,
      questionsRemaining: game.questionsRemaining,
      pendingQuestion: game.pendingQuestion,
      winner: game.winner,
      holderIds: game.holderIds,
      guesserOrder: game.guesserOrder,
      pendingHolderSelectionCount: holdersMissingCharacter(game).length,
      assignments: assignmentView,
      log: game.log
    };
  }

  return {
    code: lobby.code,
    hostId: lobby.hostId,
    youId: viewerId,
    youAreHost: viewerId === lobby.hostId,
    config: lobby.config,
    players,
    game: gameView
  };
}

function emitLobbyState(lobby) {
  for (const player of lobby.players) {
    io.to(player.id).emit("lobby_state", buildLobbyView(lobby, player.id));
  }
}

function getCurrentPlayerName(lobby) {
  if (!lobby.game) {
    return "";
  }

  const player = getPlayer(lobby, lobby.game.turnPlayerId);
  return player ? player.name : "Unknown";
}

io.on("connection", (socket) => {
  socket.on("create_lobby", (payload, callback = () => {}) => {
    const name = sanitizeName(payload && payload.name);
    if (!name) {
      callback({ error: "Enter a valid player name." });
      return;
    }

    const code = generateLobbyCode();
    const lobby = {
      code,
      hostId: socket.id,
      players: [
        {
          id: socket.id,
          name,
          team: 1
        }
      ],
      config: sanitizeConfig(payload && payload.config, 2),
      game: null
    };

    lobbies.set(code, lobby);
    socket.join(code);

    emitLobbyState(lobby);
    callback({ error: null, code });
  });

  socket.on("join_lobby", (payload, callback = () => {}) => {
    const code = normalizeLobbyCode(payload && payload.code);
    const name = sanitizeName(payload && payload.name);

    if (!name) {
      callback({ error: "Enter a valid player name." });
      return;
    }

    if (code.length !== 6) {
      callback({ error: "Enter a 6-character lobby code." });
      return;
    }

    const lobby = lobbies.get(code);
    if (!lobby) {
      callback({ error: "Lobby not found." });
      return;
    }

    if (lobby.game) {
      callback({ error: "This lobby already started." });
      return;
    }

    const team = (lobby.players.length % lobby.config.teamCount) + 1;
    lobby.players.push({
      id: socket.id,
      name,
      team
    });

    socket.join(code);

    lobby.config = sanitizeConfig(lobby.config, lobby.players.length);
    for (const player of lobby.players) {
      if (player.team > lobby.config.teamCount) {
        player.team = 1;
      }
    }

    emitLobbyState(lobby);
    callback({ error: null, code });
  });

  socket.on("update_config", (payload, callback = () => {}) => {
    const lobby = findLobbyBySocketId(socket.id);
    if (!lobby) {
      callback({ error: "Not in a lobby." });
      return;
    }

    if (lobby.hostId !== socket.id) {
      callback({ error: "Only the host can change config." });
      return;
    }

    if (lobby.game) {
      callback({ error: "Cannot change config after game start." });
      return;
    }

    lobby.config = sanitizeConfig(payload, lobby.players.length);
    for (const player of lobby.players) {
      if (player.team > lobby.config.teamCount) {
        player.team = 1;
      }
    }

    emitLobbyState(lobby);
    callback({ error: null });
  });

  socket.on("set_team", (payload, callback = () => {}) => {
    const lobby = findLobbyBySocketId(socket.id);
    if (!lobby) {
      callback({ error: "Not in a lobby." });
      return;
    }

    if (lobby.game) {
      callback({ error: "Cannot change teams after game start." });
      return;
    }

    const targetId = String(payload && payload.playerId || "").trim();
    const targetPlayer = getPlayer(lobby, targetId);
    if (!targetPlayer) {
      callback({ error: "Player not found." });
      return;
    }

    if (targetId !== socket.id && lobby.hostId !== socket.id) {
      callback({ error: "Only host can change another player's team." });
      return;
    }

    const team = Number.parseInt(payload && payload.team, 10);
    if (Number.isNaN(team)) {
      callback({ error: "Invalid team value." });
      return;
    }

    targetPlayer.team = Math.min(Math.max(team, 1), lobby.config.teamCount);
    emitLobbyState(lobby);
    callback({ error: null });
  });

  socket.on("start_game", (_payload, callback = () => {}) => {
    const lobby = findLobbyBySocketId(socket.id);
    if (!lobby) {
      callback({ error: "Not in a lobby." });
      return;
    }

    if (lobby.hostId !== socket.id) {
      callback({ error: "Only the host can start the game." });
      return;
    }

    if (lobby.game) {
      callback({ error: "Game already started." });
      return;
    }

    const result = startGame(lobby);
    if (result.error) {
      callback(result);
      return;
    }

    emitLobbyState(lobby);
    callback({ error: null });
  });

  socket.on("set_holder_character", (payload, callback = () => {}) => {
    const lobby = findLobbyBySocketId(socket.id);
    if (!lobby || !lobby.game) {
      callback({ error: "No active game." });
      return;
    }

    const game = lobby.game;
    if (game.winner) {
      callback({ error: "Game already finished." });
      return;
    }

    if (lobby.config.holderCharacterMode !== HOLDER_CHARACTER_MODE_HOLDER_CHOICE) {
      callback({ error: "Holder selection is disabled in this lobby." });
      return;
    }

    const holder = game.assignments[socket.id];
    if (!holder || holder.role !== "holder") {
      callback({ error: "Only holders can set the secret character." });
      return;
    }

    if (holder.solved) {
      callback({ error: "Your holder role is already solved." });
      return;
    }

    const lockedAfterStart = game.questionsRemaining < game.questionLimit || Boolean(game.pendingQuestion);
    if (lockedAfterStart) {
      callback({ error: "Character selection is locked after the first question." });
      return;
    }

    const pendingBefore = hasPendingHolderCharacterSelection(game);
    const hadCharacterBefore = Boolean(holder.character);

    let selectedCharacter = null;
    if (payload && payload.random) {
      selectedCharacter = assignRandomCharacterToHolder(game, socket.id);
      if (!selectedCharacter) {
        callback({ error: "No available characters left for random assignment." });
        return;
      }
    } else {
      const characterId = String(payload && payload.characterId || "").trim();
      if (!characterId) {
        callback({ error: "Choose a character first." });
        return;
      }

      const candidate = characters.find((character) => character.id === characterId);
      if (!candidate) {
        callback({ error: "Invalid character selected." });
        return;
      }

      const takenCharacterIds = holderCharacterIds(game, socket.id);
      if (takenCharacterIds.has(candidate.id)) {
        callback({ error: "That character is already taken by another holder." });
        return;
      }

      holder.character = candidate;
      selectedCharacter = candidate;
    }

    const actor = getPlayer(lobby, socket.id);
    addGameLog(
      game,
      `${actor ? actor.name : "A holder"} ${hadCharacterBefore ? "updated" : "locked in"} their secret character.`
    );

    const pendingAfter = hasPendingHolderCharacterSelection(game);
    if (pendingBefore && !pendingAfter) {
      addGameLog(game, "All holders have locked in characters. Guessers may begin.");
    }

    emitLobbyState(lobby);
    callback({ error: null, characterId: selectedCharacter.id });
  });

  socket.on("ask_question", (payload, callback = () => {}) => {
    const lobby = findLobbyBySocketId(socket.id);
    if (!lobby || !lobby.game) {
      callback({ error: "No active game." });
      return;
    }

    const game = lobby.game;
    if (game.winner) {
      callback({ error: "Game already finished." });
      return;
    }

    if (hasPendingHolderCharacterSelection(game)) {
      callback({ error: "Waiting for holders to lock in secret characters." });
      return;
    }

    if (game.pendingQuestion) {
      callback({ error: "A question is still waiting for answers." });
      return;
    }

    if (game.turnPlayerId !== socket.id) {
      callback({ error: `It is ${getCurrentPlayerName(lobby)}'s turn.` });
      return;
    }

    const assignment = game.assignments[socket.id];
    if (!assignment || assignment.role !== "guesser") {
      callback({ error: "Only a guesser can ask questions." });
      return;
    }

    if (assignment.eliminated) {
      callback({ error: `You are out after ${MAX_GUESSER_STRIKES} incorrect guesses.` });
      return;
    }

    if (game.questionsRemaining <= 0) {
      callback({ error: "Question limit reached." });
      return;
    }

    const text = String(payload && payload.text || "").trim().slice(0, MAX_QUESTION_LENGTH);
    if (!text) {
      callback({ error: "Question cannot be empty." });
      return;
    }

    let targetIds;
    if (lobby.config.sameQuestionForAllTargets) {
      targetIds = unsolvedHolderIds(game);
    } else {
      const targetId = String(payload && payload.targetId || "").trim();
      targetIds = unsolvedHolderIds(game).filter((holderId) => holderId === targetId);
    }

    if (!targetIds.length) {
      callback({ error: "No valid holder target selected." });
      return;
    }

    game.questionsRemaining -= 1;
    game.pendingQuestion = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      askerId: socket.id,
      text,
      targetIds,
      answers: {}
    };

    const asker = getPlayer(lobby, socket.id);
    const askedBy = asker ? asker.name : "Unknown";
    addGameLog(game, `${askedBy} asked: \"${text}\"`);

    emitLobbyState(lobby);
    callback({ error: null });
  });

  socket.on("answer_question", (payload, callback = () => {}) => {
    const lobby = findLobbyBySocketId(socket.id);
    if (!lobby || !lobby.game) {
      callback({ error: "No active game." });
      return;
    }

    const game = lobby.game;
    if (!game.pendingQuestion || game.winner) {
      callback({ error: "No pending question to answer." });
      return;
    }

    if (!game.pendingQuestion.targetIds.includes(socket.id)) {
      callback({ error: "You are not a target for this question." });
      return;
    }

    if (game.pendingQuestion.answers[socket.id]) {
      callback({ error: "You already answered this question." });
      return;
    }

    const rawAnswer = String(payload && payload.answer || "").trim().toLowerCase();
    if (rawAnswer !== "yes" && rawAnswer !== "no") {
      callback({ error: "Answer must be yes or no." });
      return;
    }

    game.pendingQuestion.answers[socket.id] = rawAnswer;
    finalizePendingQuestionIfReady(lobby);
    evaluateWinState(lobby);

    emitLobbyState(lobby);
    callback({ error: null });
  });

  socket.on("make_guess", (payload, callback = () => {}) => {
    const lobby = findLobbyBySocketId(socket.id);
    if (!lobby || !lobby.game) {
      callback({ error: "No active game." });
      return;
    }

    const game = lobby.game;
    if (game.winner) {
      callback({ error: "Game already finished." });
      return;
    }

    if (hasPendingHolderCharacterSelection(game)) {
      callback({ error: "Waiting for holders to lock in secret characters." });
      return;
    }

    if (game.pendingQuestion) {
      callback({ error: "Resolve the current question first." });
      return;
    }

    if (game.turnPlayerId !== socket.id) {
      callback({ error: `It is ${getCurrentPlayerName(lobby)}'s turn.` });
      return;
    }

    const guesser = game.assignments[socket.id];
    if (!guesser || guesser.role !== "guesser") {
      callback({ error: "Only guessers can make guesses." });
      return;
    }

    if (guesser.eliminated) {
      callback({ error: `You are out after ${MAX_GUESSER_STRIKES} incorrect guesses.` });
      return;
    }

    const targetId = String(payload && payload.targetId || "").trim();
    const characterId = String(payload && payload.characterId || "").trim();

    const target = game.assignments[targetId];
    if (!target || target.role !== "holder" || target.solved || !target.character) {
      callback({ error: "Choose an unsolved holder with a locked character." });
      return;
    }

    const guessedCharacter = characters.find((character) => character.id === characterId);
    if (!guessedCharacter) {
      callback({ error: "Choose a valid character." });
      return;
    }

    const actor = getPlayer(lobby, socket.id);
    const targetPlayer = getPlayer(lobby, targetId);

    if (target.character.id === guessedCharacter.id) {
      target.solved = true;
      addGameLog(
        game,
        `${actor ? actor.name : "Unknown"} guessed ${guessedCharacter.name} for ${targetPlayer ? targetPlayer.name : "Unknown"} (correct).`
      );
    } else {
      guesser.strikes = Math.max(0, Number.parseInt(guesser.strikes, 10) || 0) + 1;
      const strikesLeft = Math.max(0, MAX_GUESSER_STRIKES - guesser.strikes);

      addGameLog(
        game,
        `${actor ? actor.name : "Unknown"} guessed ${guessedCharacter.name} for ${targetPlayer ? targetPlayer.name : "Unknown"} (incorrect). Strikes: ${guesser.strikes}/${MAX_GUESSER_STRIKES}.`
      );

      if (guesser.strikes >= MAX_GUESSER_STRIKES) {
        guesser.eliminated = true;
        addGameLog(
          game,
          `${actor ? actor.name : "A guesser"} reached ${MAX_GUESSER_STRIKES} strikes and is out.`
        );
      } else if (strikesLeft > 0) {
        addGameLog(
          game,
          `${actor ? actor.name : "A guesser"} has ${strikesLeft} strike${strikesLeft === 1 ? "" : "s"} left.`
        );
      }
    }

    evaluateWinState(lobby);
    if (!game.winner) {
      advanceTurn(lobby, socket.id);
    }

    emitLobbyState(lobby);
    callback({ error: null });
  });

  socket.on("disconnect", () => {
    const lobby = findLobbyBySocketId(socket.id);
    if (!lobby) {
      return;
    }

    const player = getPlayer(lobby, socket.id);
    lobby.players = lobby.players.filter((entry) => entry.id !== socket.id);

    if (!lobby.players.length) {
      lobbies.delete(lobby.code);
      return;
    }

    if (lobby.hostId === socket.id) {
      lobby.hostId = lobby.players[0].id;
    }

    if (lobby.game) {
      const game = lobby.game;
      const assignment = game.assignments[socket.id];
      delete game.assignments[socket.id];

      game.holderIds = game.holderIds.filter((holderId) => holderId !== socket.id);
      game.guesserOrder = game.guesserOrder.filter((guesserId) => guesserId !== socket.id);

      if (assignment && assignment.role === "holder" && !assignment.solved) {
        addGameLog(game, `${player ? player.name : "A holder"} disconnected. Their character objective was removed.`);
      }

      if (game.pendingQuestion) {
        game.pendingQuestion.targetIds = game.pendingQuestion.targetIds.filter((targetId) => targetId !== socket.id);
        delete game.pendingQuestion.answers[socket.id];
        finalizePendingQuestionIfReady(lobby);
      }

      evaluateWinState(lobby);

      if (!game.winner && game.turnPlayerId === socket.id) {
        advanceTurn(lobby, socket.id);
      }
    }

    emitLobbyState(lobby);
  });
});

async function startServer() {
  await syncCharactersOnLaunch();

  server.listen(PORT, () => {
    console.log(`Uma Guess Who lobby server running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  const reason = error && error.message ? error.message : String(error);
  console.error(`Failed to start server: ${reason}`);
  process.exit(1);
});
