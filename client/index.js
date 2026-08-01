console.log("Hello, world!");
const response = await fetch("hello.wasm");
const bytes = await response.arrayBuffer();

const {instance} = await WebAssembly.instantiate(bytes);
console.log(instance.exports.add(2, 3));
//const proto = location.protocol === 'https:'? 
//    'wss://':
//    'ws://';
//const ws = new WebSocket(`${proto}${location.host}/ws`);
//
//ws.onopen = () => {
//    console.log('WS connected');
//    ws.send("Hello, server!\n");
//};
//ws.onmessage = (e) => {
//    console.log('MSG:', e.data);
//};
//ws.onclose = () => {
//    console.log('WS closed');
//};
