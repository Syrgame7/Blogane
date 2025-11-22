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

// --- إعدادات الملفات ---
const DATA_FILE = 'database.json';
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
try { if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) {}

// البيانات الافتراضية (مع إضافة الكوينز)
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

// --- AI (Gemini) ---
async function getAIResponse(prompt, context = "") {
    if (!process.env.GEMINI_API_KEY) return "مرحباً! كيف حالك؟";
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const fullPrompt = context ? `Context: ${context}. Reply to: ${prompt}` : prompt;
        const result = await model.generateContent(fullPrompt);
        return (await result.response).text();
    } catch (error) { return "أهلاً بك، يومك سعيد! 🌸"; }
}

// --- Keep-Alive ---
app.get('/ping', (req, res) => res.send('Pong'));
setInterval(() => { try { http.get(`http://127.0.0.1:${process.env.PORT||3000}/ping`).on('error',()=>{}); } catch(e){} }, 240000);

// --- Bots Setup ---
const botNames = ["أميرة", "خالد", "نور", "يوسف", "سارة", "عمر", "ليلى", "أحمد", "فاطمة", "ماجد"];
for(let i=0; i<80; i++) {
    const email = `bot${i}@blogane.com`;
    if(!db.users.find(u => u.email === email)) {
        const name = botNames[i % botNames.length] + " " + Math.floor(Math.random()*100);
        db.users.push({
            id: Date.now() + i, name: name, email: email, password: 'bot',
            avatar: `https://ui-avatars.com/api/?name=${name}&background=random&color=fff`,
            bio: 'Bot 🤖', isBot: true, isOnline: true, coins: 9999
        });
    }
}
saveData();

// --- Bot Active Behavior (المبادرة بالرسائل) ---
setInterval(async () => {
    try {
        // 1. نشر وعمل لايكات (كما سبق)
        if (Math.random() < 0.3) {
            const bot = db.users.filter(u=>u.isBot)[Math.floor(Math.random()*db.users.filter(u=>u.isBot).length)];
            if(bot) {
                const post = { id: Date.now(), author: bot.name, email: bot.email, avatar: bot.avatar, content: "منشور تلقائي للتفاعل 🚀", media: null, likes: [], comments: [], date: new Date().toISOString(), context:'general', contextId:null };
                db.posts.unshift(post); io.emit('receive_post', post);
            }
        }

        // 2. المبادرة برسالة خاصة لمستخدم حقيقي (جديد!)
        if (Math.random() < 0.1) { // فرصة 10% كل دورة
            const realUsers = db.users.filter(u => !u.isBot && u.isOnline);
            const randomUser = realUsers[Math.floor(Math.random() * realUsers.length)];
            const randomBot = db.users.filter(u=>u.isBot)[Math.floor(Math.random()*db.users.filter(u=>u.isBot).length)];
            
            if (randomUser && randomBot) {
                // البوت يقرر ماذا يقول باستخدام AI
                const openers = ["مرحباً، منشورك الأخير أعجبني!", "كيف حالك اليوم؟", "هل تحب البرمجة؟", "صورة بروفايلك رائعة 🌹"];
                const text = openers[Math.floor(Math.random() * openers.length)];
                
                const msg = { id: Date.now(), from: randomBot.email, to: randomUser.email, text: text, date: new Date().toISOString() };
                db.privateMessages.push(msg);
                saveData();
                const socketId = Object.keys(connectedSockets).find(key => connectedSockets[key] === randomUser.email); // Fix mapping logic below
                // البحث عن سوكت المستخدم
                for (let [id, email] of Object.entries(connectedSockets)) {
                    if (email === randomUser.email) io.to(id).emit('receive_private_msg', msg);
                }
            }
        }
        saveData();
    } catch(e) {}
}, 8000);

let connectedSockets = {}; 

io.on('connection', (socket) => {
    
    socket.on('register', (d) => {
        if (db.users.find(u => u.email === d.email)) socket.emit('auth_error', 'البريد مسجل');
        else { 
            const u = { ...d, id: Date.now(), avatar: `https://ui-avatars.com/api/?name=${d.name}&background=random`, bio: 'جديد', isOnline: true, coins: 50 }; // 50 هدية تسجيل
            db.users.push(u); saveData(); socket.emit('auth_success', u); 
        }
    });

    socket.on('login', (d) => {
        const u = db.users.find(u => u.email === d.email && u.password === d.password);
        if (u) {
            connectedSockets[socket.id] = u.email; // Correct mapping: SocketID -> Email
            u.isOnline = true; 
            if(!u.coins) u.coins = 50; // ضمان وجود الكوينز
            saveData();
            socket.emit('auth_success', u);
            socket.emit('init_data', { groups: db.groups, pages: db.pages, reels: db.reels, globalMessages: db.globalMessages });
            socket.emit('load_posts', (db.posts||[]).filter(p => p.context === 'general'));
            updateFriendsList(u.email);
        } else { socket.emit('auth_error', 'بيانات خاطئة'); }
    });

    // --- Economy: Gifts ---
    socket.on('send_gift', (d) => {
        // d: { from, to, giftName, cost, icon }
        const sender = db.users.find(u => u.email === d.from);
        const receiver = db.users.find(u => u.email === d.to);
        
        if (sender && sender.coins >= d.cost) {
            sender.coins -= d.cost;
            if(receiver) {
                if(!receiver.coins) receiver.coins = 0;
                receiver.coins += d.cost; // تحويل الكوينز للمستقبل
            }
            
            // إرسال رسالة هدية في الشات
            const msg = { 
                id: Date.now(), from: d.from, to: d.to, 
                text: `أرسل هدية: ${d.giftName} ${d.icon}`, 
                isGift: true, icon: d.icon,
                date: new Date().toISOString() 
            };
            db.privateMessages.push(msg);
            saveData();

            // تحديث رصيد المرسل
            socket.emit('update_coins', sender.coins);
            socket.emit('receive_private_msg', msg);
            
            // تحديث المستقبل
            for (let [id, email] of Object.entries(connectedSockets)) {
                if (email === d.to) {
                    io.to(id).emit('receive_private_msg', msg);
                    io.to(id).emit('update_coins', receiver.coins);
                    io.to(id).emit('notification', { title: 'هدية جديدة! 🎁', body: `${sender.name} أرسل لك ${d.giftName}` });
                }
            }
        } else {
            socket.emit('notification', { title: 'خطأ', body: 'رصيدك لا يكفي لإرسال الهدية!' });
        }
    });

    // --- Features ---
    socket.on('new_post', (d) => { 
        let u=d.media&&d.media.startsWith('data:')?saveBase64ToFile(d.media,'post'):null; 
        const p={...d,id:Date.now(),media:u,likes:[],comments:[],date:new Date().toISOString()}; 
        db.posts.unshift(p); 
        
        // مكافأة نشر
        const user = db.users.find(u => u.email === d.email);
        if(user) { user.coins += 5; socket.emit('update_coins', user.coins); }
        
        saveData(); io.emit('receive_post', p); socket.emit('upload_complete'); 
    });

    // ... (باقي الدوال الأساسية: لايك، تعليق، مجموعات، كما هي في الكود السابق لضمان الاستقرار) ...
    socket.on('toggle_like', ({id, type, userEmail}) => { let x=(type==='reel'?db.reels:db.posts).find(i=>i.id==id); if(x){ if(x.likes.includes(userEmail))x.likes=x.likes.filter(e=>e!==userEmail); else x.likes.push(userEmail); saveData(); io.emit('update_likes', {id, type, likes:x.likes}); } });
    socket.on('add_comment', (d) => { const p=db.posts.find(x=>x.id==d.postId); if(p){ p.comments.push({id:Date.now(), ...d}); saveData(); io.emit('update_comments', {postId:d.postId, comments:p.comments}); } });
    socket.on('send_global_msg', (d) => { let u=d.image?saveBase64ToFile(d.image,'chat'):null; const m={...d,image:u,id:Date.now(),date:new Date().toISOString()}; db.globalMessages.push(m); saveData(); io.emit('receive_global_msg', m); });
    socket.on('send_private_msg', (d) => {
        const m = { ...d, id: Date.now(), date: new Date().toISOString() };
        db.privateMessages.push(m); saveData();
        socket.emit('receive_private_msg', m);
        
        // Bot Reply
        const target = db.users.find(u => u.email === d.to);
        if(target && target.isBot) {
            setTimeout(async () => {
                const replyText = await getAIResponse(d.text);
                const botReply = { id:Date.now(), from:d.to, to:d.from, text:replyText, date:new Date().toISOString() };
                db.privateMessages.push(botReply); saveData();
                socket.emit('receive_private_msg', botReply);
            }, 2000);
        } else {
            for (let [id, email] of Object.entries(connectedSockets)) {
                if (email === d.to) {
                    io.to(id).emit('receive_private_msg', m);
                    io.to(id).emit('notification', { title: 'رسالة جديدة', body: `من ${db.users.find(u=>u.email===d.from)?.name}` });
                }
            }
        }
    });
    socket.on('get_private_msgs', ({u1, u2}) => socket.emit('load_private_msgs', db.privateMessages.filter(m=>(m.from===u1&&m.to===u2)||(m.from===u2&&m.to===u1))));
    
    // Friends
    socket.on('send_friend_request', (d) => {
        if(d.from!==d.to && !db.friendRequests.find(r=>r.from===d.from&&r.to===d.to)) {
            db.friendRequests.push({from:d.from, to:d.to}); saveData();
            const t=db.users.find(u=>u.email===d.to);
            if(t&&t.isBot){ setTimeout(()=>{ db.friendRequests=db.friendRequests.filter(r=>!(r.from===d.from&&r.to===d.to)); db.friendships.push({user1:d.from,user2:d.to}); saveData(); updateFriendsList(d.from); },2000); } 
            else { 
                for(let [id, email] of Object.entries(connectedSockets)) if(email===d.to) { io.to(id).emit('new_req_alert'); io.to(id).emit('notification',{title:'طلب صداقة', body:'لديك طلب صداقة جديد'}); }
                checkFriendRequests(d.to); 
            }
        }
    });
    socket.on('respond_friend_request', (d) => { db.friendRequests = db.friendRequests.filter(r=>!(r.to===d.userEmail && r.from===d.requesterEmail)); if(d.accept) { db.friendships.push({user1:d.userEmail, user2:d.requesterEmail}); updateFriendsList(d.userEmail); updateFriendsList(d.requesterEmail); } saveData(); checkFriendRequests(d.userEmail); });

    function checkFriendRequests(email) { const reqs = db.friendRequests.filter(r => r.to === email); const data = reqs.map(r => { const s = db.users.find(u=>u.email===r.from); return {email:r.from, name:s?s.name:'Unknown', avatar:s?s.avatar:''}; }); for(let [id, e] of Object.entries(connectedSockets)) if(e===email) io.to(id).emit('update_requests', data); }
    function updateFriendsList(email) { const fs = db.friendships.filter(f => f.user1 === email || f.user2 === email); const emails = fs.map(f => f.user1 === email ? f.user2 : f.user1); const fData = db.users.filter(u => emails.includes(u.email)).map(u => ({ name: u.name, email: u.email, avatar: u.avatar, isOnline: !!Object.values(connectedSockets).includes(u.email) || u.isBot })); for(let [id, e] of Object.entries(connectedSockets)) if(e===email) io.to(id).emit('update_friends', fData); }

    // Others
    socket.on('create_group', (d)=>{const g={id:'g'+Date.now(),...d,members:[d.owner]}; db.groups.push(g); saveData(); io.emit('update_groups', db.groups);});
    socket.on('create_page', (d)=>{const p={id:'p'+Date.now(),...d,followers:[d.owner]}; db.pages.push(p); saveData(); io.emit('update_pages', db.pages);});
    socket.on('get_context_posts', ({context, contextId}) => { socket.emit('load_posts', db.posts.filter(p => p.context === context && p.contextId === contextId)); });
    socket.on('new_reel', (d) => { let u=saveBase64ToFile(d.videoBase64,'reel'); if(u){ const r={id:Date.now(),url:u,desc:d.desc,author:d.author,avatar:d.avatar,email:d.email,likes:[],comments:[]}; db.reels.unshift(r); saveData(); io.emit('receive_reel', {...r,videoBase64:null}); socket.emit('upload_complete'); } });
    socket.on('update_profile', (d) => { const i=db.users.findIndex(u=>u.email===d.email); if(i!==-1){ db.users[i].name=d.name; db.users[i].bio=d.bio; if(d.avatar&&d.avatar.startsWith('data:'))db.users[i].avatar=saveBase64ToFile(d.avatar,'avatar'); saveData(); socket.emit('profile_updated_success', db.users[i]); } });
    socket.on('get_profile_info', (e) => { const u=db.users.find(x=>x.email===e); if(u) { const fs=db.friendships.filter(f=>f.user1===e||f.user2===e); const fEmails=fs.map(f=>f.user1===e?f.user2:f.user1); const friends=db.users.filter(x=>fEmails.includes(x.email)).map(x=>({name:x.name, avatar:x.avatar, email:x.email})); socket.emit('open_profile_view', {user:u, posts:(db.posts||[]).filter(p=>p.email===e), friends}); } });

    socket.on('disconnect', () => {
        const email = connectedSockets[socket.id];
        if(email) { const u=db.users.find(x=>x.email===email); if(u){u.isOnline=false; saveData();} delete connectedSockets[socket.id]; }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on ${PORT}`));
