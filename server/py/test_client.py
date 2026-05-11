import asyncio
import websockets
import ssl

async def test():
    # Отключаем проверку самоподписанного сертификата
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE

    async with websockets.connect("wss://localhost:9001", ssl=ssl_context) as ws:
        print("✅ Соединение установлено")
        await ws.send("Hello from Python")
        print("📤 Сообщение отправлено")
        await asyncio.sleep(1)  # Ждём, чтобы сервер успел обработать

asyncio.run(test())