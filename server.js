const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs'); // Built-in helper to read/write files
const path = require('path');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const { OpenAI } = require('openai');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Initialize OpenAI with your private API key
const openai = new OpenAI({
    apiKey: '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'
});

app.use(express.static('public'));

// Increase payload limit bounds so large image uploads don't crash the server
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Configure secure stateful user tracking session layers
app.use(session({
    secret: 'math-league-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // Valid for 24 Hours
}));

const SETS_FILE = path.join(__dirname, 'sets.json');
const USERS_FILE = path.join(__dirname, 'users.json');

// Helper function to read user registrations safely
function loadUsers() {
    try {
        if (!fs.existsSync(USERS_FILE)) return [];
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(data || '[]');
    } catch (err) {
        console.error("Error reading users.json:", err);
        return [];
    }
}

// Helper function to save registered user accounts safely
function saveUsers(usersArray) {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(usersArray, null, 2), 'utf8');
    } catch (err) {
        console.error("Error writing to users.json:", err);
    }
}

// Helper function to read sets from our json file safely
function loadSavedSets() {
    try {
        if (!fs.existsSync(SETS_FILE)) {
            return [];
        }
        const data = fs.readFileSync(SETS_FILE, 'utf8');
        return JSON.parse(data || '[]');
    } catch (err) {
        console.error("Error reading sets.json:", err);
        return [];
    }
}

// Helper function to save updates back to the json file
function saveSetsToFile(setsArray) {
    try {
        fs.writeFileSync(SETS_FILE, JSON.stringify(setsArray, null, 2), 'utf8');
    } catch (err) {
        console.error("Error writing to sets.json:", err);
    }
}

// Generates a random 8-digit room code string
function generateRandomCode() {
    return Math.floor(10000000 + Math.random() * 90000000).toString();
}

// Map tracking all active live rooms simultaneously (Key: roomCode -> Value: roomData)
let activeRooms = {};

// Helper to look up which room a student belongs to based on their socket ID
function findRoomByStudentSocketId(socketId) {
    for (const code in activeRooms) {
        if (activeRooms[code].students[socketId]) {
            return activeRooms[code];
        }
    }
    return null;
}

// Helper to look up a room by the host's socket ID
function findRoomByHostSocketId(socketId) {
    for (const code in activeRooms) {
        if (activeRooms[code].hostSocketId === socketId) {
            return activeRooms[code];
        }
    }
    return null;
}

console.log(`=========================================`);
console.log(`🎰 AI-INFUSED MULTI-ROOM SERVER READY `);
console.log(`=========================================`);

// ==========================================
// 🔐 USER ACCOUNT AUTHENTICATION ROUTES
// ==========================================

app.post('/api/auth/signup', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: "Missing required fields." });
        }

        const users = loadUsers();
        const normalizedEmail = email.toLowerCase().trim();

        if (users.find(u => u.email === normalizedEmail)) {
            return res.status(400).json({ error: "An account with this email already exists." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        users.push({ email: normalizedEmail, password: hashedPassword });
        saveUsers(users);

        res.json({ success: true, message: "Account created successfully!" });
    } catch (err) {
        res.status(500).json({ error: "Server registration error." });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const users = loadUsers();
        const normalizedEmail = email.toLowerCase().trim();

        const user = users.find(u => u.email === normalizedEmail);
        if (!user) {
            return res.status(400).json({ error: "Invalid email or password combination." });
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.status(400).json({ error: "Invalid email or password combination." });
        }

        // Store account string marker token within express state tracking block
        req.session.userEmail = user.email;
        res.json({ success: true, message: "Welcome back!" });
    } catch (err) {
        res.status(500).json({ error: "Server authentication error." });
    }
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Middleware intercept check guard verifying access state rules
function requireLogin(req, res, next) {
    if (!req.session.userEmail) {
        return res.status(401).json({ error: "Unauthorized access. Please log in." });
    }
    next();
}

// ==========================================
// 🤖 AI WORKSHEET VISION ROUTE
// ==========================================

app.post('/api/ai/scan-worksheet', requireLogin, async (req, res) => {
    try {
        const { base64Image } = req.body;
        if (!base64Image) {
            return res.status(400).json({ error: "No image payload found." });
        }

        console.log("🤖 Sending worksheet snapshot to OpenAI Vision API...");

        // Fire request over to GPT-4o with explicit instructions to parse math sheets into pure JSON strings
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "user",
                    content: [
                        { 
                            type: "text", 
                            text: `Analyze this math worksheet image. Extract all questions along with their answers. 
                            For questions involving diagrams, graphs, or geometric shapes, use the "text" field to type out the question statement, and append a highly descriptive note explaining what the shape or layout looks like (e.g., "[Geometry Asset: Triangle ABC with right angle at B, AB=3, BC=4]"). 
                            You must return a JSON object containing an array named "questions". 
                            Each question in the array must look exactly like this object structural layout: 
                            { "text": "Question statement here", "answer": "Answer here" }` 
                        },
                        {
                            type: "image_url",
                            image_url: {
                                url: base64Image // Receives the direct image payload string natively
                            }
                        }
                    ]
                }
            ]
        });

        // Parse and forward the data back up to the frontend UI wizard view
        const aiOutputText = response.choices[0].message.content;
        const parsedJson = JSON.parse(aiOutputText);

        res.json(parsedJson);
    } catch (err) {
        console.error("AI Scanner Failure:", err);
        res.status(500).json({ error: "AI processing failed. Check terminal keys." });
    }
});

// ==========================================
// 📁 PROTECTED GAME SET ENDPOINTS
// ==========================================

app.get('/api/sets', requireLogin, (req, res) => {
    const allSets = loadSavedSets();
    const userSets = allSets.filter(set => set.owner === req.session.userEmail);
    res.json(userSets);
});

app.post('/api/sets', requireLogin, (req, res) => {
    const userSetsIncoming = req.body; 
    const allSets = loadSavedSets();
    
    const remainingSets = allSets.filter(set => set.owner !== req.session.userEmail);
    
    const brandedSets = userSetsIncoming.map(set => {
        set.owner = req.session.userEmail;
        return set;
    });

    const combinedOutput = [...remainingSets, ...brandedSets];
    saveSetsToFile(combinedOutput);
    res.json({ success: true, message: "Set saved completely!" });
});

const availableEmojis = [
    "🔥","👑","🚀","👾","🍕","🐱","🦊","🫅","🎭","🎲","🎯","🧩","🎪","🎨","🛹","💎","⚡","🌈","🍀","🌍",
    "🐼","🐨","🐯","🦁","🐸","🐵","🦄","🦅","🦉","🦖","🐙","🦈","🍦","🍿","🍩","🍪","🥑","🌮","🎮","🎸",
    "🏆","⚽","🏀","🎬","✈️","🛸","⚓️","🏝️","🌋","🔮","🎈","🎉","🎁","💡","🔑","📦","🍎","🥕","🍿","🧠"
];

function getFirstFreeEmoji(roomObj) {
    const takenEmojis = Object.values(roomObj.students).map(s => s.avatarSymbol);
    return availableEmojis.find(emo => !takenEmojis.includes(emo)) || "❓";
}

io.on('connection', (socket) => {
    
    socket.on('registerHost', () => {
        const oldRoom = findRoomByHostSocketId(socket.id);
        if (oldRoom) {
            delete activeRooms[oldRoom.code];
        }

        const newCode = generateRandomCode();
        activeRooms[newCode] = {
            code: newCode,
            hostSocketId: socket.id,
            students: {},    
            currentQuestion: null,
            startTime: null,
            firstCorrectAnswered: false,
            submissionsThisRound: 0,
            isStarted: false,
            loadedSet: null
        };

        console.log(`🎰 NEW LIVE ROOM CREATED: ${newCode}`);
        socket.join(newCode);
        socket.emit('initRoomCode', newCode);
        socket.emit('updateLobby', []);
    });

    socket.on('joinRoom', ({ name, code }) => {
        const targetCode = code.trim();
        const room = activeRooms[targetCode];

        if (!room) {
            socket.emit('joinError', 'Invalid Room Code. Check the projector!');
            return;
        }
        if (room.isStarted) {
            socket.emit('joinError', 'Too late! The match has already started.');
            return;
        }

        let assignedEmoji = getFirstFreeEmoji(room);
        let assignedColor = "#0984e3";
        
        room.students[socket.id] = { 
            id: socket.id,
            name: name, 
            score: 0,
            avatarSymbol: assignedEmoji,
            avatarColor: assignedColor
        };

        socket.join(targetCode);
        socket.emit('joinSuccess', { id: socket.id, defaultSymbol: assignedEmoji, defaultColor: assignedColor });
        
        io.to(room.hostSocketId).emit('updateLobby', Object.values(room.students));
        io.to(targetCode).emit('syncTakenAvatars', Object.values(room.students));
    });

    socket.on('updateAvatar', ({ symbol, color }) => {
        const room = findRoomByStudentSocketId(socket.id);
        if (!room || room.isStarted || !room.students[socket.id]) return;

        const isEmojiTaken = Object.values(room.students).some(s => s.id !== socket.id && s.avatarSymbol === symbol);
        
        if (!isEmojiTaken) {
            room.students[socket.id].avatarSymbol = symbol;
            room.students[socket.id].avatarColor = color;
            
            io.to(room.hostSocketId).emit('updateLobby', Object.values(room.students));
            io.to(room.code).emit('syncTakenAvatars', Object.values(room.students));
        } else {
            socket.emit('avatarSelectionFailed', {
                message: 'Someone just grabbed that emoji! Pick a different one.',
                fallbackSymbol: room.students[socket.id].avatarSymbol
            });
            room.students[socket.id].avatarColor = color;
            io.to(room.hostSocketId).emit('updateLobby', Object.values(room.students));
        }
    });

    socket.on('selectActiveSet', (selectedSet) => {
        const room = findRoomByHostSocketId(socket.id);
        if (!room) return;

        room.loadedSet = selectedSet;
        io.to(room.hostSocketId).emit('activeSetReady', room.loadedSet);
    });

    socket.on('signalGameStart', () => {
        const room = findRoomByHostSocketId(socket.id);
        if (!room) return;

        room.isStarted = true;
        io.to(room.code).emit('lockAndLoadMatch');
    });

    socket.on('startQuestion', (questionData) => {
        const room = findRoomByHostSocketId(socket.id);
        if (!room) return;

        room.currentQuestion = questionData;
        room.startTime = Date.now();
        room.firstCorrectAnswered = false;
        room.submissionsThisRound = 0;
        io.to(room.code).emit('revealQuestionInput', { text: questionData.text });
    });

    socket.on('submitAnswer', (studentAnswer) => {
        const room = findRoomByStudentSocketId(socket.id);
        if (!room) return;

        const student = room.students[socket.id];
        if (!student || !room.startTime || !room.currentQuestion) return;

        room.submissionsThisRound++;
        const elapsedSeconds = (Date.now() - room.startTime) / 1000;
        
        if (studentAnswer.trim() === room.currentQuestion.answer) {
            let pointsEarned = 3; 
            
            if (elapsedSeconds <= 60) pointsEarned = 3;
            else if (elapsedSeconds <= 120) pointsEarned = 2;
            else if (elapsedSeconds <= 180) pointsEarned = 1;

            if (!room.firstCorrectAnswered) {
                pointsEarned += 1; 
                room.firstCorrectAnswered = true;
            }
            student.score += pointsEarned;
        }

        const totalStudents = Object.keys(room.students).length;
        if (room.submissionsThisRound >= totalStudents) {
            io.to(room.hostSocketId).emit('forceRevealAnswer', room.currentQuestion.answer);
        }
    });

    socket.on('timerExpired', () => {
        const room = findRoomByHostSocketId(socket.id);
        if (room) {
            io.to(room.hostSocketId).emit('forceRevealAnswer', room.currentQuestion ? room.currentQuestion.answer : "");
        }
    });

    socket.on('requestLeaderboard', () => {
        const room = findRoomByHostSocketId(socket.id);
        if (!room) return;

        const leaderboard = Object.values(room.students).sort((a, b) => b.score - a.score);
        socket.emit('finalLeaderboard', leaderboard);
    });

    socket.on('disconnect', () => {
        const hostedRoom = findRoomByHostSocketId(socket.id);
        if (hostedRoom) {
            console.log(`🗑️ HOST DISCONNECTED. REMOVING ROOM: ${hostedRoom.code}`);
            io.to(hostedRoom.code).emit('joinError', 'Host disconnected from room match session.');
            delete activeRooms[hostedRoom.code];
            return;
        }

        const studentRoom = findRoomByStudentSocketId(socket.id);
        if (studentRoom && studentRoom.students[socket.id]) {
            delete studentRoom.students[socket.id];
            io.to(studentRoom.hostSocketId).emit('updateLobby', Object.values(studentRoom.students));
            io.to(studentRoom.code).emit('syncTakenAvatars', Object.values(studentRoom.students));
        }
    });
});

// CHANGED SECTION: Dynamically detect cloud hosting ports or default to 3000 locally
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));