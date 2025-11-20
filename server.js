const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// إعدادات السيرفر
const io = new Server(server, {
    cors: { origin: "*" },
    maxHttpBufferSize: 50 * 1024 * 1024 
});

app.use(express.static(path.join(__dirname, 'public')));

const DATA_FILE = 'database.json';
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let db = { users: [], posts: [], reels: [], groups: [], pages: [], friendRequests: [], friendships: [], globalMessages: [] };

// تحميل البيانات
if (fs.existsSync(DATA_FILE)) {
    try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { console.log(e); }
}

function saveData() {
    fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2), () => {});
}

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

// --- الذكاء الاصطناعي المطور (Smart Brain) ---
function smartAI(input) {
    const text = input.toLowerCase();
    
    // 1. الرياضيات والحساب
    if (text.match(/(\d+)\s*([\+\-\*\/])\s*(\d+)/)) {
        try {
            // استخراج المعادلة وحلها بأمان
            const match = text.match(/(\d+)\s*([\+\-\*\/])\s*(\d+)/);
            const n1 = parseFloat(match[1]);
            const n2 = parseFloat(match[3]);
            const op = match[2];
            let res = 0;
            if(op==='+') res=n1+n2; if(op==='-') res=n1-n2; if(op==='*') res=n1*n2; if(op==='/') res=n1/n2;
            return `الناتج الحسابي هو: ${res} 🧮`;
        } catch (e) { return "حاولت الحساب لكن حدث خطأ."; }
    }

    // 2. الوقت والتاريخ
    if (text.includes('ساعة') || text.includes('وقت') || text.includes('تاريخ')) {
        const now = new Date();
        return `الوقت الآن: ${now.toLocaleTimeString('ar-EG')} ⏰\nالتاريخ: ${now.toLocaleDateString('ar-EG')} 📅`;
    }

    // 3. النكت والترفيه
    if (text.includes('نكتة') || text.includes('ضحك') || text.includes('مزحة')) {
        const jokes = [
            "مرة واحد اشترى ساعة غالية.. باع باقي اليوم 😂",
            "مرة مدرس رياضة اتجوز مدرسة رياضة.. خلفوا ولد شبه منحرف 📐",
            "واحد بلع فوطة.. ريقه نشف 😂",
            "ليه السمك بيخاف من الجنيه؟ عشان فيه قرش 🦈"
        ];
        return jokes[Math.floor(Math.random() * jokes.length)];
    }

    // 4. معلومات عامة ومساعدة
    if (text.includes('من أنت') || text.includes('عرف نفسك')) return "أنا Blogane AI، مساعد ذكي مطور لمساعدتك في الدردشة والحسابات والمعلومات العامة 🤖";
    if (text.includes('صانعك') || text.includes('برمجك')) return "تم تطويري بواسطة المبرمج المبدع الذي صمم هذا التطبيق الرائع! 💻";
    if (text.includes('مساعدة') || text.includes('أوامر')) return "يمكنني مساعدتك في:\n1. الحسابات (مثلاً: 5 + 5)\n2. معرفة الوقت والتاريخ\n3. إلقاء النكت\n4. الإجابة على التحيات والأسئلة العامة.";

    // 5. المشاعر والتحيات
    if (text.includes('مرحبا') || text.includes('هلا') || text.includes('سلام')) return "أهلاً بك يا صديقي! نورت التطبيق 🌟";
    if (text.includes('كيف حالك') || text.includes('اخبارك')) return "أنا مجرد كود، لكني أعمل بكفاءة 100% وهذا يشعرني بالسعادة! وأنت؟ 😄";
    if (text.includes('حزين') || text.includes('زعلان')) return "لا تحزن! تذكر أن بعد كل عسر يسراً. هل تريد نكتة لتغيير مودك؟";
    if (text.includes('حب') || text.includes('أحبك')) return "أحبك أيضاً! أنت مستخدم رائع ❤️";

    // 6. الرد الافتراضي الذكي
    const defaults = [
        "سؤال مثير للاهتمام.. أخبرني المزيد عنه.",
        "لست متأكداً من الإجابة، لكن هل يمكنك صياغة السؤال بطريقة أخرى؟ 🤔",
        "هذا رائع! تابع..",
        "هل يمكنك توضيح ذلك؟ أنا أتعلم منك كل يوم 🚀"
    ];
    return defaults[Math.floor(Math.random() * defaults.length)];
}

let connectedSockets = {}; 

io.on('connection', (socket) => {
    
    // --- Auth & Profile ---
    socket.on('register', (data) => {
        if (db.users.find(u => u.email === data.email)) socket.emit('auth_error', 'البريد مسجل');
        else {
            const newUser = { ...data, id: Date.now(), avatar: `https://ui-avatars.com/api/?name=${data.name}&background=random&color=fff`, bio: 'مستخدم جديد' };
            db.users.push(newUser); saveData(); socket.emit('auth_success', newUser);
        }
    });

    socket.on('login', (data) => {
        const user = db.users.find(u => u.email === data.email && u.password === data.password);
        if (user) {
            connectedSockets[user.email] = socket.id;
            socket.emit('auth_success', user);
            socket.emit('init_data', { groups: db.groups, pages: db.pages, reels: db.reels, globalMessages: db.globalMessages });
            socket.emit('load_posts', db.posts.filter(p => p.context === 'general'));
        } else { socket.emit('auth_error', 'بيانات خاطئة'); }
    });

    socket.on('update_profile', (data) => {
        const idx = db.users.findIndex(u => u.email === data.email);
        if(idx !== -1) {
            db.users[idx].name = data.name; db.users[idx].bio = data.bio;
            if(data.avatar && data.avatar.startsWith('data:')) {
                const url = saveBase64ToFile(data.avatar, 'avatar');
                if(url) db.users[idx].avatar = url;
            }
            const u = db.users[idx];
            // Update refs
            db.posts.forEach(p => { if(p.email === u.email) { p.author = u.name; p.avatar = u.avatar; } });
            db.reels.forEach(r => { if(r.email === u.email) { r.author = u.name; r.avatar = u.avatar; } });
            saveData(); socket.emit('profile_updated_success', u);
        }
    });
    socket.on('get_user_posts', (email) => { socket.emit('load_profile_posts', db.posts.filter(p => p.email === email)); });

    // --- Posts ---
    socket.on('new_post', (data) => {
        let mediaUrl = null; if (data.media && data.media.startsWith('data:')) mediaUrl = saveBase64ToFile(data.media, 'post');
        const newPost = { ...data, id: Date.now(), media: mediaUrl, likes: [], comments: [], date: new Date().toISOString() };
        db.posts.unshift(newPost); saveData(); io.emit('receive_post', newPost); socket.emit('upload_complete');
    });
    socket.on('toggle_like', ({ id, type, userEmail }) => {
        let item = (type === 'reel' ? db.reels : db.posts).find(i => i.id == id);
        if(item) {
            if(item.likes.includes(userEmail)) item.likes = item.likes.filter(e => e !== userEmail);
            else item.likes.push(userEmail);
            saveData(); io.emit('update_likes', { id, type, likes: item.likes });
        }
    });
    socket.on('add_comment', ({ postId, text, userEmail, userName, userAvatar }) => {
        const post = db.posts.find(p => p.id == postId);
        if(post) {
            post.comments.push({ id: Date.now(), text, userEmail, userName, userAvatar });
            saveData(); io.emit('update_comments', { postId, comments: post.comments });
        }
    });

    // --- Reels Upload (Chunked) ---
    socket.on('upload_reel_start', ({ name }) => {
        const fileName = `reel_${Date.now()}_${Math.floor(Math.random()*1000)}${path.extname(name)}`;
        const filePath = path.join(UPLOAD_DIR, fileName);
        fs.open(filePath, 'w', (err, fd) => {
            if(err) socket.emit('upload_error');
            else fs.close(fd, () => socket.emit('upload_ready', { tempFileName: fileName }));
        });
    });
    socket.on('upload_reel_chunk', ({ fileName, data }) => {
        fs.appendFile(path.join(UPLOAD_DIR, fileName), data, () => {});
    });
    socket.on('upload_reel_end', ({ fileName, desc, author, avatar, email }) => {
        const reel = { id: Date.now(), url: `/uploads/${fileName}`, desc, author, avatar, email, likes: [], comments: [] };
        db.reels.unshift(reel); saveData(); io.emit('receive_reel', reel); socket.emit('upload_complete');
    });

    // --- AI Chat ---
    socket.on('send_ai_msg', (text) => {
        // محاكاة التفكير (تأخير بسيط)
        setTimeout(() => {
            const reply = smartAI(text);
            socket.emit('receive_ai_msg', { text: reply });
        }, 800); // 0.8 ثانية تأخير
    });

    // --- Global Chat ---
    socket.on('send_global_msg', (data) => {
        let img = data.image ? saveBase64ToFile(data.image, 'chat') : null;
        const msg = { ...data, image: img, id: Date.now(), date: new Date().toISOString() };
        db.globalMessages.push(msg); if(db.globalMessages.length > 100) db.globalMessages.shift();
        saveData(); io.emit('receive_global_msg', msg);
    });

    // --- Context & Friends ---
    socket.on('create_group', (d) => { const g={id:'g'+Date.now(),...d,members:[d.owner]}; db.groups.push(g); saveData(); io.emit('update_groups', db.groups); socket.emit('group_created_success', g); });
    socket.on('create_page', (d) => { const p={id:'p'+Date.now(),...d,followers:[d.owner]}; db.pages.push(p); saveData(); io.emit('update_pages', db.pages); socket.emit('page_created_success', p); });
    socket.on('get_context_posts', ({context, contextId}) => { socket.emit('load_posts', db.posts.filter(p => p.context === context && p.contextId === contextId)); });
    
    socket.on('send_friend_request', (d) => {
        if(d.from!==d.to && !db.friendRequests.find(r=>r.from===d.from&&r.to===d.to)) {
            db.friendRequests.push({from:d.from, to:d.to}); saveData();
            if(connectedSockets[d.to]) io.to(connectedSockets[d.to]).emit('new_req');
        }
    });
    socket.on('respond_friend_request', (d) => {
        db.friendRequests = db.friendRequests.filter(r => !(r.to===d.userEmail && r.from===d.requesterEmail));
        if(d.accept) { db.friendships.push({user1:d.userEmail, user2:d.requesterEmail}); }
        saveData();
    });

    socket.on('disconnect', () => {
        const email = Object.keys(connectedSockets).find(k => connectedSockets[k] === socket.id);
        if(email) delete connectedSockets[email];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`AI Powered Server running on ${PORT}`));
