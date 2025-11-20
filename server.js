const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// السماح برفع بيانات كبيرة (صور) حتى 10 ميجا
const io = new Server(server, {
    maxHttpBufferSize: 10 * 1024 * 1024 
});

app.use(express.static(path.join(__dirname, 'public')));

// --- قاعدة البيانات المؤقتة ---
let users = [];
let posts = []; 
let reels = [];
let groups = [{ id: 'g1', name: 'مجتمع المطورين', description: 'للنقاشات البرمجية', members: [], owner: 'System' }]; 
let pages = [{ id: 'p1', name: 'أخبار التقنية', followers: [], owner: 'System' }];
let friendRequests = [];
let friendships = [];
let globalMessages = []; // { id, text, image, author, email, avatar, date }
let connectedSockets = {}; 

io.on('connection', (socket) => {
    
    // --- المصادقة ---
    socket.on('register', (data) => {
        if (users.find(u => u.email === data.email)) {
            socket.emit('auth_error', 'البريد مسجل بالفعل');
        } else {
            const newUser = { 
                ...data, 
                id: Date.now(), 
                avatar: `https://ui-avatars.com/api/?name=${data.name}&background=random`, 
                bio: 'مستخدم جديد في التطبيق' 
            };
            users.push(newUser);
            socket.emit('auth_success', newUser);
        }
    });

    socket.on('login', (data) => {
        const user = users.find(u => u.email === data.email && u.password === data.password);
        if (user) {
            connectedSockets[user.email] = socket.id;
            socket.emit('auth_success', user);
            // إرسال البيانات الأولية
            socket.emit('init_data', { groups, pages, reels, globalMessages });
            socket.emit('load_posts', posts.filter(p => p.context === 'general'));
            
            updateFriendsList(user.email);
            checkFriendRequests(user.email);
        } else {
            socket.emit('auth_error', 'بيانات خاطئة');
        }
    });

    // --- الملف الشخصي (تحديث) ---
    socket.on('update_profile', (data) => {
        // data: { email, name, bio, avatar (base64) }
        const userIndex = users.findIndex(u => u.email === data.email);
        if(userIndex !== -1) {
            users[userIndex].name = data.name;
            users[userIndex].bio = data.bio;
            if(data.avatar) users[userIndex].avatar = data.avatar;
            
            // تحديث بيانات المستخدم في المنشورات والرسائل القديمة (اختياري لتحسين العرض)
            // سنكتفي بتحديث المستخدم نفسه وإرجاعه
            socket.emit('profile_updated_success', users[userIndex]);
        }
    });

    socket.on('get_user_posts', (email) => {
        const userPosts = posts.filter(p => p.email === email);
        socket.emit('load_profile_posts', userPosts);
    });

    // --- المنشورات والتفاعل ---
    socket.on('new_post', (data) => {
        const newPost = {
            ...data, id: Date.now(), likes: [], comments: [], date: new Date().toISOString()
        };
        posts.unshift(newPost);
        io.emit('receive_post', newPost);
    });

    // الإعجاب (يعمل للمنشورات والريلز)
    socket.on('toggle_like', ({ id, type, userEmail }) => {
        let targetArr = type === 'reel' ? reels : posts;
        const item = targetArr.find(i => i.id == id);
        
        if(item) {
            if(item.likes.includes(userEmail)) {
                item.likes = item.likes.filter(e => e !== userEmail); // إزالة اللايك
            } else {
                item.likes.push(userEmail); // إضافة لايك
            }
            // إعلام الجميع بالتحديث
            io.emit('update_likes', { id, type, likes: item.likes });
        }
    });

    // التعليقات
    socket.on('add_comment', ({ postId, text, userEmail, userName, userAvatar }) => {
        const post = posts.find(p => p.id == postId);
        if(post) {
            const newComment = {
                id: Date.now(), text, userEmail, userName, userAvatar, date: new Date().toISOString()
            };
            post.comments.push(newComment);
            io.emit('update_comments', { postId, comments: post.comments });
        }
    });

    // --- الريلز ---
    socket.on('new_reel', (data) => {
        const reel = { ...data, id: Date.now(), likes: [], comments: [] };
        reels.unshift(reel);
        io.emit('receive_reel', reel);
    });

    // --- المجموعات والصفحات ---
    socket.on('create_group', ({ name, desc, owner }) => {
        const newGroup = { id: 'g' + Date.now(), name, description: desc, members: [owner], owner };
        groups.push(newGroup);
        io.emit('update_groups', groups);
        socket.emit('group_created_success', newGroup);
    });

    socket.on('create_page', ({ name, owner }) => {
        const newPage = { id: 'p' + Date.now(), name, followers: [owner], owner };
        pages.push(newPage);
        io.emit('update_pages', pages);
        socket.emit('page_created_success', newPage);
    });

    socket.on('get_context_posts', ({ context, contextId }) => {
        const filteredPosts = posts.filter(p => p.context === context && p.contextId === contextId);
        socket.emit('load_posts', filteredPosts);
    });

    // --- الدردشة العامة (صور ونصوص) ---
    socket.on('send_global_msg', (data) => {
        // data: { text, image, author, email, avatar }
        const msg = { ...data, id: Date.now(), date: new Date().toISOString() };
        globalMessages.push(msg);
        if(globalMessages.length > 100) globalMessages.shift();
        io.emit('receive_global_msg', msg);
    });

    // --- الأصدقاء والخاص ---
    socket.on('send_friend_request', (data) => {
        if (data.fromEmail === data.toEmail) return;
        if (!friendRequests.find(r => r.from === data.fromEmail && r.to === data.toEmail)) {
            friendRequests.push({ from: data.fromEmail, to: data.toEmail });
            const targetSocket = connectedSockets[data.toEmail];
            if (targetSocket) io.to(targetSocket).emit('new_req');
            checkFriendRequests(data.toEmail);
        }
    });

    socket.on('respond_friend_request', (data) => {
        friendRequests = friendRequests.filter(req => !(req.to === data.userEmail && req.from === data.requesterEmail));
        if (data.accept) {
            friendships.push({ user1: data.userEmail, user2: data.requesterEmail });
            updateFriendsList(data.userEmail);
            updateFriendsList(data.requesterEmail);
        }
        checkFriendRequests(data.userEmail);
    });

    socket.on('private_message', (data) => {
        const targetSocket = connectedSockets[data.to];
        if (targetSocket) io.to(targetSocket).emit('receive_private_message', data);
        socket.emit('receive_private_message', data);
    });

    // الدوال المساعدة
    function updateFriendsList(email) {
        const myFriendships = friendships.filter(f => f.user1 === email || f.user2 === email);
        const friendsEmails = myFriendships.map(f => f.user1 === email ? f.user2 : f.user1);
        const friendsData = users.filter(u => friendsEmails.includes(u.email)).map(u => ({
            name: u.name, email: u.email, avatar: u.avatar, isOnline: !!connectedSockets[u.email]
        }));
        const sockId = connectedSockets[email];
        if (sockId) io.to(sockId).emit('update_friends', friendsData);
    }

    function checkFriendRequests(email) {
        const myRequests = friendRequests.filter(req => req.to === email);
        const sockId = connectedSockets[email];
        const reqsData = myRequests.map(req => {
            const sender = users.find(u => u.email === req.from);
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
server.listen(PORT, () => console.log(`Blogane Server Running on port ${PORT}`));
