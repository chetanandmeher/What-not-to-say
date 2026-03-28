// -----------------------------------------------
// AI Parliament — Shorts Reaction Lab (Standalone)
// -----------------------------------------------

const API = "";

// State
let shortsQueue = [];
let currentShort = null;
let shortsPlayer = null;
let shortReactionPending = false;

// DOM Refs
const statusText = document.getElementById("statusText");
const statusDot = document.querySelector(".status-dot");
const shortUrlInput = document.getElementById("shortUrlInput");
const shortTitleInput = document.getElementById("shortTitleInput");
const shortCaptionInput = document.getElementById("shortCaptionInput");
const btnQueueShort = document.getElementById("btnQueueShort");
const shortsQueueList = document.getElementById("shortsQueueList");
const shortsPlayerEmpty = document.getElementById("shortsPlayerEmpty");
const shortsNowPlayingTitle = document.getElementById("shortsNowPlayingTitle");
const shortsNowPlayingCaption = document.getElementById("shortsNowPlayingCaption");
const btnPlayShort = document.getElementById("btnPlayShort");
const shortsStatusPill = document.getElementById("shortsStatusPill");
const shortsReactionsSection = document.getElementById("shortsReactionsSection");
const shortsAnswersGrid = document.getElementById("shortsAnswersGrid");
const loadingOverlay = document.getElementById("loadingOverlay");
const loaderText = document.getElementById("loaderText");

// Helpers
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
    const palette = {
        idle: { text: "var(--accent-orange)", border: "rgba(245, 158, 11, 0.25)", bg: "rgba(245, 158, 11, 0.12)" },
        ready: { text: "var(--accent-cyan)", border: "rgba(0, 212, 255, 0.28)", bg: "rgba(0, 212, 255, 0.12)" },
        live: { text: "var(--accent-blue)", border: "rgba(59, 130, 246, 0.28)", bg: "rgba(59, 130, 246, 0.12)" },
        done: { text: "var(--accent-green)", border: "rgba(16, 185, 129, 0.28)", bg: "rgba(16, 185, 129, 0.12)" },
        error: { text: "var(--accent-red)", border: "rgba(239, 68, 68, 0.3)", bg: "rgba(239, 68, 68, 0.12)" }
    };
    const colors = palette[tone] || palette.idle;
    shortsStatusPill.textContent = text;
    shortsStatusPill.style.color = colors.text;
    shortsStatusPill.style.borderColor = colors.border;
    shortsStatusPill.style.background = colors.bg;
}

function getShortDisplayTitle(shortItem, fallback = "Untitled Short") {
    return shortItem?.title || shortItem?.caption || fallback;
}

function renderShortsQueue() {
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
                <span class="shorts-queue-title">${getShortDisplayTitle(item, `Short ${index + 1}`)}</span>
                <span class="shorts-queue-caption">${item.caption || "No caption"}</span>
                <span class="shorts-queue-url">${item.url}</span>
            </div>
        `;
        shortsQueueList.appendChild(queueItem);
    });

    btnPlayShort.disabled = false;
    if (!currentShort) setShortsStatus(`${shortsQueue.length} SHORT${shortsQueue.length === 1 ? '' : 'S'} QUEUED`, "ready");
}

function updateShortNowPlaying(shortItem = null) {
    if (!shortItem) {
        shortsNowPlayingTitle.textContent = "No Short loaded";
        shortsNowPlayingCaption.textContent = "Add a URL and context.";
        shortsPlayerEmpty.style.display = "flex";
        return;
    }
    shortsNowPlayingTitle.textContent = getShortDisplayTitle(shortItem);
    shortsNowPlayingCaption.textContent = shortItem.caption || "No caption.";
    shortsPlayerEmpty.style.display = "none";
}

function clearShortReactions() {
    shortsReactionsSection.style.display = "none";
    shortsAnswersGrid.innerHTML = "";
}

// YouTube Helpers (extracted)
function extractYouTubeVideoId(input) {
    const trimmed = (input || "").trim();
    if (!trimmed) return null;
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
        return { videoId: trimmed, normalizedUrl: `https://www.youtube.com/shorts/${trimmed}` };
    }
    try {
        const url = new URL(trimmed);
        let videoId = "";
        const host = url.hostname.replace(/^www\./, "").toLowerCase();
        if (host === "youtu.be") videoId = url.pathname.split("/")[1];
        else if (host.includes("youtube.com")) {
            if (url.pathname.startsWith("/shorts/")) videoId = url.pathname.split("/")[2];
            else videoId = url.searchParams.get("v");
        }
        if (/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
            return { videoId, normalizedUrl: `https://www.youtube.com/shorts/${videoId}` };
        }
    } catch {}
    return null;
}

function mountShortPlayer(videoId) {
    if (shortsPlayer && typeof shortsPlayer.loadVideoById === "function") {
        shortsPlayer.loadVideoById(videoId);
        return;
    }
    shortsPlayer = new YT.Player("shortsPlayer", {
        videoId,
        playerVars: { autoplay: 1, controls: 1, rel: 0, playsinline: 1, modestbranding: 1 },
        events: { onReady: (event) => event.target.playVideo(), onStateChange: onShortPlayerStateChange }
    });
}

function onShortPlayerStateChange(event) {
    if (event.data === YT.PlayerState.PLAYING) {
        setStatus("SHORT PLAYING", "var(--accent-cyan)");
        setShortsStatus("PLAYING", "live");
    }
    if (event.data === YT.PlayerState.ENDED && !shortReactionPending) {
        generateShortReactionsForCurrentShort();
    }
}

function renderShortReactionAnswers(result) {
    shortsReactionsSection.style.display = "block";
    shortsAnswersGrid.innerHTML = "";
    result.answers.forEach((ans) => {
        const card = document.createElement("div");
        card.className = "answer-card";
        card.innerHTML = `
            <div class="answer-header">
                <span class="answer-name">${ans.name.toUpperCase()}</span>
                <div class="header-actions">
                    <button class="btn-tts" title="Play">🔊</button>
                </div>
            </div>
            <div class="answer-text">${ans.answer}</div>
        `;
        const btnTts = card.querySelector(".btn-tts");
        btnTts.onclick = () => speechSynthesis.speak(new SpeechSynthesisUtterance(ans.answer));
        shortsAnswersGrid.appendChild(card);
    });
    shortsReactionsSection.scrollIntoView({ behavior: "smooth" });
}

// Event Listeners
btnQueueShort.onclick = function() {
    const rawUrl = shortUrlInput.value.trim();
    const title = shortTitleInput.value.trim();
    const caption = shortCaptionInput.value.trim();
    if (!rawUrl) return alert("Enter YouTube URL/ID.");
    if (!title && !caption) return alert("Add title or caption.");
    const parsed = extractYouTubeVideoId(rawUrl);
    if (!parsed) return alert("Invalid YouTube link.");
    shortsQueue.push({ ...parsed, title: title || caption.slice(0,70), caption });
    shortUrlInput.value = shortTitleInput.value = shortCaptionInput.value = "";
    renderShortsQueue();
};

btnPlayShort.onclick = async function() {
    if (!shortsQueue.length) return alert("Queue empty.");
    currentShort = shortsQueue.shift();
    shortReactionPending = false;
    clearShortReactions();
    updateShortNowPlaying(currentShort);
    renderShortsQueue();
    setShortsStatus("LOADING PLAYER", "live");
    try {
        mountShortPlayer(currentShort.videoId);
    } catch (err) {
        setShortsStatus("PLAYER ERROR", "error");
        alert("Player error: " + err.message);
    }
};

async function generateShortReactionsForCurrentShort() {
    if (!currentShort || shortReactionPending) return;
    shortReactionPending = true;
    showLoading("AI Reacting...");
    setStatus("GENERATING REACTIONS", "var(--accent-cyan)");
    setShortsStatus("GENERATING", "live");
    try {
        const res = await fetch("/api/game/shorts/react", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: currentShort.url, title: currentShort.title, caption: currentShort.caption })
        });
        const data = await res.json();
        if (data.result.error) throw new Error(data.result.error);
        renderShortReactionAnswers(data.result);
        setStatus("REACTIONS READY", "var(--accent-green)");
        setShortsStatus("READY", "done");
    } catch (err) {
        setStatus("ERROR", "var(--accent-red)");
        setShortsStatus("ERROR", "error");
        alert("API error: " + err.message);
    } finally {
        shortReactionPending = false;
        hideLoading();
    }
}

// Init
renderShortsQueue();
updateShortNowPlaying();
setStatus("SHORTS LAB READY", "var(--accent-green)");
