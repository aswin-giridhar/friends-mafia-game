const socket = io();

// Game state
let selectedCharacter = null;
let isRecording = false;
let recognition = null;

// Initialize speech recognition
if ("webkitSpeechRecognition" in window) {
    recognition = new webkitSpeechRecognition();
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
}

// DOM elements
const micButton = document.getElementById("mic-button");
const voteButton = document.getElementById("vote-button");
const accuseButton = document.getElementById("accuse-button");
const dialogueBox = document.getElementById("current-dialogue");
const selectedNameSpan = document.getElementById("selected-name");

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

    // Enable action buttons
    voteButton.disabled = false;
    accuseButton.disabled = false;

    updateDialogue(
        `Selected ${characterName}. You can now vote, accuse, or speak to them.`,
    );
}

// Voice input handling
micButton.addEventListener("mousedown", startRecording);
micButton.addEventListener("mouseup", stopRecording);
micButton.addEventListener("touchstart", startRecording);
micButton.addEventListener("touchend", stopRecording);

function startRecording() {
    if (!selectedCharacter) {
        updateDialogue("Please select a character first!");
        return;
    }

    if (recognition && !isRecording) {
        isRecording = true;
        micButton.textContent = "🔴 Recording...";
        micButton.style.background = "#ff6b6b";
        recognition.start();
    }
}

function stopRecording() {
    if (recognition && isRecording) {
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

    socket.emit("voice-input", {
        transcript: transcript,
        targetCharacter: selectedCharacter,
    });
}

// Voting functionality
voteButton.addEventListener("click", () => {
    if (!selectedCharacter) {
        updateDialogue("Please select a character to vote for!");
        return;
    }

    const confirmation = confirm(
        `Are you sure you want to vote for ${selectedCharacter}?`,
    );
    if (confirmation) {
        socket.emit("vote", {
            playerId: window.playerData.id,
            targetCharacter: selectedCharacter,
        });

        updateDialogue(`You voted for ${selectedCharacter}!`);
        voteButton.disabled = true;
        voteButton.textContent = "✅ Voted";
    }
});

// Accusation functionality
accuseButton.addEventListener("click", () => {
    if (!selectedCharacter) {
        updateDialogue("Please select a character to accuse!");
        return;
    }

    const confirmation = confirm(
        `Are you sure you want to accuse ${selectedCharacter} of being mafia?`,
    );
    if (confirmation) {
        socket.emit("accuse", {
            playerId: window.playerData.id,
            targetCharacter: selectedCharacter,
        });

        updateDialogue(`You accused ${selectedCharacter} of being mafia!`);
        accuseButton.disabled = true;
        accuseButton.textContent = "✅ Accused";
    }
});

// Socket event handlers
socket.on("character-speaking", (data) => {
    const { character, dialogue, audio } = data;

    highlightSpeaker(character);
    updateDialogue(`${character}: ${dialogue}`);

    if (audio) {
        playAudio(audio);
    }
});

socket.on("vote-cast", (data) => {
    const { voter, target, response } = data;
    updateDialogue(`Vote registered: ${target} has been voted for!`);
});

socket.on("accusation-made", (data) => {
    const { accuser, target, response } = data;
    updateDialogue(
        `Accusation made: ${target} has been accused of being mafia!`,
    );
});

socket.on("clear-speaker", () => {
    clearSpeakerHighlight();
});

// Visual effects
function highlightSpeaker(characterName) {
    clearSpeakerHighlight();

    const characterFrame = document.querySelector(
        `[data-character="${characterName}"]`,
    );
    if (characterFrame) {
        characterFrame.classList.add("speaking");
    }
}

function clearSpeakerHighlight() {
    document.querySelectorAll(".speaking").forEach((element) => {
        element.classList.remove("speaking");
    });
}

function updateDialogue(message) {
    dialogueBox.textContent = message;
}

// Audio playback
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

// Initialize buttons as disabled
voteButton.disabled = true;
accuseButton.disabled = true;
