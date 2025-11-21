const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*" },
    maxHttpBufferSize: 50 * 1024 * 1024 // 50 MB limit
});

app.use(express.static(path.join(__dirname, 'public')));

// --- إعداد الملفات والمجلدات (لمنع الأخطاء) ---
const DATA_FILE = 'database.json';
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

// التأكد من وجود مجلد الرفع
if (!fs.existsSync(UPLOAD_DIR)) {
    try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) { console.error("Error creating upload dir", e); }
}

// البيانات الافتراضية
const defaultData = { 
    users: [], posts: [], reels: [], groups: [], pages: [], 
    friendRequests: [], friendships: [], globalMessages: [], privateMessages: [] 
};

let db = { ...defaultData };

// تحميل البيانات بأمان
if (fs.existsSync(DATA_FILE)) {
    try { 
        db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); 
    } catch (e) { 
        console.error("Database file corrupt, resetting."); 
        db = { ...defaultData };
    }
} else {
    // إنشاء الملف إذا لم يكن موجوداً
    saveData();
}

function saveData() {
    try {
        // تنظيف البيانات القديمة لتسريع السيرفر
        if(db.globalMessages.length > 150) db.globalMessages = db.globalMessages.slice(-150);
        if(db.posts.length > 100) db.posts = db.posts.slice(0, 100);
        fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2), () => {});
    } catch (e) { console.error("Save error", e); }
}

function saveBase64ToFile(base64Data, prefix) {
    try {
        if (!base64Data) return null;
        const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) return null;
        const ext = matches[1].split('/')[1] || 'bin';
        const filename = `${prefix}_${Date.now()}.${ext}`;
        fs.writeFileSync(path.join(UPLOAD_DIR, filename), Buffer.from(matches[2], 'base64'));
        return `/uploads/${filename}`;
    } catch (e) { return null; }
}

// --- Keep-Alive (منع توقف السيرفر) ---
app.get('/ping', (req, res) => res.status(200).send('Pong'));
// الانتظار 20 ثانية ثم بدء التنبيه الدوري
setTimeout(() => {
    setInterval(() => {
        const PORT = process.env.PORT || 3000;
        http.get(`http://127.0.0.1:${PORT}/ping`, (res) => {}).on('error', (e) => {});
    }, 4 * 60 * 1000); // كل 4 دقائق
}, 20000);

// --- محرك البوتات (Simulation Engine) ---
const botNames = ["Sarah", "Ahmed Tech", "Dr. House", "Lofi Girl", "Gamer Pro"];
const botAvatars = [
    "https://ui-avatars.com/api/?name=Sarah&background=ff00ff&color=fff",
    "https://ui-avatars.com/api/?name=Ahmed&background=0000ff&color=fff",
    "https://ui-avatars.com/api/?name=Dr&background=ff0000&color=fff",
    "https://ui-avatars.com/api/?name=Lofi&background=ffaa00&color=fff",
    "https://ui-avatars.com/api/?name=Gamer&background=00ff00&color=fff"
];
const botComments = ["منشور رائع!", "أتفق معك 👍", "😂😂", "مبدع كالعادة", "صباح الخير"];
const botPosts = ["هل جربتم البرمجة اليوم؟", "صورة جميلة للغروب", "تحديث جديد للتطبيق!", "مين يلعب؟"];

// تسجيل البوتات كمستخدمين
botNames.forEach((name, i) => {
    const email = `bot${i}@blogane.com`;
    if(!db.users.find(u=>u.email===email)) {
        db.users.push({id:Date.now()+i, name, email, password:'bot', avatar:botAvatars[i], bio:'AI User', isBot:true});
    }
});

// دورة حياة البوتات (كل 12 ثانية)
setInterval(() => {
    try {
        const action = Math.random();
        const botIdx = Math.floor(Math.random() * botNames.length);
        const bot = { name: botNames[botIdx], email: `bot${botIdx}@blogane.com`, avatar: botAvatars[botIdx] };

        if (action < 0.15) { // نشر بوست
            const newPost = {
                id: Date.now(), author: bot.name, email: bot.email, avatar: bot.avatar,
                content: botPosts[Math.floor(Math.random()*botPosts.length)], media: null,
                likes: [], comments: [], date: new Date().toISOString(), context: 'general', contextId: null
            };
            db.posts.unshift(newPost); io.emit('receive_post', newPost);
        } 
        else if (action < 0.5 && db.posts.length > 0) { // إعجاب
            const p = db.posts[Math.floor(Math.random()*db.posts.length)];
            if(!p.likes.includes(bot.email)) { p.likes.push(bot.email); io.emit('update_likes', {id:p.id, type:'post', likes:p.likes}); }
        }
        else if (action < 0.7 && db.posts.length > 0) { // تعليق
            const p = db.posts[Math.floor(Math.random()*db.posts.length)];
            const c = { id: Date.now(), text: botComments[Math.floor(Math.random()*botComments.length)], userEmail: bot.email, userName: bot.name, userAvatar: bot.avatar };
            p.comments.push(c); io.emit('update_comments', {postId:p.id, comments:p.comments});
        }
        saveData();
    } catch(e) { console.error("Bot error", e); }
}, 12000);

// --- Socket Logic ---
let connectedSockets = {}; 

io.on('connection', (socket) => {
    
    // Auth
    socket.on('register', (d) => {
        if (db.users.find(u => u.email === d.email)) socket.emit('auth_error', 'البريد مسجل');
        else {
            const u = { ...d, id: Date.now(), avatar: `https://ui-avatars.com/api/?name=${d.name}&background=random`, bio: 'مستخدم جديد' };
            db.users.push(u); saveData(); socket.emit('auth_success', u);
        }
    });
    socket.on('login', (d) => {
        const u = db.users.find(u => u.email === d.email && u.password === d.password);
        if (u) {
            connectedSockets[u.email] = socket.id;
            socket.emit('auth_success', u);
            socket.emit('init_data', { groups: db.groups, pages: db.pages, reels: db.reels, globalMessages: db.globalMessages });
            socket.emit('load_posts', db.posts.filter(p => p.context === 'general'));
            updateFriendsList(u.email);
        } else { socket.emit('auth_error', 'بيانات خاطئة'); }
    });

    // Posts
    socket.on('new_post', (d) => {
        let url = null; if(d.media && d.media.startsWith('data:')) url = saveBase64ToFile(d.media, 'post');
        const p = { ...d, id: Date.now(), media: url, likes: [], comments: [], date: new Date().toISOString() };
        db.posts.unshift(p); saveData(); io.emit('receive_post', p); socket.emit('upload_complete');
    });
    socket.on('toggle_like', ({id, type, userEmail}) => {
        let item = (type==='reel'?db.reels:db.posts).find(i=>i.id==id);
        if(item) {
            if(item.likes.includes(userEmail)) item.likes=item.likes.filter(e=>e!==userEmail); else item.likes.push(userEmail);
            saveData(); io.emit('update_likes', {id, type, likes:item.likes});
        }
    });
    socket.on('add_comment', (d) => {
        const p = db.posts.find(x=>x.id==d.postId);
        if(p) { p.comments.push({id:Date.now(), ...d}); saveData(); io.emit('update_comments', {postId:d.postId, comments:p.comments}); }
    });

    // Video Upload (Chunking)
    socket.on('upload_reel_start', ({ name }) => {
        const fileName = `reel_${Date.now()}_${Math.floor(Math.random()*1000)}${path.extname(name)}`;
        fs.open(path.join(UPLOAD_DIR, fileName), 'w', (err, fd) => {
            if(!err) fs.close(fd, () => socket.emit('upload_ready', { tempFileName: fileName }));
        });
    });
    socket.on('upload_reel_chunk', ({ fileName, data }) => { 
        try { fs.appendFileSync(path.join(UPLOAD_DIR, fileName), data); } catch(e){} 
    });
    socket.on('upload_reel_end', (d) => {
        const r = { id: Date.now(), url: `/uploads/${d.fileName}`, desc:d.desc, author:d.author, avatar:d.avatar, email:d.email, likes:[], comments:[] };
        db.reels.unshift(r); saveData(); io.emit('receive_reel', r); socket.emit('upload_complete');
    });

    // Chat
    socket.on('send_global_msg', (d) => {
        let url = d.image ? saveBase64ToFile(d.image, 'chat') : null;
        const m = { ...d, image: url, id: Date.now(), date: new Date().toISOString() };
        db.globalMessages.push(m); saveData(); io.emit('receive_global_msg', m);
    });
    socket.on('send_ai_msg', (t) => { setTimeout(() => socket.emit('receive_ai_msg', {text: "أنا ذكاء اصطناعي، اسألني عن أي شيء!"}), 800); });
    socket.on('send_private_msg', (d) => {
        const m = { ...d, id: Date.now(), date: new Date().toISOString() };
        db.privateMessages.push(m); saveData();
        socket.emit('receive_private_msg', m);
        if(connectedSockets[d.to]) io.to(connectedSockets[d.to]).emit('receive_private_msg', m);
    });
    socket.on('get_private_msgs', ({u1, u2}) => socket.emit('load_private_msgs', db.privateMessages.filter(m => (m.from===u1&&m.to===u2) || (m.from===u2&&m.to===u1))));

    // Others
    socket.on('create_group', (d) => { const g={id:'g'+Date.now(),...d,members:[d.owner]}; db.groups.push(g); saveData(); io.emit('update_groups', db.groups); socket.emit('group_created_success', g); });
    socket.on('create_page', (d) => { const p={id:'p'+Date.now(),...d,followers:[d.owner]}; db.pages.push(p); saveData(); io.emit('update_pages', db.pages); socket.emit('page_created_success', p); });
    socket.on('delete_group', ({groupId, email}) => { const i = db.groups.findIndex(g=>g.id===groupId); if(i!==-1 && db.groups[i].owner===email){ db.groups.splice(i,1); saveData(); io.emit('update_groups', db.groups); socket.emit('delete_success'); } });
    socket.on('delete_page', ({pageId, email}) => { const i = db.pages.findIndex(p=>p.id===pageId); if(i!==-1 && db.pages[i].owner===email){ db.pages.splice(i,1); saveData(); io.emit('update_pages', db.pages); socket.emit('delete_success'); } });
    
    socket.on('get_context_posts', ({context, contextId}) => { socket.emit('load_posts', db.posts.filter(p => p.context === context && p.contextId === contextId)); });
    socket.on('update_profile', (d) => { const i=db.users.findIndex(u=>u.email===d.email); if(i!==-1){ db.users[i].name=d.name; db.users[i].bio=d.bio; if(d.avatar&&d.avatar.startsWith('data:'))db.users[i].avatar=saveBase64ToFile(d.avatar,'avatar'); saveData(); socket.emit('profile_updated_success', db.users[i]); } });
    socket.on('get_profile_info', (e) => { const u=db.users.find(x=>x.email===e); if(u) socket.emit('open_profile_view', {user:u, posts:db.posts.filter(p=>p.email===e)}); });

    // Friends
    socket.on('send_friend_request', (d) => { if(d.from!==d.to && !db.friendRequests.find(r=>r.from===d.from&&r.to===d.to)) { db.friendRequests.push({from:d.from, to:d.to}); saveData(); if(connectedSockets[d.to]) io.to(connectedSockets[d.to]).emit('new_req'); checkFriendRequests(d.to); } });
    socket.on('respond_friend_request', (d) => { db.friendRequests = db.friendRequests.filter(r=>!(r.to===d.userEmail && r.from===d.requesterEmail)); if(d.accept) { db.friendships.push({user1:d.userEmail, user2:d.requesterEmail}); updateFriendsList(d.userEmail); updateFriendsList(d.requesterEmail); } saveData(); checkFriendRequests(d.userEmail); });

    function updateFriendsList(email) {
        const fs = db.friendships.filter(f => f.user1 === email || f.user2 === email);
        const emails = fs.map(f => f.user1 === email ? f.user2 : f.user1);
        const fData = db.users.filter(u => emails.includes(u.email)).map(u => ({ name: u.name, email: u.email, avatar: u.avatar, isOnline: !!connectedSockets[u.email] }));
        if(connectedSockets[email]) io.to(connectedSockets[email]).emit('update_friends', fData);
    }
    function checkFriendRequests(email) {
        const reqs = db.friendRequests.filter(r => r.to === email);
        const data = reqs.map(r => { const s = db.users.find(u=>u.email===r.from); return {email:r.from, name:s?s.name:'Unknown', avatar:s?s.avatar:''}; });
        if(connectedSockets[email]) io.to(connectedSockets[email]).emit('update_requests', data);
    }

    socket.on('disconnect', () => {
        const email = Object.keys(connectedSockets).find(k => connectedSockets[k] === socket.id);
        if(email) delete connectedSockets[email];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
