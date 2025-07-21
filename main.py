import asyncio
import websockets
import json
import os
from aiohttp import web
from pyppeteer import launch
import wave
import webrtcvad

PORT_WS = 8081
PORT_HTTP = 3000
BROWSER_PAGE = None

# === Servidor HTTP para o navegador zumbi ===
async def serve_browser():
    app = web.Application()
    app.router.add_static('/', path='public', show_index=True)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '0.0.0.0', PORT_HTTP)
    await site.start()
    print(f"🌐 Servindo browser.html em http://localhost:{PORT_HTTP}/browser.html")

# === Inicia o Puppeteer controlando navegador zumbi ===
async def start_browser():
    global BROWSER_PAGE
    browser = await launch(headless=True, args=[
        '--no-sandbox',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--disable-dev-shm-usage',
        '--allow-file-access-from-files',
    ])
    BROWSER_PAGE = await browser.newPage()
    await BROWSER_PAGE.goto(f'http://localhost:{PORT_HTTP}/browser.html')

    async def console_log(msg):
        print(f"[NAVEGADOR] {msg.text}")

    BROWSER_PAGE.on('console', console_log)

# === Manipula cliente WebSocket ===
async def websocket_handler(websocket):
    print("🤝 Cliente conectado via WebSocket")

    async def on_transcription(text):
        response = {
            "text": text,
            "result": [{"conf": 1.0, "word": text}],
            "final": True
        }
        await websocket.send(json.dumps(response))
        print(f"📤 Enviado: {text}")

    await BROWSER_PAGE.exposeFunction('onTranscription', on_transcription)

    # Estado do VAD
    vad = webrtcvad.Vad(2)
    audio_buffer = bytearray()
    vad_chunk_size = 320  # 20ms para 16kHz mono

    await BROWSER_PAGE.evaluate("() => window.startRecognition()")

    try:
        async for message in websocket:
            if isinstance(message, bytes):
                audio_buffer.extend(message)
                while len(audio_buffer) >= vad_chunk_size:
                    chunk = bytes(audio_buffer[:vad_chunk_size])
                    audio_buffer = audio_buffer[vad_chunk_size:]

                    if vad.is_speech(chunk, sample_rate=16000):
                        print("🗣️  Voz detectada - ativando reconhecimento")
                        await BROWSER_PAGE.evaluate("() => window.startRecognition()")
                        break
            else:
                try:
                    data = json.loads(message)
                    if "config" in data:
                        print("⚙️  Configuração recebida")
                except:
                    pass
    finally:
        await BROWSER_PAGE.evaluate("() => window.stopRecognition()")
        print("🔌 Cliente desconectado")

# === Inicia servidor WebSocket ===
async def start_websocket_server():
    server = await websockets.serve(websocket_handler, "0.0.0.0", PORT_WS)
    print(f"🔌 WebSocket ativo em ws://localhost:{PORT_WS}")
    await server.wait_closed()

# === Main ===
async def main():
    await serve_browser()
    await start_browser()
    await start_websocket_server()

if __name__ == '__main__':
    asyncio.run(main())
