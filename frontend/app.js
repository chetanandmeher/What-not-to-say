// -----------------------------------------------
// AI Parliament — Control Room Frontend Logic
// -----------------------------------------------

const API = "";

// --- State ---
let gameState = null;

// --- TTS Engine ---
let availableVoices = [];
let contestantVoices = {};
let hostVoice = null;

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
    
    const ut = new SpeechSynthesisUtterance(text);
    
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
const customSituation = document.getElementById("customSituation");
const elimThreshold = document.getElementById("elimThreshold");
const resultsSection = document.getElementById("resultsSection");
const situationDisplay = document.getElementById("situationDisplay");
const answersGrid = document.getElementById("answersGrid");
const voteList = document.getElementById("voteList");
const voteTally = document.getElementById("voteTally");
const eliminationFeed = document.getElementById("eliminationFeed");
const eliminationList = document.getElementById("eliminationList");
const loadingOverlay = document.getElementById("loadingOverlay");
const loaderText = document.getElementById("loaderText");

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
    roundNumber.textContent = state.round_number;
    elimCount.textContent = state.rounds_until_elimination;
    renderContestants(state.contestants, roundResult);
    renderEliminationFeed(state.eliminated);

    if (state.game_over) {
        btnRound.disabled = true;
        btnEliminate.disabled = true;
        const btnVote = document.getElementById("btnVote");
        if (btnVote) btnVote.disabled = true;
        
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
        updateDashboard(data.state);
    } catch (e) {
        console.error("Settings failed", e);
    }
}

async function startGame() {
    showLoading("INITIALIZING ARENA...");
    setStatus("INITIALIZING", "var(--accent-orange)");

    try {
        const res = await fetch(`${API}/api/game/start`, { method: "POST" });
        const data = await res.json();

        updateUI(data.state);
        resultsSection.style.display = "none";
        btnRound.disabled = false;
        btnEliminate.disabled = true;
        customSituation.disabled = false;
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
    showLoading("GENERATING AWKWARD SITUATION...");
    setStatus("GENERATING", "var(--accent-cyan)");
    btnRound.disabled = true;

    try {
        const body = situation ? JSON.stringify({ situation }) : JSON.stringify({});
        const res = await fetch(`${API}/api/game/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
        });
        const data = await res.json();

        if (data.result.error) {
            alert(data.result.error);
            return;
        }

        renderAnswers(data.result);

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

        updateUI(data.state, data.result);
        renderVotes(data.result);

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
            assignVoices(data.contestants); // Assign unique voices once loaded
        }
    } catch {
        // Server not running yet, show empty grid
    }
})();
