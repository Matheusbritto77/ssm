const puppeteer = require('puppeteer');
const WebSocket = require('ws');
const path = require('path');

const PORT = 8081;

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new', // roda sem X11
    args: [
      '--no-sandbox', // necessário em root/docker
      '--disable-setuid-sandbox',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--allow-file-access-from-files',
      '--use-file-for-fake-audio-capture=audio.wav',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-software-rasterizer',
      '--mute-audio',
    ]
  });

  const page = await browser.newPage();

  // Habilita logs do console da página
  page.on('console', (msg) => {
    console.log(`[Navegador] ${msg.text()}`);
  });

  // Carrega a interface controlada
  await page.goto('file://' + path.join(__dirname, 'public/browser.html'));

  // WebSocket server
  const wss = new WebSocket.Server({ port: PORT });
  console.log(`🔌 WebSocket Server rodando em ws://localhost:${PORT}`);

  wss.on('connection', (ws) => {
    console.log('🤝 Cliente conectado via WebSocket');

    ws.on('message', async (message) => {
      const data = JSON.parse(message);

      if (data.type === 'audio') {
        await page.evaluate((base64Audio) => {
          const audio = new Audio(`data:audio/wav;base64,${base64Audio}`);
          audio.play();
        }, data.base64);
      }

      if (data.type === 'startTranscription') {
        await page.evaluate(() => window.startRecognition());
      }

      if (data.type === 'stopTranscription') {
        await page.evaluate(() => window.stopRecognition());
      }

      if (data.type === 'tts') {
        await page.evaluate((text) => {
          const utterance = new SpeechSynthesisUtterance(text);
          speechSynthesis.speak(utterance);
        }, data.text);
      }
    });

    // Transcrição de volta
    page.exposeFunction('onTranscription', (text) => {
      ws.send(JSON.stringify({ type: 'transcription', text }));
    });
  });
})();
