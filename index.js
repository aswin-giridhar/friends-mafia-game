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

// Game configuration
const GAME_CONFIG = {
    nightDuration: 30,      // 30 seconds for night phase
    discussionDuration: 180, // 3 minutes for discussion
    votingDuration: 60,      // 1 minute for voting
    minPlayers: 3
};

// Enhanced game state
let gameState = {
    players: new Map(),      // Human players: { id, name, photo, role, isAlive }
    aiPersonas: [],          // AI characters with roles
    phase: 'lobby',          // 'lobby', 'night', 'discussion', 'voting', 'gameOver'
    round: 0,
    alivePlayers: [],        // References to alive players (human + AI)
    eliminatedPlayers: [],
    votes: new Map(),        // playerId -> targetCharacter
    accusations: new Map(),  // playerId -> targetCharacter
    mafiaTarget: null,       // Player targeted by mafia
    doctorSave: null,        // Player saved by doctor
    detectiveCheck: null,    // Player investigated by detective
    phaseTimer: null,        // Current phase timer
    timeRemaining: 0,        // Time left in current phase
    gameResults: null        // { winner, reason }
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

// Enhanced MCP Manager
class MCPManager {
    constructor() {
        this.conversations = new Map();
    }

    generateResponse(character, userInput, gameContext) {
        const characterData = friendsCharacters[character];
        const conversation = this.conversations.get(character) || [];

        conversation.push({ role: "user", content: userInput });

        let response = this.selectResponse(characterData, userInput, gameContext);

        conversation.push({ role: "assistant", content: response });
        this.conversations.set(character, conversation.slice(-10));

        return response;
    }

    selectResponse(characterData, userInput, gameContext) {
        const { traits, catchphrases, mafiaRole } = characterData;

        // Phase-based responses
        if (gameContext.phase === 'night') {
            if (mafiaRole === 'mafia') {
                return "The night is perfect for... activities. *whispers suspiciously*";
            } else if (mafiaRole === 'doctor') {
                return "I need to protect someone tonight. Who needs my help?";
            }
            return "It's so quiet tonight... too quiet.";
        }

        if (userInput.toLowerCase().includes("vote")) {
            return `${catchphrases[0]} But voting is important!`;
        }

        if (userInput.toLowerCase().includes("accuse")) {
            return "That's a serious accusation!";
        }

        if (userInput.toLowerCase().includes("food") && traits.includes("food-obsessed")) {
            return "Joey doesn't share food! But what kind of food?";
        }

        return catchphrases[Math.floor(Math.random() * catchphrases.length)];
    }
}

const mcpManager = new MCPManager();

// Game logic functions
function initializeGame() {
    // Assign roles to AI personas
    const roles = ['mafia', 'mafia', 'doctor', 'detective', 'townsfolk', 'townsfolk'];
    const shuffledRoles = [...roles].sort(() => Math.random() - 0.5);

    gameState.aiPersonas.forEach((persona, index) => {
        persona.role = shuffledRoles[index] || 'townsfolk';
        persona.isAlive = true;
    });

    // Assign roles to human players
    gameState.players.forEach(player => {
        player.role = 'townsfolk';
        player.isAlive = true;
    });

    updateAlivePlayers();
    gameState.phase = 'night';
    gameState.round = 1;

    startPhase('night', GAME_CONFIG.nightDuration);
}

function updateAlivePlayers() {
    gameState.alivePlayers = [
        ...Array.from(gameState.players.values()).filter(p => p.isAlive),
        ...gameState.aiPersonas.filter(p => p.isAlive)
    ];
}

function startPhase(phase, duration) {
    gameState.phase = phase;
    gameState.timeRemaining = duration;

    // Clear previous timer
    if (gameState.phaseTimer) clearInterval(gameState.phaseTimer);

    // Start phase timer
    gameState.phaseTimer = setInterval(() => {
        gameState.timeRemaining--;

        io.emit('timer-update', {
            phase: gameState.phase,
            timeRemaining: gameState.timeRemaining
        });

        if (gameState.timeRemaining <= 0) {
            clearInterval(gameState.phaseTimer);
            handlePhaseEnd();
        }
    }, 1000);

    io.emit('phase-change', {
        phase: gameState.phase,
        round: gameState.round,
        timeRemaining: gameState.timeRemaining
    });
}

function handlePhaseEnd() {
    switch (gameState.phase) {
        case 'night':
            processNightActions();
            break;
        case 'discussion':
            startPhase('voting', GAME_CONFIG.votingDuration);
            break;
        case 'voting':
            processVotes();
            break;
    }
}

function processNightActions() {
    let eliminatedPlayer = null;

    // Process mafia kill (AI chooses randomly)
    const mafiaMembers = gameState.aiPersonas.filter(p => p.role === 'mafia' && p.isAlive);
    if (mafiaMembers.length > 0) {
        const potentialTargets = gameState.alivePlayers.filter(p => p.role !== 'mafia');
        if (potentialTargets.length > 0) {
            const targetIndex = Math.floor(Math.random() * potentialTargets.length);
            gameState.mafiaTarget = potentialTargets[targetIndex];

            // Doctor save (AI chooses randomly)
            const doctors = gameState.aiPersonas.filter(p => p.role === 'doctor' && p.isAlive);
            if (doctors.length > 0) {
                const saveIndex = Math.floor(Math.random() * gameState.alivePlayers.length);
                gameState.doctorSave = gameState.alivePlayers[saveIndex];
            }

            // Check if target was saved
            if (gameState.mafiaTarget !== gameState.doctorSave) {
                gameState.mafiaTarget.isAlive = false;
                eliminatedPlayer = gameState.mafiaTarget;
                gameState.eliminatedPlayers.push(eliminatedPlayer);
            }
        }
    }

    updateAlivePlayers();

    // Check win conditions
    if (checkWinConditions()) return;

    // Start discussion phase
    io.emit('night-results', {
        eliminated: eliminatedPlayer ? 
            { name: eliminatedPlayer.name || eliminatedPlayer.playerName } : 
            null
    });

    startPhase('discussion', GAME_CONFIG.discussionDuration);
}

function processVotes() {
    const voteCounts = new Map();

    // Count votes
    gameState.votes.forEach(vote => {
        voteCounts.set(vote, (voteCounts.get(vote) || 0) + 1);
    });

    // Find player with most votes
    let maxVotes = 0;
    let eliminatedPlayer = null;

    voteCounts.forEach((votes, playerName) => {
        if (votes > maxVotes) {
            maxVotes = votes;
            eliminatedPlayer = playerName;
        }
    });

    // Eliminate player
    if (eliminatedPlayer) {
        const player = [...gameState.players.values(), ...gameState.aiPersonas]
            .find(p => (p.name === eliminatedPlayer) || (p.playerName === eliminatedPlayer));

        if (player) {
            player.isAlive = false;
            gameState.eliminatedPlayers.push(player);
            updateAlivePlayers();

            io.emit('player-eliminated', {
                playerName: eliminatedPlayer,
                role: player.role
            });
        }
    }

    // Check win conditions
    if (checkWinConditions()) return;

    // Start next round
    gameState.round++;
    startPhase('night', GAME_CONFIG.nightDuration);
}

function checkWinConditions() {
    const mafiaCount = gameState.alivePlayers.filter(p => p.role === 'mafia').length;
    const innocentCount = gameState.alivePlayers.filter(p => p.role !== 'mafia').length;

    if (mafiaCount === 0) {
        endGame('innocents', 'All mafia members eliminated!');
        return true;
    }

    if (mafiaCount >= innocentCount) {
        endGame('mafia', 'Mafia outnumbers the innocents!');
        return true;
    }

    return false;
}

function endGame(winner, reason) {
    gameState.phase = 'gameOver';
    gameState.gameResults = { winner, reason };

    if (gameState.phaseTimer) clearInterval(gameState.phaseTimer);

    io.emit('game-over', gameState.gameResults);
}

// Routes
app.get("/", (req, res) => {
    res.render("index");
});

app.post("/start-game", upload.single("playerPhoto"), (req, res) => {
    const playerName = req.body.playerName;
    const playerPhoto = req.file ? req.file.filename : "default-player.jpg";

    const playerId = uuidv4();
    gameState.players.set(playerId, {
        id: playerId,
        playerName: playerName,
        photo: playerPhoto,
        role: "townsfolk",
        isAlive: true
    });

    res.redirect(`/game?playerId=${playerId}`);
});

app.get("/game", (req, res) => {
    const playerId = req.query.playerId;
    const player = gameState.players.get(playerId);

    if (!player) return res.redirect("/");

    // Initialize AI personas if needed
    if (gameState.aiPersonas.length === 0) {
        const selectedCharacters = Object.keys(friendsCharacters).slice(0, 4);
        gameState.aiPersonas = selectedCharacters.map(name => ({
            name,
            ...friendsCharacters[name],
            isAlive: true
        }));
    }

    res.render("game", { 
        personas: gameState.aiPersonas, 
        player,
        gameState: {
            phase: gameState.phase,
            round: gameState.round
        }
    });
});

// Socket.io connection handling
io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    // Send initial game state
    socket.emit('game-state', {
        phase: gameState.phase,
        round: gameState.round,
        timeRemaining: gameState.timeRemaining
    });

    // Start game when requested
    socket.on('start-game', () => {
        if (gameState.phase === 'lobby' && gameState.players.size >= GAME_CONFIG.minPlayers) {
            initializeGame();
        }
    });

    // Handle voice input
    socket.on("voice-input", async (data) => {
        const { transcript, targetCharacter } = data;

        const aiResponse = mcpManager.generateResponse(
            targetCharacter,
            transcript,
            { phase: gameState.phase, round
