document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('auth');


    // Функция для отображения состояния "авторизован"
    function showLoggedIn(username) {
		form.style.display = 'none';
		document.getElementById('main-menu').style.display = 'flex';
	}


    // Функция для отображения формы входа
	function showLoginForm() {
		form.style.display = 'block';
		document.getElementById('main-menu').style.display = 'none';
	}

    // 1. Автоматическая попытка авторизации при загрузке страницы
    fetch('/me')
        .then(response => {
            if (response.ok) {
                return response.json();
            }
            throw new Error('Not authenticated');
        })
        .then(data => {
            if (data.user) {
                showLoggedIn(data.user.username);
            } else {
                showLoginForm();
            }
        })
        .catch(() => {
            // Ошибка сети или 401 – значит гость
            showLoginForm();
        });

    // 2. Обработка отправки формы (регистрация/вход)
    form.addEventListener('submit', async (event) => {
        event.preventDefault(); // не перезагружаем страницу

        const formData = new FormData(form);
        const username = formData.get('username');
        const password = formData.get('password');

        try {
            const response = await fetch('/auth', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
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


// ================== Лобби (заглушки) ==================
const lobbyCodeInput = document.getElementById('lobby-code');
const createLobbyBtn = document.getElementById('create-lobby');
const joinLobbyBtn = document.getElementById('join-lobby');
const lobbyStatus = document.getElementById('lobby-status');

// Генерация случайного кода из 6 заглавных букв
function generateLobbyCode() {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += letters.charAt(Math.floor(Math.random() * letters.length));
    }
    return code;
}

// Установка случайного кода при загрузке
lobbyCodeInput.value = generateLobbyCode();

// Ограничение ввода: только заглавные английские буквы, максимум 6
lobbyCodeInput.addEventListener('input', () => {
    let value = lobbyCodeInput.value.toUpperCase().replace(/[^A-Z]/g, '');
    if (value.length > 6) value = value.slice(0, 6);
    lobbyCodeInput.value = value;
});

// Заглушка создания лобби (всегда успешно)
async function createLobbyStub(code) {
    // TODO: заменить на реальный запрос к серверу
    console.log(`[STUB] Создание лобби с кодом ${code}`);
    return new Promise(resolve => {
        setTimeout(() => resolve({ success: true, code }), 300);
    });
}

// Заглушка присоединения к лобби (всегда успешно)
async function joinLobbyStub(code) {
    // TODO: заменить на реальный запрос к серверу
    console.log(`[STUB] Присоединение к лобби с кодом ${code}`);
    return new Promise(resolve => {
        setTimeout(() => resolve({ success: true, code }), 300);
    });
}

// Обработчик кнопки "Создать лобби"
createLobbyBtn.addEventListener('click', async () => {
    const code = lobbyCodeInput.value;
    if (code.length !== 6) {
        lobbyStatus.textContent = 'Код должен содержать 6 заглавных букв';
        return;
    }
    lobbyStatus.textContent = 'Создание лобби...';
    const result = await createLobbyStub(code);
    lobbyStatus.textContent = `Лобби ${result.code} создано (заглушка)`;
    // Переход на страницу лобби
    window.location.href = 'lobby/lobby.html';
});

// Обработчик кнопки "Присоединиться"
joinLobbyBtn.addEventListener('click', async () => {
    const code = lobbyCodeInput.value;
    if (code.length !== 6) {
        lobbyStatus.textContent = 'Код должен содержать 6 заглавных букв';
        return;
    }
    lobbyStatus.textContent = 'Подключение...';
    const result = await joinLobbyStub(code);
    lobbyStatus.textContent = `Вы подключились к лобби ${result.code} (заглушка)`;
    // Переход на страницу лобби
    window.location.href = 'lobby/lobby.html';
});

// Если в будущем вы захотите передать код на страницу лобби, можно сохранить его в sessionStorage перед переходом.