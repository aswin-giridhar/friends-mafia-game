const socket = io();
let notificationManager;
let currentGamePhase = "lobby"; // 'lobby', 'night', 'day', 'discussion', 'voting'
let playerVoted = false;

// DOM elements
const micButton = document.getElementById("mic-button");
const voteButton = document.getElementById("vote-button");
const accuseButton = document.getElementById("accuse-button");
const dialogueBox = document.getElementById("current-dialogue");
const selectedNameSpan = document.getElementById("selected-name");
const startGameBtn = document.getElementById("start-game-btn");
const phaseTimer = document.getElementById("phase-timer");
const currentRound = document.getElementById("current-round");
const actionStatus = document.getElementById("action-status");

document.addEventListener("DOMContentLoaded", () => {
    // Initialize notification system
    notificationManager = new NotificationManager();
    notificationManager.show("🎭 Welcome to Central Perk Mafia!", "game", 4000);

    // Initialize game state
    updateUIForPhase("lobby");

    // Start game button handler
    startGameBtn.addEventListener("click", () => {
        socket.emit("start-game");
        notificationManager.show(
            "🎮 Game started! Roles are being assigned...",
            "game",
            3000,
        );
        startGameBtn.disabled = true;
    });
});

// Initialize speech recognition
if ("webkitSpeechRecognition" in window) {
    const recognition = new webkitSpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        handleVoiceInput(transcript);
    };

    recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        stopRecording();
    };

    // Voice input handling
    micButton.addEventListener("mousedown", () => startRecording(recognition));
    micButton.addEventListener("mouseup", () => stopRecording(recognition));
} else {
    micButton.disabled = true;
    console.warn("Speech recognition not supported");
}

// Character selection
document.querySelectorAll(".character-frame").forEach((frame) => {
    frame.addEventListener("click", () => {
        selectCharacter(frame.dataset.character, frame);
    });
});

function selectCharacter(characterName, frameElement) {
    // Clear previous selection
    document.querySelectorAll(".character-frame").forEach((f) => {
        f.classList.remove("selected");
    });

    // Set new selection
    frameElement.classList.add("selected");
    selectedCharacter = characterName;
    selectedNameSpan.textContent = characterName;

    // Update button states based on phase
    updateButtonStates();

    notificationManager.showPlayerAction("select", "You", characterName);
}

function startRecording(recognition) {
    if (!selectedCharacter) {
        notificationManager.showError("Please select a character first!");
        return;
    }

    if (!isRecording) {
        isRecording = true;
        micButton.textContent = "🔴 Recording...";
        micButton.style.background = "#ff6b6b";
        recognition.start();
    }
}

function stopRecording(recognition) {
    if (isRecording) {
        isRecording = false;
        micButton.textContent = "🎤 Hold to Speak";
        micButton.style.background =
            "linear-gradient(145deg, #ffd700, #ffed4e)";
        recognition.stop();
    }
}

function handleVoiceInput(transcript) {
    if (!selectedCharacter) return;

    updateDialogue(`You said: "${transcript}"`);
    notificationManager.showPlayerAction("speak", "You", selectedCharacter);

    socket.emit("voice-input", {
        transcript: transcript,
        targetCharacter: selectedCharacter,
    });
}

// Voting functionality
voteButton.addEventListener("click", () => {
    if (!selectedCharacter) {
        notificationManager.showError("Please select a character to vote for!");
        return;
    }

    const confirmation = confirm(`Vote to eliminate ${selectedCharacter}?`);
    if (confirmation) {
        socket.emit("vote", {
            playerId: window.playerData.id,
            targetCharacter: selectedCharacter,
        });

        playerVoted = true;
        voteButton.disabled = true;
        voteButton.textContent = "✅ Voted";
        notificationManager.showPlayerAction("vote", "You", selectedCharacter);
    }
});

// Accusation functionality
accuseButton.addEventListener("click", () => {
    if (!selectedCharacter) {
        notificationManager.showError("Please select a character to accuse!");
        return;
    }

    const confirmation = confirm(`Accuse ${selectedCharacter} of being mafia?`);
    if (confirmation) {
        socket.emit("accuse", {
            playerId: window.playerData.id,
            targetCharacter: selectedCharacter,
        });

        accuseButton.disabled = true;
        accuseButton.textContent = "✅ Accused";
        notificationManager.showPlayerAction(
            "accusation",
            "You",
            selectedCharacter,
        );
    }
});

// Socket event handlers =============================================
socket.on("phase-change", (data) => {
    currentGamePhase = data.phase;
    updateUIForPhase(data.phase);
    notificationManager.showPhaseChange(data.phase, data.round);
});

socket.on("timer-update", (data) => {
    phaseTimer.textContent = formatTime(data.timeRemaining);
    if (data.timeRemaining <= 30) {
        notificationManager.showGameEvent("timerWarning");
    }
});

socket.on("character-speaking", (data) => {
    const { character, dialogue, audio } = data;
    highlightSpeaker(character);
    updateDialogue(`${character}: ${dialogue}`);
    notificationManager.showPlayerAction(
        "speak",
        character,
        dialogue.substring(0, 30),
    );

    if (audio) playAudio(audio);
});

socket.on("player-eliminated", (data) => {
    notificationManager.showElimination(
        data.playerName,
        data.role,
        data.method,
    );
});

socket.on("game-over", (data) => {
    notificationManager.showVictory(data.winner, data.reason);
});

socket.on("clear-speaker", clearSpeakerHighlight);

// UI Management Functions ===========================================
function updateUIForPhase(phase) {
    // Reset UI state for new phase
    playerVoted = false;
    voteButton.textContent = "📊 Vote";
    accuseButton.textContent = "👆 Accuse";

    // Phase-specific UI updates
    switch (phase) {
        case "night":
            actionStatus.textContent = "Mafia is choosing a target...";
            break;
        case "discussion":
            actionStatus.textContent = "Discuss suspicions with other players";
            break;
        case "voting":
            actionStatus.textContent = "Vote to eliminate a suspect";
            break;
    }

    updateButtonStates();
}

function updateButtonStates() {
    const hasSelection = selectedCharacter !== null;

    voteButton.disabled =
        currentGamePhase !== "voting" || !hasSelection || playerVoted;

    accuseButton.disabled = currentGamePhase !== "discussion" || !hasSelection;

    micButton.disabled = currentGamePhase === "voting" || !hasSelection;
}

// Helper Functions ==================================================
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

function highlightSpeaker(characterName) {
    clearSpeakerHighlight();
    const characterFrame = document.querySelector(
        `[data-character="${characterName}"]`,
    );
    if (characterFrame) characterFrame.classList.add("speaking");
}

function clearSpeakerHighlight() {
    document.querySelectorAll(".speaking").forEach((el) => {
        el.classList.remove("speaking");
    });
}

function updateDialogue(message) {
    dialogueBox.textContent = message;
}

function playAudio(base64Audio) {
    try {
        const audioBlob = new Blob(
            [Uint8Array.from(atob(base64Audio), (c) => c.charCodeAt(0))],
            { type: "audio/mpeg" },
        );
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audio.play();
        audio.onended = () => URL.revokeObjectURL(audioUrl);
    } catch (error) {
        console.error("Error playing audio:", error);
    }
}

// Initial setup
voteButton.disabled = true;
accuseButton.disabled = true;
