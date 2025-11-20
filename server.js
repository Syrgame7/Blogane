const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// تقديم ملفات الواجهة
app.use(express.static(path.join(__dirname, 'public')));

// --- قاعدة بيانات في الذاكرة (لأغراض العرض) ---
// ملاحظة: عند إعادة تشغيل السيرفر ستمسح البيانات. لحفظ دائم تحتاج MongoDB.
let users = []; 
let posts = [];
let friendRequests = []; // { from: email, to: email }
let friendships = []; // { user1: email, user2: email }
let connectedSockets = {}; // ربط الإيميل بـ Socket ID

io.on('connection', (socket) => {
    console.log('مستخدم متصل:', socket.id);

    // --- 1. تسجيل الدخول والتسجيل ---
    socket.on('register', (data) => {
        const exists = users.find(u => u.email === data.email);
        if (exists) {
            socket.emit('auth_error', 'البريد الإلكتروني مسجل مسبقاً');
        } else {
            const newUser = { ...data, id: Date.now(), avatar: `https://ui-avatars.com/api/?name=${data.name}&background=random` };
            users.push(newUser);
            socket.emit('auth_success', newUser);
        }
    });

    socket.on('login', (data) => {
        const user = users.find(u => u.email === data.email && u.password === data.password);
        if (user) {
            connectedSockets[user.email] = socket.id; // ربط المستخدم بالاتصال الحالي
            socket.emit('auth_success', user);
            
            // إرسال البيانات الأولية
            socket.emit('load_posts', posts);
            updateFriendsList(user.email);
            checkFriendRequests(user.email);
            
            // إخبار الأصدقاء أني أصبحت "أونلاين"
            broadcastStatus(user.email, true);
        } else {
            socket.emit('auth_error', 'بيانات الدخول غير صحيحة');
        }
    });

    // --- 2. المنشورات ---
    socket.on('new_post', (postData) => {
        const post = {
            ...postData,
            id: Date.now(),
            likes: 0,
            date: new Date().toISOString()
        };
        posts.unshift(post);
        io.emit('receive_post', post); // نشر للجميع
    });

    // --- 3. طلبات الصداقة ---
    socket.on('send_friend_request', (data) => {
        // data = { fromEmail, toEmail }
        if (data.fromEmail === data.toEmail) return;
        
        // التحقق هل هم أصدقاء أصلاً؟
        const isFriend = friendships.find(f => (f.user1 == data.fromEmail && f.user2 == data.toEmail) || (f.user1 == data.toEmail && f.user2 == data.fromEmail));
        if (isFriend) return;

        friendRequests.push({ from: data.fromEmail, to: data.toEmail });
        
        // إشعار المستقبل فوراً إذا كان متصلاً
        const targetSocket = connectedSockets[data.toEmail];
        if (targetSocket) {
            io.to(targetSocket).emit('new_friend_request', { from: data.fromEmail });
            checkFriendRequests(data.toEmail);
        }
    });

    socket.on('respond_friend_request', (data) => {
        // data = { userEmail, requesterEmail, accept: boolean }
        // حذف الطلب
        friendRequests = friendRequests.filter(req => !(req.to === data.userEmail && req.from === data.requesterEmail));
        
        if (data.accept) {
            friendships.push({ user1: data.userEmail, user2: data.requesterEmail });
            
            // تحديث قائمة الأصدقاء للطرفين
            updateFriendsList(data.userEmail);
            updateFriendsList(data.requesterEmail);
        }
        checkFriendRequests(data.userEmail); // تحديث قائمة الطلبات
    });

    // --- 4. الدردشة الخاصة ---
    socket.on('private_message', (data) => {
        // data = { from, to, content }
        const targetSocket = connectedSockets[data.to];
        if (targetSocket) {
            io.to(targetSocket).emit('receive_private_message', data);
        }
        // إرسال نسخة لي (لأراها في شاشتي)
        socket.emit('receive_private_message', data);
    });

    // --- دوال مساعدة ---
    function updateFriendsList(email) {
        // البحث عن جميع الصداقات
        const myFriendships = friendships.filter(f => f.user1 === email || f.user2 === email);
        const friendsEmails = myFriendships.map(f => f.user1 === email ? f.user2 : f.user1);
        
        // جلب بيانات الأصدقاء
        const friendsData = users.filter(u => friendsEmails.includes(u.email)).map(u => ({
            name: u.name,
            email: u.email,
            avatar: u.avatar,
            isOnline: !!connectedSockets[u.email]
        }));
        
        const sockId = connectedSockets[email];
        if (sockId) io.to(sockId).emit('update_friends', friendsData);
    }

    function checkFriendRequests(email) {
        const myRequests = friendRequests.filter(req => req.to === email);
        const sockId = connectedSockets[email];
        
        // جلب الأسماء
        const requestsWithNames = myRequests.map(req => {
            const sender = users.find(u => u.email === req.from);
            return { email: req.from, name: sender ? sender.name : req.from, avatar: sender.avatar };
        });

        if (sockId) io.to(sockId).emit('update_requests', requestsWithNames);
    }

    function broadcastStatus(email, isOnline) {
        // يمكن تطويرها لإعلام الأصدقاء فقط
    }

    socket.on('disconnect', () => {
        // إزالة المستخدم من قائمة المتصلين
        const email = Object.keys(connectedSockets).find(key => connectedSockets[key] === socket.id);
        if (email) {
            delete connectedSockets[email];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Blogane Server running on port ${PORT}`));
