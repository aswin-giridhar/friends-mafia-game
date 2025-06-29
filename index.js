const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const axios = require("axios");
require("dotenv").config();

const friendsCharacters = require("./characters");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Setup
app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(express.json());

// Game state
let gameState = {
    players: new Map(),
    currentSpeaker: null,
    gamePhase: "lobby", // lobby, day, night, voting
    aiPersonas: [],
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

        // Add user input to conversation history
        conversation.push({ role: "user", content: userInput });

        // Generate contextual response based on character traits
        let response = this.selectResponse(
            characterData,
            userInput,
            gameContext,
        );

        // Add AI response to conversation history
        conversation.push({ role: "assistant", content: response });
        this.conversations.set(character, conversation.slice(-10)); // Keep last 10 exchanges

        return response;
    }

    selectResponse(characterData, userInput, gameContext) {
        const { traits, catchphrases } = characterData;

        // Simple response logic (in hackathon, you'd use a more sophisticated LLM)
        if (
            userInput.toLowerCase().includes("food") &&
            characterData.traits.includes("food-obsessed")
        ) {
            return "Joey doesn't share food! But seriously, what kind of food are we talking about here?";
        }

        if (
            userInput.toLowerCase().includes("accuse") ||
            userInput.toLowerCase().includes("suspicious")
        ) {
            const responses = [
                `${traits.includes("sarcastic") ? "Could this BE any more dramatic?" : catchphrases[0]}`,
                "Hey, I'm just trying to survive here!",
                "That's a pretty serious accusation...",
            ];
            return responses[Math.floor(Math.random() * responses.length)];
        }

        // Default to catchphrase
        return catchphrases[Math.floor(Math.random() * catchphrases.length)];
    }
}

const mcpManager = new MCPManager();

// Routes
app.get("/", (req, res) => {
    // Generate AI personas based on user selection (default 4)
    const selectedCharacters = Object.keys(friendsCharacters).slice(0, 4);
    const personas = selectedCharacters.map((name) => ({
        name,
        ...friendsCharacters[name],
    }));

    res.render("game", { personas });
});

// Socket.io connection handling
io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    // Handle user voice input
    socket.on("voice-input", async (data) => {
        const { transcript, targetCharacter } = data;

        // Generate AI response using MCP
        const aiResponse = mcpManager.generateResponse(
            targetCharacter,
            transcript,
            gameState,
        );

        // Generate voice audio
        const audioBuffer = await generateVoice(
            aiResponse,
            friendsCharacters[targetCharacter].voiceId,
        );

        // Highlight speaking character
        gameState.currentSpeaker = targetCharacter;

        // Send response to all clients
        io.emit("character-speaking", {
            character: targetCharacter,
            dialogue: aiResponse,
            audio: audioBuffer ? audioBuffer.toString("base64") : null,
        });

        // Clear speaker after 3 seconds
        setTimeout(() => {
            gameState.currentSpeaker = null;
            io.emit("clear-speaker");
        }, 3000);
    });

    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
