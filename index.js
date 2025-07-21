// server.js
const puppeteer = require('puppeteer');
const WebSocket = require('ws');
const path = require('path');

const PORT = 8081;

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--allow-file-access-from-files',
      '--use-file-for-fake-audio-capture=audio.wav',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-software-rasterizer',
      '--mute-audio'
    ]
  });

  const page = await browser.newPage();
  await page.goto('file://' + path.join(__dirname, 'public/browser.html'));

  page.on('console', (msg) => {
    console.log(`[NAVEGADOR] ${msg.text()}`);
  });

  const wss = new WebSocket.Server({ port: PORT });
  console.log(`\u{1F50C} WebSocket compatível com Vosk rodando em ws://localhost:${PORT}`);

  wss.on('connection', (ws) => {
    console.log('\u{1F91D} Cliente conectado');

    page.exposeFunction('onTranscription', (text) => {
      console.log('\u{1F4E4} Enviando transcrição:', text);
      const response = {
        text,
        result: [{ conf: 1.0, word: text }],
        final: true
      };
      ws.send(JSON.stringify(response));
    });

    let audioBuffer = [];
    let transcriptionStarted = false;

    ws.on('message', async (message) => {
      if (typeof message === 'string') {
        try {
          const data = JSON.parse(message);
          if (data.config) {
            console.log('[Vosk] Configuração recebida:', data);
            // Começa transcrição ao receber config
            transcriptionStarted = true;
            await page.evaluate(() => window.startRecognition());
          }
        } catch (err) {
          console.error('Erro ao processar mensagem JSON:', err);
        }
      } else if (Buffer.isBuffer(message)) {
        if (transcriptionStarted) {
          // Ignorado: audio em tempo real não é interpretado diretamente pelo navegador
          // Use reconhecimento do navegador via WebSpeech
          // Aqui você pode simular entrada se quiser
        }
      }
    });

    ws.on('close', async () => {
      console.log('\u{1F6AB} Cliente desconectado');
      await page.evaluate(() => window.stopRecognition());
    });
  });
})();
