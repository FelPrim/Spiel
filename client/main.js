"use strict";

console.log("Hello, world!");
const WS_URL = 'wss://localhost:9002';
const ws = new WebSocket(WS_URL);

ws.onopen = () => console.log('WS connected');
ws.onmessage = (e) => console.log('MSG:', e.data);
ws.onclose = () => console.log('WS closed');
