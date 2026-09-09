document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('auth');
    const messageContainer = document.createElement('div');
    messageContainer.id = 'auth-message';
    document.body.appendChild(messageContainer);

    // Функция для отображения состояния "авторизован"
    function showLoggedIn(username) {
		form.style.display = 'none';
		messageContainer.textContent = `Добро пожаловать, ${username}!`;
		document.getElementById('main-menu').style.display = 'flex';
	}


    // Функция для отображения формы входа
	function showLoginForm() {
		form.style.display = 'block';
		messageContainer.textContent = '';
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
