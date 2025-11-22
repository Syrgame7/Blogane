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
    maxHttpBufferSize: 50 * 1024 * 1024 // 50 MB
});

app.use(express.static(path.join(__dirname, 'public')));

// --- إعدادات الملفات ---
const DATA_FILE = 'database.json';
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

// إنشاء المجلدات بأمان
try { if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) { console.error("FS Create Error", e); }

// البيانات الافتراضية
const defaultDB = { users: [], posts: [], reels: [], groups: [], pages: [], friendRequests: [], friendships: [], globalMessages: [], privateMessages: [] };
let db = { ...defaultDB };

// تحميل البيانات
function loadData() {
    if (fs.existsSync(DATA_FILE)) {
        try {
            const raw = fs.readFileSync(DATA_FILE, 'utf8');
            const loaded = JSON.parse(raw);
            db = { ...defaultDB, ...loaded };
            // التأكد من أن المصفوفات موجودة
            for(let key in defaultDB) if(!Array.isArray(db[key])) db[key] = [];
        } catch (e) { 
            console.error("DB Load Error, resetting...");
            db = { ...defaultDB }; 
        }
    } else saveData();
}
loadData();

// حفظ البيانات (مع حماية من الأخطاء)
function saveData() {
    try {
        // تنظيف البيانات القديمة للحفاظ على الأداء
        if(db.globalMessages.length > 400) db.globalMessages = db.globalMessages.slice(-400);
        if(db.posts.length > 150) db.posts = db.posts.slice(0, 150);
        fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    } catch (e) { console.error("DB Save Error", e.message); }
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

// --- الذكاء الاصطناعي (Gemini 1.5 Flash) ---
async function getAIResponse(prompt) {
    if (!process.env.GEMINI_API_KEY) return "عذراً، مفتاح AI غير مضبوط في السيرفر.";
    
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // قائمة الموديلات للتجربة (الأحدث أولاً)
    const models = ["gemini-2.5-flash", "gemini-1.5-pro", "gemini-pro"]; 

    for (const modelName of models) {
        try {
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent(prompt);
            const response = await result.response;
            return response.text();
        } catch (error) {
            console.warn(`AI Model ${modelName} failed:`, error.message);
            continue; // جرب الموديل التالي
        }
    }
    return "أواجه ضغطاً عالياً حالياً، يرجى المحاولة لاحقاً! 🤖";
}

// --- Keep-Alive ---
app.get('/ping', (req, res) => res.send('Pong'));
setInterval(() => { 
    try { http.get(`http://127.0.0.1:${process.env.PORT||3000}/ping`).on('error',()=>{}); } catch(e){} 
}, 240000);

// --- 80 Smart Bots Setup ---
const firstNames = ["أحمد", "محمد", "محمود", "علي", "عمر", "خالد", "يوسف", "إبراهيم", "حسن", "سعيد", "مصطفى", "عبدالله", "عبدالرحمن", "كريم", "طارق", "زياد", "ياسر", "سامي", "فهد", "سلمان", "فيصل", "ماجد", "نايف", "وليد", "هاني", "جمال", "رامي", "سمير", "عادل", "نور", "سارة", "ليلى", "مريم", "فاطمة", "عائشة", "زينب", "هدى", "منى", "هند", "سلمى", "ندى", "ياسمين", "رنا", "داليا", "ريم", "أمل", "حنان", "سعاد", "وفاء", "لمياء", "شروق", "آية", "منال", "نهى", "سمر", "عبير", "غادة", "نجوى", "أسماء"];
const lastNames = ["الشمري", "الغامدي", "المصري", "العلي", "محمد", "أحمد", "محمود", "حسن", "إبراهيم", "سعيد", "كمال", "جمال", "فوزي", "صلاح", "يوسف", "عبدالله", "عمر", "خالد", "سالم", "غانم", "حامد", "نور"];
const botBios = ["مهتم بالتقنية 💻", "مصور فوتوغرافي 📸", "عاشق القهوة ☕", "طالب جامعي 🎓", "مهندس 🏗️", "طبيب 🩺", "سبحان الله وبحمده", "قارئ نهم 📚"];

// إنشاء البوتات
for(let i=0; i<80; i++) {
    const email = `user_${i}@blogane.com`;
    if(!db.users.find(u => u.email === email)) {
        const fname = firstNames[Math.floor(Math.random() * firstNames.length)];
        const lname = lastNames[Math.floor(Math.random() * lastNames.length)];
        db.users.push({
            id: Date.now() + i, 
            name: `${fname} ${lname}`, 
            email: email, 
            password: 'bot',
            avatar: `https://ui-avatars.com/api/?name=${fname}+${lname}&background=random&color=fff&size=128`,
            bio: botBios[Math.floor(Math.random() * botBios.length)], 
            isBot: true, isOnline: true
        });
    }
}
saveData();

// محرك تفاعل البوتات
const botContents = ["صباح الخير يا وجوه الخير 🌹", "جمعة مباركة", "مساء الورد", "مين فاضي ندردش؟", "صورة جميلة جداً", "سبحان الله", "الحمد لله دائماً وأبداً", "تصبحون على خير", "الجو رائع اليوم"];
setInterval(() => {
    try {
        const action = Math.random();
        const botsOnly = db.users.filter(u => u.isBot);
        if(botsOnly.length === 0) return;
        const botUser = botsOnly[Math.floor(Math.random() * botsOnly.length)];

        if (action < 0.15) { // نشر
            const newPost = {
                id: Date.now(), author: botUser.name, email: botUser.email, avatar: botUser.avatar,
                content: botContents[Math.floor(Math.random() * botContents.length)], 
                media: Math.random()>0.8 ? `https://picsum.photos/400/300?random=${Date.now()}` : null,
                likes: [], comments: [], date: new Date().toISOString(), context: 'general', contextId: null
            };
            db.posts.unshift(newPost); io.emit('receive_post', newPost);
        } 
        else if (action < 0.6 && db.posts.length > 0) { // لايك
            const p = db.posts[Math.floor(Math.random() * db.posts.length)];
            if(p && !p.likes.includes(botUser.email)) {
                p.likes.push(botUser.email);
                io.emit('update_likes', {id: p.id, type: 'post', likes: p.likes});
            }
        }
        else if (action < 0.75 && db.posts.length > 0) { // تعليق
            const p = db.posts[Math.floor(Math.random() * db.posts.length)];
            if(p) {
                const c = { id: Date.now(), text: "منور يا غالي 🔥", userEmail: botUser.email, userName: botUser.name, userAvatar: botUser.avatar };
                p.comments.push(c); io.emit('update_comments', {postId: p.id, comments: p.comments});
            }
        }
        saveData();
    } catch(e) { console.error("Bot Engine Error (Ignored):", e.message); }
}, 5000);

let connectedSockets = {}; 

io.on('connection', (socket) => {
    
    // Auth
    socket.on('register', (d) => {
        if (db.users.find(u => u.email === d.email)) socket.emit('auth_error', 'البريد مسجل');
        else {
            const u = { ...d, id: Date.now(), avatar: `https://ui-avatars.com/api/?name=${d.name}&background=random`, bio: 'مستخدم جديد', isOnline: true };
            db.users.push(u); saveData(); socket.emit('auth_success', u);
        }
    });
    socket.on('login', (d) => {
        const u = db.users.find(u => u.email === d.email && u.password === d.password);
        if (u) {
            connectedSockets[u.email] = socket.id; u.isOnline = true; saveData();
            socket.emit('auth_success', u);
            socket.emit('init_data', { groups: db.groups, pages: db.pages, reels: db.reels, globalMessages: db.globalMessages });
            socket.emit('load_posts', (db.posts||[]).filter(p => p.context === 'general'));
            updateFriendsList(u.email); checkFriendRequests(u.email);
        } else { socket.emit('auth_error', 'بيانات خاطئة'); }
    });

    // AI Chat
    socket.on('send_ai_msg', async (text) => {
        const reply = await getAIResponse(text);
        socket.emit('receive_ai_msg', { text: reply });
    });

    // Private & Bot Reply
    socket.on('send_private_msg', (d) => {
        const m = { ...d, id: Date.now(), date: new Date().toISOString() };
        db.privateMessages.push(m); saveData();
        socket.emit('receive_private_msg', m);
        
        const target = db.users.find(u => u.email === d.to);
        if(target && target.isBot) {
            setTimeout(async () => {
                const replyText = await getAIResponse(d.text);
                const botReply = { id:Date.now(), from:d.to, to:d.from, text:replyText, date:new Date().toISOString() };
                db.privateMessages.push(botReply); saveData();
                socket.emit('receive_private_msg', botReply);
            }, 2000);
        } else {
            if(connectedSockets[d.to]) io.to(connectedSockets[d.to]).emit('receive_private_msg', m);
        }
    });
    socket.on('get_private_msgs', ({u1, u2}) => socket.emit('load_private_msgs', db.privateMessages.filter(m=>(m.from===u1&&m.to===u2)||(m.from===u2&&m.to===u1))));

    // Friends
    socket.on('send_friend_request', (d) => {
        if(d.from !== d.to && !db.friendRequests.find(r => r.from === d.from && r.to === d.to)) {
            db.friendRequests.push({ from: d.from, to: d.to }); saveData();
            const target = db.users.find(u => u.email === d.to);
            if(target && target.isBot) {
                setTimeout(() => {
                    db.friendRequests = db.friendRequests.filter(r => !(r.from === d.from && r.to === d.to));
                    db.friendships.push({ user1: d.from, user2: d.to });
                    saveData(); updateFriendsList(d.from);
                }, 2000);
            } else {
                if(connectedSockets[d.to]) io.to(connectedSockets[d.to]).emit('new_req_alert');
                checkFriendRequests(d.to);
            }
        }
    });
    socket.on('respond_friend_request', (d) => {
        db.friendRequests = db.friendRequests.filter(r => !(r.to === d.userEmail && r.from === d.requesterEmail));
        if(d.accept) { db.friendships.push({ user1: d.userEmail, user2: d.requesterEmail }); updateFriendsList(d.userEmail); updateFriendsList(d.requesterEmail); }
        saveData(); checkFriendRequests(d.userEmail);
    });

    function checkFriendRequests(email) { const reqs = db.friendRequests.filter(r => r.to === email); const data = reqs.map(r => { const s = db.users.find(u=>u.email===r.from); return {email:r.from, name:s?s.name:'Unknown', avatar:s?s.avatar:''}; }); if(connectedSockets[email]) io.to(connectedSockets[email]).emit('update_requests', data); }
    function updateFriendsList(email) { const fs = db.friendships.filter(f => f.user1 === email || f.user2 === email); const emails = fs.map(f => f.user1 === email ? f.user2 : f.user1); const fData = db.users.filter(u => emails.includes(u.email)).map(u => ({ name: u.name, email: u.email, avatar: u.avatar, isOnline: !!connectedSockets[u.email] || u.isBot })); if(connectedSockets[email]) io.to(connectedSockets[email]).emit('update_friends', fData); }

    // General Features
    socket.on('send_global_msg', (d) => { let u=d.image?saveBase64ToFile(d.image,'chat'):null; const m={...d,image:u,id:Date.now(),date:new Date().toISOString()}; db.globalMessages.push(m); saveData(); io.emit('receive_global_msg', m); });
    socket.on('new_post', (d) => { let u=d.media&&d.media.startsWith('data:')?saveBase64ToFile(d.media,'post'):null; const p={...d,id:Date.now(),media:u,likes:[],comments:[],date:new Date().toISOString()}; db.posts.unshift(p); saveData(); io.emit('receive_post', p); socket.emit('upload_complete'); });
    socket.on('toggle_like', ({id, type, userEmail}) => { let x=(type==='reel'?db.reels:db.posts).find(i=>i.id==id); if(x){ if(x.likes.includes(userEmail))x.likes=x.likes.filter(e=>e!==userEmail); else x.likes.push(userEmail); saveData(); io.emit('update_likes', {id, type, likes:x.likes}); } });
    socket.on('add_comment', (d) => { const p=db.posts.find(x=>x.id==d.postId); if(p){ p.comments.push({id:Date.now(), ...d}); saveData(); io.emit('update_comments', {postId:d.postId, comments:p.comments}); } });
    
    socket.on('update_profile', (d) => { const i=db.users.findIndex(u=>u.email===d.email); if(i!==-1){ db.users[i].name=d.name; db.users[i].bio=d.bio; if(d.avatar&&d.avatar.startsWith('data:'))db.users[i].avatar=saveBase64ToFile(d.avatar,'avatar'); saveData(); socket.emit('profile_updated_success', db.users[i]); } });
    socket.on('get_profile_info', (e) => { const u=db.users.find(x=>x.email===e); if(u) { const fs=db.friendships.filter(f=>f.user1===e||f.user2===e); const fEmails=fs.map(f=>f.user1===e?f.user2:f.user1); const friends=db.users.filter(x=>fEmails.includes(x.email)).map(x=>({name:x.name, avatar:x.avatar, email:x.email})); socket.emit('open_profile_view', {user:u, posts:(db.posts||[]).filter(p=>p.email===e), friends}); } });

    socket.on('create_group', (d)=>{const g={id:'g'+Date.now(),...d,members:[d.owner]}; db.groups.push(g); saveData(); io.emit('update_groups', db.groups);});
    socket.on('create_page', (d)=>{const p={id:'p'+Date.now(),...d,followers:[d.owner]}; db.pages.push(p); saveData(); io.emit('update_pages', db.pages);});
    socket.on('delete_group', ({groupId, email}) => { const i=db.groups.findIndex(g=>g.id===groupId); if(i!==-1 && db.groups[i].owner===email){ db.groups.splice(i,1); saveData(); io.emit('update_groups', db.groups); socket.emit('delete_success'); } });
    socket.on('delete_page', ({pageId, email}) => { const i=db.pages.findIndex(p=>p.id===pageId); if(i!==-1 && db.pages[i].owner===email){ db.pages.splice(i,1); saveData(); io.emit('update_pages', db.pages); socket.emit('delete_success'); } });
    socket.on('get_context_posts', ({context, contextId}) => { socket.emit('load_posts', db.posts.filter(p => p.context === context && p.contextId === contextId)); });
    
    socket.on('new_reel', (d) => { let u=saveBase64ToFile(d.videoBase64,'reel'); if(u){ const r={id:Date.now(),url:u,desc:d.desc,author:d.author,avatar:d.avatar,email:d.email,likes:[],comments:[]}; db.reels.unshift(r); saveData(); io.emit('receive_reel', {...r,videoBase64:null}); socket.emit('upload_complete'); } });
    socket.on('upload_reel_start', ({name}) => { const f=`reel_${Date.now()}_${Math.floor(Math.random()*1000)}${path.extname(name)}`; fs.open(path.join(UPLOAD_DIR,f),'w',(e,fd)=>{if(!e)fs.close(fd,()=>socket.emit('upload_ready',{tempFileName:f}));}); });
    socket.on('upload_reel_chunk', ({fileName, data}) => { try{fs.appendFileSync(path.join(UPLOAD_DIR,fileName), data);}catch(e){} });
    socket.on('upload_reel_end', (d)=>{ const r={id:Date.now(),url:`/uploads/${d.fileName}`,desc:d.desc,author:d.author,avatar:d.avatar,email:d.email,likes:[],comments:[]}; db.reels.unshift(r); saveData(); io.emit('receive_reel', r); socket.emit('upload_complete'); });

    socket.on('disconnect', () => {
        const email = Object.keys(connectedSockets).find(k => connectedSockets[k] === socket.id);
        if(email) { const u=db.users.find(x=>x.email===email); if(u){u.isOnline=false; saveData();} delete connectedSockets[email]; }
    });
});

// --- Anti-Crash System (منع توقف السيرفر نهائياً) ---
process.on('uncaughtException', (err) => { console.error('Caught exception: ' + err); });
process.on('unhandledRejection', (reason, p) => { console.error('Unhandled Rejection at:', p, 'reason:', reason); });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on ${PORT}`));
