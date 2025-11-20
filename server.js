const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    maxHttpBufferSize: 1e8 // السماح ببيانات بحجم 100 ميجا (للصور إذا لزم الأمر)
});

app.use(express.static(path.join(__dirname, 'public')));

// --- قاعدة البيانات (في الذاكرة) ---
let users = [];
// posts structure: { id, author, email, avatar, content, mediaType, mediaUrl, date, likes: [], comments: [], context: 'general'|'group'|'page', contextId }
let posts = []; 
let groups = [
    { id: 'g1', name: 'مجتمع المطورين', description: 'نقاشات برمجية', members: [], owner: '' },
    { id: 'g2', name: 'عشاق التصميم', description: 'شارك تصاميمك', members: [], owner: '' }
]; 
let pages = [
    { id: 'p1', name: 'أخبار التكنولوجيا', followers: [] },
    { id: 'p2', name: 'ميمز وضحك', followers: [] }
];
let friendRequests = [];
let friendships = [];
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
                avatar: `https://ui-avatars.com/api/?name=${data.name}&background=random&size=128`,
                bio: 'مستخدم جديد في Blogane'
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
            
            // إرسال البيانات الأساسية
            socket.emit('init_data', { groups, pages });
            
            // إرسال المنشورات العامة فقط في البداية
            const generalPosts = posts.filter(p => p.context === 'general');
            socket.emit('load_posts', generalPosts);
            
            updateFriendsList(user.email);
            checkFriendRequests(user.email);
        } else {
            socket.emit('auth_error', 'بيانات خاطئة');
        }
    });

    // --- تعديل الملف الشخصي ---
    socket.on('update_profile', (newData) => {
        const userIndex = users.findIndex(u => u.email === newData.email);
        if (userIndex !== -1) {
            users[userIndex].name = newData.name;
            users[userIndex].bio = newData.bio;
            users[userIndex].avatar = newData.avatar; // رابط صورة جديد
            
            // تحديث بيانات المستخدم في المنشورات القديمة (اختياري، لكن أفضل للعرض)
            posts.forEach(p => {
                if(p.email === newData.email) {
                    p.author = newData.name;
                    p.avatar = newData.avatar;
                }
            });

            socket.emit('auth_success', users[userIndex]); // تحديث البيانات محلياً
            io.emit('profile_updated', users[userIndex]); // إعلام الجميع (لتحديث التعليقات وغيرها)
        }
    });

    // --- المنشورات والتفاعل ---
    socket.on('new_post', (data) => {
        const newPost = {
            ...data,
            id: Date.now(),
            likes: [], // مصفوفة إيميلات المعجبين
            comments: [],
            date: new Date().toISOString()
        };
        posts.unshift(newPost);
        io.emit('receive_post', newPost);
    });

    socket.on('like_post', ({ postId, userEmail }) => {
        const post = posts.find(p => p.id == postId);
        if(post) {
            if(post.likes.includes(userEmail)) {
                post.likes = post.likes.filter(e => e !== userEmail); // إزالة اللايك
            } else {
                post.likes.push(userEmail); // إضافة لايك
            }
            io.emit('update_post_stats', { postId, likes: post.likes });
        }
    });

    socket.on('comment_post', ({ postId, userEmail, userName, userAvatar, text }) => {
        const post = posts.find(p => p.id == postId);
        if(post) {
            const newComment = {
                id: Date.now(),
                userEmail, userName, userAvatar, text,
                date: new Date().toISOString()
            };
            post.comments.push(newComment);
            io.emit('new_comment', { postId, comment: newComment });
        }
    });

    // --- المجموعات والصفحات ---
    socket.on('create_group', ({ name, desc, owner }) => {
        const newGroup = { id: 'g' + Date.now(), name, description: desc, members: [owner], owner };
        groups.push(newGroup);
        io.emit('update_groups', groups);
    });

    socket.on('create_page', ({ name, owner }) => {
        const newPage = { id: 'p' + Date.now(), name, followers: [owner] };
        pages.push(newPage);
        io.emit('update_pages', pages);
    });

    socket.on('join_group', ({ groupId, email }) => {
        const group = groups.find(g => g.id === groupId);
        if(group && !group.members.includes(email)) {
            group.members.push(email);
            io.emit('update_groups', groups);
        }
    });

    // طلب محتوى خاص (عند دخول مجموعة أو صفحة)
    socket.on('get_context_posts', ({ context, contextId }) => {
        const filteredPosts = posts.filter(p => p.context === context && p.contextId === contextId);
        socket.emit('load_posts', filteredPosts);
    });

    // --- الأصدقاء والدردشة (كما هي) ---
    socket.on('send_friend_request', (data) => {
        if (data.fromEmail === data.toEmail) return;
        // منع التكرار
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

    // --- دوال مساعدة ---
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
        const requestsWithNames = myRequests.map(req => {
            const sender = users.find(u => u.email === req.from);
            return { email: req.from, name: sender ? sender.name : req.from, avatar: sender ? sender.avatar : '' };
        });
        if (sockId) io.to(sockId).emit('update_requests', requestsWithNames);
    }

    socket.on('disconnect', () => {
        const email = Object.keys(connectedSockets).find(key => connectedSockets[key] === socket.id);
        if (email) delete connectedSockets[email];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
