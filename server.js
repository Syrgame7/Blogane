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

// هيكل البيانات
let db = { 
    users: [], posts: [], reels: [], groups: [], pages: [], 
    friendRequests: [], friendships: [], globalMessages: [], privateMessages: [] 
};

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

// --- BOT SIMULATION ENGINE (بوتات التفاعل) ---
const botNames = ["Sarah Cool", "Ahmed Tech", "Lofi Girl", "Gamer Pro", "Dr. House", "Cat Lover"];
const botAvatars = [
    "https://ui-avatars.com/api/?name=Sarah&background=ff00ff&color=fff",
    "https://ui-avatars.com/api/?name=Ahmed&background=0000ff&color=fff",
    "https://ui-avatars.com/api/?name=Lofi&background=ffaa00&color=fff",
    "https://ui-avatars.com/api/?name=Gamer&background=00ff00&color=fff",
    "https://ui-avatars.com/api/?name=Dr&background=ff0000&color=fff",
    "https://ui-avatars.com/api/?name=Cat&background=888888&color=fff"
];
const botComments = ["رائع جداً! 🔥", "منشور جميل استمر", "أتفق معك تماماً", "😂😂😂", "ممكن نتعرف؟", "شكراً على المشاركة", "Wow!", "Good vibes only ✨"];
const botPosts = ["صباح الخير يا جماعة! ☀️", "مين يلعب معي ببجي؟ 🎮", "الجو اليوم رائع جداً", "هل تعلم أن القطط تنام 16 ساعة؟ 🐈", "برمجة HTML ممتعة جداً!"];

// دالة تشغيل البوتات (كل 15 ثانية يحدث شيء)
setInterval(() => {
    const action = Math.random();
    const randomBotIndex = Math.floor(Math.random() * botNames.length);
    const botName = botNames[randomBotIndex];
    const botAvatar = botAvatars[randomBotIndex];
    const botEmail = `bot${randomBotIndex}@blogane.com`;

    if (action < 0.2) { // 20% احتمال نشر منشور جديد
        const newPost = {
            id: Date.now(), author: botName, email: botEmail, avatar: botAvatar,
            content: botPosts[Math.floor(Math.random() * botPosts.length)],
            media: null, likes: [], comments: [], date: new Date().toISOString(),
            context: 'general', contextId: null
        };
        db.posts.unshift(newPost);
        io.emit('receive_post', newPost);
    } 
    else if (action < 0.6 && db.posts.length > 0) { // 40% احتمال إعجاب
        const randomPost = db.posts[Math.floor(Math.random() * db.posts.length)];
        if(!randomPost.likes.includes(botEmail)) {
            randomPost.likes.push(botEmail);
            io.emit('update_likes', { id: randomPost.id, type: 'post', likes: randomPost.likes });
        }
    } 
    else if (action < 0.9 && db.posts.length > 0) { // 30% احتمال تعليق
        const randomPost = db.posts[Math.floor(Math.random() * db.posts.length)];
        const comment = {
            id: Date.now(), text: botComments[Math.floor(Math.random() * botComments.length)],
            userEmail: botEmail, userName: botName, userAvatar: botAvatar
        };
        randomPost.comments.push(comment);
        io.emit('update_comments', { postId: randomPost.id, comments: randomPost.comments });
    }
    saveData();
}, 8000); // كل 8 ثواني تفاعل

// --- Socket Logic ---
let connectedSockets = {}; 

io.on('connection', (socket) => {
    
    // Auth
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

    // Posts & Comments
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

    // Chat (Global, AI, Private)
    socket.on('send_global_msg', (data) => {
        let img = data.image ? saveBase64ToFile(data.image, 'chat') : null;
        const msg = { ...data, image: img, id: Date.now(), date: new Date().toISOString() };
        db.globalMessages.push(msg); if(db.globalMessages.length > 100) db.globalMessages.shift();
        saveData(); io.emit('receive_global_msg', msg);
    });
    
    socket.on('send_ai_msg', (text) => {
        setTimeout(() => {
            let reply = "أنا ذكاء اصطناعي، ما زلت أتعلم!";
            if(text.includes('مرحبا')) reply = "أهلاً بك! كيف يمكنني مساعدتك؟";
            if(text.includes('نكتة')) reply = "مرة طماطم عطست قالت كاتشب 😂";
            socket.emit('receive_ai_msg', { text: reply });
        }, 800);
    });

    // Private Chat System
    socket.on('get_private_msgs', ({ user1, user2 }) => {
        const msgs = db.privateMessages.filter(m => (m.from === user1 && m.to === user2) || (m.from === user2 && m.to === user1));
        socket.emit('load_private_msgs', msgs);
    });
    
    socket.on('send_private_msg', (data) => {
        // data: { from, to, text }
        const msg = { ...data, id: Date.now(), date: new Date().toISOString() };
        db.privateMessages.push(msg);
        saveData();
        // Send to sender (to update UI)
        socket.emit('receive_private_msg', msg);
        // Send to receiver if online
        const targetSocket = connectedSockets[data.to];
        if (targetSocket) io.to(targetSocket).emit('receive_private_msg', msg);
    });

    // Others (Reels, Groups, Context, Friends) - Same as before
    socket.on('new_reel', (d) => {
        let url = saveBase64ToFile(d.videoBase64, 'reel');
        if(url) { const r={id:Date.now(),url,desc:d.desc,author:d.author,avatar:d.avatar,email:d.email,likes:[],comments:[]}; db.reels.unshift(r); saveData(); io.emit('receive_reel', {...r,videoBase64:null}); socket.emit('upload_complete'); }
    });
    socket.on('create_group', (d) => { const g={id:'g'+Date.now(),...d,members:[d.owner]}; db.groups.push(g); saveData(); io.emit('update_groups', db.groups); socket.emit('group_created_success', g); });
    socket.on('create_page', (d) => { const p={id:'p'+Date.now(),...d,followers:[d.owner]}; db.pages.push(p); saveData(); io.emit('update_pages', db.pages); socket.emit('page_created_success', p); });
    socket.on('delete_group', ({groupId, email}) => { const idx = db.groups.findIndex(g=>g.id===groupId); if(idx!==-1 && db.groups[idx].owner===email){ db.groups.splice(idx,1); saveData(); io.emit('update_groups', db.groups); socket.emit('delete_success'); } });
    socket.on('delete_page', ({pageId, email}) => { const idx = db.pages.findIndex(p=>p.id===pageId); if(idx!==-1 && db.pages[idx].owner===email){ db.pages.splice(idx,1); saveData(); io.emit('update_pages', db.pages); socket.emit('delete_success'); } });
    socket.on('get_context_posts', ({context, contextId}) => { socket.emit('load_posts', db.posts.filter(p => p.context === context && p.contextId === contextId)); });
    socket.on('update_profile', (d) => { const i=db.users.findIndex(u=>u.email===d.email); if(i!==-1){ db.users[i].name=d.name; db.users[i].bio=d.bio; if(d.avatar&&d.avatar.startsWith('data:'))db.users[i].avatar=saveBase64ToFile(d.avatar,'avatar'); saveData(); socket.emit('profile_updated_success', db.users[i]); } });
    socket.on('get_user_posts', (e) => socket.emit('load_profile_posts', db.posts.filter(p=>p.email===e)));
    
    // Friends Logic
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
