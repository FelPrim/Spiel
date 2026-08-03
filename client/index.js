// console.log("Hello, world!");
// const response = await fetch('spiel.wasm');
// const bytes = await response.arrayBuffer();
// 
// let memory;
// 
// const importObject = {
//     env: {
//         js_log(ptr, len) {
//             const buf = new Uint8Array(memory.buffer, ptr, len);
//             console.log("[C]:", new TextDecoder().decode(buf));
//         }
//     }
// };
// 
// const { instance } = await WebAssembly.instantiate(bytes, importObject);
// const { alloc, process, get_errno, get_memory_base} = instance.exports;
// memory = instance.exports.memory;
// 
// const ptr = alloc(4, 4, 10);
// if (get_errno() !== 0) {
// 	document.getElementById('output').textContent = "Ошибка выделения: " + get_errno();
// }
// 
// process(ptr, 10);
// 
// const base = get_memory_base();
// const result = new Uint32Array(memory.buffer, base + ptr, 10);
// document.getElementById('output').textContent = Array.from(result).join(', ');
		
const proto = location.protocol === 'https:'? 
    'wss://':
    'ws://';
const url = `${location.protocol}//${location.host}`
//const ws = new WebSocket(`${url}/ws`);

const token = localStorage.getItem('token');

function initApp(token) {
	document.getElementById('authBlock').style.display = 'none';
	document.getElementById('appBlock').style.display = 'block';

	const ws = new WebSocket(`${proto}${location.host}/ws?token=${token}`);
	
	ws.onopen = () => {
		console.log('WS connected');
	};
	ws.onmessage = (e) => {
		console.log('MSG:', e.data);
	};
	ws.onclose = () => {
		console.log('WS closed');
	};
}

document.getElementById('auth').onsubmit = async (e) => {
	e.preventDefault();
	const errorMsg = document.getElementById('errorMsg');
    errorMsg.textContent = '';
	
	// It is vulnerable to brute-force, i think
	const response = await fetch(`${url}/auth`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			login: document.getElementById('login').value,
			password: document.getElementById('password').value
		})
	});
	if (!response.ok) {
		const textError = await response.text();
		console.error("Сервер вернул ошибку:", textError);
		errorMsg.textContent = `Ошибка сервера: ${response.status} ${response.statusText}`;
		return;
	}
	const data = await response.json();

	if (response.ok && data.token) {
		localStorage.setItem('token', data.token);
		initApp(data.token);
	} else {
		errorMsg.textContent = data.message || 'Ошибка входа';
	}
};

function logout() {
	localStorage.removeItem('token');
	if (ws) ws.close();
	location.reload();
}