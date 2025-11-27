const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*" },
    maxHttpBufferSize: 50 * 1024 * 1024 
});

app.use(express.static(path.join(__dirname, 'public')));

// --- Files ---
const DATA_FILE = 'database.json';
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
try { if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) {}

const defaultDB = { users: [], posts: [], reels: [], stories: [], groups: [], pages: [], friendRequests: [], friendships: [], globalMessages: [], privateMessages: [] };
let db = { ...defaultDB };

function loadData() {
    if (fs.existsSync(DATA_FILE)) {
        try {
            const loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            db = { ...defaultDB, ...loaded };
            for(let key in defaultDB) if(!Array.isArray(db[key])) db[key] = [];
        } catch (e) { db = { ...defaultDB }; }
    } else saveData();
}
loadData();

function saveData() {
    try {
        if(db.globalMessages.length > 300) db.globalMessages = db.globalMessages.slice(-300);
        if(db.posts.length > 150) db.posts = db.posts.slice(0, 150);
        if(db.stories.length > 50) db.stories = db.stories.slice(-50);
        fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    } catch (e) { console.error("Save Error"); }
}

function saveBase64ToFile(base64Data, prefix) {
    try {
        if (!base64Data || typeof base64Data !== 'string') return null;
        const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) return null;
        const ext = matches[1].split('/')[1] || 'bin';
        const filename = `${prefix}_${Date.now()}.${ext}`;
        fs.writeFileSync(path.join(UPLOAD_DIR, filename), Buffer.from(matches[2], 'base64'));
        return `/uploads/${filename}`;
    } catch (e) { return null; }
}

async function getAIResponse(prompt) {
    if (!process.env.GEMINI_API_KEY) return "مرحباً! أنا الذكاء الاصطناعي.";
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent(prompt);
        return (await result.response).text();
    } catch (e) { return "لحظة من فضلك..."; }
}

app.get('/ping', (req, res) => res.send('Pong'));
setInterval(() => { try { http.get(`http://127.0.0.1:${process.env.PORT||3000}/ping`).on('error',()=>{}); } catch(e){} }, 240000);

// --- 130 Bots (Verified) ---
const names = ["أحمد", "سارة", "محمد", "نور", "خالد", "ليلى", "يوسف", "مريم", "عمر", "فاطمة", "علي", "هدى", "إبراهيم", "منى", "حسن", "زينب", "سعيد", "سلمى", "مصطفى", "رنا"];
const surnames = ["المصري", "الغامدي", "علي", "حسن", "إبراهيم", "محمود", "سعيد", "كمال", "صلاح", "يوسف", "عبدالله", "عمر", "سالم", "غانم", "حامد", "نور"];

for(let i=0; i<130; i++) {
    const email = `bot${i}@blogane.com`;
    if(!db.users.find(u => u.email === email)) {
        const f = names[Math.floor(Math.random()*names.length)];
        const l = surnames[Math.floor(Math.random()*surnames.length)];
        db.users.push({
            id: Date.now() + i, name: `${f} ${l}`, email: email, password: 'bot',
            avatar: `https://ui-avatars.com/api/?name=${f}+${l}&background=random&color=fff&size=128`,
            bio: 'حساب رسمي موثوق ✨', isBot: true, isOnline: true, coins: 99999, verified: true 
        });
    }
}
saveData();

let connectedSockets = {}; 

// --- Simulation (Posts & Stories) ---
const botMsgs = ["صباح الخير ☀️", "يوم جميل للجميع", "صورة رائعة", "سبحان الله", "مساء الورد", "تطبيق ممتاز", "جمعة مباركة", "تحياتي", "روعة", "استمر"];
const giftTypes = ["وردة 🌹", "قلب ❤️", "سيارة 🏎️"];

setInterval(() => {
    try {
        const bots = db.users.filter(u => u.isBot);
        const sender = bots[Math.floor(Math.random() * bots.length)];
        const receiver = bots[Math.floor(Math.random() * bots.length)];
        const action = Math.random();

        if(!sender) return;

        if (action < 0.1) { // New Story (Added!)
             const story = { id: Date.now(), author: sender.name, email: sender.email, avatar: sender.avatar, media: `https://picsum.photos/400/800?random=${Date.now()}`, date: new Date().toISOString(), verified: true };
             db.stories.push(story); if(db.stories.length>50)db.stories.shift();
             io.emit('new_story', story);
        } else if (action < 0.2) { // Gift Ticker
             const gift = giftTypes[Math.floor(Math.random() * giftTypes.length)];
             io.emit('gift_broadcast', { from: sender.name, to: receiver.name, gift: gift, avatar: sender.avatar });
        } else if (action < 0.35) { // Post
            const p = { id: Date.now(), author: sender.name, email: sender.email, avatar: sender.avatar, content: botMsgs[Math.floor(Math.random()*botMsgs.length)], media: null, likes: [], comments: [], date: new Date().toISOString(), context:'general', contextId:null, verified: true };
            db.posts.unshift(p); io.emit('receive_post', p);
        }
        saveData();
    } catch(e) {}
}, 4000);

io.on('connection', (socket) => {
    socket.on('register', (d) => {
        if (db.users.find(u => u.email === d.email)) socket.emit('auth_error', 'البريد مسجل');
        else { const u = { ...d, id: Date.now(), avatar: `https://ui-avatars.com/api/?name=${d.name}&background=random`, bio: 'جديد', isOnline: true, coins: 100, verified: false }; db.users.push(u); saveData(); socket.emit('auth_success', u); }
    });
    socket.on('login', (d) => {
        const u = db.users.find(u => u.email === d.email && u.password === d.password);
        if (u) {
            connectedSockets[u.email] = socket.id; u.isOnline = true; if(u.coins===undefined)u.coins=100; saveData();
            socket.emit('auth_success', u);
            socket.emit('init_data', { groups: db.groups, pages: db.pages, reels: db.reels, globalMessages: db.globalMessages, friendRequests: db.friendRequests, stories: db.stories });
            socket.emit('load_posts', (db.posts||[]).filter(p => p.context === 'general'));
            const fs=db.friendships.filter(f=>f.user1===u.email||f.user2===u.email);
            const fe=fs.map(f=>f.user1===u.email?f.user2:f.user1);
            const fd=db.users.filter(x=>fe.includes(x.email)).map(x=>({name:x.name,email:x.email,avatar:x.avatar,isOnline:!!connectedSockets[x.email]||x.isBot, verified:x.verified}));
            socket.emit('update_friends', fd);
        } else { socket.emit('auth_error', 'بيانات خاطئة'); }
    });

    // Profile Fix
    socket.on('get_profile_info', (e) => { 
        const u = db.users.find(x => x.email === e); 
        if(u) { 
            const fs = db.friendships.filter(f => f.user1 === e || f.user2 === e);
            const fEmails = fs.map(f => f.user1 === e ? f.user2 : f.user1);
            const friends = db.users.filter(x => fEmails.includes(x.email)).map(x => ({name:x.name, avatar:x.avatar, email:x.email, verified:x.verified})); 
            socket.emit('open_profile_view', {user:u, posts:(db.posts||[]).filter(p=>p.email===e), friends}); 
        } 
    });

    // Standard
    socket.on('new_post', (d) => { let u=d.media&&d.media.startsWith('data:')?saveBase64ToFile(d.media,'post'):null; const user=db.users.find(x=>x.email===d.email); const p={...d,id:Date.now(),media:u,likes:[],comments:[],date:new Date().toISOString(), verified: user?user.verified:false}; db.posts.unshift(p); if(user){user.coins+=10;socket.emit('update_coins',user.coins);} saveData(); io.emit('receive_post', p); socket.emit('upload_complete'); });
    socket.on('toggle_like', ({id, type, userEmail}) => { let x=db.posts.find(i=>i.id==id); if(x){ if(x.likes.includes(userEmail))x.likes=x.likes.filter(e=>e!==userEmail); else x.likes.push(userEmail); saveData(); io.emit('update_likes', {id, likes:x.likes}); } });
    socket.on('add_comment', (d) => { const p=db.posts.find(x=>x.id==d.postId); if(p){ p.comments.push({id:Date.now(), ...d}); saveData(); io.emit('update_comments', {postId:d.postId, comments:p.comments}); } });
    socket.on('game_result', ({email, reward}) => { const u = db.users.find(x => x.email === email); if(u) { u.coins += reward; saveData(); socket.emit('update_coins', u.coins); } });
    socket.on('claim_bonus', (email) => { const u = db.users.find(x => x.email === email); if(u) { u.coins += 50; saveData(); socket.emit('update_coins', u.coins); socket.emit('notification', {title:'مكافأة!', body:'50 كوينز!'}); } });
    socket.on('search_users', (q) => { if(!q)return; const r=db.users.filter(u=>u.name.toLowerCase().includes(q.toLowerCase())).slice(0,15).map(u=>({name:u.name,email:u.email,avatar:u.avatar,isBot:u.isBot, verified:u.verified})); socket.emit('search_results', r); });
    socket.on('send_ai_msg', async (t) => { const r = await getAIResponse(t); socket.emit('receive_ai_msg', {text: r}); });
    socket.on('send_global_msg', (d) => { let u=d.image?saveBase64ToFile(d.image,'chat'):null; const m={...d,image:u,id:Date.now(),date:new Date().toISOString()}; db.globalMessages.push(m); saveData(); io.emit('receive_global_msg', m); });
    socket.on('update_profile', (d) => { const i=db.users.findIndex(u=>u.email===d.email); if(i!==-1){ db.users[i].name=d.name; db.users[i].bio=d.bio; if(d.avatar&&d.avatar.startsWith('data:'))db.users[i].avatar=saveBase64ToFile(d.avatar,'avatar'); saveData(); socket.emit('profile_updated_success', db.users[i]); } });

    socket.on('disconnect', () => {
        for(let [email, sId] of Object.entries(connectedSockets)) { if(sId===socket.id) { const u=db.users.find(x=>x.email===email); if(u){u.isOnline=false; saveData();} delete connectedSockets[email]; break; } }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on ${PORT}`));
