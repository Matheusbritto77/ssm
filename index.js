// server.js
const puppeteer = require('puppeteer');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { Writable } = require('stream');
const wav = require('wav');
const Vad = require('node-webrtcvad');

const PORT = 8081;
const TEMP_WAV = path.join(__dirname, 'audio.wav');
const vad = new Vad(Vad.Mode.AGGRESSIVE);

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--allow-file-access-from-files',
      `--use-file-for-fake-audio-capture=${TEMP_WAV}`,
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

    let audioChunks = [];
    let isRecording = false;
    let silenceCounter = 0;

    const resetSession = async () => {
      console.log('\u{1F39B} Gravando WAV...');
      const writer = new wav.FileWriter(TEMP_WAV, {
        channels: 1,
        sampleRate: 16000,
        bitDepth: 16
      });
      for (const chunk of audioChunks) writer.write(chunk);
      writer.end();

      console.log('\u{1F4C1} WAV salvo, iniciando transcrição...');
      await page.reload();
    };

    ws.on('message', async (message) => {
      if (typeof message === 'string') {
        try {
          const data = JSON.parse(message);
          if (data.config) {
            console.log('[Vosk] Configuração recebida:', data);
            isRecording = true;
          }
        } catch (err) {
          console.error('Erro ao processar JSON:', err);
        }
      } else if (Buffer.isBuffer(message) && isRecording) {
        audioChunks.push(message);

        const isSpeech = await vad.processAudio(message, 16000);
        if (isSpeech) {
          silenceCounter = 0;
        } else {
          silenceCounter++;
          if (silenceCounter > 10) { // ~1 segundo de silêncio
            isRecording = false;
            silenceCounter = 0;
            await resetSession();
            audioChunks = [];
          }
        }
      }
    });

    ws.on('close', async () => {
      console.log('\u{1F6AB} Cliente desconectado');
      await page.evaluate(() => window.stopRecognition());
    });
  });
})();
