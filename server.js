const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*" },
    maxHttpBufferSize: 50 * 1024 * 1024 
});

app.use(express.static(path.join(__dirname, 'public')));

const DATA_FILE = 'database.json';
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

try { if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) {}

const defaultDB = { users: [], posts: [], reels: [], groups: [], pages: [], friendRequests: [], friendships: [], globalMessages: [], privateMessages: [] };
let db = { ...defaultDB };

function loadData() {
    if (fs.existsSync(DATA_FILE)) {
        try {
            const raw = fs.readFileSync(DATA_FILE, 'utf8');
            const loaded = JSON.parse(raw);
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
        fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    } catch (e) { console.error("Save Error", e); }
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

// Keep-Alive
app.get('/ping', (req, res) => res.send('Pong'));
setInterval(() => { try { http.get(`http://127.0.0.1:${process.env.PORT||3000}/ping`).on('error',()=>{}); } catch(e){} }, 240000);

// --- Bots (30 Bot) ---
const arabicNames = [
    "أحمد محمد", "سارة علي", "خالد عمر", "نور الهدى", "يوسف كمال", "ليلى محمود", "عمر الشريف", "هدى حسن", 
    "ماجد المهندس", "منى زكي", "كريم عبد العزيز", "ياسمين صبري", "عمرو دياب", "نانسي عجرم", "تامر حسني", 
    "شيرين", "محمد صلاح", "أبو تريكة", "فيروز", "أم كلثوم", "نجيب محفوظ", "طه حسين", "أحمد زويل", 
    "مجدي يعقوب", "غادة عبد الرازق", "أحمد حلمي", "دنيا سمير", "محمد رمضان", "عادل إمام", "سعاد حسني"
];
const botPostsText = ["صباح الخير 🌹", "تطبيق رائع!", "مين يلعب؟", "صورة جميلة", "سبحان الله", "اللهم صل على محمد", "الجو جميل", "تحيا مصر", "مساء الورد"];

arabicNames.forEach((name, i) => {
    const email = `bot${i}@blogane.com`;
    if(!db.users.find(u => u.email === email)) {
        db.users.push({
            id: Date.now() + i, name, email, password: 'bot',
            avatar: `https://ui-avatars.com/api/?name=${name.replace(' ','+')}&background=random&color=fff&size=128`,
            bio: 'Bot 🤖', isBot: true, isOnline: true, lastSeen: new Date().toISOString()
        });
    }
});

setInterval(() => {
    try {
        const action = Math.random();
        const botIdx = Math.floor(Math.random() * arabicNames.length);
        const botEmail = `bot${botIdx}@blogane.com`;
        const botUser = db.users.find(u => u.email === botEmail);
        if (!botUser) return;

        if (action < 0.2) { 
            const newPost = {
                id: Date.now(), author: botUser.name, email: botEmail, avatar: botUser.avatar,
                content: botPostsText[Math.floor(Math.random() * botPostsText.length)], media: null,
                likes: [], comments: [], date: new Date().toISOString(), context: 'general', contextId: null
            };
            db.posts.unshift(newPost);
            io.emit('receive_post', newPost);
        } else if (action < 0.5 && db.posts.length > 0) {
            const p = db.posts[Math.floor(Math.random() * db.posts.length)];
            if(p && !p.likes.includes(botEmail)) { p.likes.push(botEmail); io.emit('update_likes', {id: p.id, type: 'post', likes: p.likes}); }
        }
        saveData();
    } catch(e) {}
}, 5000);

let connectedSockets = {}; 

io.on('connection', (socket) => {
    
    // Auth & Online Status
    socket.on('register', (d) => {
        if (db.users.find(u => u.email === d.email)) socket.emit('auth_error', 'البريد مسجل');
        else {
            const u = { ...d, id: Date.now(), avatar: `https://ui-avatars.com/api/?name=${d.name}&background=random`, bio: 'مستخدم جديد', isOnline: true, lastSeen: new Date().toISOString() };
            db.users.push(u); saveData(); socket.emit('auth_success', u);
        }
    });
    socket.on('login', (d) => {
        const u = db.users.find(u => u.email === d.email && u.password === d.password);
        if (u) {
            connectedSockets[u.email] = socket.id;
            u.isOnline = true; // Set Online
            saveData();
            socket.emit('auth_success', u);
            socket.emit('init_data', { groups: db.groups, pages: db.pages, reels: db.reels, globalMessages: db.globalMessages });
            socket.emit('load_posts', (db.posts||[]).filter(p => p.context === 'general'));
            updateFriendsList(u.email);
            checkFriendRequests(u.email);
            // Notify friends user is online
            broadcastStatus(u.email, true);
        } else { socket.emit('auth_error', 'بيانات خاطئة'); }
    });

    // Friend Requests
    socket.on('send_friend_request', (d) => {
        if(d.from !== d.to && !db.friendRequests.find(r => r.from === d.from && r.to === d.to)) {
            db.friendRequests.push({ from: d.from, to: d.to });
            saveData();
            
            // Bot auto-accept
            const targetUser = db.users.find(u => u.email === d.to);
            if(targetUser && targetUser.isBot) {
                setTimeout(() => {
                    db.friendRequests = db.friendRequests.filter(r => !(r.from === d.from && r.to === d.to));
                    db.friendships.push({ user1: d.from, user2: d.to });
                    saveData();
                    updateFriendsList(d.from);
                }, 2000);
            } else {
                if(connectedSockets[d.to]) io.to(connectedSockets[d.to]).emit('new_req_alert'); // Realtime Alert
                checkFriendRequests(d.to);
            }
        }
    });

    socket.on('respond_friend_request', (d) => {
        db.friendRequests = db.friendRequests.filter(r => !(r.to === d.userEmail && r.from === d.requesterEmail));
        if(d.accept) {
            db.friendships.push({ user1: d.userEmail, user2: d.requesterEmail });
            updateFriendsList(d.userEmail);
            updateFriendsList(d.requesterEmail);
        }
        saveData();
        checkFriendRequests(d.userEmail);
    });

    function checkFriendRequests(email) {
        const reqs = db.friendRequests.filter(r => r.to === email);
        const data = reqs.map(r => { 
            const s = db.users.find(u=>u.email===r.from); 
            return {email:r.from, name:s?s.name:'Unknown', avatar:s?s.avatar:''}; 
        });
        if(connectedSockets[email]) io.to(connectedSockets[email]).emit('update_requests', data);
    }

    function updateFriendsList(email) {
        const fs = db.friendships.filter(f => f.user1 === email || f.user2 === email);
        const emails = fs.map(f => f.user1 === email ? f.user2 : f.user1);
        const fData = db.users.filter(u => emails.includes(u.email)).map(u => ({ 
            name: u.name, email: u.email, avatar: u.avatar, 
            isOnline: !!connectedSockets[u.email] || u.isBot, // Check connection or Bot
            lastSeen: u.lastSeen 
        }));
        if(connectedSockets[email]) io.to(connectedSockets[email]).emit('update_friends', fData);
    }

    function broadcastStatus(email, status) {
        const fs = db.friendships.filter(f => f.user1 === email || f.user2 === email);
        fs.forEach(f => {
            const friendEmail = f.user1 === email ? f.user2 : f.user1;
            if(connectedSockets[friendEmail]) updateFriendsList(friendEmail);
        });
    }

    // Chat & Posts (Standard)
    socket.on('new_post', (d) => { let u=d.media&&d.media.startsWith('data:')?saveBase64ToFile(d.media,'post'):null; const p={...d,id:Date.now(),media:u,likes:[],comments:[],date:new Date().toISOString()}; db.posts.unshift(p); saveData(); io.emit('receive_post', p); socket.emit('upload_complete'); });
    socket.on('toggle_like', ({id, type, userEmail}) => { let x=(type==='reel'?db.reels:db.posts).find(i=>i.id==id); if(x){ if(x.likes.includes(userEmail))x.likes=x.likes.filter(e=>e!==userEmail); else x.likes.push(userEmail); saveData(); io.emit('update_likes', {id, type, likes:x.likes}); } });
    socket.on('add_comment', (d) => { const p=db.posts.find(x=>x.id==d.postId); if(p){ p.comments.push({id:Date.now(), ...d}); saveData(); io.emit('update_comments', {postId:d.postId, comments:p.comments}); } });
    socket.on('send_global_msg', (d) => { let url = d.image ? saveBase64ToFile(d.image, 'chat') : null; const m = { ...d, image: url, id: Date.now(), date: new Date().toISOString() }; db.globalMessages.push(m); saveData(); io.emit('receive_global_msg', m); });
    socket.on('send_private_msg', (d)=>{const m={...d,id:Date.now(),date:new Date().toISOString()}; db.privateMessages.push(m); saveData(); socket.emit('receive_private_msg',m); if(connectedSockets[d.to])io.to(connectedSockets[d.to]).emit('receive_private_msg',m);});
    socket.on('get_private_msgs', ({u1,u2}) => socket.emit('load_private_msgs', db.privateMessages.filter(m=>(m.from===u1&&m.to===u2)||(m.from===u2&&m.to===u1))));
    
    // Profile
    socket.on('get_profile_info', (e) => { 
        const u = db.users.find(x=>x.email===e); 
        if(u) {
            const fs = db.friendships.filter(f => f.user1 === e || f.user2 === e);
            const fEmails = fs.map(f => f.user1 === e ? f.user2 : f.user1);
            const friends = db.users.filter(x => fEmails.includes(x.email)).map(x => ({name:x.name, avatar:x.avatar, email:x.email}));
            socket.emit('open_profile_view', {user:u, posts:(db.posts||[]).filter(p=>p.email===e), friends}); 
        }
    });
    socket.on('update_profile', (d) => { 
        const i=db.users.findIndex(u=>u.email===d.email); 
        if(i!==-1){ 
            db.users[i].name=d.name; db.users[i].bio=d.bio; 
            if(d.avatar&&d.avatar.startsWith('data:')) db.users[i].avatar=saveBase64ToFile(d.avatar,'avatar'); 
            saveData(); socket.emit('profile_updated_success', db.users[i]); 
        } 
    });

    // Others
    socket.on('create_group', (d) => { const g={id:'g'+Date.now(),...d,members:[d.owner]}; db.groups.push(g); saveData(); io.emit('update_groups', db.groups); socket.emit('group_created_success', g); });
    socket.on('create_page', (d) => { const p={id:'p'+Date.now(),...d,followers:[d.owner]}; db.pages.push(p); saveData(); io.emit('update_pages', db.pages); socket.emit('page_created_success', p); });
    socket.on('delete_group', ({groupId, email}) => { const i=db.groups.findIndex(g=>g.id===groupId); if(i!==-1 && db.groups[i].owner===email){ db.groups.splice(i,1); saveData(); io.emit('update_groups', db.groups); socket.emit('delete_success'); } });
    socket.on('delete_page', ({pageId, email}) => { const i=db.pages.findIndex(p=>p.id===pageId); if(i!==-1 && db.pages[i].owner===email){ db.pages.splice(i,1); saveData(); io.emit('update_pages', db.pages); socket.emit('delete_success'); } });
    socket.on('get_context_posts', ({context, contextId}) => { socket.emit('load_posts', db.posts.filter(p => p.context === context && p.contextId === contextId)); });
    socket.on('new_reel', (d) => { let u=saveBase64ToFile(d.videoBase64,'reel'); if(u){ const r={id:Date.now(),url:u,desc:d.desc,author:d.author,avatar:d.avatar,email:d.email,likes:[],comments:[]}; db.reels.unshift(r); saveData(); io.emit('receive_reel', {...r,videoBase64:null}); socket.emit('upload_complete'); } });
    socket.on('upload_reel_start', ({name}) => { const f=`reel_${Date.now()}_${Math.floor(Math.random()*1000)}${path.extname(name)}`; fs.open(path.join(UPLOAD_DIR,f),'w',(e,fd)=>{if(!e)fs.close(fd,()=>socket.emit('upload_ready',{tempFileName:f}));}); });
    socket.on('upload_reel_chunk', ({fileName, data}) => { try{fs.appendFileSync(path.join(UPLOAD_DIR,fileName), data);}catch(e){} });
    socket.on('upload_reel_end', (d)=>{ const r={id:Date.now(),url:`/uploads/${d.fileName}`,desc:d.desc,author:d.author,avatar:d.avatar,email:d.email,likes:[],comments:[]}; db.reels.unshift(r); saveData(); io.emit('receive_reel', r); socket.emit('upload_complete'); });
    socket.on('send_ai_msg', (t)=> setTimeout(()=>socket.emit('receive_ai_msg', {text:"أنا ذكاء اصطناعي، اسألني عن أي شيء!"}), 800));

    socket.on('disconnect', () => {
        const email = Object.keys(connectedSockets).find(k => connectedSockets[k] === socket.id);
        if(email) {
            const u = db.users.find(x => x.email === email);
            if(u) { u.isOnline = false; u.lastSeen = new Date().toISOString(); saveData(); broadcastStatus(email, false); }
            delete connectedSockets[email];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on ${PORT}`));
