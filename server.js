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

// Default DB
const defaultDB = { users: [], posts: [], reels: [], stories: [], groups: [], pages: [], friendRequests: [], friendships: [], globalMessages: [], privateMessages: [] };
let db = { ...defaultDB };

// Load Data
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

// --- AI ---
async function getAIResponse(prompt) {
    if (!process.env.GEMINI_API_KEY) return "مرحباً! أنا الذكاء الاصطناعي.";
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent(prompt);
        return (await result.response).text();
    } catch (e) { return "لحظة من فضلك..."; }
}

// --- Keep-Alive ---
app.get('/ping', (req, res) => res.send('Pong'));
setInterval(() => { try { http.get(`http://127.0.0.1:${process.env.PORT||3000}/ping`).on('error',()=>{}); } catch(e){} }, 240000);

// --- 130 Verified Bots ---
const botFirstNames = ["أحمد", "سارة", "محمد", "نور", "خالد", "ليلى", "يوسف", "مريم", "عمر", "فاطمة", "علي", "هدى", "إبراهيم", "منى", "حسن", "زينب", "سعيد", "سلمى", "مصطفى", "رنا"];
const botLastNames = ["المصري", "الغامدي", "علي", "حسن", "إبراهيم", "محمود", "سعيد", "كمال", "صلاح", "يوسف", "عبدالله", "عمر", "سالم", "غانم", "حامد", "نور"];
const botBios = ["أحب الحياة 🌸", "مبرمج", "مصور 📸", "طبيب 🩺", "مهندس 🏗️", "كاتب ✍️", "صانع محتوى 🎥"];

for(let i=0; i<130; i++) {
    const email = `bot${i}@blogane.com`;
    if(!db.users.find(u => u.email === email)) {
        const f = botFirstNames[Math.floor(Math.random()*botFirstNames.length)];
        const l = botLastNames[Math.floor(Math.random()*botLastNames.length)];
        const gender = ["سارة","نور","ليلى","مريم","فاطمة","هدى","منى","زينب","سلمى","رنا"].includes(f) ? "women" : "men";
        
        db.users.push({
            id: Date.now() + i, name: `${f} ${l}`, email: email, password: 'bot',
            avatar: `https://randomuser.me/api/portraits/${gender}/${i % 90}.jpg`, 
            bio: botBios[Math.floor(Math.random()*botBios.length)],
            isBot: true, isOnline: true, coins: 50000, verified: true 
        });
    }
}
saveData();

let connectedSockets = {}; 

// --- Simulation (Fix: Ensure posts are 'general') ---
const botMsgs = ["صباح الخير ☀️", "يوم جميل", "صورة رائعة", "سبحان الله", "مساء الورد", "تطبيق ممتاز", "جمعة مباركة", "تحياتي", "روعة", "استمر"];
const giftTypes = ["وردة 🌹", "قلب ❤️", "سيارة 🏎️"];

setInterval(() => {
    try {
        const bots = db.users.filter(u => u.isBot);
        const sender = bots[Math.floor(Math.random() * bots.length)];
        const receiver = bots[Math.floor(Math.random() * bots.length)];
        const action = Math.random();

        if(!sender) return;

        if (action < 0.05) { // Story
             const story = { id: Date.now(), author: sender.name, email: sender.email, avatar: sender.avatar, media: `https://picsum.photos/400/800?random=${Date.now()}`, date: new Date().toISOString(), verified: true };
             db.stories.push(story); if(db.stories.length>50)db.stories.shift();
             io.emit('new_story', story);
        } else if (action < 0.15) { // Gift Ticker
             const gift = giftTypes[Math.floor(Math.random() * giftTypes.length)];
             io.emit('gift_broadcast', { from: sender.name, to: receiver.name, gift: gift, avatar: sender.avatar });
        } else if (action < 0.4) { // Post (FIXED)
            const p = { 
                id: Date.now(), author: sender.name, email: sender.email, avatar: sender.avatar, 
                content: botMsgs[Math.floor(Math.random()*botMsgs.length)], 
                media: Math.random()>0.7 ? `https://picsum.photos/500/500?random=${Date.now()}` : null,
                likes: [], comments: [], date: new Date().toISOString(), 
                context:'general', contextId:null, verified: true // Ensure context is general
            };
            db.posts.unshift(p); 
            io.emit('receive_post', p); // Emit to all
        }
        saveData();
    } catch(e) {}
}, 5000);

io.on('connection', (socket) => {
    // Auth
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
            // Send ALL general posts
            socket.emit('load_posts', db.posts.filter(p => p.context === 'general'));
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
            // Filter posts for this user
            const userPosts = db.posts.filter(p => p.email === e);
            socket.emit('open_profile_view', {user:u, posts:userPosts, friends}); 
        } 
    });

    // Standard Features
    socket.on('new_post', (d) => { let u=d.media&&d.media.startsWith('data:')?saveBase64ToFile(d.media,'post'):null; const user=db.users.find(x=>x.email===d.email); const p={...d,id:Date.now(),media:u,likes:[],comments:[],date:new Date().toISOString(), verified: user?user.verified:false}; db.posts.unshift(p); if(user){user.coins+=10;socket.emit('update_coins',user.coins);} saveData(); io.emit('receive_post', p); socket.emit('upload_complete'); });
    socket.on('toggle_like', ({id, type, userEmail}) => { let x=db.posts.find(i=>i.id==id); if(x){ if(x.likes.includes(userEmail))x.likes=x.likes.filter(e=>e!==userEmail); else x.likes.push(userEmail); saveData(); io.emit('update_likes', {id, likes:x.likes}); } });
    socket.on('add_comment', (d) => { const p=db.posts.find(x=>x.id==d.postId); if(p){ p.comments.push({id:Date.now(), ...d}); saveData(); io.emit('update_comments', {postId:d.postId, comments:p.comments}); } });
    socket.on('game_result', ({email, reward}) => { const u = db.users.find(x => x.email === email); if(u) { u.coins += reward; saveData(); socket.emit('update_coins', u.coins); } });
    socket.on('claim_bonus', (email) => { const u = db.users.find(x => x.email === email); if(u) { u.coins += 50; saveData(); socket.emit('update_coins', u.coins); socket.emit('notification', {title:'مكافأة!', body:'50 كوينز!'}); } });
    socket.on('search_users', (q) => { if(!q)return; const r=db.users.filter(u=>u.name.toLowerCase().includes(q.toLowerCase())).slice(0,15).map(u=>({name:u.name,email:u.email,avatar:u.avatar,isBot:u.isBot, verified:u.verified})); socket.emit('search_results', r); });
    socket.on('send_ai_msg', async (t) => { const r = await getAIResponse(t); socket.emit('receive_ai_msg', {text: r}); });
    socket.on('send_global_msg', (d) => { let u=d.image?saveBase64ToFile(d.image,'chat'):null; const m={...d,image:u,id:Date.now(),date:new Date().toISOString()}; db.globalMessages.push(m); saveData(); io.emit('receive_global_msg', m); });
    socket.on('update_profile', (d) => { const i=db.users.findIndex(u=>u.email===d.email); if(i!==-1){ db.users[i].name=d.name; db.users[i].bio=d.bio; if(d.avatar&&d.avatar.startsWith('data:'))db.users[i].avatar=saveBase64ToFile(d.avatar,'avatar'); saveData(); socket.emit('profile_updated_success', db.users[i]); } });
    
    socket.on('send_gift', (d) => { const s=db.users.find(u=>u.email===d.from); const r=db.users.find(u=>u.email===d.to); if(s&&s.coins>=d.cost){ s.coins-=d.cost; if(r)r.coins=(r.coins||0)+d.cost; const m={id:Date.now(),from:d.from,to:d.to,text:`أرسل هدية: ${d.giftName} ${d.icon}`,isGift:true,icon:d.icon,date:new Date().toISOString()}; db.privateMessages.push(m); saveData(); socket.emit('update_coins',s.coins); socket.emit('gift_broadcast', {from:s.name,to:r?r.name:"Unknown",gift:`${d.giftName} ${d.icon}`,avatar:s.avatar}); if(connectedSockets[d.to]){io.to(connectedSockets[d.to]).emit('receive_private_msg',m);io.to(connectedSockets[d.to]).emit('update_coins',r.coins);io.to(connectedSockets[d.to]).emit('notification',{title:'هدية!',body:'وصلتك هدية'});} socket.emit('receive_private_msg',m); } else socket.emit('notification',{title:'عفواً',body:'رصيدك لا يكفي'}); });
    socket.on('create_group', (d)=>{const g={id:'g'+Date.now(),...d,members:[d.owner]}; db.groups.push(g); saveData(); io.emit('update_groups', db.groups);});
    socket.on('create_page', (d)=>{const p={id:'p'+Date.now(),...d,followers:[d.owner]}; db.pages.push(p); saveData(); io.emit('update_pages', db.pages);});
    socket.on('delete_group', ({groupId, email}) => { const i=db.groups.findIndex(g=>g.id===groupId); if(i!==-1 && db.groups[i].owner===email){ db.groups.splice(i,1); saveData(); io.emit('update_groups', db.groups); socket.emit('delete_success'); } });
    socket.on('delete_page', ({pageId, email}) => { const i=db.pages.findIndex(p=>p.id===pageId); if(i!==-1 && db.pages[i].owner===email){ db.pages.splice(i,1); saveData(); io.emit('update_pages', db.pages); socket.emit('delete_success'); } });
    socket.on('get_context_posts', ({context, contextId}) => { socket.emit('load_posts', db.posts.filter(p => p.context === context && p.contextId === contextId)); });
    socket.on('send_friend_request', (d) => { if(d.from!==d.to && !db.friendRequests.find(r=>r.from===d.from&&r.to===d.to)) { db.friendRequests.push({from:d.from, to:d.to}); saveData(); const t=db.users.find(u=>u.email===d.to); if(t&&t.isBot){ setTimeout(()=>{ db.friendRequests=db.friendRequests.filter(r=>!(r.from===d.from&&r.to===d.to)); db.friendships.push({user1:d.from,user2:d.to}); saveData(); const fs=db.friendships.filter(f=>f.user1===d.from||f.user2===d.from); const fe=fs.map(f=>f.user1===d.from?f.user2:f.user1); const fd=db.users.filter(u=>fe.includes(u.email)).map(u=>({name:u.name,email:u.email,avatar:u.avatar,isOnline:!!connectedSockets[u.email]||u.isBot})); socket.emit('update_friends', fd); },1500); } else { if(connectedSockets[d.to]) io.to(connectedSockets[d.to]).emit('new_req_alert'); } } });
    socket.on('respond_friend_request', (d) => { db.friendRequests=db.friendRequests.filter(r=>!(r.to===d.userEmail && r.from===d.requesterEmail)); if(d.accept) { db.friendships.push({user1:d.userEmail, user2:d.requesterEmail}); } saveData(); });
    socket.on('upload_reel_start', ({name}) => { const f=`reel_${Date.now()}_${Math.floor(Math.random()*1000)}${path.extname(name)}`; fs.open(path.join(UPLOAD_DIR,f),'w',(e,fd)=>{if(!e)fs.close(fd,()=>socket.emit('upload_ready',{tempFileName:f}));}); });
    socket.on('upload_reel_chunk', ({fileName, data}) => { try{fs.appendFileSync(path.join(UPLOAD_DIR,fileName), data);}catch(e){} });
    socket.on('upload_reel_end', (d)=>{ const r={id:Date.now(),url:`/uploads/${d.fileName}`,desc:d.desc,author:d.author,avatar:d.avatar,email:d.email,likes:[],comments:[]}; db.reels.unshift(r); saveData(); io.emit('receive_reel', r); socket.emit('upload_complete'); });
    socket.on('toggle_like_reel', ({id, userEmail}) => { const r=db.reels.find(x=>x.id==id); if(r){ if(!r.likes)r.likes=[]; if(r.likes.includes(userEmail))r.likes=r.likes.filter(e=>e!==userEmail); else r.likes.push(userEmail); saveData(); io.emit('update_reel_stats', {id, likes:r.likes.length, comments:r.comments?r.comments.length:0}); } });
    socket.on('comment_reel', ({id, text, userEmail, userName, userAvatar}) => { const r=db.reels.find(x=>x.id==id); if(r){ if(!r.comments)r.comments=[]; const c={id:Date.now(),text,userEmail,userName,userAvatar}; r.comments.push(c); saveData(); io.emit('update_reel_stats', {id, likes:r.likes?r.likes.length:0, comments:r.comments.length}); io.emit('new_reel_comment', {reelId:id, comment:c}); } });
    socket.on('send_private_msg', (d) => { const m = { ...d, id: Date.now(), date: new Date().toISOString() }; db.privateMessages.push(m); saveData(); socket.emit('receive_private_msg', m); const t = db.users.find(u => u.email === d.to); if(t && t.isBot) { setTimeout(async()=>{const r=await getAIResponse(d.text); db.privateMessages.push({id:Date.now(),from:d.to,to:d.from,text:r,date:new Date().toISOString()}); saveData(); socket.emit('receive_private_msg',{from:d.to,text:r});},2000); } else if(connectedSockets[d.to]){ io.to(connectedSockets[d.to]).emit('receive_private_msg',m); io.to(connectedSockets[d.to]).emit('notification',{title:'رسالة',body:'لديك رسالة جديدة'}); } });
    socket.on('get_private_msgs', ({u1, u2}) => { socket.emit('load_private_msgs', db.privateMessages.filter(m => (m.from===u1&&m.to===u2) || (m.from===u2&&m.to===u1))); });

    socket.on('disconnect', () => {
        for(let [email, sId] of Object.entries(connectedSockets)) { if(sId===socket.id) { const u=db.users.find(x=>x.email===email); if(u){u.isOnline=false; saveData();} delete connectedSockets[email]; break; } }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on ${PORT}`));
