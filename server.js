const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
// زدنا الحجم المسموح به لرفع الصور (5 ميجا)
const io = new Server(server, {
    maxHttpBufferSize: 5 * 1024 * 1024 
});

app.use(express.static(path.join(__dirname, 'public')));

// --- بيانات الذاكرة ---
let users = [];
let posts = []; 
let reels = []; // مصفوفة الريلز
let groups = [
    { id: 'g1', name: 'مجتمع المبرمجين', description: 'للنقاشات التقنية', members: [], owner: 'System' }
]; 
let pages = [
    { id: 'p1', name: 'أخبار العالم', followers: [], owner: 'System' }
];
let friendRequests = [];
let friendships = [];
let globalMessages = []; // رسائل الشات العام
let connectedSockets = {}; 

io.on('connection', (socket) => {
    
    // --- المصادقة ---
    socket.on('register', (data) => {
        if (users.find(u => u.email === data.email)) {
            socket.emit('auth_error', 'البريد مسجل بالفعل');
        } else {
            const newUser = { ...data, id: Date.now(), avatar: `https://ui-avatars.com/api/?name=${data.name}&background=random`, bio: 'مستخدم جديد' };
            users.push(newUser);
            socket.emit('auth_success', newUser);
        }
    });

    socket.on('login', (data) => {
        const user = users.find(u => u.email === data.email && u.password === data.password);
        if (user) {
            connectedSockets[user.email] = socket.id;
            socket.emit('auth_success', user);
            socket.emit('init_data', { groups, pages, reels, globalMessages });
            socket.emit('load_posts', posts.filter(p => p.context === 'general'));
            updateFriendsList(user.email);
            checkFriendRequests(user.email);
        } else {
            socket.emit('auth_error', 'بيانات خاطئة');
        }
    });

    // --- المنشورات والصور ---
    socket.on('new_post', (data) => {
        const newPost = {
            ...data, id: Date.now(), likes: [], comments: [], date: new Date().toISOString()
        };
        posts.unshift(newPost);
        io.emit('receive_post', newPost);
    });

    // --- الريلز (Reels) ---
    socket.on('new_reel', (data) => {
        const reel = { ...data, id: Date.now(), likes: [] };
        reels.unshift(reel); // الأحدث في البداية
        io.emit('receive_reel', reel);
    });

    // --- المجموعات والصفحات ---
    socket.on('create_group', ({ name, desc, owner }) => {
        const newGroup = { id: 'g' + Date.now(), name, description: desc, members: [owner], owner };
        groups.push(newGroup);
        io.emit('update_groups', groups);
        // إرجاع الآيدي للمستخدم ليدخل مباشرة
        socket.emit('group_created_success', newGroup);
    });

    socket.on('create_page', ({ name, owner }) => {
        const newPage = { id: 'p' + Date.now(), name, followers: [owner], owner };
        pages.push(newPage);
        io.emit('update_pages', pages);
        socket.emit('page_created_success', newPage);
    });

    socket.on('join_group', ({ groupId, email }) => {
        const group = groups.find(g => g.id === groupId);
        if(group && !group.members.includes(email)) {
            group.members.push(email);
            io.emit('update_groups', groups);
        }
    });

    socket.on('get_context_posts', ({ context, contextId }) => {
        const filteredPosts = posts.filter(p => p.context === context && p.contextId === contextId);
        socket.emit('load_posts', filteredPosts);
    });

    // --- الدردشة (عامة وخاصة) ---
    socket.on('send_global_msg', (data) => {
        const msg = { ...data, id: Date.now() };
        globalMessages.push(msg);
        if(globalMessages.length > 50) globalMessages.shift(); // الاحتفاظ بآخر 50 رسالة فقط
        io.emit('receive_global_msg', msg);
    });

    socket.on('private_message', (data) => {
        const targetSocket = connectedSockets[data.to];
        if (targetSocket) io.to(targetSocket).emit('receive_private_message', data);
        socket.emit('receive_private_message', data);
    });

    // --- الأصدقاء ---
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
