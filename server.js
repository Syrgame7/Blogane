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

if (!fs.existsSync(UPLOAD_DIR)){
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// تهيئة قاعدة البيانات
let db = { users: [], posts: [], reels: [], groups: [], pages: [], friendRequests: [], friendships: [], globalMessages: [] };

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

let connectedSockets = {}; 

io.on('connection', (socket) => {
    
    // --- Auth ---
    socket.on('register', (data) => {
        if (db.users.find(u => u.email === data.email)) {
            socket.emit('auth_error', 'البريد مسجل');
        } else {
            const newUser = { ...data, id: Date.now(), avatar: `https://ui-avatars.com/api/?name=${data.name}&background=random`, bio: 'مستخدم جديد' };
            db.users.push(newUser); saveData();
            socket.emit('auth_success', newUser);
        }
    });

    socket.on('login', (data) => {
        const user = db.users.find(u => u.email === data.email && u.password === data.password);
        if (user) {
            connectedSockets[user.email] = socket.id;
            socket.emit('auth_success', user);
            socket.emit('init_data', { groups: db.groups, pages: db.pages, reels: db.reels, globalMessages: db.globalMessages });
            socket.emit('load_posts', db.posts.filter(p => p.context === 'general'));
        } else {
            socket.emit('auth_error', 'بيانات خاطئة');
        }
    });

    // --- Profile Posts (المناشير في الملف الشخصي) ---
    socket.on('get_user_posts', (email) => {
        // جلب المنشورات التي نشرها هذا الشخص فقط (سواء كانت عامة أو في مجموعات)
        // أو يمكن حصرها في العامة فقط حسب رغبتك. هنا سنجلب كل ما نشره.
        const userPosts = db.posts.filter(p => p.email === email);
        socket.emit('load_profile_posts', userPosts);
    });

    socket.on('update_profile', (data) => {
        const idx = db.users.findIndex(u => u.email === data.email);
        if(idx !== -1) {
            db.users[idx].name = data.name;
            db.users[idx].bio = data.bio;
            if(data.avatar && data.avatar.startsWith('data:')) {
                const url = saveBase64ToFile(data.avatar, 'avatar');
                if(url) db.users[idx].avatar = url;
            }
            // تحديث البيانات في المنشورات القديمة
            const u = db.users[idx];
            db.posts.forEach(p => { if(p.email === u.email) { p.author = u.name; p.avatar = u.avatar; } });
            db.reels.forEach(r => { if(r.email === u.email) { r.author = u.name; r.avatar = u.avatar; } });
            
            saveData();
            socket.emit('profile_updated_success', u);
        }
    });

    // --- Posts ---
    socket.on('new_post', (data) => {
        let mediaUrl = null;
        if (data.media && data.media.startsWith('data:')) mediaUrl = saveBase64ToFile(data.media, 'post');
        const newPost = { ...data, id: Date.now(), media: mediaUrl, likes: [], comments: [], date: new Date().toISOString() };
        db.posts.unshift(newPost); saveData();
        io.emit('receive_post', newPost);
        socket.emit('upload_complete');
    });

    socket.on('toggle_like', ({ id, type, userEmail }) => {
        let item = (type === 'reel' ? db.reels : db.posts).find(i => i.id == id);
        if(item) {
            if(item.likes.includes(userEmail)) item.likes = item.likes.filter(e => e !== userEmail);
            else item.likes.push(userEmail);
            saveData();
            io.emit('update_likes', { id, type, likes: item.likes });
        }
    });

    socket.on('add_comment', ({ postId, text, userEmail, userName, userAvatar }) => {
        const post = db.posts.find(p => p.id == postId);
        if(post) {
            post.comments.push({ id: Date.now(), text, userEmail, userName, userAvatar });
            saveData();
            io.emit('update_comments', { postId, comments: post.comments });
        }
    });

    // --- AI Chatbot (المساعد الذكي) ---
    socket.on('send_ai_msg', (text) => {
        // 1. الرد الفوري بأن الرسالة وصلت (للعرض عند المستخدم)
        // يتم التعامل معها في الواجهة، هنا نجهز الرد
        
        // محاكاة ذكاء اصطناعي بسيط
        setTimeout(() => {
            let reply = "أنا مساعد ذكي تجريبي، لا زلت أتعلم!";
            if (text.includes('مرحبا') || text.includes('هلا')) reply = "أهلاً بك في Blogane! كيف يمكنني مساعدتك اليوم؟ 🤖";
            else if (text.includes('كيف حالك')) reply = "أنا مجرد كود برمجي، لكني أشعر أنني بخير طالما السيرفر يعمل! 😄";
            else if (text.includes('اسمك')) reply = "اسمي Blogane Bot الإصدار 1.0";
            else if (text.includes('شكرا')) reply = "على الرحب والسعة! في خدمتك دائماً.";
            
            socket.emit('receive_ai_msg', { text: reply, isBot: true });
        }, 1000); // تأخير ثانية ليبدو واقعياً
    });

    // --- Reels ---
    socket.on('new_reel', (data) => {
        let url = saveBase64ToFile(data.videoBase64, 'reel');
        if(url) {
            const reel = { id: Date.now(), url, desc: data.desc, author: data.author, avatar: data.avatar, email: data.email, likes: [], comments: [] };
            db.reels.unshift(reel); saveData();
            io.emit('receive_reel', { ...reel, videoBase64: null });
            socket.emit('upload_complete');
        }
    });

    // --- Global Chat ---
    socket.on('send_global_msg', (data) => {
        let img = data.image ? saveBase64ToFile(data.image, 'chat') : null;
        const msg = { ...data, image: img, id: Date.now() };
        db.globalMessages.push(msg); 
        if(db.globalMessages.length > 100) db.globalMessages.shift();
        saveData();
        io.emit('receive_global_msg', msg);
    });

    // --- Groups/Pages ---
    socket.on('create_group', (d) => { const g={id:'g'+Date.now(),...d,members:[d.owner]}; db.groups.push(g); saveData(); io.emit('update_groups', db.groups); socket.emit('group_created_success', g); });
    socket.on('create_page', (d) => { const p={id:'p'+Date.now(),...d,followers:[d.owner]}; db.pages.push(p); saveData(); io.emit('update_pages', db.pages); socket.emit('page_created_success', p); });
    socket.on('get_context_posts', ({context, contextId}) => { socket.emit('load_posts', db.posts.filter(p => p.context === context && p.contextId === contextId)); });

    // --- Friends ---
    socket.on('send_friend_request', (d) => {
        if(d.from !== d.to && !db.friendRequests.find(r=>r.from===d.from && r.to===d.to)) {
            db.friendRequests.push({from:d.from, to:d.to}); saveData();
            if(connectedSockets[d.to]) io.to(connectedSockets[d.to]).emit('new_req');
        }
    });
    
    // ... (بقية كود الأصدقاء كما هو)

    socket.on('disconnect', () => {
        const email = Object.keys(connectedSockets).find(k => connectedSockets[k] === socket.id);
        if(email) delete connectedSockets[email];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
