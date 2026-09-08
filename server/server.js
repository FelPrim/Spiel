const express = require('express');
const bcrypt = require('bcrypt');
const cookieSession = require('cookie-session');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// Путь к файлу с пользователями
const usersFile = path.join(__dirname, '..', 'data', 'users.json');

// Middleware для парсинга тела POST-запросов
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Настройка cookie-сессии
app.use(cookieSession({
    name: 'session',
    keys: ['secret-key-1', 'secret-key-2'], // замените на свои случайные строки
    maxAge: 24 * 60 * 60 * 1000 // 24 часа
}));

// Раздача статики из client/
app.use(express.static(path.join(__dirname, '..', 'client')));

// Отдельный маршрут для видео (если оставить его в data/)
app.get('/video.webm', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'data', 'video.webm'));
});

// Загрузка пользователей из файла (или создание пустого объекта)
function loadUsers() {
    try {
        const data = fs.readFileSync(usersFile, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return {}; // файл не существует или пуст
    }
}

// Сохранение пользователей в файл
function saveUsers(users) {
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

// Регистрация / вход
app.post('/auth', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }

    const users = loadUsers();

    if (users[username]) {
        const hash = users[username].passwordHash;
        const match = await bcrypt.compare(password, hash);
        if (match) {
            req.session.user = { username };
            return res.json({ success: true, user: { username } });
        } else {
            return res.status(401).json({ error: 'Неверный пароль' });
        }
    } else {
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);
        users[username] = { passwordHash };
        saveUsers(users);
        req.session.user = { username };
        return res.json({ success: true, user: { username } });
    }
});

app.get('/me', (req, res) => {
    if (req.session.user) {
        res.json({ user: req.session.user });
    } else {
        res.status(401).json({ error: 'Не авторизован' });
    }
});
// Выход
app.post('/logout', (req, res) => {
    req.session = null; // очистить сессию
    res.redirect('/');
});

app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});
