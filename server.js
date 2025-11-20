const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// زيادة الحد الأقصى لاستقبال البيانات
const io = new Server(server, {
    cors: { origin: "*" },
    maxHttpBufferSize: 100 * 1024 * 1024 // 100 MB
});

app.use(express.static(path.join(__dirname, 'public')));

const DATA_FILE = 'database.json';
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

if (!fs.existsSync(UPLOAD_DIR)){
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

let db = { users: [], posts: [], reels: [], groups: [], pages: [], friendRequests: [], friendships: [], globalMessages: [] };

// تحميل البيانات
if (fs.existsSync(DATA_FILE)) {
    try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { console.log(e); }
}

function saveData() {
    fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2), () => {});
}

// دالة لحفظ الصور (Base64) - للمنشورات والبروفايل
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

    // --- Posts ---
    socket.on('new_post', (data) => {
        let mediaUrl = null;
        if (data.media && data.media.startsWith('data:')) mediaUrl = saveBase64ToFile(data.media, 'post');
        const newPost = { ...data, id: Date.now(), media: mediaUrl, likes: [], comments: [], date: new Date().toISOString() };
        db.posts.unshift(newPost); saveData();
        io.emit('receive_post', newPost);
        socket.emit('upload_complete');
    });

    // --- Video Upload System (Chunking) ---
    // 1. استقبال بداية الرفع
    socket.on('upload_reel_start', ({ name, size }) => {
        const fileName = `reel_${Date.now()}_${Math.floor(Math.random() * 1000)}${path.extname(name)}`;
        const filePath = path.join(UPLOAD_DIR, fileName);
        // إنشاء ملف فارغ
        fs.open(filePath, 'w', (err, fd) => {
            if (err) {
                socket.emit('upload_error', 'فشل إنشاء الملف');
            } else {
                fs.close(fd, () => {
                    socket.emit('upload_ready', { tempFileName: fileName });
                });
            }
        });
    });

    // 2. استقبال جزء من الملف
    socket.on('upload_reel_chunk', ({ fileName, data }) => {
        const filePath = path.join(UPLOAD_DIR, fileName);
        // كتابة الجزء (Chunk) في نهاية الملف
        fs.appendFile(filePath, data, (err) => {
            if (err) console.error('Error appending chunk', err);
            // نطلب الجزء التالي من العميل (اختياري، لكن هنا العميل سيرسل تباعاً)
        });
    });

    // 3. نهاية الرفع وحفظ البيانات
    socket.on('upload_reel_end', ({ fileName, desc, author, avatar, email }) => {
        const reelUrl = `/uploads/${fileName}`;
        const reel = { 
            id: Date.now(), 
            url: reelUrl, 
            desc, 
            author, 
            avatar, 
            email, 
            likes: [], 
            comments: [] 
        };
        db.reels.unshift(reel);
        saveData();
        io.emit('receive_reel', reel);
        socket.emit('upload_complete'); // إخفاء اللودر عند العميل
    });

    // --- بقية الأوامر (بروفايل، شات، مجموعات...) ---
    socket.on('update_profile', (data) => {
        const idx = db.users.findIndex(u => u.email === data.email);
        if(idx !== -1) {
            db.users[idx].name = data.name;
            db.users[idx].bio = data.bio;
            if(data.avatar && data.avatar.startsWith('data:')) {
                const url = saveBase64ToFile(data.avatar, 'avatar');
                if(url) db.users[idx].avatar = url;
            }
            const u = db.users[idx];
            db.posts.forEach(p => { if(p.email === u.email) { p.author = u.name; p.avatar = u.avatar; } });
            db.reels.forEach(r => { if(r.email === u.email) { r.author = u.name; r.avatar = u.avatar; } });
            saveData();
            socket.emit('profile_updated_success', u);
        }
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

    socket.on('send_global_msg', (data) => {
        let img = data.image ? saveBase64ToFile(data.image, 'chat') : null;
        const msg = { ...data, image: img, id: Date.now() };
        db.globalMessages.push(msg); 
        if(db.globalMessages.length > 100) db.globalMessages.shift();
        saveData();
        io.emit('receive_global_msg', msg);
    });

    socket.on('send_ai_msg', (text) => {
        setTimeout(() => {
            let reply = "أهلاً! أنا المساعد الذكي، كيف أخدمك؟";
            socket.emit('receive_ai_msg', { text: reply });
        }, 1000);
    });

    socket.on('create_group', (d) => { const g={id:'g'+Date.now(),...d,members:[d.owner]}; db.groups.push(g); saveData(); io.emit('update_groups', db.groups); socket.emit('group_created_success', g); });
    socket.on('create_page', (d) => { const p={id:'p'+Date.now(),...d,followers:[d.owner]}; db.pages.push(p); saveData(); io.emit('update_pages', db.pages); socket.emit('page_created_success', p); });
    socket.on('get_context_posts', ({context, contextId}) => { socket.emit('load_posts', db.posts.filter(p => p.context === context && p.contextId === contextId)); });
    socket.on('get_user_posts', (email) => { socket.emit('load_profile_posts', db.posts.filter(p => p.email === email)); });
    
    socket.on('send_friend_request', (d) => {
        if(d.from !== d.to && !db.friendRequests.find(r=>r.from===d.from && r.to===d.to)) {
            db.friendRequests.push({from:d.from, to:d.to}); saveData();
            if(connectedSockets[d.to]) io.to(connectedSockets[d.to]).emit('new_req');
        }
    });
    socket.on('respond_friend_request', (d) => {
        db.friendRequests = db.friendRequests.filter(req => !(req.to === d.userEmail && req.from === d.requesterEmail));
        if(d.accept) {
            db.friendships.push({ user1: d.userEmail, user2: d.requesterEmail });
            updateFriendsList(d.userEmail); updateFriendsList(d.requesterEmail);
        }
        saveData(); 
    });

    function updateFriendsList(email) {
        const fs = db.friendships.filter(f => f.user1 === email || f.user2 === email);
        const emails = fs.map(f => f.user1 === email ? f.user2 : f.user1);
        const fData = db.users.filter(u => emails.includes(u.email)).map(u => ({
            name: u.name, email: u.email, avatar: u.avatar, isOnline: !!connectedSockets[u.email]
        }));
        if(connectedSockets[email]) io.to(connectedSockets[email]).emit('update_friends', fData);
    }

    socket.on('disconnect', () => {
        const email = Object.keys(connectedSockets).find(k => connectedSockets[k] === socket.id);
        if(email) delete connectedSockets[email];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
