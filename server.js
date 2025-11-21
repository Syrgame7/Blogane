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

// --- إعداد الملفات (Robust File System) ---
const DATA_FILE = 'database.json';
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

// التأكد من وجود المجلدات
try {
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
} catch (e) { console.error("FS Error:", e); }

// البنية الأساسية لقاعدة البيانات
const defaultDB = { 
    users: [], posts: [], reels: [], groups: [], pages: [], 
    friendRequests: [], friendships: [], globalMessages: [], privateMessages: [] 
};

let db = { ...defaultDB };

// --- تحميل البيانات بشكل آمن جداً ---
function loadData() {
    if (fs.existsSync(DATA_FILE)) {
        try {
            const raw = fs.readFileSync(DATA_FILE, 'utf8');
            const loaded = JSON.parse(raw);
            // دمج البيانات المحملة مع البنية الأساسية لضمان عدم فقدان أي مصفوفة
            db = { ...defaultDB, ...loaded };
            
            // تأكيد إضافي: تأكد أن كل خاصية هي مصفوفة لتجنب خطأ filter
            for (let key in defaultDB) {
                if (!Array.isArray(db[key])) db[key] = [];
            }
            console.log("Database loaded successfully.");
        } catch (e) {
            console.error("Database corruption detected. Resetting to defaults.", e);
            db = { ...defaultDB }; // إعادة تعيين في حال التلف لتجنب التوقف
        }
    } else {
        saveData(); // إنشاء الملف إذا لم يكن موجوداً
    }
}

// استدعاء التحميل فوراً
loadData();

function saveData() {
    try {
        // تنظيف بسيط لتوفير المساحة
        if (db.globalMessages && db.globalMessages.length > 200) db.globalMessages = db.globalMessages.slice(-200);
        
        // الكتابة المتزامنة أكثر أماناً لمنع تداخل البيانات في هذا النوع من التطبيقات البسيطة
        fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    } catch (e) {
        console.error("Save Failed:", e);
    }
}

function saveBase64ToFile(base64Data, prefix) {
    try {
        if (!base64Data || typeof base64Data !== 'string') return null;
        const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) return null;
        const ext = matches[1].split('/')[1] || 'bin';
        const filename = `${prefix}_${Date.now()}.${ext}`;
        fs.writeFileSync(path.join(UPLOAD_DIR, filename), Buffer.from(matches[2], 'base64'));
        return `/uploads/${filename}`;
    } catch (e) { return null; }
}

// --- معالجة الأخطاء العامة لمنع توقف السيرفر ---
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    // لا نوقف السيرفر، فقط نسجل الخطأ
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
});

// --- Keep-Alive ---
app.get('/ping', (req, res) => res.status(200).send('Pong'));
setInterval(() => {
    try {
        http.get(`http://127.0.0.1:${process.env.PORT || 3000}/ping`).on('error', () => {});
    } catch(e) {}
}, 4 * 60 * 1000);


// --- بوتات ذكية (Smart Bots) ---
const botNames = ["Sarah AI", "Gamer Bot", "Dr. Bot", "Chef Bot"];
const botAvatars = [
    "https://ui-avatars.com/api/?name=Sarah&background=ff00ff&color=fff",
    "https://ui-avatars.com/api/?name=Gamer&background=0000ff&color=fff",
    "https://ui-avatars.com/api/?name=Dr&background=ff0000&color=fff",
    "https://ui-avatars.com/api/?name=Chef&background=00ff00&color=fff"
];

// التأكد من وجود البوتات
botNames.forEach((name, i) => {
    const email = `bot${i}@blogane.com`;
    // نستخدم التحقق الآمن (?.)
    if (!db.users?.find(u => u.email === email)) {
        db.users.push({
            id: Date.now() + i, name, email, password: 'bot', 
            avatar: botAvatars[i], bio: 'AI Assistant', isBot: true
        });
    }
});

// محرك تفاعل البوتات
setInterval(() => {
    try {
        if (!db.posts) db.posts = []; // حماية إضافية
        
        const action = Math.random();
        const botIdx = Math.floor(Math.random() * botNames.length);
        const bot = { name: botNames[botIdx], email: `bot${botIdx}@blogane.com`, avatar: botAvatars[botIdx] };

        if (action < 0.2) { // نشر بوست
            const texts = ["مساء الخير يا أصدقاء 👋", "تطبيق رائع جداً!", "هل من جديد؟", "أحب هذا المكان ❤️"];
            const newPost = {
                id: Date.now(), author: bot.name, email: bot.email, avatar: bot.avatar,
                content: texts[Math.floor(Math.random()*texts.length)], media: null,
                likes: [], comments: [], date: new Date().toISOString(), context: 'general', contextId: null
            };
            db.posts.unshift(newPost);
            io.emit('receive_post', newPost);
            saveData();
        } 
        else if (action < 0.5 && db.posts.length > 0) { // إعجاب
            const p = db.posts[Math.floor(Math.random()*db.posts.length)];
            if (p && p.likes && !p.likes.includes(bot.email)) { // تحقق آمن
                p.likes.push(bot.email);
                io.emit('update_likes', {id: p.id, type: 'post', likes: p.likes});
                saveData();
            }
        }
    } catch (e) { console.error("Bot Loop Error:", e); }
}, 15000); // كل 15 ثانية


// --- Socket Logic ---
let connectedSockets = {}; 

io.on('connection', (socket) => {
    
    // Auth
    socket.on('register', (d) => {
        if (db.users.find(u => u.email === d.email)) socket.emit('auth_error', 'البريد مسجل');
        else {
            const u = { ...d, id: Date.now(), avatar: `https://ui-avatars.com/api/?name=${d.name}&background=random`, bio: 'مستخدم جديد' };
            db.users.push(u); saveData(); socket.emit('auth_success', u);
        }
    });

    socket.on('login', (d) => {
        const u = db.users.find(u => u.email === d.email && u.password === d.password);
        if (u) {
            connectedSockets[u.email] = socket.id;
            socket.emit('auth_success', u);
            // نرسل مصفوفات فارغة في حال عدم وجود بيانات لتجنب الأخطاء في الواجهة
            socket.emit('init_data', { 
                groups: db.groups || [], 
                pages: db.pages || [], 
                reels: db.reels || [], 
                globalMessages: db.globalMessages || [] 
            });
            // التحقق الآمن قبل الفلترة
            const posts = (db.posts || []).filter(p => p.context === 'general');
            socket.emit('load_posts', posts);
            
            updateFriendsList(u.email);
            checkFriendRequests(u.email);
        } else { socket.emit('auth_error', 'بيانات خاطئة'); }
    });

    // Posts
    socket.on('new_post', (d) => {
        let url = null; if(d.media && d.media.startsWith('data:')) url = saveBase64ToFile(d.media, 'post');
        const p = { ...d, id: Date.now(), media: url, likes: [], comments: [], date: new Date().toISOString() };
        db.posts.unshift(p); saveData(); io.emit('receive_post', p); socket.emit('upload_complete');
    });

    socket.on('toggle_like', ({id, type, userEmail}) => {
        // استخدام التحقق الآمن ?.
        let collection = type === 'reel' ? db.reels : db.posts;
        let item = collection?.find(i => i.id == id);
        
        if(item) {
            if(!item.likes) item.likes = []; // إصلاح فوري للمصفوفة إذا كانت مفقودة
            if(item.likes.includes(userEmail)) item.likes = item.likes.filter(e => e !== userEmail);
            else item.likes.push(userEmail);
            saveData(); 
            io.emit('update_likes', {id, type, likes: item.likes});
        }
    });

    socket.on('add_comment', (d) => {
        const p = db.posts?.find(x => x.id == d.postId);
        if(p) {
            if(!p.comments) p.comments = [];
            p.comments.push({id:Date.now(), ...d});
            saveData();
            io.emit('update_comments', {postId: d.postId, comments: p.comments});
        }
    });

    // Chat & AI
    socket.on('send_global_msg', (d) => {
        let url = d.image ? saveBase64ToFile(d.image, 'chat') : null;
        const m = { ...d, image: url, id: Date.now(), date: new Date().toISOString() };
        db.globalMessages.push(m); saveData(); io.emit('receive_global_msg', m);
    });

    socket.on('send_ai_msg', (t) => {
        // رد ذكي بسيط
        let reply = "أنا ذكاء اصطناعي، كيف أساعدك؟";
        if(t.includes("مرحبا")) reply = "أهلاً بك في Blogane!";
        if(t.includes("نكتة")) reply = "مرة قمر عمل رجيم بقى هلال 😂";
        setTimeout(() => socket.emit('receive_ai_msg', {text: reply}), 800);
    });

    socket.on('send_private_msg', (d) => {
        const m = { ...d, id: Date.now(), date: new Date().toISOString() };
        db.privateMessages.push(m); saveData();
        socket.emit('receive_private_msg', m);
        if(connectedSockets[d.to]) io.to(connectedSockets[d.to]).emit('receive_private_msg', m);
    });

    socket.on('get_private_msgs', ({u1, u2}) => {
        const msgs = (db.privateMessages || []).filter(m => (m.from===u1&&m.to===u2) || (m.from===u2&&m.to===u1));
        socket.emit('load_private_msgs', msgs);
    });

    // Context & Others
    socket.on('create_group', (d) => { const g={id:'g'+Date.now(),...d,members:[d.owner]}; db.groups.push(g); saveData(); io.emit('update_groups', db.groups); socket.emit('group_created_success', g); });
    socket.on('create_page', (d) => { const p={id:'p'+Date.now(),...d,followers:[d.owner]}; db.pages.push(p); saveData(); io.emit('update_pages', db.pages); socket.emit('page_created_success', p); });
    
    socket.on('delete_group', ({groupId, email}) => { 
        const i = db.groups.findIndex(g=>g.id===groupId); 
        if(i!==-1 && db.groups[i].owner===email){ db.groups.splice(i,1); saveData(); io.emit('update_groups', db.groups); socket.emit('delete_success'); } 
    });
    
    socket.on('delete_page', ({pageId, email}) => { 
        const i = db.pages.findIndex(p=>p.id===pageId); 
        if(i!==-1 && db.pages[i].owner===email){ db.pages.splice(i,1); saveData(); io.emit('update_pages', db.pages); socket.emit('delete_success'); } 
    });

    socket.on('get_context_posts', ({context, contextId}) => { 
        // تحقق آمن
        const posts = (db.posts || []).filter(p => p.context === context && p.contextId === contextId);
        socket.emit('load_posts', posts); 
    });

    socket.on('update_profile', (d) => { 
        const i=db.users.findIndex(u=>u.email===d.email); 
        if(i!==-1){ 
            db.users[i].name=d.name; db.users[i].bio=d.bio; 
            if(d.avatar&&d.avatar.startsWith('data:')) db.users[i].avatar=saveBase64ToFile(d.avatar,'avatar'); 
            saveData(); socket.emit('profile_updated_success', db.users[i]); 
        } 
    });
    
    socket.on('get_profile_info', (e) => { 
        const u=db.users.find(x=>x.email===e); 
        if(u) socket.emit('open_profile_view', {user:u, posts:(db.posts||[]).filter(p=>p.email===e)}); 
    });

    // Friends Logic
    socket.on('send_friend_request', (d) => {
        if(d.from!==d.to && !db.friendRequests.find(r=>r.from===d.from && r.to===d.to)) {
            db.friendRequests.push({from:d.from, to:d.to});
            saveData();
            if(connectedSockets[d.to]) io.to(connectedSockets[d.to]).emit('new_req');
            checkFriendRequests(d.to);
        }
    });

    socket.on('respond_friend_request', (d) => {
        db.friendRequests = db.friendRequests.filter(r=>!(r.to===d.userEmail && r.from===d.requesterEmail));
        if(d.accept) {
            db.friendships.push({user1:d.userEmail, user2:d.requesterEmail});
            updateFriendsList(d.userEmail);
            updateFriendsList(d.requesterEmail);
        }
        saveData();
        checkFriendRequests(d.userEmail);
    });

    function updateFriendsList(email) {
        const fs = (db.friendships || []).filter(f => f.user1 === email || f.user2 === email);
        const emails = fs.map(f => f.user1 === email ? f.user2 : f.user1);
        const fData = db.users.filter(u => emails.includes(u.email)).map(u => ({ 
            name: u.name, email: u.email, avatar: u.avatar, isOnline: !!connectedSockets[u.email] 
        }));
        if(connectedSockets[email]) io.to(connectedSockets[email]).emit('update_friends', fData);
    }

    function checkFriendRequests(email) {
        const reqs = (db.friendRequests || []).filter(r => r.to === email);
        const data = reqs.map(r => { 
            const s = db.users.find(u=>u.email===r.from); 
            return {email:r.from, name:s?s.name:'Unknown', avatar:s?s.avatar:''}; 
        });
        if(connectedSockets[email]) io.to(connectedSockets[email]).emit('update_requests', data);
    }

    // Reels
    socket.on('new_reel', (d) => {
        let url = saveBase64ToFile(d.videoBase64, 'reel');
        if(url) {
            const r = {id:Date.now(), url, desc:d.desc, author:d.author, avatar:d.avatar, email:d.email, likes:[], comments:[]};
            db.reels.unshift(r); saveData(); io.emit('receive_reel', {...r, videoBase64:null}); socket.emit('upload_complete');
        }
    });
    // دعم رفع الريلز المجزأ (Chunked)
    socket.on('upload_reel_start', ({ name }) => {
        const fileName = `reel_${Date.now()}_${Math.floor(Math.random()*1000)}${path.extname(name)}`;
        fs.open(path.join(UPLOAD_DIR, fileName), 'w', (err, fd) => {
            if(!err) fs.close(fd, () => socket.emit('upload_ready', { tempFileName: fileName }));
        });
    });
    socket.on('upload_reel_chunk', ({ fileName, data }) => { 
        try { fs.appendFileSync(path.join(UPLOAD_DIR, fileName), data); } catch(e){} 
    });
    socket.on('upload_reel_end', (d) => {
        const r = { id: Date.now(), url: `/uploads/${d.fileName}`, desc:d.desc, author:d.author, avatar:d.avatar, email:d.email, likes:[], comments:[] };
        db.reels.unshift(r); saveData(); io.emit('receive_reel', r); socket.emit('upload_complete');
    });

    socket.on('disconnect', () => {
        const email = Object.keys(connectedSockets).find(k => connectedSockets[k] === socket.id);
        if(email) delete connectedSockets[email];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Robust Server running on ${PORT}`));
