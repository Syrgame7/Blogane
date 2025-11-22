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

// البيانات الافتراضية
const defaultDB = { users: [], posts: [], reels: [], groups: [], pages: [], friendRequests: [], friendships: [], globalMessages: [], privateMessages: [] };
let db = { ...defaultDB };

// تحميل البيانات
if (fs.existsSync(DATA_FILE)) {
    try {
        db = { ...defaultDB, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
        // تصحيح حالة الاتصال عند إعادة التشغيل
        db.users.forEach(u => { if(!u.isBot) u.isOnline = false; });
    } catch (e) { console.log("DB Error, using default"); }
} else saveData();

function saveData() {
    try {
        if(db.globalMessages.length > 300) db.globalMessages = db.globalMessages.slice(-300);
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

// --- AI Logic ---
async function getAIResponse(prompt) {
    if (!process.env.GEMINI_API_KEY) return "أهلاً بك! كيف حالك؟";
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const models = ["gemini-2.5-flash", "gemini-pro"];
    for (const m of models) {
        try {
            const model = genAI.getGenerativeModel({ model: m });
            const result = await model.generateContent(prompt);
            return (await result.response).text();
        } catch (e) { continue; }
    }
    return "أهلاً يا صديقي!";
}

// --- Bots Setup (80 Bots) ---
const botNames = ["أحمد", "سارة", "خالد", "نور", "يوسف", "ليلى", "عمر", "منى", "علي", "زينب", "كريم", "هند", "ماجد", "سلمى", "فهد", "رانيا", "طارق", "داليا", "سامي", "عبير"];
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

let connectedSockets = {}; // Map: email -> socketId

// --- Bot Simulation Loop ---
setInterval(async () => {
    try {
        const action = Math.random();
        const botsOnly = db.users.filter(u => u.isBot);
        const bot = botsOnly[Math.floor(Math.random() * botsOnly.length)];

        if (!bot) return;

        // 1. النشر (10%)
        if (action < 0.1) {
            const post = { id: Date.now(), author: bot.name, email: bot.email, avatar: bot.avatar, content: "مساء الخير يا جماعة 🌹", media: null, likes: [], comments: [], date: new Date().toISOString(), context:'general', contextId:null };
            db.posts.unshift(post); io.emit('receive_post', post);
        }
        // 2. اللايك (40%)
        else if (action < 0.5 && db.posts.length > 0) {
            const p = db.posts[Math.floor(Math.random()*db.posts.length)];
            if(!p.likes.includes(bot.email)) { p.likes.push(bot.email); io.emit('update_likes', {id:p.id, type:'post', likes:p.likes}); }
        }
        // 3. المبادرة برسالة خاصة لمستخدم حقيقي (5%)
        else if (action > 0.95) {
            const realUsers = Object.keys(connectedSockets).filter(email => !email.includes('bot')); // المستخدمين المتصلين
            if (realUsers.length > 0) {
                const targetEmail = realUsers[Math.floor(Math.random() * realUsers.length)];
                const socketId = connectedSockets[targetEmail];
                const openers = ["مرحباً، منشورك رائع!", "كيف حالك اليوم؟", "صورة بروفايلك جميلة", "هل تحب التقنية؟"];
                const text = openers[Math.floor(Math.random() * openers.length)];
                
                const msg = { id: Date.now(), from: bot.email, to: targetEmail, text: text, date: new Date().toISOString() };
                db.privateMessages.push(msg);
                if (socketId) {
                    io.to(socketId).emit('receive_private_msg', msg);
                    io.to(socketId).emit('notification', {title: bot.name, body: text});
                }
            }
        }
        saveData();
    } catch(e) {}
}, 5000);

// --- Socket Logic ---
io.on('connection', (socket) => {
    
    socket.on('register', (d) => {
        if (db.users.find(u => u.email === d.email)) socket.emit('auth_error', 'البريد مسجل');
        else { 
            const u = { ...d, id: Date.now(), avatar: `https://ui-avatars.com/api/?name=${d.name}&background=random`, bio: 'جديد', isOnline: true, coins: 50 }; 
            db.users.push(u); saveData(); socket.emit('auth_success', u); 
        }
    });

    socket.on('login', (d) => {
        const u = db.users.find(u => u.email === d.email && u.password === d.password);
        if (u) {
            connectedSockets[u.email] = socket.id; // Map Email to SocketID
            u.isOnline = true; if(u.coins===undefined) u.coins=50;
            saveData();
            socket.emit('auth_success', u);
            socket.emit('init_data', { groups: db.groups, pages: db.pages, reels: db.reels, globalMessages: db.globalMessages });
            socket.emit('load_posts', (db.posts||[]).filter(p => p.context === 'general'));
            updateFriendsList(u.email);
        } else { socket.emit('auth_error', 'بيانات خاطئة'); }
    });

    // --- Gift System ---
    socket.on('send_gift', (d) => {
        const sender = db.users.find(u => u.email === d.from);
        const receiver = db.users.find(u => u.email === d.to);
        if (sender && sender.coins >= d.cost) {
            sender.coins -= d.cost;
            if (receiver) { receiver.coins = (receiver.coins||0) + d.cost; }
            
            const msg = { id: Date.now(), from: d.from, to: d.to, text: `أرسل لك ${d.giftName} ${d.icon}`, isGift: true, icon: d.icon, date: new Date().toISOString() };
            db.privateMessages.push(msg); saveData();

            socket.emit('update_coins', sender.coins);
            socket.emit('receive_private_msg', msg);
            
            const receiverSocket = connectedSockets[d.to];
            if (receiverSocket) {
                io.to(receiverSocket).emit('receive_private_msg', msg);
                io.to(receiverSocket).emit('update_coins', receiver.coins);
                io.to(receiverSocket).emit('notification', {title: 'هدية جديدة! 🎁', body: `${sender.name} أرسل ${d.giftName}`});
            }
        } else {
            socket.emit('notification', {title: 'عفواً', body: 'رصيدك لا يكفي'});
        }
    });

    // --- Chat & Bots ---
    socket.on('send_private_msg', (d) => {
        const m = { ...d, id: Date.now(), date: new Date().toISOString() };
        db.privateMessages.push(m); saveData();
        socket.emit('receive_private_msg', m);
        
        const target = db.users.find(u => u.email === d.to);
        const targetSocket = connectedSockets[d.to];

        if (target && target.isBot) {
            // Bot Reply
            setTimeout(async () => {
                const replyText = await getAIResponse(d.text);
                const botReply = { id: Date.now(), from: d.to, to: d.from, text: replyText, date: new Date().toISOString() };
                db.privateMessages.push(botReply); saveData();
                socket.emit('receive_private_msg', botReply);
                socket.emit('notification', {title: target.name, body: replyText});
            }, 2000);
        } else if (targetSocket) {
            io.to(targetSocket).emit('receive_private_msg', m);
            io.to(targetSocket).emit('notification', {title: 'رسالة جديدة', body: `من ${db.users.find(u=>u.email===d.from)?.name}`});
        }
    });

    socket.on('send_global_msg', (d) => { 
        let u=d.image?saveBase64ToFile(d.image,'chat'):null; 
        const m={...d,image:u,id:Date.now(),date:new Date().toISOString()}; 
        db.globalMessages.push(m); saveData(); io.emit('receive_global_msg', m); 
    });

    socket.on('send_ai_msg', async (t) => {
        const r = await getAIResponse(t);
        socket.emit('receive_ai_msg', {text: r});
    });

    socket.on('get_private_msgs', ({u1, u2}) => {
        socket.emit('load_private_msgs', db.privateMessages.filter(m => (m.from===u1&&m.to===u2) || (m.from===u2&&m.to===u1)));
    });

    // --- Standard Features ---
    socket.on('new_post', (d) => { 
        let u=d.media&&d.media.startsWith('data:')?saveBase64ToFile(d.media,'post'):null; 
        const p={...d,id:Date.now(),media:u,likes:[],comments:[],date:new Date().toISOString()}; 
        db.posts.unshift(p); 
        const user = db.users.find(u=>u.email===d.email);
        if(user) { user.coins += 5; socket.emit('update_coins', user.coins); socket.emit('notification', {title:'مبروك', body:'حصلت على 5 كوينز للنشر!'}); }
        saveData(); io.emit('receive_post', p); socket.emit('upload_complete'); 
    });

    socket.on('toggle_like', ({id, type, userEmail}) => { 
        let x=(type==='reel'?db.reels:db.posts).find(i=>i.id==id); 
        if(x){ if(x.likes.includes(userEmail))x.likes=x.likes.filter(e=>e!==userEmail); else x.likes.push(userEmail); saveData(); io.emit('update_likes', {id, type, likes:x.likes}); } 
    });
    socket.on('add_comment', (d) => { 
        const p=db.posts.find(x=>x.id==d.postId); if(p){ p.comments.push({id:Date.now(), ...d}); saveData(); io.emit('update_comments', {postId:d.postId, comments:p.comments}); } 
    });

    socket.on('update_profile', (d) => { 
        const i=db.users.findIndex(u=>u.email===d.email); 
        if(i!==-1){ 
            db.users[i].name=d.name; db.users[i].bio=d.bio; 
            if(d.avatar&&d.avatar.startsWith('data:')) db.users[i].avatar=saveBase64ToFile(d.avatar,'avatar'); 
            saveData(); socket.emit('profile_updated_success', db.users[i]); 
        } 
    });

    socket.on('get_profile_info', (e) => { 
        const u=db.users.find(x=>x.email===e); 
        if(u) { 
            const fs=db.friendships.filter(f=>f.user1===e||f.user2===e); 
            const fEmails=fs.map(f=>f.user1===e?f.user2:f.user1); 
            const friends=db.users.filter(x=>fEmails.includes(x.email)).map(x=>({name:x.name, avatar:x.avatar, email:x.email})); 
            socket.emit('open_profile_view', {user:u, posts:(db.posts||[]).filter(p=>p.email===e), friends}); 
        } 
    });

    socket.on('send_friend_request', (d) => {
        if(d.from!==d.to && !db.friendRequests.find(r=>r.from===d.from&&r.to===d.to)) {
            db.friendRequests.push({from:d.from, to:d.to}); saveData();
            const t=db.users.find(u=>u.email===d.to);
            if(t && t.isBot) {
                setTimeout(() => {
                    db.friendRequests = db.friendRequests.filter(r=>!(r.from===d.from && r.to===d.to));
                    db.friendships.push({user1:d.from, user2:d.to}); saveData(); updateFriendsList(d.from);
                }, 2000);
            } else if(connectedSockets[d.to]) {
                io.to(connectedSockets[d.to]).emit('new_req_alert');
                io.to(connectedSockets[d.to]).emit('notification', {title:'طلب صداقة', body:'طلب جديد!'});
            }
        }
    });
    socket.on('respond_friend_request', (d) => {
        db.friendRequests = db.friendRequests.filter(r=>!(r.to===d.userEmail && r.from===d.requesterEmail));
        if(d.accept) { db.friendships.push({user1:d.userEmail, user2:d.requesterEmail}); updateFriendsList(d.userEmail); updateFriendsList(d.requesterEmail); }
        saveData();
    });

    function updateFriendsList(email) {
        const fs = db.friendships.filter(f => f.user1 === email || f.user2 === email);
        const emails = fs.map(f => f.user1 === email ? f.user2 : f.user1);
        const fData = db.users.filter(u => emails.includes(u.email)).map(u => ({ 
            name: u.name, email: u.email, avatar: u.avatar, isOnline: !!connectedSockets[u.email] || u.isBot 
        }));
        if(connectedSockets[email]) io.to(connectedSockets[email]).emit('update_friends', fData);
    }

    // Other Features (Groups, Reels...)
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
        const email = Object.keys(connectedSockets).find(key => connectedSockets[key] === socket.id);
        if(email) { 
            const u = db.users.find(x => x.email === email); 
            if(u) { u.isOnline = false; saveData(); } 
            delete connectedSockets[email]; // Remove from map
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on ${PORT}`));
