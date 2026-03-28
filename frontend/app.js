// -----------------------------------------------
// AI Parliament — Control Room Frontend Logic
// -----------------------------------------------

const API = "";

// --- State ---
let gameState = null;
let shortsQueue = [];
let currentShort = null;
let shortsPlayer = null;
let ytApiReadyPromise = null;
let shortReactionPending = false;
let chaosCards = [];
let armedChaosCard = null;
let lastAppliedChaosId = null;
let awaitingVote = false;

// --- TTS Engine ---
let availableVoices = [];
let contestantVoices = {};
let hostVoice = null;

// --- Avatars & SFX ---
const avatars = {
    "The Observational": "🧐",
    "The Deadpan": "😐",
    "The Absurdist": "🤪",
    "The Insult Comic": "🤬",
    "The Storyteller": "📚",
    "The Dad": "👨",
    "The Edgelord": "💀",
    "The Conspiracy Theorist": "👽",
    "The Hindi Comic": "👳",
    "default": "🤖"
};

const sfx = {
    laugh: new Audio("https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3"),
    crickets: new Audio("https://assets.mixkit.co/active_storage/sfx/2533/2533-preview.mp3"),
    boo: new Audio("https://assets.mixkit.co/active_storage/sfx/2552/2552-preview.mp3"),
    trapdoor: new Audio("https://assets.mixkit.co/active_storage/sfx/2573/2573-preview.mp3") 
};
Object.values(sfx).forEach(audio => audio.volume = 0.6);

function loadVoices() {
    availableVoices = window.speechSynthesis.getVoices();
}
window.speechSynthesis.onvoiceschanged = loadVoices;
// Try loading immediately in case they are already available
loadVoices();

function assignVoices(contestants) {
    if (availableVoices.length === 0) loadVoices();
    
    // Filter to English and Hindi voices (or all if none)
    let targetVoices = availableVoices.filter(v => v.lang.startsWith('en') || v.lang.startsWith('hi') || v.lang.includes('IN'));
    if (targetVoices.length === 0) targetVoices = availableVoices;
    
    let usedVoices = new Set();
    
    // Assign Host Voice exclusively first
    let bestHost = null;
    let highestHostScore = -Infinity;
    targetVoices.forEach(v => {
        let score = 0;
        let vName = v.name.toLowerCase();
        if (vName.includes("guy") || vName.includes("announcer") || vName.includes("news")) score += 20;
        if (v.name.includes("Microsoft Mark") || v.name.includes("Google UK English Male")) score += 30;
        if (score > highestHostScore) {
            highestHostScore = score;
            bestHost = v;
        }
    });
    if (bestHost) {
        hostVoice = bestHost;
        usedVoices.add(bestHost.name);
    }
    
    // Personality Keyword Matchers
    const preferences = {
        "The Observational": ["us", "male", "guy", "ryan", "josh"],
        "The Deadpan": ["uk", "gb", "female", "deadpan", "clara", "aria"],
        "The Absurdist": ["us", "male", "eric", "thomas", "christopher"],
        "The Insult Comic": ["uk", "gb", "male", "george", "arthur"],
        "The Storyteller": ["us", "male", "andrew", "william"],
        "The Dad": ["us", "male", "david", "arthur", "old", "deep"],
        "The Edgelord": ["uk", "gb", "male", "brian", "ryan"],
        "The Conspiracy Theorist": ["us", "male", "fast", "crazy", "andrew", "guy", "eric"]
    };

    contestants.forEach((c) => {
        let prefs = preferences[c.name] || [];
        let bestVoice = null;
        let highestScore = -Infinity;

        // Shuffle voices slightly so identical ties get broken randomly
        let shuffledVoices = [...targetVoices].sort(() => Math.random() - 0.5);

        shuffledVoices.forEach(v => {
            // STRICTLY block used voices 
            if (usedVoices.has(v.name)) return;
            
            let score = 0;
            let vName = v.name.toLowerCase();
            let vLang = v.lang.toLowerCase();
            
            // Premium cloud voices base score
            if (vName.includes("natural") || vName.includes("google") || vName.includes("premium")) score += 20;
            if (!v.localService) score += 10;
            
            // Match personality traits
            prefs.forEach(p => {
                if (vName.includes(p) || vLang.includes(p)) score += 15;
            });

            if (score > highestScore) {
                highestScore = score;
                bestVoice = v;
            }
        });

        // CRITICAL FALLBACK: If we ran out of unique voices on this computer, just recycle a random one.
        if (!bestVoice && targetVoices.length > 0) {
            bestVoice = targetVoices[Math.floor(Math.random() * targetVoices.length)];
        }

        if (bestVoice) {
            contestantVoices[c.name] = bestVoice;
            usedVoices.add(bestVoice.name);
        }
    });
}

function playHostAudio(text) {
    window.speechSynthesis.cancel(); 
    const ut = new SpeechSynthesisUtterance(text);
    if (hostVoice) ut.voice = hostVoice;
    ut.pitch = 0.95;
    ut.rate = 1.15;
    window.speechSynthesis.speak(ut);
}

function playAnswerAudio(name, text) {
    window.speechSynthesis.cancel(); 
    
    // Stop talking on all cards
    const cards = document.querySelectorAll('.contestant-card');
    cards.forEach(c => c.classList.remove('talking'));
    
    // Add talking to current card
    cards.forEach(card => {
        const nameNode = card.querySelector('.contestant-name');
        if (nameNode && nameNode.textContent.toLowerCase() === name.toLowerCase()) {
            card.classList.add('talking');
        }
    });

    const ut = new SpeechSynthesisUtterance(text);
    
    ut.onend = () => {
        cards.forEach(c => c.classList.remove('talking'));
    };
    
    // Apply their matched personality voice
    if (contestantVoices[name]) {
        ut.voice = contestantVoices[name];
    }
    
    // Hash their name to give standard voices a reproducible micro-pitch
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash += name.charCodeAt(i);

    if (name === "The Deadpan") {
        ut.pitch = 0.92;
        ut.rate = 1;
    } else if (name === "The Dad") {
        ut.pitch = 0.7; // Very deep
        ut.rate = 1; // Fast
    } else if (name === "The Conspiracy Theorist") {
        ut.pitch = 1.15; // Fast and nervous
        ut.rate = 1.25;
    } else {
        ut.pitch = 0.95 + ((hash % 10) / 100); 
        ut.rate = 1;
    }
    
    window.speechSynthesis.speak(ut);
}

// --- DOM Refs ---
const roundNumber = document.getElementById("roundNumber");
const elimCount = document.getElementById("elimCount");
const statusText = document.getElementById("statusText");
const statusDot = document.querySelector(".status-dot");
const contestantGrid = document.getElementById("contestantGrid");
const btnStart = document.getElementById("btnStart");
const btnRound = document.getElementById("btnRound");
const btnVote = document.getElementById("btnVote");
const btnEliminate = document.getElementById("btnEliminate");
const btnChaos = document.getElementById("btnChaos");
const btnChaosClear = document.getElementById("btnChaosClear");
const customSituation = document.getElementById("customSituation");
const elimThreshold = document.getElementById("elimThreshold");
const resultsSection = document.getElementById("resultsSection");
const situationDisplay = document.getElementById("situationDisplay");
const chaosPanel = document.getElementById("chaosPanel");
const chaosTitle = document.getElementById("chaosTitle");
const chaosDescription = document.getElementById("chaosDescription");
const chaosBanner = document.getElementById("chaosBanner");
const chaosBannerName = document.getElementById("chaosBannerName");
const chaosBannerDescription = document.getElementById("chaosBannerDescription");
const answersGrid = document.getElementById("answersGrid");
const votesPanel = document.getElementById("votesPanel");
const voteList = document.getElementById("voteList");
const voteTally = document.getElementById("voteTally");
const eliminationFeed = document.getElementById("eliminationFeed");
const eliminationList = document.getElementById("eliminationList");
const loadingOverlay = document.getElementById("loadingOverlay");
const loaderText = document.getElementById("loaderText");
const shortUrlInput = document.getElementById("shortUrlInput");
const shortTitleInput = document.getElementById("shortTitleInput");
const shortCaptionInput = document.getElementById("shortCaptionInput");
const shortsQueueList = document.getElementById("shortsQueueList");
const shortsPlayerEmpty = document.getElementById("shortsPlayerEmpty");
const shortsNowPlayingTitle = document.getElementById("shortsNowPlayingTitle");
const shortsNowPlayingCaption = document.getElementById("shortsNowPlayingCaption");
const btnPlayShort = document.getElementById("btnPlayShort");
const shortsStatusPill = document.getElementById("shortsStatusPill");
const shortsReactionsSection = document.getElementById("shortsReactionsSection");
const shortsAnswersGrid = document.getElementById("shortsAnswersGrid");
const hasShortsLab = Boolean(
    shortUrlInput &&
    shortTitleInput &&
    shortCaptionInput &&
    shortsQueueList &&
    shortsPlayerEmpty &&
    shortsNowPlayingTitle &&
    shortsNowPlayingCaption &&
    btnPlayShort &&
    shortsStatusPill &&
    shortsReactionsSection &&
    shortsAnswersGrid
);

// --- Helpers ---
function showLoading(text = "PROCESSING...") {
    loaderText.textContent = text;
    loadingOverlay.style.display = "flex";
}

function hideLoading() {
    loadingOverlay.style.display = "none";
}

function setStatus(text, color = "var(--accent-green)") {
    statusText.textContent = text;
    statusDot.style.background = color;
    statusDot.style.boxShadow = `0 0 8px ${color}`;
}

function setShortsStatus(text, tone = "idle") {
    if (!shortsStatusPill) return;

    const palette = {
        idle: {
            text: "var(--accent-orange)",
            border: "rgba(245, 158, 11, 0.25)",
            background: "rgba(245, 158, 11, 0.12)"
        },
        ready: {
            text: "var(--accent-cyan)",
            border: "rgba(0, 212, 255, 0.28)",
            background: "rgba(0, 212, 255, 0.12)"
        },
        live: {
            text: "var(--accent-blue)",
            border: "rgba(59, 130, 246, 0.28)",
            background: "rgba(59, 130, 246, 0.12)"
        },
        done: {
            text: "var(--accent-green)",
            border: "rgba(16, 185, 129, 0.28)",
            background: "rgba(16, 185, 129, 0.12)"
        },
        error: {
            text: "var(--accent-red)",
            border: "rgba(239, 68, 68, 0.3)",
            background: "rgba(239, 68, 68, 0.12)"
        }
    };

    const colors = palette[tone] || palette.idle;
    shortsStatusPill.textContent = text;
    shortsStatusPill.style.color = colors.text;
    shortsStatusPill.style.borderColor = colors.border;
    shortsStatusPill.style.background = colors.background;
}

function syncChaosCards(cards = []) {
    if (!Array.isArray(cards) || cards.length === 0) return;

    chaosCards = cards.map((card) => ({ ...card }));
    if (armedChaosCard) {
        armedChaosCard = chaosCards.find((card) => card.id === armedChaosCard.id) || armedChaosCard;
    }
    renderChaosState();
}

function pickRandomChaosCard() {
    if (chaosCards.length === 0) return null;

    const excludedIds = new Set(
        [armedChaosCard?.id, lastAppliedChaosId].filter(Boolean)
    );
    const eligibleCards = chaosCards.filter((card) => !excludedIds.has(card.id));
    const pool = eligibleCards.length > 0 ? eligibleCards : chaosCards;
    return pool[Math.floor(Math.random() * pool.length)];
}

function renderChaosState() {
    if (!chaosTitle || !chaosDescription) return;

    if (armedChaosCard) {
        chaosTitle.textContent = armedChaosCard.name.toUpperCase();
        chaosDescription.textContent = armedChaosCard.summary;
        if (chaosPanel) chaosPanel.classList.add("armed");
    } else {
        chaosTitle.textContent = "No chaos armed";
        chaosDescription.textContent = "Press the Chaos Button to force the next round into a cursed new format.";
        if (chaosPanel) chaosPanel.classList.remove("armed");
    }

    updateChaosControls();
}

function showChaosBanner(card = null) {
    if (!chaosBanner || !chaosBannerName || !chaosBannerDescription) return;

    if (!card) {
        chaosBanner.style.display = "none";
        chaosBannerName.textContent = "";
        chaosBannerDescription.textContent = "";
        return;
    }

    chaosBanner.style.display = "grid";
    chaosBannerName.textContent = card.name.toUpperCase();
    chaosBannerDescription.textContent = card.summary;
}

function updateChaosControls() {
    const canUseChaos = Boolean(gameState) && !gameState.game_over && !awaitingVote;

    if (btnChaos) {
        btnChaos.disabled = !canUseChaos || chaosCards.length === 0;
    }

    if (btnChaosClear) {
        btnChaosClear.disabled = !canUseChaos || !armedChaosCard;
    }
}

function armChaos() {
    if (!gameState || gameState.game_over) return;

    const nextCard = pickRandomChaosCard();
    if (!nextCard) {
        alert("No chaos cards are configured yet.");
        return;
    }

    armedChaosCard = nextCard;
    renderChaosState();
    setStatus("CHAOS ARMED", "var(--accent-pink)");
}

function clearChaos() {
    armedChaosCard = null;
    renderChaosState();
}

function getShortDisplayTitle(shortItem, fallback = "Untitled Short") {
    if (!shortItem) return fallback;
    return shortItem.title || shortItem.caption || fallback;
}

function renderShortsQueue() {
    if (!shortsQueueList) return;

    if (shortsQueue.length === 0) {
        shortsQueueList.innerHTML = '<div class="shorts-queue-empty">No Shorts queued yet.</div>';
        btnPlayShort.disabled = true;
        if (!currentShort) setShortsStatus("QUEUE EMPTY", "idle");
        return;
    }

    shortsQueueList.innerHTML = "";
    shortsQueue.forEach((item, index) => {
        const queueItem = document.createElement("div");
        queueItem.className = "shorts-queue-item";
        queueItem.innerHTML = `
            <span class="shorts-queue-order">${index + 1}</span>
            <div class="shorts-queue-content">
                <span class="shorts-queue-title">${escapeHtml(getShortDisplayTitle(item, `Short ${index + 1}`))}</span>
                <span class="shorts-queue-caption">${escapeHtml(item.caption || "No extra caption provided.")}</span>
                <span class="shorts-queue-url">${escapeHtml(item.url)}</span>
            </div>
        `;
        shortsQueueList.appendChild(queueItem);
    });

    btnPlayShort.disabled = false;
    if (!currentShort) {
        const noun = shortsQueue.length === 1 ? "SHORT" : "SHORTS";
        setShortsStatus(`${shortsQueue.length} ${noun} QUEUED`, "ready");
    }
}

function updateShortNowPlaying(shortItem = null) {
    if (!hasShortsLab) return;

    if (!shortItem) {
        shortsNowPlayingTitle.textContent = "No Short loaded";
        shortsNowPlayingCaption.textContent = "Add a URL and a little context so the contestants know what they are reacting to.";
        shortsPlayerEmpty.style.display = "flex";
        return;
    }

    shortsNowPlayingTitle.textContent = getShortDisplayTitle(shortItem);
    shortsNowPlayingCaption.textContent = shortItem.caption || "No extra caption provided for this Short.";
}

function clearShortReactions() {
    if (!hasShortsLab) return;
    shortsReactionsSection.style.display = "none";
    shortsAnswersGrid.innerHTML = "";
}

function extractYouTubeVideoId(input) {
    const trimmed = (input || "").trim();
    if (!trimmed) return null;

    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
        return {
            videoId: trimmed,
            normalizedUrl: `https://www.youtube.com/shorts/${trimmed}`
        };
    }

    try {
        const url = new URL(trimmed);
        const host = url.hostname.replace(/^www\./, "").toLowerCase();
        let videoId = "";

        if (host === "youtu.be") {
            videoId = url.pathname.split("/").filter(Boolean)[0] || "";
        } else if (host.endsWith("youtube.com")) {
            if (url.pathname.startsWith("/shorts/")) {
                videoId = url.pathname.split("/")[2] || "";
            } else if (url.pathname.startsWith("/embed/")) {
                videoId = url.pathname.split("/")[2] || "";
            } else {
                videoId = url.searchParams.get("v") || "";
            }
        }

        if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;

        return {
            videoId,
            normalizedUrl: `https://www.youtube.com/shorts/${videoId}`
        };
    } catch {
        return null;
    }
}

function ensureYouTubeApi() {
    if (window.YT && typeof window.YT.Player === "function") {
        return Promise.resolve(window.YT);
    }

    if (!ytApiReadyPromise) {
        ytApiReadyPromise = new Promise((resolve, reject) => {
            let settled = false;
            const finish = (value, error = null) => {
                if (settled) return;
                settled = true;
                if (error) {
                    reject(error);
                    return;
                }
                resolve(value);
            };

            const previousHandler = window.onYouTubeIframeAPIReady;
            window.onYouTubeIframeAPIReady = () => {
                if (typeof previousHandler === "function") previousHandler();
                finish(window.YT);
            };

            if (!document.getElementById("youtubeIframeApi")) {
                const script = document.createElement("script");
                script.id = "youtubeIframeApi";
                script.src = "https://www.youtube.com/iframe_api";
                script.async = true;
                script.onerror = () => finish(null, new Error("Failed to load the YouTube player API."));
                document.head.appendChild(script);
            }

            window.setTimeout(() => {
                if (!(window.YT && typeof window.YT.Player === "function")) {
                    finish(null, new Error("Timed out while loading the YouTube player API."));
                }
            }, 15000);
        });
    }

    return ytApiReadyPromise;
}

function mountShortPlayer(videoId) {
    if (!hasShortsLab) return;
    shortsPlayerEmpty.style.display = "none";

    if (shortsPlayer && typeof shortsPlayer.loadVideoById === "function") {
        shortsPlayer.loadVideoById(videoId);
        return;
    }

    shortsPlayer = new window.YT.Player("shortsPlayer", {
        videoId,
        playerVars: {
            autoplay: 1,
            controls: 1,
            rel: 0,
            playsinline: 1,
            modestbranding: 1
        },
        events: {
            onReady: (event) => event.target.playVideo(),
            onStateChange: onShortPlayerStateChange
        }
    });
}

function onShortPlayerStateChange(event) {
    if (!hasShortsLab) return;
    if (!window.YT || !currentShort) return;

    if (event.data === window.YT.PlayerState.PLAYING) {
        setStatus("SHORT PLAYING", "var(--accent-cyan)");
        setShortsStatus("PLAYING SHORT", "live");
    }

    if (event.data === window.YT.PlayerState.ENDED && !shortReactionPending) {
        generateShortReactionsForCurrentShort();
    }
}

// --- Render Functions ---
function renderContestants(contestants, roundResult = null) {
    contestantGrid.innerHTML = "";

    contestants.forEach((c) => {
        const card = document.createElement("div");
        card.className = "contestant-card";

        if (!c.alive) card.classList.add("eliminated");
        if (roundResult && roundResult.winner === c.name) card.classList.add("winner");

        const votesReceived =
            roundResult && roundResult.vote_counts ? roundResult.vote_counts[c.name] || 0 : null;

        card.innerHTML = `
            <div class="contestant-header">
                <span class="contestant-name">${c.name.toUpperCase()}</span>
                <span class="contestant-status ${c.alive ? "alive" : "dead"}">
                    ${c.alive ? "ACTIVE" : "ELIMINATED"}
                </span>
            </div>
            <div class="avatar-container">
                <span class="contestant-avatar">${avatars[c.name] || avatars['default']}</span>
            </div>
            <div class="contestant-model">${c.model}</div>
            <div class="contestant-stats">
                <div class="stat">
                    <span class="stat-label">WINS</span>
                    <span class="stat-value wins">${c.wins}</span>
                </div>
                <div class="stat">
                    <span class="stat-label">LOSSES</span>
                    <span class="stat-value losses">${c.losses}</span>
                </div>
                ${
                    votesReceived !== null
                        ? `<div class="stat">
                            <span class="stat-label">VOTES</span>
                            <span class="stat-value" style="color: var(--accent-cyan)">${votesReceived}</span>
                        </div>`
                        : ""
                }
            </div>
        `;

        contestantGrid.appendChild(card);
    });
}

function renderAnswers(result) {
    resultsSection.style.display = "block";
    votesPanel.style.display = "none"; // Hide votes initially

    // Situation
    situationDisplay.textContent = result.situation;
    showChaosBanner(result.chaos_card || null);
    
    // Host speaks the situation automatically!
    playHostAudio("The scenario is: " + result.situation);

    // Answers
    answersGrid.innerHTML = "";
    result.answers.forEach((ans) => {
        const card = document.createElement("div");
        card.className = "answer-card";

        card.innerHTML = `
            <div class="answer-header">
                <span class="answer-name">${ans.name.toUpperCase()}</span>
                <div class="header-actions">
                    <button class="btn-tts" title="Play Answer Audio">🔊 PLAY</button>
                </div>
            </div>
            <div class="answer-text">${escapeHtml(ans.answer)}</div>
        `;
        
        // Wire up TTS click event safely
        const btnTts = card.querySelector('.btn-tts');
        btnTts.addEventListener('click', () => {
            playAnswerAudio(ans.name, ans.answer);
            btnTts.style.background = 'rgba(16, 185, 129, 0.4)';
            setTimeout(() => btnTts.style.background = '', 300);
        });
        
        answersGrid.appendChild(card);
    });

    // Scroll to results
    resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderVotes(result) {
    votesPanel.style.display = "block";

    // Highlight winner/loser
    const cards = answersGrid.querySelectorAll('.answer-card');
    cards.forEach(card => {
        const nameNode = card.querySelector('.answer-name');
        if (!nameNode) return;
        const name = nameNode.textContent.toLowerCase();
        
        if (name === result.winner.toLowerCase()) card.classList.add("round-winner");
        if (name === result.loser.toLowerCase()) card.classList.add("round-loser");

        const votes = result.vote_counts[nameNode.textContent] || result.vote_counts[nameNode.textContent.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')] || 0;
        
        // Inject vote count into header actions
        const actions = card.querySelector('.header-actions');
        const voteSpan = document.createElement('span');
        voteSpan.className = 'answer-votes';
        voteSpan.textContent = `${votes} vote${votes !== 1 ? "s" : ""}`;
        actions.prepend(voteSpan);
    });

    // Votes
    voteList.innerHTML = "";
    result.votes.forEach((v) => {
        const item = document.createElement("span");
        item.className = "vote-item";
        item.innerHTML = `<span class="voter">${v.voter}</span><span class="arrow">→</span><span class="voted-for">${v.voted_for}</span>`;
        voteList.appendChild(item);
    });

    // Tally
    voteTally.innerHTML = "";
    const sortedTally = Object.entries(result.vote_counts).sort((a, b) => b[1] - a[1]);
    sortedTally.forEach(([name, count]) => {
        const bar = document.createElement("div");
        bar.className = "tally-bar";
        bar.innerHTML = `<span class="tally-name">${name}</span><span class="tally-count">${count}</span>`;
        voteTally.appendChild(bar);
    });
}

function renderShortReactionAnswers(result) {
    if (!hasShortsLab) return;
    shortsReactionsSection.style.display = "block";
    shortsAnswersGrid.innerHTML = "";

    result.answers.forEach((ans) => {
        const card = document.createElement("div");
        card.className = "answer-card";
        card.innerHTML = `
            <div class="answer-header">
                <span class="answer-name">${ans.name.toUpperCase()}</span>
                <div class="header-actions">
                    <button class="btn-tts" title="Play Answer Audio">🔊 PLAY</button>
                </div>
            </div>
            <div class="answer-text">${escapeHtml(ans.answer)}</div>
        `;

        const btnTts = card.querySelector(".btn-tts");
        btnTts.addEventListener("click", () => {
            playAnswerAudio(ans.name, ans.answer);
            btnTts.style.background = "rgba(16, 185, 129, 0.4)";
            setTimeout(() => btnTts.style.background = "", 300);
        });

        shortsAnswersGrid.appendChild(card);
    });

    shortsReactionsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderEliminationFeed(eliminated) {
    if (!eliminated || eliminated.length === 0) {
        eliminationFeed.style.display = "none";
        return;
    }

    eliminationFeed.style.display = "block";
    eliminationList.innerHTML = "";

    eliminated.forEach((e) => {
        const entry = document.createElement("div");
        entry.className = "elimination-entry";
        entry.innerHTML = `
            <div class="elim-info">
                <span class="elim-name">☠ ${e.name}</span>
                <span class="elim-reason">${e.final_wins} wins / ${e.final_losses} losses</span>
            </div>
            <span class="elim-round">Round ${e.round_eliminated}</span>
        `;
        eliminationList.appendChild(entry);
    });
}

function updateUI(state, roundResult = null) {
    gameState = state;
    syncChaosCards(state.chaos_cards || []);
    roundNumber.textContent = state.round_number;
    elimCount.textContent = state.rounds_until_elimination;
    renderContestants(state.contestants, roundResult);
    renderEliminationFeed(state.eliminated);
    updateChaosControls();

    if (state.game_over) {
        clearChaos();
        btnRound.disabled = true;
        btnEliminate.disabled = true;
        const btnVote = document.getElementById("btnVote");
        if (btnVote) btnVote.disabled = true;
        if (btnChaos) btnChaos.disabled = true;
        if (btnChaosClear) btnChaosClear.disabled = true;
        
        let winner = state.contestants.find(c => c.alive);
        if (winner) {
            setStatus("WINNER CROWNED", "var(--accent-pink)");
            const timerDiv = document.querySelector('.elimination-timer');
            if (timerDiv) {
                timerDiv.innerHTML = `<span style="color:var(--accent-pink); font-size: 1.1rem; font-weight: bold; letter-spacing: 2px;">🏆 ${winner.name.toUpperCase()} WINS! 🏆</span>`;
            }
            playHostAudio(`The game is over! ${winner.name} is the last comedian standing and wins the crown!`);
        } else {
            setStatus("GAME OVER", "var(--accent-orange)");
        }
    }
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

// --- API Calls ---
async function updateSettings() {
    const val = parseInt(elimThreshold.value);
    if (!val || val < 1) return;
    
    try {
        const res = await fetch("/api/game/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ elimination_threshold: val })
        });
        const data = await res.json();
        updateUI(data.state);
    } catch (e) {
        console.error("Settings failed", e);
    }
}

function queueShort() {
    if (!hasShortsLab) return;
    const rawUrl = shortUrlInput.value.trim();
    const title = shortTitleInput.value.trim();
    const caption = shortCaptionInput.value.trim();

    if (!rawUrl) {
        alert("Paste a YouTube Shorts URL, watch URL, or raw video ID first.");
        return;
    }

    if (!title && !caption) {
        alert("Add at least a title or a caption so the contestants have some context.");
        return;
    }

    const parsed = extractYouTubeVideoId(rawUrl);
    if (!parsed) {
        alert("That does not look like a valid YouTube Shorts or YouTube video link.");
        return;
    }

    const fallbackTitle = title || caption.slice(0, 70) || "Untitled Short";
    shortsQueue.push({
        videoId: parsed.videoId,
        url: parsed.normalizedUrl,
        title: fallbackTitle,
        caption
    });

    shortUrlInput.value = "";
    shortTitleInput.value = "";
    shortCaptionInput.value = "";
    renderShortsQueue();
}

async function playNextShort() {
    if (!hasShortsLab) return;
    if (shortsQueue.length === 0) {
        alert("Queue a Short first.");
        return;
    }

    currentShort = shortsQueue.shift();
    shortReactionPending = false;
    clearShortReactions();
    updateShortNowPlaying(currentShort);
    renderShortsQueue();
    setShortsStatus("LOADING PLAYER", "live");

    try {
        await ensureYouTubeApi();
        mountShortPlayer(currentShort.videoId);
    } catch (err) {
        console.error("YouTube player failed", err);
        setShortsStatus("PLAYER ERROR", "error");
        setStatus("SHORT PLAYER ERROR", "var(--accent-red)");
        alert("Failed to load the YouTube player: " + err.message);
    }
}

async function generateShortReactionsForCurrentShort() {
    if (!hasShortsLab) return;
    if (!currentShort || shortReactionPending) return;

    shortReactionPending = true;
    showLoading("CONTESTANTS ARE REACTING TO THE SHORT...");
    setStatus("SHORT COMPLETE", "var(--accent-orange)");
    setShortsStatus("GENERATING REACTIONS", "live");

    try {
        const res = await fetch(`${API}/api/game/shorts/react`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                url: currentShort.url,
                title: currentShort.title,
                caption: currentShort.caption
            }),
        });
        const data = await res.json();

        if (data.result.error) {
            setShortsStatus("REACTION ERROR", "error");
            alert(data.result.error);
            shortReactionPending = false;
            return;
        }

        updateUI(data.state);
        renderShortReactionAnswers(data.result);
        setStatus("REACTIONS READY", "var(--accent-green)");
        setShortsStatus("REACTIONS READY", "done");
    } catch (err) {
        console.error("Short reactions failed", err);
        setStatus("SHORTS ERROR", "var(--accent-red)");
        setShortsStatus("REACTION ERROR", "error");
        shortReactionPending = false;
        alert("Failed to generate Short reactions: " + err.message);
    } finally {
        hideLoading();
    }
}

async function startGame() {
    showLoading("INITIALIZING ARENA...");
    setStatus("INITIALIZING", "var(--accent-orange)");

    try {
        const res = await fetch(`${API}/api/game/start`, { method: "POST" });
        const data = await res.json();

        updateUI(data.state);
        awaitingVote = false;
        lastAppliedChaosId = null;
        clearChaos();
        showChaosBanner(null);
        resultsSection.style.display = "none";
        btnVote.style.display = "none";
        btnRound.style.display = "inline-flex";
        btnRound.disabled = false;
        btnEliminate.disabled = true;
        customSituation.disabled = false;
        updateChaosControls();
        setStatus("READY", "var(--accent-green)");
        btnStart.innerHTML = '<span class="btn-icon">↻</span> RESTART GAME';
    } catch (err) {
        setStatus("ERROR", "var(--accent-red)");
        alert("Failed to start game: " + err.message);
    } finally {
        hideLoading();
    }
}

async function generateAnswers() {
    const situation = customSituation.value.trim() || null;
    const payload = {};
    if (situation) payload.situation = situation;
    if (armedChaosCard) payload.chaos_id = armedChaosCard.id;

    showLoading(
        armedChaosCard
            ? `UNLEASHING ${armedChaosCard.name.toUpperCase()}...`
            : "GENERATING AWKWARD SITUATION..."
    );
    setStatus("GENERATING", "var(--accent-cyan)");
    btnRound.disabled = true;
    updateChaosControls();

    try {
        const res = await fetch(`${API}/api/game/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const data = await res.json();

        if (data.result.error) {
            alert(data.result.error);
            btnRound.disabled = false;
            updateChaosControls();
            return;
        }

        awaitingVote = true;
        renderAnswers(data.result);
        if (data.result.chaos_card) {
            lastAppliedChaosId = data.result.chaos_card.id;
        }
        armedChaosCard = null;
        renderChaosState();

        // Switch buttons
        btnRound.style.display = "none";
        btnVote.style.display = "inline-flex";
        btnVote.disabled = false;
        
        setStatus("AWAITING VOTE", "var(--accent-orange)");
        customSituation.value = "";
    } catch (err) {
        setStatus("ERROR", "var(--accent-red)");
        alert("Generation failed: " + err.message);
        btnRound.disabled = false;
        updateChaosControls();
    } finally {
        hideLoading();
    }
}

async function executeVoting() {
    showLoading("CONTESTANTS ARE VOTING...");
    setStatus("CASTING VOTES", "var(--accent-cyan)");
    btnVote.disabled = true;

    try {
        const res = await fetch(`${API}/api/game/vote`, {
            method: "POST"
        });
        const data = await res.json();

        if (data.result.error) {
            alert(data.result.error);
            return;
        }

        awaitingVote = false;
        updateUI(data.state, data.result);
        renderVotes(data.result);

        const maxVotes = Math.max(0, ...Object.values(data.result.vote_counts || {}));
        if (maxVotes > 2) {
            sfx.laugh.play().catch(e => console.log(e));
        } else if (maxVotes === 0) {
            sfx.crickets.play().catch(e => console.log(e));
        } else {
            // Bad round
            if (Math.random() > 0.5) sfx.boo.play().catch(e => console.log(e));
        }

        // Switch buttons back
        btnVote.style.display = "none";
        btnRound.style.display = "inline-flex";

        if (data.result.elimination_due) {
            btnEliminate.disabled = false;
            setStatus("ELIMINATION DUE", "var(--accent-red)");
            btnRound.disabled = true;
        } else {
            setStatus("ROUND COMPLETE", "var(--accent-green)");
            btnRound.disabled = gameState?.game_over || false;
        }
        updateChaosControls();
    } catch (err) {
        setStatus("ERROR", "var(--accent-red)");
        alert("Voting failed: " + err.message);
        btnVote.disabled = false;
    } finally {
        hideLoading();
    }
}

async function eliminate() {
    showLoading("ELIMINATING + EVOLVING...");
    setStatus("ELIMINATION", "var(--accent-red)");

    try {
        const res = await fetch(`${API}/api/game/eliminate`, { method: "POST" });
        const data = await res.json();

        if (data.result.error) {
            alert(data.result.error);
            return;
        }

        const previousAlive = gameState.contestants.filter(c => c.alive).map(c=>c.name);
        const currentAlive = data.state.contestants.filter(c => c.alive).map(c=>c.name);
        const eliminatedName = previousAlive.find(n => !currentAlive.includes(n));

        if (eliminatedName) {
            sfx.trapdoor.play().catch(e=>console.log(e));
            const cards = document.querySelectorAll('.contestant-card');
            cards.forEach(card => {
                const nameNode = card.querySelector('.contestant-name');
                if (nameNode && nameNode.textContent.toLowerCase() === eliminatedName.toLowerCase()) {
                    card.classList.add(Math.random() > 0.5 ? 'vaporize' : 'trapdoor');
                }
            });
            await new Promise(r => setTimeout(r, 1400)); // wait for animation
        }

        updateUI(data.state);

        // Show evolution notification
        if (data.result.new_contestant) {
            const nc = data.result.new_contestant;
            const badge = document.createElement("div");
            badge.className = "evolution-badge";
            badge.textContent = `⟳ EVOLVED: ${nc.name} (from ${nc.evolved_from})`;
            eliminationList.appendChild(badge);
        }

        btnEliminate.disabled = true;
        if (!data.state.game_over) {
            setStatus("READY", "var(--accent-green)");
            btnRound.disabled = false;
        }
        updateChaosControls();
    } catch (err) {
        setStatus("ERROR", "var(--accent-red)");
        alert("Elimination failed: " + err.message);
    } finally {
        hideLoading();
    }
}

// --- Initial Load ---
(async function init() {
    try {
        const res = await fetch(`${API}/api/game/contestants`);
        if (res.ok) {
            const data = await res.json();
            renderContestants(data.contestants);
            syncChaosCards(data.chaos_cards || []);
            assignVoices(data.contestants); // Assign unique voices once loaded
        }
    } catch {
        // Server not running yet, show empty grid
    }

    if (hasShortsLab) {
        renderShortsQueue();
        updateShortNowPlaying();
    }
    renderChaosState();
})();
