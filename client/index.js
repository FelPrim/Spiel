console.log("Hello, world!");
const response = await fetch('spiel.wasm');
const bytes = await response.arrayBuffer();

let memory;

const importObject = {
    env: {
        js_log(ptr, len) {
            const buf = new Uint8Array(memory.buffer, ptr, len);
            console.log("[C]:", new TextDecoder().decode(buf));
        }
    }
};


const { instance } = await WebAssembly.instantiate(bytes, importObject);
const { alloc, process, get_errno, get_memory_base} = instance.exports;
memory = instance.exports.memory;

const ptr = alloc(4, 4, 10);
if (get_errno() !== 0) {
	document.getElementById('output').textContent = "Ошибка выделения: " + get_errno();
}

process(ptr, 10);

const base = get_memory_base();
const result = new Uint32Array(memory.buffer, base + ptr, 10);
document.getElementById('output').textContent = Array.from(result).join(', ');
		
const proto = location.protocol === 'https:'? 
    'wss://':
    'ws://';
const ws = new WebSocket(`${proto}${location.host}/ws`);

ws.onopen = () => {
    console.log('WS connected');
    ws.send("Hello, server!\n");
};
ws.onmessage = (e) => {
    console.log('MSG:', e.data);
};
ws.onclose = () => {
    console.log('WS closed');
};
