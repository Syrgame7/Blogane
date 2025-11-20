const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// زيادة الحد الأقصى لاستقبال البيانات عبر السوكيت (50 ميجا)
const io = new Server(server, {
    cors: { origin: "*" },
    maxHttpBufferSize: 50 * 1024 * 1024 
});

app.use(express.static(path.join(__dirname, 'public')));

const DATA_FILE = 'database.json';
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

// التأكد من وجود مجلد Uploads
if (!fs.existsSync(UPLOAD_DIR)){
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

let db = { users: [], posts: [], reels: [], groups: [], pages: [], friendRequests: [], friendships: [], globalMessages: [] };

// تحميل البيانات
function loadData() {
    if (fs.existsSync(DATA_FILE)) {
        try {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            db = JSON.parse(data);
            console.log('Data loaded successfully');
        } catch (err) {
            console.error('Error loading data:', err);
        }
    }
}

// حفظ البيانات
function saveData() {
    // نستخدم الكتابة غير المتزامنة لمنع توقف السيرفر
    fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2), (err) => {
        if (err) console.error('Save error:', err);
    });
}

// دالة مساعدة لحفظ الملفات (صور أو فيديو) من Base64 إلى ملف حقيقي
function saveBase64ToFile(base64Data, prefix = 'file') {
    try {
        // استخراج نوع الملف والبيانات
        const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) {
            return null;
        }
        
        const type = matches[1];
        const buffer = Buffer.from(matches[2], 'base64');
        const extension = type.split('/')[1] || 'bin';
        const filename = `${prefix}_${Date.now()}.${extension}`;
        const filepath = path.join(UPLOAD_DIR, filename);

        fs.writeFileSync(filepath, buffer); // الحفظ في القرص
        return `/uploads/${filename}`; // إرجاع الرابط
    } catch (e) {
        console.error("Error saving file:", e);
        return null;
    }
}

loadData();
let connectedSockets = {}; 

io.on('connection', (socket) => {
    
    // --- Auth ---
    socket.on('register', (data) => {
        if (db.users.find(u => u.email === data.email)) {
            socket.emit('auth_error', 'البريد مسجل');
        } else {
            const newUser = { ...data, id: Date.now(), avatar: `https://ui-avatars.com/api/?name=${data.name}&background=random`, bio: 'مستخدم جديد' };
            db.users.push(newUser);
            saveData();
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
            updateFriendsList(user.email);
            checkFriendRequests(user.email);
        } else {
            socket.emit('auth_error', 'بيانات خاطئة');
        }
    });

    // --- Profile Update (مع حفظ الصورة كملف) ---
    socket.on('update_profile', (data) => {
        const idx = db.users.findIndex(u => u.email === data.email);
        if(idx !== -1) {
            db.users[idx].name = data.name;
            db.users[idx].bio = data.bio;
            
            // إذا تم رفع صورة جديدة، نحفظها كملف لتقليل حجم الـ JSON
            if(data.avatar && data.avatar.startsWith('data:image')) {
                const fileUrl = saveBase64ToFile(data.avatar, 'avatar');
                if(fileUrl) db.users[idx].avatar = fileUrl;
            } else if (data.avatar) {
                // إذا كان الرابط نصي عادي (قديم)
                db.users[idx].avatar = data.avatar;
            }

            // تحديث المنشورات القديمة
            db.posts.forEach(p => { if(p.email === data.email) { p.author = data.name; p.avatar = db.users[idx].avatar; } });
            db.reels.forEach(r => { if(r.email === data.email) { r.author = data.name; r.avatar = db.users[idx].avatar; } });

            saveData();
            socket.emit('profile_updated_success', db.users[idx]);
        }
    });
    
    socket.on('get_user_posts', (email) => {
        socket.emit('load_profile_posts', db.posts.filter(p => p.email === email));
    });

    // --- New Post (مع حفظ الصورة كملف) ---
    socket.on('new_post', (data) => {
        let mediaUrl = null;
        if (data.media && data.media.startsWith('data:')) {
            mediaUrl = saveBase64ToFile(data.media, 'post_img');
        }

        const newPost = { 
            ...data, 
            id: Date.now(), 
            media: mediaUrl, // نحفظ الرابط فقط
            likes: [], comments: [], date: new Date().toISOString() 
        };
        
        db.posts.unshift(newPost);
        saveData();
        io.emit('receive_post', newPost);
        socket.emit('upload_complete');
    });

    // --- New Reel (مع حفظ الفيديو كملف - الحل لمشكلة التجمد) ---
    socket.on('new_reel', (data) => {
        // data.videoBase64 هو الملف الضخم
        let videoUrl = null;
        
        if (data.videoBase64) {
            videoUrl = saveBase64ToFile(data.videoBase64, 'reel');
        }

        if (videoUrl) {
            const reel = { 
                id: Date.now(),
                url: videoUrl, // نحفظ الرابط فقط!
                desc: data.desc,
                author: data.author,
                avatar: data.avatar,
                email: data.email, // مهم لتحديث البروفايل لاحقاً
                likes: [], comments: [] 
            };
            db.reels.unshift(reel);
            saveData();
            io.emit('receive_reel', { ...reel, videoBase64: null }); // لا نعيد إرسال البيانات الضخمة
            socket.emit('upload_complete');
        } else {
            // حدث خطأ في الحفظ
            socket.emit('upload_complete'); 
        }
    });

    // --- Likes & Comments ---
    socket.on('toggle_like', ({ id, type, userEmail }) => {
        let targetArr = type === 'reel' ? db.reels : db.posts;
        const item = targetArr.find(i => i.id == id);
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
            const newComment = { id: Date.now(), text, userEmail, userName, userAvatar };
            post.comments.push(newComment);
            saveData();
            io.emit('update_comments', { postId, comments: post.comments });
        }
    });

    // --- Groups/Pages/Chat/Friends (نفس المنطق السابق مع الحفظ) ---
    socket.on('create_group', (d) => { 
        const g = { id: 'g'+Date.now(), ...d, members:[d.owner] }; 
        db.groups.push(g); saveData(); io.emit('update_groups', db.groups); socket.emit('group_created_success', g); 
    });
    
    socket.on('create_page', (d) => { 
        const p = { id: 'p'+Date.now(), ...d, followers:[d.owner] }; 
        db.pages.push(p); saveData(); io.emit('update_pages', db.pages); socket.emit('page_created_success', p); 
    });

    socket.on('get_context_posts', ({ context, contextId }) => {
        socket.emit('load_posts', db.posts.filter(p => p.context === context && p.contextId === contextId));
    });

    socket.on('send_global_msg', (data) => {
        let imgUrl = null;
        if(data.image) imgUrl = saveBase64ToFile(data.image, 'chat');
        
        const msg = { ...data, image: imgUrl, id: Date.now(), date: new Date().toISOString() };
        db.globalMessages.push(msg);
        if(db.globalMessages.length > 100) db.globalMessages.shift();
        saveData();
        io.emit('receive_global_msg', msg);
    });

    // Friends Logic
    socket.on('send_friend_request', (d) => {
        if(d.fromEmail !== d.toEmail && !db.friendRequests.find(r => r.from === d.fromEmail && r.to === d.toEmail)) {
            db.friendRequests.push({ from: d.fromEmail, to: d.toEmail });
            saveData();
            if(connectedSockets[d.toEmail]) io.to(connectedSockets[d.toEmail]).emit('new_req');
            checkFriendRequests(d.toEmail);
        }
    });
    socket.on('respond_friend_request', (d) => {
        db.friendRequests = db.friendRequests.filter(req => !(req.to === d.userEmail && req.from === d.requesterEmail));
        if(d.accept) {
            db.friendships.push({ user1: d.userEmail, user2: d.requesterEmail });
            updateFriendsList(d.userEmail); updateFriendsList(d.requesterEmail);
        }
        saveData(); checkFriendRequests(d.userEmail);
    });

    function updateFriendsList(email) {
        const fs = db.friendships.filter(f => f.user1 === email || f.user2 === email);
        const emails = fs.map(f => f.user1 === email ? f.user2 : f.user1);
        const fData = db.users.filter(u => emails.includes(u.email)).map(u => ({
            name: u.name, email: u.email, avatar: u.avatar, isOnline: !!connectedSockets[u.email]
        }));
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
