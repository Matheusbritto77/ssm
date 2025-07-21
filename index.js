const puppeteer = require('puppeteer');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const PORT = 8081;

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--allow-file-access-from-files',
      '--use-file-for-fake-audio-capture=audio.wav', // exemplo, substitua por loopback se quiser real
    ]
  });

  const page = await browser.newPage();
  await page.goto('file://' + path.join(__dirname, 'public/browser.html'));

  const wss = new WebSocket.Server({ port: PORT });
  console.log(`🔌 WebSocket Server rodando em ws://localhost:${PORT}`);

  wss.on('connection', (ws) => {
    console.log('🤝 Cliente conectado via WebSocket');

    ws.on('message', async (message) => {
      const data = JSON.parse(message);
      if (data.type === 'audio') {
        // envia áudio para o navegador zumbi tocar
        await page.evaluate((base64Audio) => {
          const audio = new Audio(`data:audio/wav;base64,${base64Audio}`);
          audio.play();
        }, data.base64);
      }

      if (data.type === 'startTranscription') {
        page.evaluate(() => window.startRecognition());
      }

      if (data.type === 'stopTranscription') {
        page.evaluate(() => window.stopRecognition());
      }

      if (data.type === 'tts') {
        page.evaluate((text) => {
          const utterance = new SpeechSynthesisUtterance(text);
          speechSynthesis.speak(utterance);
        }, data.text);
      }
    });

    // envia texto transcrito de volta
    page.exposeFunction('onTranscription', (text) => {
      ws.send(JSON.stringify({ type: 'transcription', text }));
    });
  });
})();
