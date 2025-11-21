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

// --- إدارة البيانات والملفات ---
const DATA_FILE = 'database.json';
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

try { if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) {}

// البنية الأساسية
const defaultDB = { users: [], posts: [], reels: [], groups: [], pages: [], friendRequests: [], friendships: [], globalMessages: [], privateMessages: [] };
let db = { ...defaultDB };

// تحميل البيانات (مع الحفاظ عليها عند إعادة التشغيل)
function loadData() {
    if (fs.existsSync(DATA_FILE)) {
        try {
            const raw = fs.readFileSync(DATA_FILE, 'utf8');
            const loaded = JSON.parse(raw);
            db = { ...defaultDB, ...loaded };
            // إصلاح المصفوفات المفقودة إن وجدت
            for(let key in defaultDB) if(!Array.isArray(db[key])) db[key] = [];
        } catch (e) { console.log("Error loading DB, using default"); }
    } else saveData();
}
loadData();

function saveData() {
    try {
        // تنظيف دوري لتسريع السيرفر (الاحتفاظ بآخر 500 رسالة و 200 منشور)
        if(db.globalMessages.length > 500) db.globalMessages = db.globalMessages.slice(-500);
        if(db.posts.length > 200) db.posts = db.posts.slice(0, 200);
        fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    } catch (e) { console.error("Save Error", e); }
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

// --- محرك الذكاء الاصطناعي (Smart AI Brain) ---
function getAIResponse(text) {
    const t = text.toLowerCase();
    if (t.includes("مرحبا") || t.includes("هلا") || t.includes("سلام")) return "أهلاً بك يا غالي! نورت التطبيق 🌹";
    if (t.includes("حالك") || t.includes("أخبار")) return "أنا نظام ذكي أعمل بكفاءة عالية لخدمتك 🤖";
    if (t.includes("حب") || t.includes("زواج")) return "أنا روبوت لا أملك مشاعر، لكن أتمنى لك السعادة! ❤️";
    if (t.includes("نكتة")) return "مرة واحد خلف 7 عيال سمى نفسه سفن أب 😂";
    if (t.includes("دين") || t.includes("الله")) return "ونعم بالله، ذكر الله يطمئن القلوب 🤲";
    if (t.includes("بوت")) return "نعم أنا مساعدك الذكي في Blogane، كيف أساعدك؟";
    if (t.includes("صورة")) return "يمكنك نشر الصور في الدردشة العامة أو المنشورات!";
    return "سؤال مثير للاهتمام! هل يمكنك التوضيح أكثر؟ 🤔";
}

// --- إعداد البوتات (Bots Setup) ---
const botNames = [
    "عابر سبيل", "همس المشاعر", "أميرة الورد", "فارس الظلام", "ملكة الإحساس", 
    "الصقر الجارح", "نسيم الصباح", "قمر 14", "المجهول", "عاشق القهوة",
    "نور العيون", "سلطان زمانه", "زهرة الربيع", "المايسترو", "قلب الأسد",
    "شمس الأصيل", "ريحانة", "المحارب", "هدوء الليل", "بسمة أمل",
    "لحن الحياة", "طبيب القلوب", "مهندس السعادة", "سفير الحب", "غريب الدار",
    "بنت الأكابر", "ابن الأصول", "الزعيم", "الفنان", "شاعر العرب"
];

const botPostsContent = [
    { text: "صباح الخير والنشاط 🌹☕", type: "morning" },
    { text: "جمعة مباركة على الجميع 🤲", type: "islamic" },
    { text: "مساء الورد والياسمين 🌸", type: "evening" },
    { text: "مين يشرب قهوة معي؟ ☕", type: "coffee" },
    { text: "صورة من الأرشيف.. أيام جميلة 📸", type: "general" },
    { text: "الحمد لله على كل حال ❤️", type: "islamic" },
    { text: "تصبحون على خير وأحلام سعيدة 🌙", type: "night" },
    { text: "ما رأيكم في هذا التصميم؟ 🎨", type: "art" }
];

// صور عامة من روابط خارجية ثابتة (لأننا لا نستطيع رفع صور حقيقية للبوتات)
const botImages = [
    "https://images.unsplash.com/photo-1490750967868-58cb75069ed6?w=400", // Flowers
    "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400", // Coffee
    "https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?w=400", // Nature
    "https://images.unsplash.com/photo-1518020382113-a7e8fc38eac9?w=400", // Funny
    null, null // بعض المنشورات نص فقط
];

// تسجيل البوتات
botNames.forEach((name, i) => {
    const email = `user${i}@unknown.com`; // إيميلات مجهولة
    if(!db.users.find(u => u.email === email)) {
        db.users.push({
            id: Date.now() + i, 
            name: name, 
            email: email, 
            password: 'bot',
            avatar: `https://ui-avatars.com/api/?name=${name.replace(' ','+')}&background=random&color=fff`,
            bio: 'أحب الخير للجميع 🌸', 
            isBot: true,
            isOnline: true
        });
    }
});
saveData();

// محرك التفاعل الذكي (كل 6 ثواني)
setInterval(() => {
    try {
        const action = Math.random();
        const botIdx = Math.floor(Math.random() * botNames.length);
        const botEmail = `user${botIdx}@unknown.com`;
        const botUser = db.users.find(u => u.email === botEmail);

        if (!botUser) return;

        if (action < 0.15) { // نشر منشور جديد (صور أو نص)
            const contentObj = botPostsContent[Math.floor(Math.random() * botPostsContent.length)];
            const img = Math.random() > 0.5 ? botImages[Math.floor(Math.random() * botImages.length)] : null;
            
            const newPost = {
                id: Date.now(), author: botUser.name, email: botEmail, avatar: botUser.avatar,
                content: contentObj.text, media: img,
                likes: [], comments: [], date: new Date().toISOString(), context: 'general', contextId: null
            };
            db.posts.unshift(newPost);
            io.emit('receive_post', newPost);
        } 
        else if (action < 0.6 && db.posts.length > 0) { // لايك
            const p = db.posts[Math.floor(Math.random() * db.posts.length)];
            if(p && !p.likes.includes(botEmail)) {
                p.likes.push(botEmail);
                io.emit('update_likes', {id: p.id, type: 'post', likes: p.likes});
            }
        }
        else if (action < 0.8 && db.posts.length > 0) { // تعليق
            const p = db.posts[Math.floor(Math.random() * db.posts.length)];
            if(p) {
                const c = { id: Date.now(), text: "منور يا غالي 🔥", userEmail: botEmail, userName: botUser.name, userAvatar: botUser.avatar };
                p.comments.push(c);
                io.emit('update_comments', {postId: p.id, comments: p.comments});
            }
        }
        else if (action > 0.92) { // رسالة شات عام
            const msg = { id: Date.now(), text: "كيف حالكم يا شباب؟", image: null, author: botUser.name, email: botEmail, avatar: botUser.avatar, date: new Date().toISOString() };
            db.globalMessages.push(msg);
            io.emit('receive_global_msg', msg);
        }
        saveData();
    } catch(e) {}
}, 6000);

// Keep Alive
app.get('/ping', (req, res) => res.send('Pong'));
setInterval(() => { try { http.get(`http://127.0.0.1:${process.env.PORT||3000}/ping`).on('error',()=>{}); } catch(e){} }, 240000);

// --- Socket Logic ---
let connectedSockets = {}; 

io.on('connection', (socket) => {
    
    // Auth & Persistence
    socket.on('register', (d) => {
        if (db.users.find(u => u.email === d.email)) socket.emit('auth_error', 'البريد مسجل');
        else {
            const u = { ...d, id: Date.now(), avatar: `https://ui-avatars.com/api/?name=${d.name}&background=random`, bio: 'جديد هنا', isOnline: true };
            db.users.push(u); saveData(); socket.emit('auth_success', u);
        }
    });
    socket.on('login', (d) => {
        const u = db.users.find(u => u.email === d.email && u.password === d.password);
        if (u) {
            connectedSockets[u.email] = socket.id;
            u.isOnline = true; saveData();
            socket.emit('auth_success', u);
            socket.emit('init_data', { 
                groups: db.groups, pages: db.pages, reels: db.reels, 
                globalMessages: db.globalMessages // يرسل التاريخ المحفوظ
            });
            socket.emit('load_posts', (db.posts||[]).filter(p => p.context === 'general'));
            updateFriendsList(u.email);
            checkFriendRequests(u.email);
        } else { socket.emit('auth_error', 'بيانات خاطئة'); }
    });

    // Friend Requests (مع قبول البوتات)
    socket.on('send_friend_request', (d) => {
        if(d.from !== d.to && !db.friendRequests.find(r => r.from === d.from && r.to === d.to)) {
            db.friendRequests.push({ from: d.from, to: d.to });
            saveData();
            
            const target = db.users.find(u => u.email === d.to);
            if(target && target.isBot) {
                // البوت يقبل بعد 2 ثانية
                setTimeout(() => {
                    db.friendRequests = db.friendRequests.filter(r => !(r.from === d.from && r.to === d.to));
                    db.friendships.push({ user1: d.from, user2: d.to });
                    saveData();
                    updateFriendsList(d.from);
                }, 2000);
            } else {
                if(connectedSockets[d.to]) io.to(connectedSockets[d.to]).emit('new_req_alert');
                checkFriendRequests(d.to);
            }
        }
    });

    socket.on('respond_friend_request', (d) => {
        db.friendRequests = db.friendRequests.filter(r => !(r.to === d.userEmail && r.from === d.requesterEmail));
        if(d.accept) {
            db.friendships.push({ user1: d.userEmail, user2: d.requesterEmail });
            updateFriendsList(d.userEmail);
            updateFriendsList(d.requesterEmail);
        }
        saveData();
        checkFriendRequests(d.userEmail);
    });

    function checkFriendRequests(email) {
        const reqs = db.friendRequests.filter(r => r.to === email);
        const data = reqs.map(r => { const s = db.users.find(u=>u.email===r.from); return {email:r.from, name:s?s.name:'Unknown', avatar:s?s.avatar:''}; });
        if(connectedSockets[email]) io.to(connectedSockets[email]).emit('update_requests', data);
    }

    function updateFriendsList(email) {
        const fs = db.friendships.filter(f => f.user1 === email || f.user2 === email);
        const emails = fs.map(f => f.user1 === email ? f.user2 : f.user1);
        const fData = db.users.filter(u => emails.includes(u.email)).map(u => ({ 
            name: u.name, email: u.email, avatar: u.avatar, 
            isOnline: !!connectedSockets[u.email] || u.isBot
        }));
        if(connectedSockets[email]) io.to(connectedSockets[email]).emit('update_friends', fData);
    }

    // Chat (With AI Intelligence)
    socket.on('send_global_msg', (d) => {
        let url = d.image ? saveBase64ToFile(d.image, 'chat') : null;
        const m = { ...d, image: url, id: Date.now(), date: new Date().toISOString() };
        db.globalMessages.push(m); saveData();
        io.emit('receive_global_msg', m);
    });

    socket.on('send_ai_msg', (t) => {
        setTimeout(() => {
            const reply = getAIResponse(t);
            socket.emit('receive_ai_msg', {text: reply});
        }, 1000);
    });

    socket.on('send_private_msg', (d) => {
        const m = { ...d, id: Date.now(), date: new Date().toISOString() };
        db.privateMessages.push(m); saveData();
        socket.emit('receive_private_msg', m);
        if(connectedSockets[d.to]) io.to(connectedSockets[d.to]).emit('receive_private_msg', m);
    });

    socket.on('get_private_msgs', ({u1, u2}) => {
        socket.emit('load_private_msgs', db.privateMessages.filter(m => (m.from===u1&&m.to===u2) || (m.from===u2&&m.to===u1)));
    });

    // Profile & Updates
    socket.on('update_profile', (d) => {
        const i = db.users.findIndex(u => u.email === d.email);
        if(i !== -1) {
            db.users[i].name = d.name;
            db.users[i].bio = d.bio;
            if(d.avatar && d.avatar.startsWith('data:')) db.users[i].avatar = saveBase64ToFile(d.avatar, 'avatar');
            // تحديث شامل
            const u = db.users[i];
            db.posts.forEach(p=>{if(p.email===u.email){p.author=u.name;p.avatar=u.avatar}});
            db.globalMessages.forEach(m=>{if(m.email===u.email){m.author=u.name;m.avatar=u.avatar}});
            saveData();
            socket.emit('profile_updated_success', u);
        }
    });

    socket.on('get_profile_info', (email) => {
        const user = db.users.find(u => u.email === email);
        if(user) {
            // جلب الأصدقاء للعرض
            const fs = db.friendships.filter(f => f.user1 === email || f.user2 === email);
            const fEmails = fs.map(f => f.user1 === email ? f.user2 : f.user1);
            const friends = db.users.filter(u => fEmails.includes(u.email)).map(u => ({name:u.name, avatar:u.avatar, email:u.email}));
            socket.emit('open_profile_view', {user, posts:db.posts.filter(p=>p.email===email), friends});
        }
    });

    // Standard Features
    socket.on('new_post', (d) => { let u=d.media&&d.media.startsWith('data:')?saveBase64ToFile(d.media,'post'):null; const p={...d,id:Date.now(),media:u,likes:[],comments:[],date:new Date().toISOString()}; db.posts.unshift(p); saveData(); io.emit('receive_post', p); socket.emit('upload_complete'); });
    socket.on('toggle_like', ({id, type, userEmail}) => { let x=(type==='reel'?db.reels:db.posts).find(i=>i.id==id); if(x){ if(x.likes.includes(userEmail))x.likes=x.likes.filter(e=>e!==userEmail); else x.likes.push(userEmail); saveData(); io.emit('update_likes', {id, type, likes:x.likes}); } });
    socket.on('add_comment', (d) => { const p=db.posts.find(x=>x.id==d.postId); if(p){ p.comments.push({id:Date.now(), ...d}); saveData(); io.emit('update_comments', {postId:d.postId, comments:p.comments}); } });
    socket.on('create_group', (d)=>{const g={id:'g'+Date.now(),...d,members:[d.owner]}; db.groups.push(g); saveData(); io.emit('update_groups', db.groups);});
    socket.on('create_page', (d)=>{const p={id:'p'+Date.now(),...d,followers:[d.owner]}; db.pages.push(p); saveData(); io.emit('update_pages', db.pages);});
    socket.on('delete_group', ({groupId, email}) => { const i=db.groups.findIndex(g=>g.id===groupId); if(i!==-1 && db.groups[i].owner===email){ db.groups.splice(i,1); saveData(); io.emit('update_groups', db.groups); socket.emit('delete_success'); } });
    socket.on('delete_page', ({pageId, email}) => { const i=db.pages.findIndex(p=>p.id===pageId); if(i!==-1 && db.pages[i].owner===email){ db.pages.splice(i,1); saveData(); io.emit('update_pages', db.pages); socket.emit('delete_success'); } });
    socket.on('get_context_posts', ({context, contextId}) => { socket.emit('load_posts', db.posts.filter(p => p.context === context && p.contextId === contextId)); });
    socket.on('new_reel', (d) => { let u=saveBase64ToFile(d.videoBase64,'reel'); if(u){ const r={id:Date.now(),url:u,desc:d.desc,author:d.author,avatar:d.avatar,email:d.email,likes:[],comments:[]}; db.reels.unshift(r); saveData(); io.emit('receive_reel', {...r,videoBase64:null}); socket.emit('upload_complete'); } });
    socket.on('upload_reel_start', ({name}) => { const f=`reel_${Date.now()}_${Math.floor(Math.random()*1000)}${path.extname(name)}`; fs.open(path.join(UPLOAD_DIR,f),'w',(e,fd)=>{if(!e)fs.close(fd,()=>socket.emit('upload_ready',{tempFileName:f}));}); });
    socket.on('upload_reel_chunk', ({fileName, data}) => { try{fs.appendFileSync(path.join(UPLOAD_DIR,fileName), data);}catch(e){} });
    socket.on('upload_reel_end', (d)=>{ const r={id:Date.now(),url:`/uploads/${d.fileName}`,desc:d.desc,author:d.author,avatar:d.avatar,email:d.email,likes:[],comments:[]}; db.reels.unshift(r); saveData(); io.emit('receive_reel', r); socket.emit('upload_complete'); });

    socket.on('disconnect', () => {
        const email = Object.keys(connectedSockets).find(k => connectedSockets[k] === socket.id);
        if(email) {
            const u = db.users.find(x => x.email === email);
            if(u) { u.isOnline = false; saveData(); }
            delete connectedSockets[email];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
