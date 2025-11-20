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

const DATA_FILE = 'database.json';
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let db = { users: [], posts: [], reels: [], groups: [], pages: [], friendRequests: [], friendships: [], globalMessages: [] };

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

// --- Smart AI ---
function smartAI(input) {
    const text = input.toLowerCase();
    if (text.match(/(\d+)\s*([\+\-\*\/])\s*(\d+)/)) {
        try {
            const match = text.match(/(\d+)\s*([\+\-\*\/])\s*(\d+)/);
            const n1 = parseFloat(match[1]), n2 = parseFloat(match[3]), op = match[2];
            let res = 0; if(op==='+') res=n1+n2; if(op==='-') res=n1-n2; if(op==='*') res=n1*n2; if(op==='/') res=n1/n2;
            return `الناتج: ${res} 🧮`;
        } catch (e) { return "خطأ حسابي."; }
    }
    if (text.includes('وقت')) return `الوقت: ${new Date().toLocaleTimeString('ar-EG')} ⏰`;
    if (text.includes('نكتة')) return "مرة مهندس حب يضحك للدنيا.. الدنيا قالتله Error 404 😂";
    if (text.includes('مرحبا')) return "أهلاً بك يا صديقي! ❤️";
    return "أنا مساعد ذكي، اسألني في أي شيء!";
}

let connectedSockets = {}; 

io.on('connection', (socket) => {
    
    // --- Auth ---
    socket.on('register', (data) => {
        if (db.users.find(u => u.email === data.email)) socket.emit('auth_error', 'البريد مسجل');
        else {
            const newUser = { ...data, id: Date.now(), avatar: `https://ui-avatars.com/api/?name=${data.name}&background=random`, bio: 'مستخدم جديد' };
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

    // --- Deletion (Groups & Pages) ---
    socket.on('delete_group', ({ groupId, email }) => {
        const idx = db.groups.findIndex(g => g.id === groupId);
        if (idx !== -1 && db.groups[idx].owner === email) {
            db.groups.splice(idx, 1);
            saveData();
            io.emit('update_groups', db.groups);
            socket.emit('delete_success'); // إعلام المالك بالنجاح
        }
    });

    socket.on('delete_page', ({ pageId, email }) => {
        const idx = db.pages.findIndex(p => p.id === pageId);
        if (idx !== -1 && db.pages[idx].owner === email) {
            db.pages.splice(idx, 1);
            saveData();
            io.emit('update_pages', db.pages);
            socket.emit('delete_success');
        }
    });

    // --- Posts & Reels ---
    socket.on('new_post', (data) => {
        let mediaUrl = null; if (data.media && data.media.startsWith('data:')) mediaUrl = saveBase64ToFile(data.media, 'post');
        const newPost = { ...data, id: Date.now(), media: mediaUrl, likes: [], comments: [], date: new Date().toISOString() };
        db.posts.unshift(newPost); saveData(); io.emit('receive_post', newPost); socket.emit('upload_complete');
    });

    socket.on('upload_reel_start', ({ name }) => {
        const fileName = `reel_${Date.now()}_${Math.floor(Math.random()*1000)}${path.extname(name)}`;
        const filePath = path.join(UPLOAD_DIR, fileName);
        fs.open(filePath, 'w', (err, fd) => {
            if(!err) fs.close(fd, () => socket.emit('upload_ready', { tempFileName: fileName }));
        });
    });
    socket.on('upload_reel_chunk', ({ fileName, data }) => { fs.appendFile(path.join(UPLOAD_DIR, fileName), data, () => {}); });
    socket.on('upload_reel_end', ({ fileName, desc, author, avatar, email }) => {
        const reel = { id: Date.now(), url: `/uploads/${fileName}`, desc, author, avatar, email, likes: [], comments: [] };
        db.reels.unshift(reel); saveData(); io.emit('receive_reel', reel); socket.emit('upload_complete');
    });

    socket.on('toggle_like', ({ id, type, userEmail }) => {
        let item = (type === 'reel' ? db.reels : db.posts).find(i => i.id == id);
        if(item) {
            if(item.likes.includes(userEmail)) item.likes = item.likes.filter(e => e !== userEmail);
            else item.likes.push(userEmail);
            saveData(); io.emit('update_likes', { id, type, likes: item.likes });
        }
    });

    // --- Chat ---
    socket.on('send_ai_msg', (text) => { setTimeout(() => socket.emit('receive_ai_msg', { text: smartAI(text) }), 800); });
    socket.on('send_global_msg', (data) => {
        let img = data.image ? saveBase64ToFile(data.image, 'chat') : null;
        const msg = { ...data, image: img, id: Date.now(), date: new Date().toISOString() };
        db.globalMessages.push(msg); if(db.globalMessages.length > 100) db.globalMessages.shift();
        saveData(); io.emit('receive_global_msg', msg);
    });

    // --- Context ---
    socket.on('create_group', (d) => { const g={id:'g'+Date.now(),...d,members:[d.owner]}; db.groups.push(g); saveData(); io.emit('update_groups', db.groups); socket.emit('group_created_success', g); });
    socket.on('create_page', (d) => { const p={id:'p'+Date.now(),...d,followers:[d.owner]}; db.pages.push(p); saveData(); io.emit('update_pages', db.pages); socket.emit('page_created_success', p); });
    socket.on('get_context_posts', ({context, contextId}) => { socket.emit('load_posts', db.posts.filter(p => p.context === context && p.contextId === contextId)); });
    
    // --- Others ---
    socket.on('update_profile', (d) => {
        const idx = db.users.findIndex(u=>u.email===d.email);
        if(idx!==-1){ 
            db.users[idx].name=d.name; db.users[idx].bio=d.bio;
            if(d.avatar && d.avatar.startsWith('data:')) db.users[idx].avatar=saveBase64ToFile(d.avatar,'avatar');
            saveData(); socket.emit('profile_updated_success', db.users[idx]); 
        }
    });
    socket.on('get_user_posts', (e) => socket.emit('load_profile_posts', db.posts.filter(p=>p.email===e)));

    socket.on('disconnect', () => {
        const email = Object.keys(connectedSockets).find(k => connectedSockets[k] === socket.id);
        if(email) delete connectedSockets[email];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
