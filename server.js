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

// --- إعداد الملفات ---
const DATA_FILE = 'database.json';
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

// التأكد من وجود مجلد الرفع
try { if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) { console.error(e); }

// البيانات الافتراضية
const defaultDB = { users: [], posts: [], reels: [], groups: [], pages: [], friendRequests: [], friendships: [], globalMessages: [], privateMessages: [] };
let db = { ...defaultDB };

// تحميل البيانات
function loadData() {
    if (fs.existsSync(DATA_FILE)) {
        try {
            const loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            db = { ...defaultDB, ...loaded };
            // إصلاح المصفوفات المفقودة
            for(let key in defaultDB) if(!Array.isArray(db[key])) db[key] = [];
        } catch (e) { 
            console.log("Database corrupted, creating new one.");
            db = { ...defaultDB }; 
        }
    } else saveData();
}
loadData();

function saveData() {
    try {
        // تنظيف دوري لتسريع السيرفر
        if(db.globalMessages.length > 300) db.globalMessages = db.globalMessages.slice(-300);
        if(db.posts.length > 150) db.posts = db.posts.slice(0, 150);
        fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    } catch (e) { console.error("Save Error:", e.message); }
}

function saveBase64ToFile(base64Data, prefix) {
    try {
        if (!base64Data || typeof base64Data !== 'string' || !base64Data.includes('base64')) return null;
        const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) return null;
        const ext = matches[1].split('/')[1] || 'bin';
        const filename = `${prefix}_${Date.now()}.${ext}`;
        fs.writeFileSync(path.join(UPLOAD_DIR, filename), Buffer.from(matches[2], 'base64'));
        return `/uploads/${filename}`;
    } catch (e) { 
        console.error("File Save Error:", e.message);
        return null; 
    }
}

// --- AI ---
async function getAIResponse(prompt) {
    if (!process.env.GEMINI_API_KEY) return "مرحباً! أنا هنا للمساعدة.";
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent(prompt);
        return (await result.response).text();
    } catch (e) { return "أواجه ضغطاً حالياً، سأرد لاحقاً!"; }
}

// --- Keep-Alive ---
app.get('/ping', (req, res) => res.send('Pong'));
setInterval(() => { try { http.get(`http://127.0.0.1:${process.env.PORT||3000}/ping`).on('error',()=>{}); } catch(e){} }, 240000);

// --- 130 Bots Setup ---
const names = ["أحمد", "محمد", "محمود", "علي", "عمر", "خالد", "يوسف", "إبراهيم", "حسن", "سعيد", "مصطفى", "عبدالله", "كريم", "طارق", "زياد", "ياسر", "سامي", "فهد", "سلمان", "فيصل", "ماجد", "نايف", "وليد", "هاني", "جمال", "رامي", "سمير", "عادل", "نور", "سارة", "ليلى", "مريم", "فاطمة", "عائشة", "زينب", "هدى", "منى", "هند", "سلمى", "ندى", "ياسمين", "رنا", "داليا", "ريم", "أمل", "حنان", "سعاد", "وفاء", "لمياء", "شروق"];
for(let i=0; i<130; i++) {
    const email = `bot${i}@blogane.com`;
    if(!db.users.find(u => u.email === email)) {
        const n = names[Math.floor(Math.random()*names.length)];
        db.users.push({
            id: Date.now() + i, name: n, email: email, password: 'bot',
            avatar: `https://ui-avatars.com/api/?name=${n}&background=random&color=fff`,
            bio: 'Bot AI 🤖', isBot: true, isOnline: true, coins: 50000
        });
    }
}
saveData();

let connectedSockets = {}; 

// --- Simulation ---
const giftTypes = ["وردة 🌹", "قلب ❤️", "سيارة 🏎️", "طائرة ✈️", "أسد 🦁"];
const botMsgs = ["صباح الخير", "تطبيق رائع", "صورة جميلة", "سبحان الله", "مساء الورد", "مين موجود؟", "جمعة مباركة", "تحياتي", "روعة", "استمر"];
setInterval(() => {
    try {
        const bots = db.users.filter(u => u.isBot);
        const sender = bots[Math.floor(Math.random() * bots.length)];
        const receiver = bots[Math.floor(Math.random() * bots.length)];
        const action = Math.random();

        if(!sender) return;

        if (action < 0.1) { 
             const gift = giftTypes[Math.floor(Math.random() * giftTypes.length)];
             io.emit('gift_broadcast', { from: sender.name, to: receiver.name, gift: gift, avatar: sender.avatar });
        } else if (action < 0.2) { 
            const p = { id: Date.now(), author: sender.name, email: sender.email, avatar: sender.avatar, content: botMsgs[Math.floor(Math.random()*botMsgs.length)], media: null, likes: [], comments: [], date: new Date().toISOString(), context:'general', contextId:null };
            db.posts.unshift(p); io.emit('receive_post', p);
        }
        saveData();
    } catch(e) {}
}, 5000);

io.on('connection', (socket) => {
    
    // --- Auth ---
    socket.on('register', (d) => {
        if (db.users.find(u => u.email === d.email)) socket.emit('auth_error', 'البريد مسجل');
        else { const u = { ...d, id: Date.now(), avatar: `https://ui-avatars.com/api/?name=${d.name}&background=random`, bio: 'جديد', isOnline: true, coins: 100 }; db.users.push(u); saveData(); socket.emit('auth_success', u); }
    });

    socket.on('login', (d) => {
        const u = db.users.find(u => u.email === d.email && u.password === d.password);
        if (u) {
            connectedSockets[u.email] = socket.id; u.isOnline = true; if(u.coins===undefined)u.coins=100; saveData();
            socket.emit('auth_success', u);
            socket.emit('init_data', { groups: db.groups, pages: db.pages, reels: db.reels, globalMessages: db.globalMessages, friendRequests: db.friendRequests });
            socket.emit('load_posts', (db.posts||[]).filter(p => p.context === 'general'));
            sendRecentChats(u.email);
        } else { socket.emit('auth_error', 'بيانات خاطئة'); }
    });

    function sendRecentChats(email) {
        const allMsgs = [...db.privateMessages].reverse();
        const chats = new Set();
        const recentUsers = [];
        for(const m of allMsgs) {
            const other = m.from === email ? m.to : (m.to === email ? m.from : null);
            if(other && !chats.has(other)) {
                chats.add(other);
                const u = db.users.find(x => x.email === other);
                if(u) recentUsers.push({ name: u.name, email: u.email, avatar: u.avatar, isBot: u.isBot });
            }
            if(recentUsers.length >= 15) break;
        }
        if(connectedSockets[email]) io.to(connectedSockets[email]).emit('update_recent_chats', recentUsers);
    }

    // --- Game & Rewards ---
    socket.on('game_result', ({email, reward}) => { const u = db.users.find(x => x.email === email); if(u) { u.coins += reward; saveData(); socket.emit('update_coins', u.coins); } });
    socket.on('claim_bonus', (email) => { const u = db.users.find(x => x.email === email); if(u) { u.coins += 50; saveData(); socket.emit('update_coins', u.coins); socket.emit('notification', {title:'مكافأة', body:'50 كوينز!'}); } });

    // --- Posts (Fixed) ---
    socket.on('new_post', (d) => {
        try {
            let u = null;
            if(d.media && d.media.startsWith('data:')) u = saveBase64ToFile(d.media,'post');
            
            const p = {
                ...d, id: Date.now(), media: u, likes: [], comments: [], date: new Date().toISOString()
            };
            db.posts.unshift(p);
            
            const uObj = db.users.find(x => x.email === d.email);
            if(uObj) { uObj.coins += 10; socket.emit('update_coins', uObj.coins); }
            
            saveData();
            io.emit('receive_post', p);
            socket.emit('upload_complete'); // Important for UI
        } catch(e) {
            console.error("Post Error", e);
            socket.emit('notification', {title:'خطأ', body:'فشل النشر'});
            socket.emit('upload_complete');
        }
    });

    socket.on('toggle_like', ({id, userEmail}) => { let x=db.posts.find(i=>i.id==id); if(x){ if(x.likes.includes(userEmail))x.likes=x.likes.filter(e=>e!==userEmail); else x.likes.push(userEmail); saveData(); io.emit('update_likes', {id, likes:x.likes}); } });
    socket.on('add_comment', (d) => { const p=db.posts.find(x=>x.id==d.postId); if(p){ p.comments.push({id:Date.now(), ...d}); saveData(); io.emit('update_comments', {postId:d.postId, comments:p.comments}); } });

    // --- Chat ---
    socket.on('send_ai_msg', async (t) => { const r = await getAIResponse(t); socket.emit('receive_ai_msg', {text: r}); });
    socket.on('send_private_msg', (d) => {
        const m = { ...d, id: Date.now(), date: new Date().toISOString() }; db.privateMessages.push(m); saveData();
        socket.emit('receive_private_msg', m); sendRecentChats(d.from);
        const t = db.users.find(u => u.email === d.to);
        if(t && t.isBot) { setTimeout(async()=>{ const r=await getAIResponse(d.text); const bm={id:Date.now(),from:d.to,to:d.from,text:r,date:new Date().toISOString()}; db.privateMessages.push(bm); saveData(); socket.emit('receive_private_msg',bm); sendRecentChats(d.from); }, 2000); }
        else if (connectedSockets[d.to]) { io.to(connectedSockets[d.to]).emit('receive_private_msg', m); io.to(connectedSockets[d.to]).emit('notification', {title:'رسالة', body:'لديك رسالة جديدة'}); sendRecentChats(d.to); }
    });
    socket.on('get_private_msgs', ({u1, u2}) => { socket.emit('load_private_msgs', db.privateMessages.filter(m => (m.from===u1&&m.to===u2) || (m.from===u2&&m.to===u1))); });
    socket.on('send_global_msg', (d) => { let u=d.image?saveBase64ToFile(d.image,'chat'):null; const m={...d,image:u,id:Date.now(),date:new Date().toISOString()}; db.globalMessages.push(m); saveData(); io.emit('receive_global_msg', m); });

    // --- Profile (Fixed) ---
    socket.on('get_profile_info', (e) => { 
        const u = db.users.find(x => x.email === e); 
        if(u) { 
            const fs = db.friendships.filter(f => f.user1 === e || f.user2 === e);
            const fEmails = fs.map(f => f.user1 === e ? f.user2 : f.user1);
            const friends = db.users.filter(x => fEmails.includes(x.email)).map(x => ({name:x.name, avatar:x.avatar, email:x.email})); 
            socket.emit('open_profile_view', {user:u, posts:(db.posts||[]).filter(p=>p.email===e), friends}); 
        } else {
            socket.emit('notification', {title:'خطأ', body:'المستخدم غير موجود'});
        }
    });
    socket.on('update_profile', (d) => { const i=db.users.findIndex(u=>u.email===d.email); if(i!==-1){ db.users[i].name=d.name; db.users[i].bio=d.bio; if(d.avatar&&d.avatar.startsWith('data:'))db.users[i].avatar=saveBase64ToFile(d.avatar,'avatar'); saveData(); socket.emit('profile_updated_success', db.users[i]); } });

    // --- Other ---
    socket.on('search_users', (q) => { if(!q)return; const r=db.users.filter(u=>u.name.toLowerCase().includes(q.toLowerCase())).slice(0,15).map(u=>({name:u.name,email:u.email,avatar:u.avatar,isBot:u.isBot})); socket.emit('search_results', r); });
    socket.on('send_gift', (d) => { const s=db.users.find(u=>u.email===d.from); const r=db.users.find(u=>u.email===d.to); if(s&&s.coins>=d.cost){ s.coins-=d.cost; if(r)r.coins=(r.coins||0)+d.cost; const m={id:Date.now(),from:d.from,to:d.to,text:`أرسل هدية: ${d.giftName} ${d.icon}`,isGift:true,icon:d.icon,date:new Date().toISOString()}; db.privateMessages.push(m); saveData(); socket.emit('update_coins',s.coins); socket.emit('gift_broadcast', {from:s.name,to:r?r.name:"Unknown",gift:`${d.giftName} ${d.icon}`,avatar:s.avatar}); if(connectedSockets[d.to]){io.to(connectedSockets[d.to]).emit('receive_private_msg',m);io.to(connectedSockets[d.to]).emit('update_coins',r.coins);io.to(connectedSockets[d.to]).emit('notification',{title:'هدية!',body:'وصلتك هدية'});sendRecentChats(d.to);} socket.emit('receive_private_msg',m); sendRecentChats(d.from); } else socket.emit('notification',{title:'عفواً',body:'رصيدك لا يكفي'}); });
    socket.on('new_reel', (d) => { let u=saveBase64ToFile(d.videoBase64,'reel'); if(u){ const r={id:Date.now(),url:u,desc:d.desc,author:d.author,avatar:d.avatar,email:d.email,likes:[],comments:[]}; db.reels.unshift(r); saveData(); io.emit('receive_reel', {...r,videoBase64:null}); socket.emit('upload_complete'); } });
    socket.on('upload_reel_start', ({name}) => { const f=`reel_${Date.now()}_${Math.floor(Math.random()*1000)}${path.extname(name)}`; fs.open(path.join(UPLOAD_DIR,f),'w',(e,fd)=>{if(!e)fs.close(fd,()=>socket.emit('upload_ready',{tempFileName:f}));}); });
    socket.on('upload_reel_chunk', ({fileName, data}) => { try{fs.appendFileSync(path.join(UPLOAD_DIR,fileName), data);}catch(e){} });
    socket.on('upload_reel_end', (d)=>{ const r={id:Date.now(),url:`/uploads/${d.fileName}`,desc:d.desc,author:d.author,avatar:d.avatar,email:d.email,likes:[],comments:[]}; db.reels.unshift(r); saveData(); io.emit('receive_reel', r); socket.emit('upload_complete'); });
    socket.on('send_friend_request', (d) => { if(d.from!==d.to && !db.friendRequests.find(r=>r.from===d.from&&r.to===d.to)) { db.friendRequests.push({from:d.from, to:d.to}); saveData(); const t=db.users.find(u=>u.email===d.to); if(t&&t.isBot){ setTimeout(()=>{ db.friendRequests=db.friendRequests.filter(r=>!(r.from===d.from&&r.to===d.to)); db.friendships.push({user1:d.from,user2:d.to}); saveData(); const fs=db.friendships.filter(f=>f.user1===d.from||f.user2===d.from); const fe=fs.map(f=>f.user1===d.from?f.user2:f.user1); const fd=db.users.filter(u=>fe.includes(u.email)).map(u=>({name:u.name,email:u.email,avatar:u.avatar,isOnline:!!connectedSockets[u.email]||u.isBot})); socket.emit('update_friends', fd); },1500); } else { if(connectedSockets[d.to]) io.to(connectedSockets[d.to]).emit('new_req_alert'); } } });
    socket.on('respond_friend_request', (d) => { db.friendRequests=db.friendRequests.filter(r=>!(r.to===d.userEmail && r.from===d.requesterEmail)); if(d.accept) { db.friendships.push({user1:d.userEmail, user2:d.requesterEmail}); } saveData(); });

    socket.on('disconnect', () => {
        for(let [email, sId] of Object.entries(connectedSockets)) { if(sId===socket.id) { const u=db.users.find(x=>x.email===email); if(u){u.isOnline=false; saveData();} delete connectedSockets[email]; break; } }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on ${PORT}`));
