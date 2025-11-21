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

// --- 1. Keep-Alive System (منع توقف السيرفر) ---
app.get('/ping', (req, res) => { res.status(200).send('Pong'); });

// يقوم السيرفر بضرب نفسه كل 4 دقائق ليبقى مستيقظاً
setInterval(() => {
    const PORT = process.env.PORT || 3000;
    http.get(`http://127.0.0.1:${PORT}/ping`, (res) => {
        // Ping successful
    }).on('error', (err) => {
        console.error('Ping failed.');
    });
}, 4 * 60 * 1000);

// --- 2. Data Persistence (نظام الحفظ) ---
const DATA_FILE = 'database.json';
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// البيانات الافتراضية
let db = { 
    users: [], posts: [], reels: [], groups: [], pages: [], 
    friendRequests: [], friendships: [], globalMessages: [], privateMessages: [] 
};

// تحميل البيانات عند التشغيل
if (fs.existsSync(DATA_FILE)) {
    try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { console.log('Database reset'); }
}

// دالة الحفظ (مع تنظيف البيانات القديمة لمنع البطء)
function saveData() {
    // الاحتفاظ بآخر 200 منشور ورسالة فقط لتوفير المساحة
    if(db.globalMessages.length > 200) db.globalMessages = db.globalMessages.slice(-200);
    if(db.posts.length > 100) db.posts = db.posts.slice(0, 100); 
    
    fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2), (err) => {
        if(err) console.error("Save Error:", err);
    });
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

// --- 3. Super Active Bots (بوتات حيوية) ---
const bots = [
    { name: "سارة المهندسة", avatar: "https://ui-avatars.com/api/?name=Sarah&background=ff00ff&color=fff" },
    { name: "أحمد جيمر", avatar: "https://ui-avatars.com/api/?name=Ahmed&background=0000ff&color=fff" },
    { name: "عشاق القهوة", avatar: "https://ui-avatars.com/api/?name=Coffee&background=795548&color=fff" },
    { name: "د. عمر", avatar: "https://ui-avatars.com/api/?name=DrOmar&background=ff0000&color=fff" },
    { name: "نور ديزاين", avatar: "https://ui-avatars.com/api/?name=Nour&background=00ff00&color=fff" },
    { name: "تيك توك ستار", avatar: "https://ui-avatars.com/api/?name=Star&background=000000&color=fff" }
];

const botTexts = [
    "تطبيق رائع جداً! 😍", "من يوافقني الرأي؟", "صباح الخير يا قوم ☀️", 
    "هل تعلم أن البرمجة ممتعة؟ 💻", "أحتاج قهوة الآن ☕", "تصميم خرافي!", 
    "ممكن متابعة؟", "😂😂😂", "سبحان الله", "جمعة مباركة"
];

const botImages = [
    "https://picsum.photos/400/300?random=1",
    "https://picsum.photos/400/300?random=2",
    "https://picsum.photos/400/300?random=3",
    null, null, null // بعض المنشورات بدون صور
];

// محرك البوتات (يعمل كل 10 ثواني)
setInterval(() => {
    const action = Math.random(); // رقم عشوائي بين 0 و 1
    const bot = bots[Math.floor(Math.random() * bots.length)];
    const botEmail = `${bot.name.replace(' ', '')}@bot.com`;

    if (action < 0.3) { 
        // 30% فرصة: كتابة رسالة في الشات العام
        const msg = { 
            id: Date.now(), text: botTexts[Math.floor(Math.random() * botTexts.length)], image: null,
            author: bot.name, email: botEmail, avatar: bot.avatar, date: new Date().toISOString()
        };
        db.globalMessages.push(msg);
        io.emit('receive_global_msg', msg);
    } 
    else if (action < 0.5) {
        // 20% فرصة: نشر منشور جديد
        const newPost = {
            id: Date.now(), author: bot.name, email: botEmail, avatar: bot.avatar,
            content: botTexts[Math.floor(Math.random() * botTexts.length)],
            media: Math.random() > 0.7 ? botImages[Math.floor(Math.random() * 3)] : null, // أحياناً صور
            likes: [], comments: [], date: new Date().toISOString(),
            context: 'general', contextId: null
        };
        db.posts.unshift(newPost);
        io.emit('receive_post', newPost);
    }
    else if (action < 0.8 && db.posts.length > 0) {
        // 30% فرصة: إعجاب بمنشور عشوائي (ربما منشورك)
        const post = db.posts[Math.floor(Math.random() * db.posts.length)];
        if(!post.likes.includes(botEmail)) {
            post.likes.push(botEmail);
            io.emit('update_likes', { id: post.id, type: 'post', likes: post.likes });
        }
    }
    else if (db.posts.length > 0) {
        // 20% فرصة: تعليق على منشور
        const post = db.posts[Math.floor(Math.random() * db.posts.length)];
        const comment = {
            id: Date.now(), text: "منور! 🔥", userEmail: botEmail, userName: bot.name, userAvatar: bot.avatar
        };
        post.comments.push(comment);
        io.emit('update_comments', { postId: post.id, comments: post.comments });
    }
    saveData();
}, 10000); // كل 10 ثواني

let connectedSockets = {}; 

io.on('connection', (socket) => {
    
    // --- Auth ---
    socket.on('register', (data) => {
        if (db.users.find(u => u.email === data.email)) socket.emit('auth_error', 'البريد مسجل');
        else {
            const newUser = { ...data, id: Date.now(), avatar: `https://ui-avatars.com/api/?name=${data.name}&background=random`, bio: 'مستخدم جديد' };
            db.users.push(newUser); saveData(); socket.emit('auth_success', newUser);
        }
    });
    socket.on('login', (data) => {
        const user = db.users.find(u => u.email === data.email && u.password === data.password);
        if (user) {
            connectedSockets[user.email] = socket.id;
            socket.emit('auth_success', user);
            socket.emit('init_data', { groups: db.groups, pages: db.pages, reels: db.reels, globalMessages: db.globalMessages });
            socket.emit('load_posts', db.posts.filter(p => p.context === 'general'));
            updateFriendsList(user.email);
        } else { socket.emit('auth_error', 'بيانات خاطئة'); }
    });

    // --- Core Features ---
    socket.on('new_post', (data) => {
        let mediaUrl = null; if (data.media && data.media.startsWith('data:')) mediaUrl = saveBase64ToFile(data.media, 'post');
        const newPost = { ...data, id: Date.now(), media: mediaUrl, likes: [], comments: [], date: new Date().toISOString() };
        db.posts.unshift(newPost); saveData(); io.emit('receive_post', newPost); socket.emit('upload_complete');
    });

    socket.on('toggle_like', ({ id, type, userEmail }) => {
        let item = (type === 'reel' ? db.reels : db.posts).find(i => i.id == id);
        if(item) {
            if(item.likes.includes(userEmail)) item.likes = item.likes.filter(e => e !== userEmail);
            else item.likes.push(userEmail);
            saveData(); io.emit('update_likes', { id, type, likes: item.likes });
        }
    });

    socket.on('add_comment', ({ postId, text, userEmail, userName, userAvatar }) => {
        const post = db.posts.find(p => p.id == postId);
        if(post) {
            post.comments.push({ id: Date.now(), text, userEmail, userName, userAvatar });
            saveData(); io.emit('update_comments', { postId, comments: post.comments });
        }
    });

    // --- Chat ---
    socket.on('send_global_msg', (data) => {
        let img = data.image ? saveBase64ToFile(data.image, 'chat') : null;
        const msg = { ...data, image: img, id: Date.now(), date: new Date().toISOString() };
        db.globalMessages.push(msg); saveData(); io.emit('receive_global_msg', msg);
    });
    
    socket.on('send_ai_msg', (text) => {
        setTimeout(() => {
            let reply = "أنا مساعدك الذكي! أسألني عن أي شيء.";
            if(text.includes('مرحبا')) reply = "يا هلا! كيف الحال؟";
            if(text.includes('صورة')) reply = "يمكنني تحليل النصوص فقط حالياً!";
            socket.emit('receive_ai_msg', { text: reply });
        }, 1000);
    });

    socket.on('get_private_msgs', ({ user1, user2 }) => {
        const msgs = db.privateMessages.filter(m => (m.from === user1 && m.to === user2) || (m.from === user2 && m.to === user1));
        socket.emit('load_private_msgs', msgs);
    });
    
    socket.on('send_private_msg', (data) => {
        const msg = { ...data, id: Date.now(), date: new Date().toISOString() };
        db.privateMessages.push(msg); saveData();
        socket.emit('receive_private_msg', msg);
        const targetSocket = connectedSockets[data.to];
        if (targetSocket) io.to(targetSocket).emit('receive_private_msg', msg);
    });

    // --- Others ---
    socket.on('new_reel', (d) => { let url = saveBase64ToFile(d.videoBase64, 'reel'); if(url) { const r={id:Date.now(),url,desc:d.desc,author:d.author,avatar:d.avatar,email:d.email,likes:[],comments:[]}; db.reels.unshift(r); saveData(); io.emit('receive_reel', {...r,videoBase64:null}); socket.emit('upload_complete'); } });
    socket.on('create_group', (d) => { const g={id:'g'+Date.now(),...d,members:[d.owner]}; db.groups.push(g); saveData(); io.emit('update_groups', db.groups); socket.emit('group_created_success', g); });
    socket.on('create_page', (d) => { const p={id:'p'+Date.now(),...d,followers:[d.owner]}; db.pages.push(p); saveData(); io.emit('update_pages', db.pages); socket.emit('page_created_success', p); });
    socket.on('update_profile', (d) => { const i=db.users.findIndex(u=>u.email===d.email); if(i!==-1){ db.users[i].name=d.name; db.users[i].bio=d.bio; if(d.avatar&&d.avatar.startsWith('data:'))db.users[i].avatar=saveBase64ToFile(d.avatar,'avatar'); saveData(); socket.emit('profile_updated_success', db.users[i]); } });
    
    socket.on('send_friend_request', (d) => { if(d.from!==d.to && !db.friendRequests.find(r=>r.from===d.from&&r.to===d.to)) { db.friendRequests.push({from:d.from, to:d.to}); saveData(); if(connectedSockets[d.to]) io.to(connectedSockets[d.to]).emit('new_req'); } });
    socket.on('respond_friend_request', (d) => { db.friendRequests = db.friendRequests.filter(r => !(r.to===d.userEmail && r.from===d.requesterEmail)); if(d.accept) { db.friendships.push({user1:d.userEmail, user2:d.requesterEmail}); updateFriendsList(d.userEmail); updateFriendsList(d.requesterEmail); } saveData(); });

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
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
