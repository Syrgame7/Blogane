const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// --- قاعدة البيانات (في الذاكرة) ---
let users = [];
let posts = []; // { id, author, email, avatar, content, date, likes, type: 'general'|'group'|'page', targetId }
let groups = [
    { id: 'g1', name: 'عشاق البرمجة', members: [] },
    { id: 'g2', name: 'تصميم جرافيك', members: [] }
]; 
let pages = [
    { id: 'p1', name: 'أخبار التقنية', likes: 0 },
    { id: 'p2', name: 'ضحك وفرفشة', likes: 0 }
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
            const newUser = { ...data, id: Date.now(), avatar: `https://ui-avatars.com/api/?name=${data.name}&background=random&size=128` };
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
            socket.emit('init_data', { groups, pages });
            socket.emit('load_posts', posts.filter(p => p.type === 'general'));
            
            updateFriendsList(user.email);
            checkFriendRequests(user.email);
        } else {
            socket.emit('auth_error', 'بيانات خاطئة');
        }
    });

    // --- المنشورات ---
    socket.on('new_post', (data) => {
        const newPost = {
            ...data,
            id: Date.now(),
            likes: 0,
            date: new Date().toISOString()
        };
        posts.unshift(newPost);
        
        // إذا كان منشور عام، أرسله للكل
        if(data.type === 'general') {
            io.emit('receive_post', newPost);
        } 
        // إذا كان لمجموعة، أرسله فقط للأعضاء (هنا للتبسيط سنرسله للكل ولكن الفلترة في الواجهة)
        else {
            io.emit('receive_post', newPost); 
        }
    });

    // --- البروفايل ---
    socket.on('get_profile', (email) => {
        const user = users.find(u => u.email === email);
        if(user) {
            const userPosts = posts.filter(p => p.email === email && p.type === 'general');
            socket.emit('open_profile', { user, posts: userPosts });
        }
    });

    // --- المجموعات والصفحات ---
    socket.on('create_group', (name) => {
        const newGroup = { id: 'g' + Date.now(), name, members: [] };
        groups.push(newGroup);
        io.emit('update_groups', groups);
    });

    socket.on('like_page', (pageId) => {
        const page = pages.find(p => p.id === pageId);
        if(page) {
            page.likes++;
            io.emit('update_pages', pages);
        }
    });

    // --- نظام الأصدقاء والدردشة (كما هو) ---
    socket.on('send_friend_request', (data) => {
        if (data.fromEmail === data.toEmail) return;
        friendRequests.push({ from: data.fromEmail, to: data.toEmail });
        const targetSocket = connectedSockets[data.toEmail];
        if (targetSocket) io.to(targetSocket).emit('new_req');
        checkFriendRequests(data.toEmail);
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
