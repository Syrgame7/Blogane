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

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// قاعدة البيانات
let db = { 
    users: [], posts: [], reels: [], groups: [], pages: [], 
    friendRequests: [], friendships: [], globalMessages: [], privateMessages: [] 
};

// تحميل البيانات
if (fs.existsSync(DATA_FILE)) {
    try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { console.log(e); }
}

function saveData() {
    fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2), () => {});
}

function saveBase64ToFile(base64Data, prefix) {
    try {
        const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) return null;
        const ext = matches[1].split('/')[1] || 'bin';
        const filename = `${prefix}_${Date.now()}.${ext}`;
        fs.writeFileSync(path.join(UPLOAD_DIR, filename), Buffer.from(matches[2], 'base64'));
        return `/uploads/${filename}`;
    } catch (e) { return null; }
}

// --- تهيئة البوتات كمستخدمين حقيقيين ---
const bots = [
    { name: "سارة أحمد", bio: "مصممة جرافيك ومحبة للقطط 🐱", avatar: "https://ui-avatars.com/api/?name=Sarah&background=ff00ff&color=fff" },
    { name: "Tech Master", bio: "أحب البرمجة والذكاء الاصطناعي 💻", avatar: "https://ui-avatars.com/api/?name=Tech&background=0000ff&color=fff" },
    { name: "Dr. House", bio: "طبيب واستشاري نفسي 🩺", avatar: "https://ui-avatars.com/api/?name=Dr&background=ff0000&color=fff" },
    { name: "Lofi Girl", bio: "موسيقى وهدوء 🎧", avatar: "https://ui-avatars.com/api/?name=Lofi&background=ffaa00&color=fff" }
];

// تسجيل البوتات في قاعدة البيانات إذا لم يكونوا موجودين
bots.forEach((bot, index) => {
    const email = `bot${index}@blogane.com`;
    if (!db.users.find(u => u.email === email)) {
        db.users.push({
            id: Date.now() + index,
            name: bot.name,
            email: email,
            password: "bot", // كلمة سر وهمية
            avatar: bot.avatar,
            bio: bot.bio,
            isBot: true
        });
    }
});
saveData();

// --- محرك التفاعل (Simulation Engine) ---
const botTexts = ["تطبيق رائع جداً! 😍", "صباح الخير جميعاً ☀️", "من يوافقني الرأي؟", "صورة جميلة", "سبحان الله", "😂😂😂"];
setInterval(() => {
    const botIdx = Math.floor(Math.random() * bots.length);
    const botEmail = `bot${botIdx}@blogane.com`;
    const botName = bots[botIdx].name;
    const botAvatar = bots[botIdx].avatar;
    const action = Math.random();

    if (action < 0.3) { // نشر بوست
        const newPost = {
            id: Date.now(), author: botName, email: botEmail, avatar: botAvatar,
            content: botTexts[Math.floor(Math.random() * botTexts.length)],
            media: null, likes: [], comments: [], date: new Date().toISOString(),
            context: 'general', contextId: null
        };
        db.posts.unshift(newPost);
        io.emit('receive_post', newPost);
    } else if (action < 0.7 && db.posts.length > 0) { // إعجاب
        const post = db.posts[Math.floor(Math.random() * db.posts.length)];
        if(!post.likes.includes(botEmail)) {
            post.likes.push(botEmail);
            io.emit('update_likes', { id: post.id, type: 'post', likes: post.likes });
        }
    }
    saveData();
}, 10000);

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
            checkFriendRequests(u.email);
        } else { socket.emit('auth_error', 'بيانات خاطئة'); }
    });

    // Profile System (Viewing Any Profile)
    socket.on('get_profile_info', (email) => {
        const user = db.users.find(u => u.email === email);
        if(user) {
            const posts = db.posts.filter(p => p.email === email);
            socket.emit('open_profile_view', { user, posts });
        }
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

    // Chat
    socket.on('send_global_msg', (d) => {
        let url = d.image ? saveBase64ToFile(d.image, 'chat') : null;
        const m = { ...d, image: url, id: Date.now(), date: new Date().toISOString() };
        db.globalMessages.push(m); if(db.globalMessages.length>100) db.globalMessages.shift();
        saveData(); io.emit('receive_global_msg', m);
    });
    socket.on('send_private_msg', (d) => {
        const m = { ...d, id: Date.now(), date: new Date().toISOString() };
        db.privateMessages.push(m); saveData();
        socket.emit('receive_private_msg', m);
        if(connectedSockets[d.to]) io.to(connectedSockets[d.to]).emit('receive_private_msg', m);
    });
    socket.on('get_private_msgs', ({u1, u2}) => {
        socket.emit('load_private_msgs', db.privateMessages.filter(m => (m.from===u1&&m.to===u2) || (m.from===u2&&m.to===u1)));
    });

    // AI
    socket.on('send_ai_msg', (t) => {
        setTimeout(() => socket.emit('receive_ai_msg', {text: "أنا ذكاء اصطناعي متطور، اسألني عن أي شيء!"}), 800);
    });

    // Others
    socket.on('create_group', (d) => { const g={id:'g'+Date.now(),...d,members:[d.owner]}; db.groups.push(g); saveData(); io.emit('update_groups', db.groups); });
    socket.on('create_page', (d) => { const p={id:'p'+Date.now(),...d,followers:[d.owner]}; db.pages.push(p); saveData(); io.emit('update_pages', db.pages); });
    socket.on('send_friend_request', (d) => {
        if(d.from!==d.to && !db.friendRequests.find(r=>r.from===d.from&&r.to===d.to)) {
            db.friendRequests.push({from:d.from, to:d.to}); saveData();
            if(connectedSockets[d.to]) io.to(connectedSockets[d.to]).emit('new_req');
            checkFriendRequests(d.to);
        }
    });
    socket.on('respond_friend_request', (d) => {
        db.friendRequests = db.friendRequests.filter(r=>!(r.to===d.userEmail && r.from===d.requesterEmail));
        if(d.accept) { db.friendships.push({user1:d.userEmail, user2:d.requesterEmail}); updateFriendsList(d.userEmail); updateFriendsList(d.requesterEmail); }
        saveData(); checkFriendRequests(d.userEmail);
    });

    function checkFriendRequests(email) {
        const reqs = db.friendRequests.filter(r => r.to === email);
        const data = reqs.map(r => { const s = db.users.find(u=>u.email===r.from); return {email:r.from, name:s?s.name:'Unknown', avatar:s?s.avatar:''}; });
        if(connectedSockets[email]) io.to(connectedSockets[email]).emit('update_requests', data);
    }
    function updateFriendsList(email) {
        const fs = db.friendships.filter(f => f.user1 === email || f.user2 === email);
        const emails = fs.map(f => f.user1 === email ? f.user2 : f.user1);
        const fData = db.users.filter(u => emails.includes(u.email)).map(u => ({ name: u.name, email: u.email, avatar: u.avatar, isOnline: !!connectedSockets[u.email] }));
        if(connectedSockets[email]) io.to(connectedSockets[email]).emit('update_friends', fData);
    }

    socket.on('disconnect', () => {
        const email = Object.keys(connectedSockets).find(k => connectedSockets[k] === socket.id);
        if(email) delete connectedSockets[email];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on ${PORT}`));
