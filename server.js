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

// --- Files & Data ---
const DATA_FILE = 'database.json';
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
try { if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) {}

const defaultDB = { users: [], posts: [], reels: [], groups: [], pages: [], friendRequests: [], friendships: [], globalMessages: [], privateMessages: [] };
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
        if(db.globalMessages.length > 400) db.globalMessages = db.globalMessages.slice(-400);
        if(db.posts.length > 200) db.posts = db.posts.slice(0, 200);
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

// --- AI ---
async function getAIResponse(prompt) {
    if (!process.env.GEMINI_API_KEY) return "مرحباً! كيف يمكنني مساعدتك؟";
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent(prompt);
        return (await result.response).text();
    } catch (e) { return "أنا هنا للمساعدة!"; }
}

// --- Keep-Alive ---
app.get('/ping', (req, res) => res.send('Pong'));
setInterval(() => { try { http.get(`http://127.0.0.1:${process.env.PORT||3000}/ping`).on('error',()=>{}); } catch(e){} }, 240000);

// --- 130 Bots ---
const names = ["أحمد", "محمد", "محمود", "علي", "عمر", "خالد", "يوسف", "إبراهيم", "حسن", "سعيد", "مصطفى", "عبدالله", "كريم", "طارق", "زياد", "ياسر", "سامي", "فهد", "سلمان", "فيصل", "ماجد", "نايف", "وليد", "هاني", "جمال", "رامي", "سمير", "عادل", "نور", "سارة", "ليلى", "مريم", "فاطمة", "عائشة", "زينب", "هدى", "منى", "هند", "سلمى", "ندى", "ياسمين", "رنا", "داليا", "ريم", "أمل", "حنان", "سعاد", "وفاء", "لمياء", "شروق"];
const surnames = ["المصري", "العلي", "محمد", "أحمد", "محمود", "حسن", "إبراهيم", "سعيد", "كمال", "جمال", "فوزي", "صلاح", "يوسف", "عبدالله", "عمر", "خالد", "سالم", "غانم", "حامد", "نور", "الشمري", "الغامدي", "القحطاني", "الزهراني", "الدوسري"];

for(let i=0; i<130; i++) {
    const email = `bot${i}@blogane.com`;
    if(!db.users.find(u => u.email === email)) {
        const n = names[Math.floor(Math.random()*names.length)] + " " + surnames[Math.floor(Math.random()*surnames.length)];
        db.users.push({
            id: Date.now() + i, name: n, email: email, password: 'bot',
            avatar: `https://ui-avatars.com/api/?name=${n.replace(' ','+')}&background=random&color=fff`,
            bio: 'Bot Active 🤖', isBot: true, isOnline: true, coins: 5000
        });
    }
}
saveData();

let connectedSockets = {}; 

// --- Simulation: Global Gifts & Activity ---
const giftTypes = ["وردة 🌹", "سيارة 🏎️", "تاج 👑", "أسد 🦁", "قهوة ☕", "قلب ❤️"];
setInterval(() => {
    try {
        const botsOnly = db.users.filter(u => u.isBot);
        const sender = botsOnly[Math.floor(Math.random() * botsOnly.length)];
        const receiver = botsOnly[Math.floor(Math.random() * botsOnly.length)];
        
        // Fake Global Gift Notification (لخلق جو تفاعلي)
        if (Math.random() < 0.3 && sender && receiver) {
            const gift = giftTypes[Math.floor(Math.random() * giftTypes.length)];
            io.emit('global_gift_alert', { 
                from: sender.name, 
                to: receiver.name, 
                gift: gift,
                avatar: sender.avatar
            });
        }

        // Bot Posts & Chat (Existing Logic)
        if (Math.random() < 0.1) {
            const post = { id: Date.now(), author: sender.name, email: sender.email, avatar: sender.avatar, content: "يوم جميل للجميع ✨", media: null, likes: [], comments: [], date: new Date().toISOString(), context:'general', contextId:null };
            db.posts.unshift(post); io.emit('receive_post', post);
        }
        saveData();
    } catch(e) {}
}, 4000);

io.on('connection', (socket) => {
    
    socket.on('register', (d) => {
        if (db.users.find(u => u.email === d.email)) socket.emit('auth_error', 'البريد مسجل');
        else { const u = { ...d, id: Date.now(), avatar: `https://ui-avatars.com/api/?name=${d.name}&background=random`, bio: 'جديد', isOnline: true, coins: 100 }; db.users.push(u); saveData(); socket.emit('auth_success', u); }
    });

    socket.on('login', (d) => {
        const u = db.users.find(u => u.email === d.email && u.password === d.password);
        if (u) {
            connectedSockets[u.email] = socket.id; u.isOnline = true; if(u.coins===undefined) u.coins=100;
            saveData();
            socket.emit('auth_success', u);
            socket.emit('init_data', { groups: db.groups, pages: db.pages, reels: db.reels, globalMessages: db.globalMessages });
            socket.emit('load_posts', (db.posts||[]).filter(p => p.context === 'general'));
            updateFriendsList(u.email);
        } else { socket.emit('auth_error', 'بيانات خاطئة'); }
    });

    // --- Reels Interaction (New) ---
    // نستخدم دالة لايك واحدة تتعامل مع النوع
    socket.on('toggle_like', ({id, type, userEmail}) => { 
        let x = (type === 'reel' ? db.reels : db.posts).find(i => i.id == id);
        if (x) {
            if (x.likes.includes(userEmail)) x.likes = x.likes.filter(e => e !== userEmail);
            else x.likes.push(userEmail);
            saveData();
            io.emit('update_likes', {id, type, likes: x.likes});
        }
    });

    // تعليقات (محدث ليدعم الريلز والمنشورات)
    socket.on('add_comment', (d) => {
        // d needs: { postId, text, userEmail, ... , type: 'post' | 'reel' }
        let item = (d.type === 'reel' ? db.reels : db.posts).find(x => x.id == d.postId);
        if (item) {
            item.comments.push({id: Date.now(), ...d});
            saveData();
            io.emit('update_comments', {postId: d.postId, type: d.type, comments: item.comments});
        }
    });

    // --- Other ---
    socket.on('send_gift', (d) => {
        const sender = db.users.find(u => u.email === d.from);
        const receiver = db.users.find(u => u.email === d.to);
        if (sender && sender.coins >= d.cost) {
            sender.coins -= d.cost;
            if (receiver) receiver.coins = (receiver.coins||0) + d.cost;
            const msg = { id: Date.now(), from: d.from, to: d.to, text: `أرسل ${d.giftName} ${d.icon}`, isGift: true, icon: d.icon, date: new Date().toISOString() };
            db.privateMessages.push(msg); saveData();
            socket.emit('update_coins', sender.coins);
            socket.emit('receive_private_msg', msg);
            if (connectedSockets[d.to]) {
                io.to(connectedSockets[d.to]).emit('receive_private_msg', msg);
                io.to(connectedSockets[d.to]).emit('update_coins', receiver.coins);
                io.to(connectedSockets[d.to]).emit('notification', {title: 'هدية! 🎁', body: `وصلك ${d.giftName}`});
            }
            // إذاعة عالمية للهدية الكبيرة
            if(d.cost > 100) io.emit('global_gift_alert', { from: sender.name, to: receiver ? receiver.name : 'User', gift: `${d.giftName} ${d.icon}`, avatar: sender.avatar });
        } else { socket.emit('notification', {title: 'عفواً', body: 'رصيدك لا يكفي'}); }
    });

    socket.on('new_post', (d) => { let u=d.media&&d.media.startsWith('data:')?saveBase64ToFile(d.media,'post'):null; const p={...d,id:Date.now(),media:u,likes:[],comments:[],date:new Date().toISOString()}; db.posts.unshift(p); const user=db.users.find(u=>u.email===d.email); if(user){user.coins+=5;socket.emit('update_coins',user.coins);} saveData(); io.emit('receive_post', p); socket.emit('upload_complete'); });
    socket.on('send_global_msg', (d) => { let u=d.image?saveBase64ToFile(d.image,'chat'):null; const m={...d,image:u,id:Date.now(),date:new Date().toISOString()}; db.globalMessages.push(m); saveData(); io.emit('receive_global_msg', m); });
    socket.on('send_private_msg', (d) => { const m={...d,id:Date.now(),date:new Date().toISOString()}; db.privateMessages.push(m); saveData(); socket.emit('receive_private_msg',m); if(connectedSockets[d.to])io.to(connectedSockets[d.to]).emit('receive_private_msg',m); });
    socket.on('send_ai_msg', async (t) => { const r = await getAIResponse(t); socket.emit('receive_ai_msg', {text: r}); });
    
    // Standard
    socket.on('get_private_msgs', ({u1,u2})=>socket.emit('load_private_msgs',db.privateMessages.filter(m=>(m.from===u1&&m.to===u2)||(m.from===u2&&m.to===u1))));
    socket.on('send_friend_request', (d)=>{ if(d.from!==d.to && !db.friendRequests.find(r=>r.from===d.from&&r.to===d.to)){ db.friendRequests.push({from:d.from,to:d.to}); saveData(); if(connectedSockets[d.to])io.to(connectedSockets[d.to]).emit('new_req_alert'); } });
    socket.on('respond_friend_request', (d)=>{ db.friendRequests=db.friendRequests.filter(r=>!(r.to===d.userEmail&&r.from===d.requesterEmail)); if(d.accept){db.friendships.push({user1:d.userEmail,user2:d.requesterEmail}); updateFriendsList(d.userEmail); updateFriendsList(d.requesterEmail);} saveData(); });
    function updateFriendsList(e){ const fs=db.friendships.filter(f=>f.user1===e||f.user2===e); const es=fs.map(f=>f.user1===e?f.user2:f.user1); const fd=db.users.filter(u=>es.includes(u.email)).map(u=>({name:u.name,email:u.email,avatar:u.avatar,isOnline:!!connectedSockets[u.email]||u.isBot})); if(connectedSockets[e])io.to(connectedSockets[e]).emit('update_friends',fd); }
    
    socket.on('get_profile_info', (e)=>{ const u=db.users.find(x=>x.email===e); if(u){ socket.emit('open_profile_view', {user:u, posts:(db.posts||[]).filter(p=>p.email===e)}); } });
    socket.on('update_profile', (d)=>{ const i=db.users.findIndex(u=>u.email===d.email); if(i!==-1){ db.users[i].name=d.name; db.users[i].bio=d.bio; if(d.avatar&&d.avatar.startsWith('data:'))db.users[i].avatar=saveBase64ToFile(d.avatar,'avatar'); saveData(); socket.emit('profile_updated_success', db.users[i]); } });
    socket.on('new_reel', (d) => { let u=saveBase64ToFile(d.videoBase64,'reel'); if(u){ const r={id:Date.now(),url:u,desc:d.desc,author:d.author,avatar:d.avatar,email:d.email,likes:[],comments:[]}; db.reels.unshift(r); saveData(); io.emit('receive_reel', {...r,videoBase64:null}); socket.emit('upload_complete'); } });
    
    socket.on('disconnect', () => { const e=Object.keys(connectedSockets).find(k=>connectedSockets[k]===socket.id); if(e){const u=db.users.find(x=>x.email===e);if(u){u.isOnline=false;saveData();} delete connectedSockets[e];} });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on ${PORT}`));
