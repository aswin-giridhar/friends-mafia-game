const socket = io();

// Voice recognition setup
let recognition;
let isRecording = false;

if ("webkitSpeechRecognition" in window) {
    recognition = new webkitSpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        handleVoiceInput(transcript);
    };
}

// DOM elements
const micButton = document.getElementById("mic-button");
const dialogueBox = document.getElementById("current-dialogue");

// Voice input handling
micButton.addEventListener("mousedown", startRecording);
micButton.addEventListener("mouseup", stopRecording);
micButton.addEventListener("touchstart", startRecording);
micButton.addEventListener("touchend", stopRecording);

function startRecording() {
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
    // For demo, randomly select a character to respond
    const characters = [
        "Joey",
        "Phoebe",
        "Chandler",
        "Rachel",
        "Ross",
        "Monica",
    ];
    const randomCharacter =
        characters[Math.floor(Math.random() * characters.length)];

    // Send to server
    socket.emit("voice-input", {
        transcript: transcript,
        targetCharacter: randomCharacter,
    });

    // Update dialogue box
    dialogueBox.textContent = `You said: "${transcript}"`;
}

// Socket event handlers
socket.on("character-speaking", (data) => {
    const { character, dialogue, audio } = data;

    // Highlight speaking character
    highlightSpeaker(character);

    // Update dialogue
    dialogueBox.textContent = `${character}: ${dialogue}`;

    // Play audio if available
    if (audio) {
        playAudio(audio);
    }
});

socket.on("clear-speaker", () => {
    clearSpeakerHighlight();
});

// Visual highlighting functions
function highlightSpeaker(characterName) {
    // Clear previous highlights
    clearSpeakerHighlight();

    // Find and highlight current speaker
    const characterFrame = document.querySelector(
        `[data-character="${characterName}"]`,
    );
    if (characterFrame) {
        characterFrame.classList.add("speaking");
    }
}

function clearSpeakerHighlight() {
    const speakingElements = document.querySelectorAll(".speaking");
    speakingElements.forEach((element) => {
        element.classList.remove("speaking");
    });
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

        // Clean up
        audio.onended = () => URL.revokeObjectURL(audioUrl);
    } catch (error) {
        console.error("Error playing audio:", error);
    }
}

// Character interaction
document.querySelectorAll(".character-frame").forEach((frame) => {
    frame.addEventListener("click", () => {
        const characterName = frame.dataset.character;
        // You can add click interactions here
        console.log(`Clicked on ${characterName}`);
    });
});
