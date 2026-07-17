const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const { OpenAI } = require('openai');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const openai = new OpenAI({
    apiKey: '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'
});

app.use(express.static('public'));
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use(session({
    store: new FileStore({}),
    secret: 'math-league-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

const SETS_FILE = path.join(__dirname, 'sets.json');
const USERS_FILE = path.join(__dirname, 'users.json');

function loadUsers() {
    try {
        if (!fs.existsSync(USERS_FILE)) return [];
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(data || '[]');
    } catch (err) {
        return [];
    }
}

function saveUsers(usersArray) {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(usersArray, null, 2), 'utf8');
    } catch (err) {}
}

function loadSavedSets() {
    try {
        if (!fs.existsSync(SETS_FILE)) return [];
        const data = fs.readFileSync(SETS_FILE, 'utf8');
        return JSON.parse(data || '[]');
    } catch (err) {
        return [];
    }
}

function saveSetsToFile(setsArray) {
    try {
        fs.writeFileSync(SETS_FILE, JSON.stringify(setsArray, null, 2), 'utf8');
    } catch (err) {}
}

function generateRandomCode() {
    return Math.floor(10000000 + Math.random() * 90000000).toString();
}

let activeRooms = {};

function findRoomByStudentSocketId(socketId) {
    for (const code in activeRooms) {
        if (activeRooms[code].students[socketId]) return activeRooms[code];
    }
    return null;
}

function findRoomByHostSocketId(socketId) {
    for (const code in activeRooms) {
        if (activeRooms[code].hostSocketId === socketId) return activeRooms[code];
    }
    return null;
}

app.post('/api/auth/signup', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: "Missing fields." });
        const users = loadUsers();
        const normalizedEmail = email.toLowerCase().trim();
        if (users.find(u => u.email === normalizedEmail)) return res.status(400).json({ error: "Exists." });
        const hashedPassword = await bcrypt.hash(password, 10);
        users.push({ email: normalizedEmail, password: hashedPassword });
        saveUsers(users);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Fail." });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const users = loadUsers();
        const normalizedEmail = email.toLowerCase().trim();
        const user = users.find(u => u.email === normalizedEmail);
        if (!user) return res.status(400).json({ error: "Invalid credentials." });
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(400).json({ error: "Invalid credentials." });
        req.session.userEmail = user.email;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Fail." });
    }
});

app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: "Please enter your email address first." });

        const users = loadUsers();
        const normalizedEmail = email.toLowerCase().trim();
        const userIndex = users.findIndex(u => u.email === normalizedEmail);

        if (userIndex === -1) {
            return res.status(404).json({ error: "No account found with that email address." });
        }

        const tempPassword = "Password123!";
        const hashedPassword = await bcrypt.hash(tempPassword, 10);
        
        users[userIndex].password = hashedPassword;
        saveUsers(users);

        res.json({ 
            success: true, 
            message: `Password has been reset! Please login using your temporary password: ${tempPassword}` 
        });
    } catch (err) {
        res.status(500).json({ error: "Error resetting password." });
    }
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

function requireLogin(req, res, next) {
    if (!req.session.userEmail) return res.status(401).json({ error: "Unauthorized." });
    next();
}

app.post('/api/ai/scan-worksheet', requireLogin, async (req, res) => {
    try {
        const { base64Image } = req.body;
        if (!base64Image) return res.status(400).json({ error: "No image payload found." });

        console.log("🤖 Scanning sheet with 8-question limit & visual extraction rules...");

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "user",
                    content: [
                        { 
                            type: "text", 
                            text: `Analyze this math worksheet. Extract up to exactly 8 questions along with their answers. Stop processing after the 8th question.
                            For questions involving graphic diagrams, angles, geometry grids, or geometric visuals present in the image, you MUST attach the image data string or a complete visual layout description inside the "image" field string property so it renders seamlessly on the presentation screen.
                            You must return a JSON object containing an array named "questions".
                            Each question structure must match this layout exactly:
                            { "text": "Question statement here", "answer": "Answer here", "image": "Use the diagram asset or leave blank" }` 
                        },
                        {
                            type: "image_url",
                            image_url: { url: base64Image }
                        }
                    ]
                }
            ]
        });

        const parsedJson = JSON.parse(response.choices[0].message.content);
        if (parsedJson.questions && parsedJson.questions.length > 8) {
            parsedJson.questions = parsedJson.questions.slice(0, 8);
        }
        res.json(parsedJson);
    } catch (err) {
        res.status(500).json({ error: "AI parsing failed." });
    }
});

app.get('/api/sets', requireLogin, (req, res) => {
    const allSets = loadSavedSets();
    res.json(allSets.filter(set => set.owner === req.session.userEmail));
});

app.post('/api/sets', requireLogin, (req, res) => {
    const userSetsIncoming = req.body; 
    const allSets = loadSavedSets();
    const remainingSets = allSets.filter(set => set.owner !== req.session.userEmail);
    const brandedSets = userSetsIncoming.map(set => {
        set.owner = req.session.userEmail;
        return set;
    });
    saveSetsToFile([...remainingSets, ...brandedSets]);
    res.json({ success: true });
});

const availableEmojis = ["🔥","👑","🚀","👾","🍕","🐱","🦊","🫅","🎭","🎲","🎯","🧩","🎪","🎨","🛹","💎","⚡","🌈","🍀","🌍"];

function getFirstFreeEmoji(roomObj) {
    const takenEmojis = Object.values(roomObj.students).map(s => s.avatarSymbol);
    return availableEmojis.find(emo => !takenEmojis.includes(emo)) || "❓";
}

io.on('connection', (socket) => {
    socket.on('registerHost', () => {
        const oldRoom = findRoomByHostSocketId(socket.id);
        if (oldRoom) delete activeRooms[oldRoom.code];

        const newCode = generateRandomCode();
        activeRooms[newCode] = {
            code: newCode, hostSocketId: socket.id, students: {}, currentQuestion: null, startTime: null, firstCorrectAnswered: false, fastestCorrectPlayer: null, submissionsThisRound: 0, isStarted: false, loadedSet: null
        };
        socket.join(newCode);
        socket.emit('initRoomCode', newCode);
        socket.emit('updateLobby', []);
    });

    socket.on('joinRoom', ({ name, code }) => {
        const targetCode = code.trim();
        const room = activeRooms[targetCode];
        if (!room) {
            socket.emit('joinError', 'Invalid Room Code.');
            return;
        }
        if (room.isStarted) {
            socket.emit('joinError', 'Match already started.');
            return;
        }

        let assignedEmoji = getFirstFreeEmoji(room);
        room.students[socket.id] = { id: socket.id, name: name.substring(0, 15), score: 0, avatarSymbol: assignedEmoji, avatarColor: "#0984e3" };

        socket.join(targetCode);
        socket.emit('joinSuccess', { id: socket.id, defaultSymbol: assignedEmoji, defaultColor: "#0984e3" });
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
        room.fastestCorrectPlayer = null;
        room.submissionsThisRound = 0;
        io.to(room.code).emit('revealQuestionInput', { text: questionData.text, duration: 180 });
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
            else pointsEarned = 1;

            if (!room.firstCorrectAnswered) {
                pointsEarned += 1;
                room.firstCorrectAnswered = true;
                room.fastestCorrectPlayer = { id: student.id, name: student.name };
            }
            student.score += pointsEarned;
        }

        const totalStudents = Object.keys(room.students).length;
        if (room.submissionsThisRound >= totalStudents) {
            io.to(room.hostSocketId).emit('forceRevealAnswer', room.currentQuestion.answer);
            io.to(room.code).emit('timeOutLock'); 
            if (room.fastestCorrectPlayer) {
                io.to(room.code).emit('updateCategorySelector', room.fastestCorrectPlayer);
            }
        }
    });

    socket.on('timerExpired', () => {
        const room = findRoomByHostSocketId(socket.id);
        if (room) {
            io.to(room.hostSocketId).emit('forceRevealAnswer', room.currentQuestion ? room.currentQuestion.answer : "");
            io.to(room.code).emit('timeOutLock');
            if (room.fastestCorrectPlayer) {
                io.to(room.code).emit('updateCategorySelector', room.fastestCorrectPlayer);
            }
        }
    });

    socket.on('requestLeaderboard', () => {
        const room = findRoomByHostSocketId(socket.id);
        if (!room) return;
        socket.emit('finalLeaderboard', Object.values(room.students).sort((a, b) => b.score - a.score));
    });

    socket.on('disconnect', () => {
        const hostedRoom = findRoomByHostSocketId(socket.id);
        if (hostedRoom) {
            io.to(hostedRoom.code).emit('joinError', 'Host disconnected.');
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
