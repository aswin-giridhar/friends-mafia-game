const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const axios = require("axios");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

const friendsCharacters = require("./characters");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Multer setup for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "public/images/players/");
    },
    filename: (req, file, cb) => {
        const uniqueName = `player_${Date.now()}_${file.originalname}`;
        cb(null, uniqueName);
    },
});
const upload = multer({ storage: storage });

// Setup
app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Game state
let gameState = {
    players: new Map(),
    votes: new Map(),
    accusations: new Map(),
    currentSpeaker: null,
    gamePhase: "lobby",
    aiPersonas: [],
    votingResults: [],
};

// ElevenLabs API function
async function generateVoice(text, voiceId) {
    try {
        const response = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
            {
                text: text,
                model_id: "eleven_monolingual_v1",
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.5,
                },
            },
            {
                headers: {
                    Accept: "audio/mpeg",
                    "Content-Type": "application/json",
                    "xi-api-key": process.env.ELEVENLABS_API_KEY,
                },
                responseType: "arraybuffer",
            },
        );
        return Buffer.from(response.data);
    } catch (error) {
        console.error("ElevenLabs API Error:", error.message);
        return null;
    }
}

// Model Context Protocol for AI responses
class MCPManager {
    constructor() {
        this.conversations = new Map();
    }

    generateResponse(character, userInput, gameContext) {
        const characterData = friendsCharacters[character];
        const conversation = this.conversations.get(character) || [];

        conversation.push({ role: "user", content: userInput });

        let response = this.selectResponse(
            characterData,
            userInput,
            gameContext,
        );

        conversation.push({ role: "assistant", content: response });
        this.conversations.set(character, conversation.slice(-10));

        return response;
    }

    selectResponse(characterData, userInput, gameContext) {
        const { traits, catchphrases } = characterData;

        if (userInput.toLowerCase().includes("vote")) {
            return `${catchphrases[0]} But seriously, voting is important in this game!`;
        }

        if (userInput.toLowerCase().includes("accuse")) {
            const responses = [
                "Hey, that's a serious accusation!",
                "Could this BE any more dramatic?",
                "I'm innocent, I swear!",
            ];
            return responses[Math.floor(Math.random() * responses.length)];
        }

        if (
            userInput.toLowerCase().includes("food") &&
            traits.includes("food-obsessed")
        ) {
            return "Joey doesn't share food! But what kind of food are we talking about?";
        }

        return catchphrases[Math.floor(Math.random() * catchphrases.length)];
    }
}

const mcpManager = new MCPManager();

// Routes
app.get("/", (req, res) => {
    res.render("index");
});

app.post("/start-game", upload.single("playerPhoto"), (req, res) => {
    const playerName = req.body.playerName;
    const playerPhoto = req.file ? req.file.filename : "default-player.jpg";

    // Store player info in session (simplified for demo)
    const playerId = uuidv4();
    gameState.players.set(playerId, {
        name: playerName,
        photo: playerPhoto,
        role: "player",
    });

    res.redirect(`/game?playerId=${playerId}`);
});

app.get("/game", (req, res) => {
    const playerId = req.query.playerId;
    const player = gameState.players.get(playerId);

    if (!player) {
        return res.redirect("/");
    }

    // Generate AI personas
    const selectedCharacters = Object.keys(friendsCharacters).slice(0, 4);
    const personas = selectedCharacters.map((name) => ({
        name,
        ...friendsCharacters[name],
    }));

    res.render("game", { personas, player });
});

// Socket.io connection handling
io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    // Handle voice input
    socket.on("voice-input", async (data) => {
        const { transcript, targetCharacter } = data;

        const aiResponse = mcpManager.generateResponse(
            targetCharacter,
            transcript,
            gameState,
        );

        const audioBuffer = await generateVoice(
            aiResponse,
            friendsCharacters[targetCharacter].voiceId,
        );

        gameState.currentSpeaker = targetCharacter;

        io.emit("character-speaking", {
            character: targetCharacter,
            dialogue: aiResponse,
            audio: audioBuffer ? audioBuffer.toString("base64") : null,
        });

        setTimeout(() => {
            gameState.currentSpeaker = null;
            io.emit("clear-speaker");
        }, 3000);
    });

    // Handle voting
    socket.on("vote", (data) => {
        const { playerId, targetCharacter } = data;

        // Store vote
        gameState.votes.set(playerId, targetCharacter);

        // Generate AI response to being voted for
        const response = mcpManager.generateResponse(
            targetCharacter,
            "You've been voted for",
            gameState,
        );

        io.emit("vote-cast", {
            voter: playerId,
            target: targetCharacter,
            response: response,
        });

        io.emit("character-speaking", {
            character: targetCharacter,
            dialogue: response,
            audio: null,
        });
    });

    // Handle accusations
    socket.on("accuse", (data) => {
        const { playerId, targetCharacter } = data;

        gameState.accusations.set(playerId, targetCharacter);

        const response = mcpManager.generateResponse(
            targetCharacter,
            "You've been accused of being mafia",
            gameState,
        );

        io.emit("accusation-made", {
            accuser: playerId,
            target: targetCharacter,
            response: response,
        });

        io.emit("character-speaking", {
            character: targetCharacter,
            dialogue: response,
            audio: null,
        });
    });

    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
