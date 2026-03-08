(() => {
  "use strict";

  const characters = Array.isArray(window.GUESS_WHO_CHARACTERS) ? window.GUESS_WHO_CHARACTERS : [];
  const HOLDER_CHARACTER_MODE_RANDOM = "random";
  const HOLDER_CHARACTER_MODE_HOLDER_CHOICE = "holder_choice";

  const elements = {
    connectScreen: document.getElementById("connect-screen"),
    lobbyScreen: document.getElementById("lobby-screen"),
    connectionStatus: document.getElementById("connection-status"),
    gameScreen: document.getElementById("game-screen"),
    createForm: document.getElementById("create-form"),
    joinForm: document.getElementById("join-form"),
    createName: document.getElementById("create-name"),
    createHolders: document.getElementById("create-holders"),
    createQuestions: document.getElementById("create-questions"),
    createTeams: document.getElementById("create-teams"),
    createCharacterMode: document.getElementById("create-character-mode"),
    createSameQuestion: document.getElementById("create-same-question"),
    joinName: document.getElementById("join-name"),
    joinCode: document.getElementById("join-code"),
    lobbyCode: document.getElementById("lobby-code"),
    lobbyRole: document.getElementById("lobby-role"),
    inviteLink: document.getElementById("invite-link"),
    leaveLobby: document.getElementById("leave-lobby"),
    playerList: document.getElementById("player-list"),
    configForm: document.getElementById("config-form"),
    configHolders: document.getElementById("config-holders"),
    configQuestions: document.getElementById("config-questions"),
    configTeams: document.getElementById("config-teams"),
    configCharacterMode: document.getElementById("config-character-mode"),
    configSameQuestion: document.getElementById("config-same-question"),
    startGame: document.getElementById("start-game"),
    turnStatus: document.getElementById("turn-status"),
    questionStatus: document.getElementById("question-status"),
    winnerBanner: document.getElementById("winner-banner"),
    playerReferenceSection: document.getElementById("player-reference-section"),
    roleSummary: document.getElementById("role-summary"),
    secretCard: document.getElementById("secret-card"),
    holderSelectionPanel: document.getElementById("holder-selection-panel"),
    holderSelectionGrid: document.getElementById("holder-selection-grid"),
    holderSelectionRandom: document.getElementById("holder-selection-random"),
    holderWikiPanel: document.getElementById("holder-wiki-panel"),
    holderWikiFrame: document.getElementById("holder-wiki-frame"),
    holderWikiLink: document.getElementById("holder-wiki-link"),
    actionFormsSection: document.getElementById("action-forms-section"),
    askForm: document.getElementById("ask-form"),
    askTargetWrap: document.getElementById("ask-target-wrap"),
    askTarget: document.getElementById("ask-target"),
    askText: document.getElementById("ask-text"),
    guessForm: document.getElementById("guess-form"),
    guessTarget: document.getElementById("guess-target"),
    guessCharacterWrap: document.getElementById("guess-character-wrap"),
    guessCharacter: document.getElementById("guess-character"),
    guesserBoardPanel: document.getElementById("guesser-board-panel"),
    guesserChoiceGrid: document.getElementById("guesser-choice-grid"),
    pendingSection: document.getElementById("pending-section"),
    pendingText: document.getElementById("pending-text"),
    answerActions: document.getElementById("answer-actions"),
    logSection: document.getElementById("log-section"),
    gameLog: document.getElementById("game-log"),
    imageZoomModal: document.getElementById("image-zoom-modal"),
    imageZoomImage: document.getElementById("image-zoom-image"),
    imageZoomCaption: document.getElementById("image-zoom-caption"),
    imageZoomClose: document.getElementById("image-zoom-close"),
    toast: document.getElementById("toast")
  };

  const state = {
    socket: null,
    lobby: null,
    eliminatedSet: new Set(),
    imageCache: new Map(),
    imageRequests: new Map(),
    socketConnected: false,
    socketAvailable: typeof window.io === "function"
  };

  function showToast(message, isError = false) {
    elements.toast.textContent = message;
    elements.toast.classList.remove("hidden");
    elements.toast.classList.toggle("error", Boolean(isError));

    window.setTimeout(() => {
      elements.toast.classList.add("hidden");
      elements.toast.classList.remove("error");
    }, 2800);
  }

  function getZoomDataFromTarget(target) {
    if (!(target instanceof Element)) {
      return null;
    }

    const trigger = target.closest("[data-open-zoom='true']");
    if (!trigger) {
      return null;
    }

    const src = String(trigger.getAttribute("data-zoom-src") || "").trim();
    if (!src) {
      return null;
    }

    const alt = String(trigger.getAttribute("data-zoom-alt") || "Character").trim() || "Character";
    return { src, alt };
  }

  function openImageZoom(sourceUrl, label = "Character") {
    if (!elements.imageZoomModal || !elements.imageZoomImage || !sourceUrl) {
      return;
    }

    elements.imageZoomImage.src = sourceUrl;
    elements.imageZoomImage.alt = `${label} (zoomed)`;
    if (elements.imageZoomCaption) {
      elements.imageZoomCaption.textContent = label;
    }

    elements.imageZoomModal.classList.remove("hidden");
    elements.imageZoomModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
  }

  function closeImageZoom() {
    if (!elements.imageZoomModal || !elements.imageZoomImage) {
      return;
    }

    elements.imageZoomModal.classList.add("hidden");
    elements.imageZoomModal.setAttribute("aria-hidden", "true");
    elements.imageZoomImage.removeAttribute("src");
    document.body.classList.remove("modal-open");
  }

  function setConnectionStatus(text, isError = false) {
    if (!elements.connectionStatus) {
      return;
    }

    elements.connectionStatus.textContent = `Server: ${text}`;
    elements.connectionStatus.style.color = isError ? "var(--danger)" : "var(--muted)";
  }

  function setEntryActionsEnabled(enabled) {
    const createButton = elements.createForm.querySelector("button[type='submit']");
    const joinButton = elements.joinForm.querySelector("button[type='submit']");
    if (createButton) {
      createButton.disabled = !enabled;
    }
    if (joinButton) {
      joinButton.disabled = !enabled;
    }
  }

  function updateEntryActionAvailability() {
    const available = state.socketAvailable && state.socketConnected;
    setEntryActionsEnabled(available);
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

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function formatTimestamp(isoString) {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function getPlayer(playerId) {
    if (!state.lobby) {
      return null;
    }

    return state.lobby.players.find((player) => player.id === playerId) || null;
  }

  function getYou() {
    return getPlayer(state.lobby ? state.lobby.youId : "");
  }

  function getGame() {
    return state.lobby ? state.lobby.game : null;
  }

  function getYourAssignment(game) {
    if (!game || !state.lobby) {
      return null;
    }

    return game.assignments[state.lobby.youId] || null;
  }

  function holderCharacterMode() {
    if (!state.lobby || !state.lobby.config) {
      return HOLDER_CHARACTER_MODE_RANDOM;
    }

    return state.lobby.config.holderCharacterMode === HOLDER_CHARACTER_MODE_HOLDER_CHOICE
      ? HOLDER_CHARACTER_MODE_HOLDER_CHOICE
      : HOLDER_CHARACTER_MODE_RANDOM;
  }

  function pendingHolderSelectionCount(game) {
    if (!game) {
      return 0;
    }

    const serverCount = Number.parseInt(game.pendingHolderSelectionCount, 10);
    if (!Number.isNaN(serverCount)) {
      return Math.max(0, serverCount);
    }

    return game.holderIds
      .map((holderId) => game.assignments[holderId])
      .filter((assignment) => assignment && assignment.role === "holder" && !assignment.solved && !assignment.character)
      .length;
  }

  function hasPendingHolderCharacterSelection(game) {
    return pendingHolderSelectionCount(game) > 0;
  }

  function isHolderSelectionWindowOpen(game) {
    return holderCharacterMode() === HOLDER_CHARACTER_MODE_HOLDER_CHOICE
      && !game.winner
      && !game.pendingQuestion
      && game.questionsRemaining === game.questionLimit;
  }

  function needsSelfHolderSelection(game) {
    const yourAssignment = getYourAssignment(game);
    return Boolean(
      yourAssignment
      && yourAssignment.role === "holder"
      && !yourAssignment.solved
      && !yourAssignment.character
      && isHolderSelectionWindowOpen(game)
    );
  }

  function sortedCharacters() {
    return [...characters].sort((left, right) => left.name.localeCompare(right.name));
  }

  function getTakenHolderCharacterIds(game, excludedHolderId = "") {
    const taken = new Set();

    for (const [playerId, assignment] of Object.entries(game.assignments)) {
      if (!assignment || assignment.role !== "holder" || !assignment.character) {
        continue;
      }

      if (playerId === excludedHolderId) {
        continue;
      }

      taken.add(assignment.character.id);
    }

    return taken;
  }

  function buildAvailableCharactersForHolder(game, holderId) {
    const taken = getTakenHolderCharacterIds(game, holderId);
    return sortedCharacters().filter((character) => !taken.has(character.id));
  }

  function loadEliminatedSet() {
    if (!state.lobby) {
      state.eliminatedSet = new Set();
      return;
    }

    const key = `uma_guess_who_eliminated_${state.lobby.code}_${state.lobby.youId}`;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        state.eliminatedSet = new Set();
        return;
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        state.eliminatedSet = new Set();
        return;
      }

      state.eliminatedSet = new Set(parsed);
    } catch (_error) {
      state.eliminatedSet = new Set();
    }
  }

  function saveEliminatedSet() {
    if (!state.lobby) {
      return;
    }

    const key = `uma_guess_who_eliminated_${state.lobby.code}_${state.lobby.youId}`;
    try {
      window.localStorage.setItem(key, JSON.stringify([...state.eliminatedSet]));
    } catch (_error) {
      // Ignore storage errors.
    }
  }

  function ensureSocket() {
    if (!state.socketAvailable) {
      setConnectionStatus("socket client missing. Use http://localhost:3000", true);
      updateEntryActionAvailability();
      return null;
    }

    if (state.socket) {
      return state.socket;
    }

    state.socket = window.io({
      reconnection: true,
      timeout: 6000
    });

    state.socket.on("connect", () => {
      state.socketConnected = true;
      setConnectionStatus(`connected (${state.socket.id.slice(0, 6)})`);
      updateEntryActionAvailability();
    });

    state.socket.on("connect_error", () => {
      state.socketConnected = false;
      const offlineHint = window.location.protocol === "file:"
        ? "open through http://localhost:3000"
        : "run npm start and refresh";
      setConnectionStatus(`offline, ${offlineHint}`, true);
      updateEntryActionAvailability();
    });

    state.socket.on("lobby_state", (lobby) => {
      const lobbyChanged = !state.lobby || state.lobby.code !== lobby.code || state.lobby.youId !== lobby.youId;
      state.lobby = lobby;

      if (lobbyChanged) {
        loadEliminatedSet();
      }

      render();
    });

    state.socket.on("action_error", (payload) => {
      showToast(payload && payload.message ? payload.message : "Action failed.", true);
    });

    state.socket.on("disconnect", () => {
      state.socketConnected = false;
      setConnectionStatus("disconnected", true);
      updateEntryActionAvailability();
      showToast("Disconnected from server.", true);
    });

    return state.socket;
  }

  function emitWithAck(eventName, payload, timeoutMs = 8000) {
    return new Promise((resolve) => {
      const socket = ensureSocket();
      if (!socket || !socket.connected) {
        resolve({ error: "Not connected. Start server with npm start, then open http://localhost:3000." });
        return;
      }

      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        resolve({ error: "Server timed out while handling this action." });
      }, timeoutMs);

      try {
        socket.emit(eventName, payload, (response) => {
          if (settled) {
            return;
          }
          settled = true;
          window.clearTimeout(timer);
          resolve(response || { error: "No response." });
        });
      } catch (_error) {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timer);
        resolve({ error: "Failed to send action to server." });
      }
    });
  }

  function buildConfigFromCreateForm() {
    return {
      holdersCount: Number.parseInt(elements.createHolders.value, 10) || 1,
      questionLimit: Number.parseInt(elements.createQuestions.value, 10) || 15,
      teamCount: Number.parseInt(elements.createTeams.value, 10) || 2,
      holderCharacterMode: elements.createCharacterMode.value,
      sameQuestionForAllTargets: elements.createSameQuestion.checked
    };
  }

  function buildConfigFromLobbyForm() {
    return {
      holdersCount: Number.parseInt(elements.configHolders.value, 10) || 1,
      questionLimit: Number.parseInt(elements.configQuestions.value, 10) || 15,
      teamCount: Number.parseInt(elements.configTeams.value, 10) || 2,
      holderCharacterMode: elements.configCharacterMode.value,
      sameQuestionForAllTargets: elements.configSameQuestion.checked
    };
  }

  async function fetchCharacterImage(character) {
    const key = character.id;

    if (state.imageCache.has(key)) {
      return state.imageCache.get(key);
    }

    if (state.imageRequests.has(key)) {
      return state.imageRequests.get(key);
    }

    const title = character.wikiTitle || character.name;
    const apiUrl = `/api/character-image?title=${encodeURIComponent(title)}`;

    const request = window
      .fetch(apiUrl)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("image lookup failed");
        }

        return response.json();
      })
      .then((data) => {
        const imageUrl = data && typeof data.imageUrl === "string" ? data.imageUrl : null;
        state.imageCache.set(key, imageUrl);
        return imageUrl;
      })
      .catch(() => {
        state.imageCache.set(key, null);
        return null;
      })
      .finally(() => {
        state.imageRequests.delete(key);
        renderSecretCard();
        const game = getGame();
        if (game) {
          renderHolderSelectionPanel(game);
        }
        renderGuesserChoiceGrid();
      });

    state.imageRequests.set(key, request);
    return request;
  }

  function buildWikiUrl(title) {
    const pageTitle = String(title || "List_of_Characters").trim() || "List_of_Characters";
    const pagePath = encodeURIComponent(pageTitle).replace(/%20/g, "_");
    return `https://umamusu.wiki/${pagePath}`;
  }

  function renderCharacterCard(targetElement, character, options = {}) {
    const {
      title,
      hidden,
      eliminated,
      subtitle
    } = options;

    if (!character) {
      targetElement.innerHTML = "<p class=\"muted\">No character available.</p>";
      targetElement.classList.remove("eliminated");
      return;
    }

    const hasCachedImage = state.imageCache.has(character.id);
    const cachedImage = hasCachedImage ? state.imageCache.get(character.id) : null;
    if (!hasCachedImage && !hidden) {
      fetchCharacterImage(character);
    }

    targetElement.classList.toggle("eliminated", Boolean(eliminated));

    if (hidden) {
      targetElement.innerHTML = `
        <p><strong>${escapeHtml(title || "Hidden Character")}</strong></p>
        <p class="muted">This character remains hidden until solved.</p>
      `;
      return;
    }

    let imageHtml = "<div class=\"muted\">Loading image from umamusu.wiki...</div>";
    if (hasCachedImage && !cachedImage) {
      imageHtml = "<div class=\"muted\">Image unavailable.</div>";
    } else if (cachedImage) {
      imageHtml = `
        <div class="zoomable-image-shell">
          <img src="${escapeHtml(cachedImage)}" alt="${escapeHtml(character.name)}" loading="lazy">
          <span
            class="zoom-chip"
            data-open-zoom="true"
            data-zoom-src="${escapeHtml(cachedImage)}"
            data-zoom-alt="${escapeHtml(character.name)}"
          >Zoom</span>
        </div>
      `;
    }

    targetElement.innerHTML = `
      <p><strong>${escapeHtml(title || character.name)}</strong></p>
      ${subtitle ? `<p class="muted">${escapeHtml(subtitle)}</p>` : ""}
      ${imageHtml}
    `;
  }
  function renderScreens() {
    const hasLobby = Boolean(state.lobby);
    const hasGame = Boolean(getGame());

    elements.connectScreen.classList.toggle("hidden", hasLobby);
    elements.lobbyScreen.classList.toggle("hidden", !hasLobby || hasGame);
    elements.gameScreen.classList.toggle("hidden", !hasGame);
  }

  function renderLobby() {
    if (!state.lobby || getGame()) {
      return;
    }

    elements.lobbyCode.textContent = state.lobby.code;
    elements.lobbyRole.textContent = state.lobby.youAreHost
      ? "You are the host."
      : `Host: ${(getPlayer(state.lobby.hostId) || {}).name || "Unknown"}`;

    const inviteUrl = `${window.location.origin}${window.location.pathname}?code=${state.lobby.code}`;
    const localHint = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? " (for other devices, replace localhost with your computer LAN IP)"
      : "";

    elements.inviteLink.textContent = `Invite URL: ${inviteUrl}${localHint}`;

    const config = state.lobby.config;
    elements.configHolders.value = String(config.holdersCount);
    elements.configQuestions.value = String(config.questionLimit);
    elements.configTeams.value = String(config.teamCount);
    elements.configCharacterMode.value = config.holderCharacterMode || HOLDER_CHARACTER_MODE_RANDOM;
    elements.configSameQuestion.checked = Boolean(config.sameQuestionForAllTargets);

    const configLocked = !state.lobby.youAreHost;
    for (const control of elements.configForm.querySelectorAll("input, select, button")) {
      control.disabled = configLocked;
    }

    elements.startGame.disabled = !state.lobby.youAreHost;

    const playerItems = state.lobby.players
      .map((player) => {
        const youSuffix = player.id === state.lobby.youId ? " (You)" : "";
        const hostSuffix = player.id === state.lobby.hostId ? " (Host)" : "";

        const canEdit = state.lobby.youAreHost || player.id === state.lobby.youId;
        const teamOptions = Array.from({ length: state.lobby.config.teamCount }, (_, index) => index + 1)
          .map((team) => `<option value="${team}" ${team === player.team ? "selected" : ""}>Team ${team}</option>`)
          .join("");

        return `
          <li>
            <div class="player-meta">
              <strong>${escapeHtml(player.name)}${escapeHtml(youSuffix)}${escapeHtml(hostSuffix)}</strong>
              <span class="small">Role: waiting</span>
            </div>
            <label>
              <span class="small">Team</span>
              <select data-team-player-id="${player.id}" ${canEdit ? "" : "disabled"}>${teamOptions}</select>
            </label>
          </li>
        `;
      })
      .join("");

    elements.playerList.innerHTML = playerItems;
  }

  function holderTargets(game) {
    return game.holderIds
      .map((holderId) => ({
        id: holderId,
        player: getPlayer(holderId),
        assignment: game.assignments[holderId]
      }))
      .filter((entry) => entry.player && entry.assignment && !entry.assignment.solved);
  }

  function renderStatus(game) {
    const turnPlayer = getPlayer(game.turnPlayerId);
    elements.turnStatus.textContent = turnPlayer
      ? `Current turn: ${turnPlayer.name}`
      : "Current turn: Unknown";

    if (hasPendingHolderCharacterSelection(game)) {
      const missingCount = pendingHolderSelectionCount(game);
      const noun = missingCount === 1 ? "holder" : "holders";
      elements.questionStatus.textContent = `Waiting for ${missingCount} ${noun} to lock in character(s). Questions: ${game.questionsRemaining}/${game.questionLimit}`;
    } else {
      elements.questionStatus.textContent = `Questions remaining: ${game.questionsRemaining}/${game.questionLimit}`;
    }

    if (!game.winner) {
      elements.winnerBanner.classList.add("hidden");
      return;
    }

    const winnerNames = game.winner.winnerIds
      .map((playerId) => getPlayer(playerId))
      .filter(Boolean)
      .map((player) => player.name)
      .join(", ");

    const sideText = game.winner.side === "guessers" ? "Guessers" : "Holders";
    const teamText = game.winner.teamNumbers.length ? ` | Teams: ${game.winner.teamNumbers.join(", ")}` : "";

    elements.winnerBanner.textContent = `${sideText} win (${game.winner.reason}). ${winnerNames}${teamText}`;
    elements.winnerBanner.classList.remove("hidden");
  }

  function renderRoleLayout(game) {
    const yourAssignment = getYourAssignment(game);
    const isGuesser = Boolean(yourAssignment && yourAssignment.role === "guesser");
    const isHolder = Boolean(yourAssignment && yourAssignment.role === "holder");
    const requiresSelfHolderSelection = needsSelfHolderSelection(game);

    elements.gameScreen.classList.toggle("guesser-mode", isGuesser);
    elements.gameScreen.classList.toggle("holder-mode", isHolder && !requiresSelfHolderSelection);
    elements.gameScreen.classList.toggle("holder-select-mode", requiresSelfHolderSelection);

    if (isGuesser) {
      elements.holderSelectionPanel.classList.add("hidden");
      elements.playerReferenceSection.classList.add("hidden");
      elements.actionFormsSection.classList.remove("hidden");
      elements.guesserBoardPanel.classList.remove("hidden");
      elements.pendingSection.classList.add("hidden");
      elements.logSection.classList.remove("hidden");
      elements.holderWikiPanel.classList.add("hidden");
      return;
    }

    if (isHolder && requiresSelfHolderSelection) {
      elements.holderSelectionPanel.classList.remove("hidden");
      elements.playerReferenceSection.classList.add("hidden");
      elements.actionFormsSection.classList.add("hidden");
      elements.guesserBoardPanel.classList.add("hidden");
      elements.pendingSection.classList.add("hidden");
      elements.logSection.classList.add("hidden");
      elements.holderWikiPanel.classList.add("hidden");
      return;
    }

    if (isHolder) {
      elements.holderSelectionPanel.classList.add("hidden");
      elements.playerReferenceSection.classList.remove("hidden");
      elements.actionFormsSection.classList.add("hidden");
      elements.guesserBoardPanel.classList.add("hidden");
      elements.pendingSection.classList.remove("hidden");
      elements.logSection.classList.remove("hidden");
      elements.holderWikiPanel.classList.remove("hidden");
      return;
    }

    elements.holderSelectionPanel.classList.add("hidden");
    elements.playerReferenceSection.classList.remove("hidden");
    elements.actionFormsSection.classList.add("hidden");
    elements.guesserBoardPanel.classList.add("hidden");
    elements.pendingSection.classList.add("hidden");
    elements.logSection.classList.remove("hidden");
    elements.holderWikiPanel.classList.add("hidden");
  }

  function renderSecretCard() {
    const game = getGame();
    if (!game || !state.lobby) {
      return;
    }

    const yourAssignment = getYourAssignment(game);
    if (!yourAssignment) {
      elements.roleSummary.textContent = "Spectator";
      elements.secretCard.innerHTML = "<p class=\"muted\">No role assigned.</p>";
      return;
    }

    const you = getYou();
    elements.roleSummary.textContent = `${you ? you.name : "You"} | Role: ${yourAssignment.role}`;

    if (yourAssignment.role === "holder") {
      if (yourAssignment.character) {
        renderCharacterCard(elements.secretCard, yourAssignment.character, {
          title: "Your Secret Character",
          subtitle: yourAssignment.solved ? "Solved" : "Keep this hidden from guessers"
        });
      } else {
        elements.secretCard.innerHTML = "<p class=\"muted\">Pick your secret character, or request a random one.</p>";
      }
      return;
    }

    if (yourAssignment.role === "guesser") {
      const strikes = Math.max(0, Number.parseInt(yourAssignment.strikes, 10) || 0);
      const strikeLimit = 3;
      const eliminated = Boolean(yourAssignment.eliminated) || strikes >= strikeLimit;
      const strikeSummary = eliminated
        ? `You are out (${strikes}/${strikeLimit} strikes).`
        : `Strikes: ${strikes}/${strikeLimit}.`;

      elements.secretCard.innerHTML = `
        <p class="muted">You are guessing. Select a card from the full board, ask questions, and submit guesses on your turn.</p>
        <p class="muted">${escapeHtml(strikeSummary)}</p>
      `;
      return;
    }

    elements.secretCard.innerHTML = "<p class=\"muted\">No secret character for your role.</p>";
  }

  function renderHolderSelectionPanel(game) {
    const shouldShow = needsSelfHolderSelection(game);
    elements.holderSelectionPanel.classList.toggle("hidden", !shouldShow);

    if (!shouldShow) {
      elements.holderSelectionGrid.innerHTML = "";
      return;
    }

    const availableCharacters = buildAvailableCharactersForHolder(game, state.lobby.youId);

    const cards = availableCharacters
      .map((character) => {
        const hasCachedImage = state.imageCache.has(character.id);
        const cachedImage = hasCachedImage ? state.imageCache.get(character.id) : null;
        if (!hasCachedImage && !state.imageRequests.has(character.id)) {
          fetchCharacterImage(character);
        }

        let imageHtml = "<div class=\"muted\">Loading image...</div>";
        if (hasCachedImage && !cachedImage) {
          imageHtml = "<div class=\"muted\">Image unavailable</div>";
        } else if (cachedImage) {
          imageHtml = `
            <img src="${escapeHtml(cachedImage)}" alt="${escapeHtml(character.name)}" loading="lazy">
            <span
              class="zoom-chip"
              data-open-zoom="true"
              data-zoom-src="${escapeHtml(cachedImage)}"
              data-zoom-alt="${escapeHtml(character.name)}"
            >Zoom</span>
          `;
        }

        return `
          <button
            type="button"
            class="choice-card"
            data-holder-character-id="${character.id}"
          >
            <div class="choice-image-shell">${imageHtml}</div>
            <div class="choice-name">${escapeHtml(character.name)}</div>
          </button>
        `;
      })
      .join("");

    elements.holderSelectionGrid.innerHTML = cards;
    elements.holderSelectionRandom.disabled = availableCharacters.length === 0;
  }

  function renderHolderWikiReference(game) {
    const yourAssignment = getYourAssignment(game);
    const character = yourAssignment && yourAssignment.role === "holder" ? yourAssignment.character : null;

    const title = character
      ? (character.wikiTitle || character.name)
      : "List_of_Characters";
    const wikiUrl = buildWikiUrl(title);

    if (character) {
      elements.holderWikiLink.textContent = `Open ${character.name} wiki page in a new tab`;
    } else {
      elements.holderWikiLink.textContent = "Open character list wiki page in a new tab";
    }

    elements.holderWikiLink.href = wikiUrl;

    if (elements.holderWikiFrame.dataset.currentUrl !== wikiUrl) {
      elements.holderWikiFrame.src = wikiUrl;
      elements.holderWikiFrame.dataset.currentUrl = wikiUrl;
    }
  }

  function renderActionForms(game) {
    if (!state.lobby) {
      return;
    }

    const yourAssignment = getYourAssignment(game);
    const isGuesser = Boolean(yourAssignment && yourAssignment.role === "guesser");
    const guesserStrikes = isGuesser
      ? Math.max(0, Number.parseInt(yourAssignment.strikes, 10) || 0)
      : 0;
    const guesserEliminated = isGuesser && (Boolean(yourAssignment.eliminated) || guesserStrikes >= 3);
    const yourTurn = game.turnPlayerId === state.lobby.youId;
    const isGuesserTurn = isGuesser && yourTurn;
    const waitingOnHolderCharacters = hasPendingHolderCharacterSelection(game);
    const targets = holderTargets(game);
    const noTargets = targets.length === 0;

    const targetOptions = targets
      .map((target) => `<option value="${target.id}">${escapeHtml(target.player.name)}</option>`)
      .join("");

    const selectedAskTarget = elements.askTarget.value;
    const selectedGuessTarget = elements.guessTarget.value;

    elements.askTarget.innerHTML = targetOptions;
    elements.guessTarget.innerHTML = targetOptions;

    if (targets.some((target) => target.id === selectedAskTarget)) {
      elements.askTarget.value = selectedAskTarget;
    }

    if (targets.some((target) => target.id === selectedGuessTarget)) {
      elements.guessTarget.value = selectedGuessTarget;
    }

    const sameForAll = Boolean(state.lobby.config.sameQuestionForAllTargets);
    elements.askTargetWrap.classList.toggle("hidden", sameForAll);

    const askLocked = Boolean(
      game.winner
      || game.pendingQuestion
      || !isGuesserTurn
      || game.questionsRemaining <= 0
      || noTargets
      || waitingOnHolderCharacters
      || guesserEliminated
    );

    const guessLocked = Boolean(
      game.winner
      || game.pendingQuestion
      || !isGuesserTurn
      || noTargets
      || waitingOnHolderCharacters
      || guesserEliminated
    );

    for (const control of elements.askForm.querySelectorAll("input, select, button")) {
      control.disabled = !isGuesser || askLocked;
    }

    if (sameForAll || !isGuesser) {
      elements.askTarget.disabled = true;
    }

    for (const control of elements.guessForm.querySelectorAll("select, button")) {
      control.disabled = !isGuesser || guessLocked;
    }

    if (!elements.guessCharacter.options.length) {
      const options = sortedCharacters()
        .map((character) => `<option value="${character.id}">${escapeHtml(character.name)}</option>`)
        .join("");
      elements.guessCharacter.innerHTML = options;
    }

    if (!elements.guessCharacter.value && elements.guessCharacter.options.length) {
      elements.guessCharacter.value = elements.guessCharacter.options[0].value;
    }

    const guessSubmitButton = elements.guessForm.querySelector("button[type='submit']");
    if (guessSubmitButton) {
      if (guesserEliminated) {
        guessSubmitButton.textContent = "Out (3 Strikes)";
      } else if (waitingOnHolderCharacters) {
        guessSubmitButton.textContent = "Waiting For Holder Selection";
      } else {
        const selected = elements.guessCharacter.selectedOptions[0];
        guessSubmitButton.textContent = selected
          ? `Submit Guess (${selected.textContent})`
          : "Submit Guess";
      }
    }
  }

  function renderPendingQuestion(game) {
    const pending = game.pendingQuestion;
    if (!pending) {
      elements.pendingText.textContent = "No pending question.";
      elements.answerActions.classList.add("hidden");
      return;
    }

    const asker = getPlayer(pending.askerId);
    const targetNames = pending.targetIds
      .map((targetId) => getPlayer(targetId))
      .filter(Boolean)
      .map((player) => player.name);

    const answers = pending.targetIds
      .map((targetId) => {
        const player = getPlayer(targetId);
        const answer = pending.answers[targetId] || "(waiting)";
        return `${player ? player.name : targetId}: ${answer}`;
      })
      .join(" | ");

    elements.pendingText.textContent = `${asker ? asker.name : "Unknown"} asked: "${pending.text}" | Targets: ${targetNames.join(", ")} | ${answers}`;

    const canAnswer = pending.targetIds.includes(state.lobby.youId) && !pending.answers[state.lobby.youId] && !game.winner;
    elements.answerActions.classList.toggle("hidden", !canAnswer);
  }

  function renderLog(game) {
    const rows = [...game.log]
      .reverse()
      .map((entry) => `<li><strong>${formatTimestamp(entry.timestamp)}</strong> ${escapeHtml(entry.message)}</li>`)
      .join("");

    elements.gameLog.innerHTML = rows;
  }

  function renderGuesserChoiceGrid() {
    const game = getGame();
    if (!game || !state.lobby || !elements.guesserChoiceGrid) {
      return;
    }

    const yourAssignment = getYourAssignment(game);
    if (!yourAssignment || yourAssignment.role !== "guesser") {
      elements.guesserChoiceGrid.innerHTML = "";
      return;
    }

    const selectedCharacterId = elements.guessCharacter.value;

    const cards = sortedCharacters()
      .map((character) => {
        const hasCachedImage = state.imageCache.has(character.id);
        const cachedImage = hasCachedImage ? state.imageCache.get(character.id) : null;
        if (!hasCachedImage && !state.imageRequests.has(character.id)) {
          fetchCharacterImage(character);
        }

        const isSelected = selectedCharacterId === character.id;
        const isEliminated = state.eliminatedSet.has(character.id);

        let imageHtml = "<div class=\"muted\">Loading image...</div>";
        if (hasCachedImage && !cachedImage) {
          imageHtml = "<div class=\"muted\">Image unavailable</div>";
        } else if (cachedImage) {
          imageHtml = `
            <img src="${escapeHtml(cachedImage)}" alt="${escapeHtml(character.name)}" loading="lazy">
            <span
              class="zoom-chip"
              data-open-zoom="true"
              data-zoom-src="${escapeHtml(cachedImage)}"
              data-zoom-alt="${escapeHtml(character.name)}"
            >Zoom</span>
          `;
        }

        return `
          <button
            type="button"
            class="choice-card${isSelected ? " selected" : ""}${isEliminated ? " eliminated" : ""}"
            data-character-id="${character.id}"
          >
            <div class="choice-image-shell">${imageHtml}</div>
            <div class="choice-name">${escapeHtml(character.name)}</div>
          </button>
        `;
      })
      .join("");

    elements.guesserChoiceGrid.innerHTML = cards;
  }

  function renderGame() {
    const game = getGame();
    if (!game || !state.lobby) {
      return;
    }

    renderRoleLayout(game);
    renderStatus(game);
    renderSecretCard();
    renderHolderSelectionPanel(game);
    renderHolderWikiReference(game);
    renderActionForms(game);
    renderGuesserChoiceGrid();
    renderPendingQuestion(game);
    renderLog(game);
  }

  function render() {
    renderScreens();
    renderLobby();
    renderGame();
  }

  elements.createForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = elements.createName.value.trim();
    if (!name) {
      showToast("Enter your name first.", true);
      return;
    }

    const response = await emitWithAck("create_lobby", {
      name,
      config: buildConfigFromCreateForm()
    });

    if (response.error) {
      showToast(response.error, true);
      return;
    }

    showToast(`Lobby ${response.code} created.`);
  });

  elements.joinForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = elements.joinName.value.trim();
    const code = normalizeLobbyCode(elements.joinCode.value);
    elements.joinCode.value = code;

    if (!name || !code) {
      showToast("Enter name and lobby code.", true);
      return;
    }

    if (code.length !== 6) {
      showToast("Lobby code must be 6 characters.", true);
      return;
    }

    const response = await emitWithAck("join_lobby", { name, code });
    if (response.error) {
      showToast(response.error, true);
      return;
    }

    showToast(`Joined lobby ${response.code}.`);
  });

  elements.joinCode.addEventListener("input", () => {
    const normalized = normalizeLobbyCode(elements.joinCode.value);
    if (elements.joinCode.value !== normalized) {
      elements.joinCode.value = normalized;
    }
  });

  elements.configForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const response = await emitWithAck("update_config", buildConfigFromLobbyForm());
    if (response.error) {
      showToast(response.error, true);
      return;
    }

    showToast("Config updated.");
  });

  elements.playerList.addEventListener("change", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }

    const playerId = target.dataset.teamPlayerId;
    if (!playerId) {
      return;
    }

    const team = Number.parseInt(target.value, 10);
    const response = await emitWithAck("set_team", { playerId, team });
    if (response.error) {
      showToast(response.error, true);
      return;
    }

    showToast("Team updated.");
  });

  elements.startGame.addEventListener("click", async () => {
    const response = await emitWithAck("start_game", {});
    if (response.error) {
      showToast(response.error, true);
      return;
    }

    showToast("Game started.");
  });

  elements.leaveLobby.addEventListener("click", () => {
    window.location.reload();
  });

  elements.askForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const payload = {
      text: elements.askText.value.trim(),
      targetId: elements.askTarget.value
    };

    const response = await emitWithAck("ask_question", payload);
    if (response.error) {
      showToast(response.error, true);
      return;
    }

    elements.askText.value = "";
  });

  elements.guessForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const payload = {
      targetId: elements.guessTarget.value,
      characterId: elements.guessCharacter.value
    };

    const response = await emitWithAck("make_guess", payload);
    if (response.error) {
      showToast(response.error, true);
      return;
    }
  });

  elements.answerActions.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-answer]");
    if (!button) {
      return;
    }

    const response = await emitWithAck("answer_question", {
      answer: button.dataset.answer
    });

    if (response.error) {
      showToast(response.error, true);
    }
  });

  elements.secretCard.addEventListener("click", (event) => {
    const zoomData = getZoomDataFromTarget(event.target);
    if (!zoomData) {
      return;
    }

    event.preventDefault();
    openImageZoom(zoomData.src, zoomData.alt);
  });

  if (elements.imageZoomClose) {
    elements.imageZoomClose.addEventListener("click", () => {
      closeImageZoom();
    });
  }

  if (elements.imageZoomModal) {
    elements.imageZoomModal.addEventListener("click", (event) => {
      if (event.target === elements.imageZoomModal) {
        closeImageZoom();
      }
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeImageZoom();
    }
  });

  elements.holderSelectionGrid.addEventListener("click", async (event) => {
    const zoomData = getZoomDataFromTarget(event.target);
    if (zoomData) {
      event.preventDefault();
      event.stopPropagation();
      openImageZoom(zoomData.src, zoomData.alt);
      return;
    }

    const button = event.target.closest("button.choice-card[data-holder-character-id]");
    if (!button) {
      return;
    }

    const characterId = String(button.dataset.holderCharacterId || "").trim();
    if (!characterId) {
      return;
    }

    const response = await emitWithAck("set_holder_character", {
      characterId
    });

    if (response.error) {
      showToast(response.error, true);
      return;
    }

    showToast("Secret character updated.");
  });

  elements.holderSelectionRandom.addEventListener("click", async () => {
    const response = await emitWithAck("set_holder_character", {
      random: true
    });

    if (response.error) {
      showToast(response.error, true);
      return;
    }

    showToast("Random character assigned.");
  });

  elements.guesserChoiceGrid.addEventListener("click", (event) => {
    const zoomData = getZoomDataFromTarget(event.target);
    if (zoomData) {
      event.preventDefault();
      event.stopPropagation();
      openImageZoom(zoomData.src, zoomData.alt);
      return;
    }

    const button = event.target.closest("button.choice-card[data-character-id]");
    if (!button) {
      return;
    }

    const game = getGame();
    if (!game) {
      return;
    }

    const yourAssignment = getYourAssignment(game);
    if (!yourAssignment || yourAssignment.role !== "guesser") {
      return;
    }

    const characterId = String(button.dataset.characterId || "").trim();
    if (!characterId) {
      return;
    }

    const alreadySelected = elements.guessCharacter.value === characterId;
    elements.guessCharacter.value = characterId;

    if (alreadySelected) {
      if (state.eliminatedSet.has(characterId)) {
        state.eliminatedSet.delete(characterId);
      } else {
        state.eliminatedSet.add(characterId);
      }
      saveEliminatedSet();
    }

    renderActionForms(game);
    renderGuesserChoiceGrid();
  });

  elements.guessCharacter.addEventListener("change", () => {
    const game = getGame();
    if (!game) {
      return;
    }

    renderActionForms(game);
    renderGuesserChoiceGrid();
  });

  const initialCode = normalizeLobbyCode(new URLSearchParams(window.location.search).get("code"));
  if (initialCode) {
    elements.joinCode.value = initialCode;
  }

  render();
  updateEntryActionAvailability();

  if (window.location.protocol === "file:") {
    setConnectionStatus("file:// mode is unsupported. Open http://localhost:3000", true);
    showToast("Run npm start and open http://localhost:3000. Do not open index.html directly.", true);
  } else {
    setConnectionStatus("connecting...");
    ensureSocket();
  }

  if (!characters.length) {
    showToast("Character list is missing.", true);
  }
})();















