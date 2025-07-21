const puppeteer = require('puppeteer');
const WebSocket = require('ws');
const path = require('path');

const PORT = 8081;

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new', // Headless "new" (modo sem X11)
    args: [
      '--no-sandbox', // Necessário para Docker ou root
      '--disable-setuid-sandbox',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--allow-file-access-from-files',
      '--use-file-for-fake-audio-capture=audio.wav', // Simula microfone com arquivo
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-software-rasterizer',
      '--mute-audio'
    ]
  });

  const page = await browser.newPage();

  // Espelha os logs do navegador no terminal
  page.on('console', (msg) => {
    console.log(`[NAVEGADOR] ${msg.text()}`);
  });

  // Carrega a interface HTML controlada
  await page.goto('file://' + path.join(__dirname, 'public/browser.html'));

  // Inicia servidor WebSocket
  const wss = new WebSocket.Server({ port: PORT });
  console.log(`🔌 WebSocket Server rodando em ws://localhost:${PORT}`);

  wss.on('connection', (ws) => {
    console.log('🤝 Cliente conectado via WebSocket');

    ws.on('message', async (message) => {
      let data;
      try {
        data = JSON.parse(message);
      } catch (err) {
        console.error('❌ Erro ao parsear JSON recebido:', err);
        return;
      }

      switch (data.type) {
        case 'audio':
          console.log('🔈 Recebido áudio base64 para reprodução');
          await page.evaluate((base64Audio) => {
            const audio = new Audio(`data:audio/wav;base64,${base64Audio}`);
            audio.play();
          }, data.base64);
          break;

        case 'startTranscription':
          console.log('🎙️ Iniciando transcrição');
          await page.evaluate(() => window.startRecognition());
          break;

        case 'stopTranscription':
          console.log('🛑 Parando transcrição');
          await page.evaluate(() => window.stopRecognition());
          break;

        case 'tts':
          console.log(`🗣️ Fazendo TTS da frase: "${data.text}"`);
          await page.evaluate((text) => {
            const utterance = new SpeechSynthesisUtterance(text);
            speechSynthesis.speak(utterance);
          }, data.text);
          break;

        default:
          console.warn('⚠️ Tipo de mensagem WebSocket não reconhecido:', data.type);
      }
    });

    // Função exposta que o navegador chama quando tiver texto reconhecido
    page.exposeFunction('onTranscription', (text) => {
      console.log('📤 Enviando transcrição:', text);
      ws.send(JSON.stringify({ type: 'transcription', text }));
    });
  });
})();
