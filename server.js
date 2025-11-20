const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs'); // مكتبة ملفات النظام

const app = express();
const server = http.createServer(app);

// زيادة الحد الأقصى لحجم البيانات (50 ميجا) للسماح برفع الفيديوهات
const io = new Server(server, {
    cors: { origin: "*" },
    maxHttpBufferSize: 50 * 1024 * 1024 
});

app.use(express.static(path.join(__dirname, 'public')));

// --- نظام حفظ البيانات (Database System) ---
const DATA_FILE = 'database.json';

// البيانات الافتراضية
let db = {
    users: [],
    posts: [],
    reels: [],
    groups: [{ id: 'g1', name: 'مجتمع المطورين', description: 'للنقاشات البرمجية', members: [], owner: 'System' }],
    pages: [{ id: 'p1', name: 'أخبار التقنية', followers: [], owner: 'System' }],
    friendRequests: [],
    friendships: [],
    globalMessages: []
};

// دالة تحميل البيانات عند بدء التشغيل
function loadData() {
    if (fs.existsSync(DATA_FILE)) {
        try {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            db = JSON.parse(data);
            console.log('تم استعادة البيانات بنجاح!');
        } catch (err) {
            console.error('خطأ في قراءة قاعدة البيانات:', err);
        }
    }
}

// دالة حفظ البيانات (تستدعى عند أي تغيير)
function saveData() {
    fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2), (err) => {
        if (err) console.error('فشل الحفظ:', err);
    });
}

// تحميل البيانات فور تشغيل السيرفر
loadData();

let connectedSockets = {}; 

io.on('connection', (socket) => {
    
    // --- المصادقة ---
    socket.on('register', (data) => {
        if (db.users.find(u => u.email === data.email)) {
            socket.emit('auth_error', 'البريد مسجل بالفعل');
        } else {
            const newUser = { 
                ...data, 
                id: Date.now(), 
                avatar: `https://ui-avatars.com/api/?name=${data.name}&background=random`, 
                bio: 'مستخدم جديد' 
            };
            db.users.push(newUser);
            saveData(); // حفظ
            socket.emit('auth_success', newUser);
        }
    });

    socket.on('login', (data) => {
        const user = db.users.find(u => u.email === data.email && u.password === data.password);
        if (user) {
            connectedSockets[user.email] = socket.id;
            socket.emit('auth_success', user);
            // إرسال البيانات
            socket.emit('init_data', { 
                groups: db.groups, 
                pages: db.pages, 
                reels: db.reels, 
                globalMessages: db.globalMessages 
            });
            socket.emit('load_posts', db.posts.filter(p => p.context === 'general'));
            
            updateFriendsList(user.email);
            checkFriendRequests(user.email);
        } else {
            socket.emit('auth_error', 'بيانات خاطئة');
        }
    });

    // --- الملف الشخصي ---
    socket.on('update_profile', (data) => {
        const userIndex = db.users.findIndex(u => u.email === data.email);
        if(userIndex !== -1) {
            db.users[userIndex].name = data.name;
            db.users[userIndex].bio = data.bio;
            if(data.avatar) db.users[userIndex].avatar = data.avatar;
            
            // تحديث المنشورات القديمة
            db.posts.forEach(p => {
                if(p.email === data.email) { p.author = data.name; p.avatar = db.users[userIndex].avatar; }
            });
            
            saveData(); // حفظ
            socket.emit('profile_updated_success', db.users[userIndex]);
        }
    });

    socket.on('get_user_posts', (email) => {
        const userPosts = db.posts.filter(p => p.email === email);
        socket.emit('load_profile_posts', userPosts);
    });

    // --- المنشورات ---
    socket.on('new_post', (data) => {
        const newPost = { ...data, id: Date.now(), likes: [], comments: [], date: new Date().toISOString() };
        db.posts.unshift(newPost);
        saveData(); // حفظ
        io.emit('receive_post', newPost);
        socket.emit('upload_complete'); // إشعار للمستخدم بأن النشر تم
    });

    socket.on('toggle_like', ({ id, type, userEmail }) => {
        let targetArr = type === 'reel' ? db.reels : db.posts;
        const item = targetArr.find(i => i.id == id);
        if(item) {
            if(item.likes.includes(userEmail)) item.likes = item.likes.filter(e => e !== userEmail);
            else item.likes.push(userEmail);
            saveData(); // حفظ
            io.emit('update_likes', { id, type, likes: item.likes });
        }
    });

    socket.on('add_comment', ({ postId, text, userEmail, userName, userAvatar }) => {
        const post = db.posts.find(p => p.id == postId);
        if(post) {
            const newComment = { id: Date.now(), text, userEmail, userName, userAvatar };
            post.comments.push(newComment);
            saveData(); // حفظ
            io.emit('update_comments', { postId, comments: post.comments });
        }
    });

    // --- المجموعات والصفحات ---
    socket.on('create_group', ({ name, desc, owner }) => {
        const newGroup = { id: 'g' + Date.now(), name, description: desc, members: [owner], owner };
        db.groups.push(newGroup);
        saveData();
        io.emit('update_groups', db.groups);
        socket.emit('group_created_success', newGroup);
    });

    socket.on('create_page', ({ name, owner }) => {
        const newPage = { id: 'p' + Date.now(), name, followers: [owner], owner };
        db.pages.push(newPage);
        saveData();
        io.emit('update_pages', db.pages);
        socket.emit('page_created_success', newPage);
    });

    socket.on('get_context_posts', ({ context, contextId }) => {
        const filteredPosts = db.posts.filter(p => p.context === context && p.contextId === contextId);
        socket.emit('load_posts', filteredPosts);
    });

    // --- الريلز (فيديو) ---
    socket.on('new_reel', (data) => {
        // data contains { videoBase64, desc, author, avatar }
        const reel = { ...data, id: Date.now(), likes: [], comments: [] };
        db.reels.unshift(reel);
        saveData();
        io.emit('receive_reel', reel);
        socket.emit('upload_complete'); // إشعار اكتمال الرفع
    });

    // --- الدردشة ---
    socket.on('send_global_msg', (data) => {
        const msg = { ...data, id: Date.now(), date: new Date().toISOString() };
        db.globalMessages.push(msg);
        if(db.globalMessages.length > 100) db.globalMessages.shift();
        saveData();
        io.emit('receive_global_msg', msg);
    });

    // --- الأصدقاء ---
    socket.on('send_friend_request', (data) => { 
        if (data.fromEmail === data.toEmail) return;
        if (!db.friendRequests.find(r => r.from === data.fromEmail && r.to === data.toEmail)) {
            db.friendRequests.push({ from: data.fromEmail, to: data.toEmail });
            saveData();
            const targetSocket = connectedSockets[data.toEmail];
            if (targetSocket) io.to(targetSocket).emit('new_req');
            checkFriendRequests(data.toEmail);
        }
    });

    socket.on('respond_friend_request', (data) => {
        db.friendRequests = db.friendRequests.filter(req => !(req.to === data.userEmail && req.from === data.requesterEmail));
        if (data.accept) {
            db.friendships.push({ user1: data.userEmail, user2: data.requesterEmail });
            updateFriendsList(data.userEmail);
            updateFriendsList(data.requesterEmail);
        }
        saveData();
        checkFriendRequests(data.userEmail);
    });

    // الدوال المساعدة
    function updateFriendsList(email) {
        const myFriendships = db.friendships.filter(f => f.user1 === email || f.user2 === email);
        const friendsEmails = myFriendships.map(f => f.user1 === email ? f.user2 : f.user1);
        const friendsData = db.users.filter(u => friendsEmails.includes(u.email)).map(u => ({
            name: u.name, email: u.email, avatar: u.avatar, isOnline: !!connectedSockets[u.email]
        }));
        const sockId = connectedSockets[email];
        if (sockId) io.to(sockId).emit('update_friends', friendsData);
    }

    function checkFriendRequests(email) {
        const myRequests = db.friendRequests.filter(req => req.to === email);
        const sockId = connectedSockets[email];
        const reqsData = myRequests.map(req => {
            const sender = db.users.find(u => u.email === req.from);
            return { email: req.from, name: sender ? sender.name : 'Unknown', avatar: sender ? sender.avatar : '' };
        });
        if (sockId) io.to(sockId).emit('update_requests', reqsData);
    }

    socket.on('disconnect', () => {
        const email = Object.keys(connectedSockets).find(key => connectedSockets[key] === socket.id);
        if (email) delete connectedSockets[email];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server Running on port ${PORT} - Persistence Enabled`));
