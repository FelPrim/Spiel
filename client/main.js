document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('auth');

    function showLoggedIn(username) {
        form.style.display = 'none';
        document.getElementById('main-menu').style.display = 'flex';
    }

    function showLoginForm() {
        form.style.display = 'block';
        document.getElementById('main-menu').style.display = 'none';
    }

    fetch('/me')
        .then(response => {
            if (response.ok) return response.json();
            throw new Error('Not authenticated');
        })
        .then(data => {
            if (data.user) showLoggedIn(data.user.username);
            else showLoginForm();
        })
        .catch(() => showLoginForm());

    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        const formData = new FormData(form);
        const username = formData.get('username');
        const password = formData.get('password');

        try {
            const response = await fetch('/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });

            const result = await response.json();

            if (response.ok && result.success) {
                showLoggedIn(result.user.username);
            } else {
                alert(result.error || 'Ошибка авторизации');
            }
        } catch (err) {
            console.error('Ошибка сети:', err);
            alert('Не удалось соединиться с сервером');
        }
    });
});

// ================== Лобби ==================
const lobbyCodeInput = document.getElementById('lobby-code');
const createLobbyBtn = document.getElementById('create-lobby');
const joinLobbyBtn = document.getElementById('join-lobby');
const lobbyStatus = document.getElementById('lobby-status');

function generateLobbyCode() {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += letters.charAt(Math.floor(Math.random() * letters.length));
    }
    return code;
}

lobbyCodeInput.placeholder = generateLobbyCode();

lobbyCodeInput.addEventListener('input', () => {
    let value = lobbyCodeInput.value.toUpperCase().replace(/[^A-Z]/g, '');
    if (value.length > 6) value = value.slice(0, 6);
    lobbyCodeInput.value = value;
});

async function requestJson(url, options) {
    const r = await fetch(url, options);
    let data = null;
    try { data = await r.json(); } catch (_) { /* нет тела */ }
    if (!r.ok) {
        const err = new Error((data && data.error) || `Ошибка ${r.status}`);
        err.status = r.status;
        throw err;
    }
    return data;
}

function createLobby(code) {
    return requestJson('/lobby', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
    });
}

function joinLobby(code) {
    return requestJson(`/lobby/${encodeURIComponent(code)}/join`, { method: 'POST' });
}

function goToLobby(code) {
    sessionStorage.setItem('lobbyCode', code);
    window.location.href = `lobby/lobby.html?code=${encodeURIComponent(code)}`;
}

createLobbyBtn.addEventListener('click', async () => {
    const code = lobbyCodeInput.value || lobbyCodeInput.placeholder;

    if (code.length !== 6) {
        lobbyStatus.textContent = 'Код должен содержать 6 заглавных букв';
        return;
    }
    lobbyStatus.textContent = 'Создание лобби...';
    try {
        const result = await createLobby(code);
        goToLobby(result.code);
    } catch (err) {
        // Например: "Лобби с таким кодом уже существует"
        lobbyStatus.textContent = err.message;
    }
});

joinLobbyBtn.addEventListener('click', async () => {
    const code = lobbyCodeInput.value;
    if (code.length !== 6) {
        lobbyStatus.textContent = 'Код должен содержать 6 заглавных букв';
        return;
    }
    lobbyStatus.textContent = 'Подключение...';
    try {
        const result = await joinLobby(code);
        goToLobby(result.code);
    } catch (err) {
        // Например: "Лобби с таким кодом не найдено"
        lobbyStatus.textContent = err.message;
    }
});