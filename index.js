const puppeteer = require('puppeteer');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs'); // Para depuração, se precisar salvar o áudio

const PORT = 8081;
const BROWSER_HTML_PATH = path.join(__dirname, 'public', 'browser.html');

(async () => {
    // Verificar se o arquivo browser.html existe
    if (!fs.existsSync(BROWSER_HTML_PATH)) {
        console.error(`Erro: O arquivo browser.html não foi encontrado em ${BROWSER_HTML_PATH}`);
        console.error('Certifique-se de que a pasta "public" e "browser.html" existem na raiz do seu projeto.');
        process.exit(1); // Encerra o processo se o arquivo não for encontrado
    }

    console.log('🚀 Iniciando Puppeteer...');
    const browser = await puppeteer.launch({
        headless: 'new', // Use 'new' para o novo modo headless, ou false para ver a UI
        args: [
            '--no-sandbox', // Necessário para ambientes Docker/Linux
            '--disable-setuid-sandbox',
            '--use-fake-ui-for-media-stream', // Permite que o microfone/câmera não peçam permissão real
            // '--use-fake-device-for-media-stream', // Não vamos usar um arquivo estático aqui
            '--disable-gpu',
            '--disable-dev-shm-usage', // Importante para ambientes com memória limitada como Docker
            '--disable-software-rasterizer',
            '--mute-audio' // Para não ouvirmos o áudio sendo processado no navegador zumbi
        ]
    });
    console.log('✅ Puppeteer iniciado.');

    const page = await browser.newPage();

    // Espelha os logs do navegador no terminal do Node.js
    page.on('console', (msg) => {
        // Filtra logs de "Fake device" se forem muito barulhentos, mas mantenha-os se úteis
        if (msg.text().includes('Fake device')) {
            // console.log(`[NAVEGADOR - DEBUG ÁUDIO] ${msg.text()}`);
        } else {
            console.log(`[NAVEGADOR] ${msg.text()}`);
        }
    });
    page.on('pageerror', (err) => {
        console.error(`[NAVEGADOR - ERRO DE PÁGINA] ${err.message}`);
    });

    console.log(`🌐 Carregando página ${BROWSER_HTML_PATH} no navegador zumbi...`);
    // Carrega a interface HTML controlada, onde o STT será executado
    await page.goto('file://' + BROWSER_HTML_PATH, { waitUntil: 'domcontentloaded' });
    console.log('📄 Página carregada no Puppeteer.');

    // Inicia servidor WebSocket
    const wss = new WebSocket.Server({ port: PORT });
    console.log(`🔌 WebSocket Server rodando em ws://localhost:${PORT}`);

    wss.on('connection', (ws) => {
        console.log('🤝 Cliente conectado via WebSocket');

        // Exponha uma função para o navegador Puppeteer chamar quando tiver a transcrição
        page.exposeFunction('onTranscription', (text) => {
            console.log('📤 Transcrição recebida do navegador:', text);
            // Envia a transcrição de volta para o cliente que se conectou ao WebSocket
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'transcription', text }));
            }
        });

        ws.on('message', async (message) => {
            // Aqui, esperamos buffers de áudio diretamente do cliente
            // O cliente HTML está enviando ArrayBuffer, que no Node.js virá como Buffer
            if (message instanceof Buffer) {
                // console.log(`🔈 Recebido buffer de áudio do cliente. Tamanho: ${message.byteLength} bytes.`);
                
                // Injeta o buffer de áudio na página do Puppeteer
                // Precisamos passar os dados de áudio para o contexto da página no navegador.
                // A melhor forma é converter o Buffer para um ArrayBuffer (se ainda não for)
                // e passá-lo como um TypedArray (Uint8Array, Int16Array, etc.) para o evaluate.
                // O evaluate manipulará no lado do navegador.
                
                // Assumimos que o cliente envia Int16Array (como no seu HTML frontend)
                const int16Array = new Int16Array(message.buffer, message.byteOffset, message.byteLength / Int16Array.BYTES_PER_ELEMENT);

                // Chama a função global no navegador Puppeteer para injetar o áudio
                await page.evaluate((audioData) => {
                    // console.log('[NAVEGADOR] Recebeu dados de áudio para injeção.');
                    if (window.injectAudioBuffer) {
                        window.injectAudioBuffer(audioData);
                    } else {
                        console.error('[NAVEGADOR] window.injectAudioBuffer não está definido!');
                    }
                }, Array.from(int16Array)); // Converte TypedArray para Array JS para serialização

            } else if (typeof message === 'string') {
                // Tratar mensagens de controle JSON, se houver
                try {
                    const data = JSON.parse(message);
                    if (data.type === 'startTranscription') {
                        console.log('🎙️ Sinal para iniciar transcrição recebido.');
                        await page.evaluate(() => window.startRecognition()); // Inicia o STT no navegador
                    } else if (data.type === 'stopTranscription') {
                        console.log('🛑 Sinal para parar transcrição recebido.');
                        await page.evaluate(() => window.stopRecognition()); // Para o STT no navegador
                    } else {
                        console.warn('⚠️ Mensagem de texto JSON não reconhecida:', data);
                    }
                } catch (err) {
                    console.error('❌ Erro ao parsear mensagem de texto (não JSON esperado):', err.message);
                }
            } else {
                console.warn('⚠️ Tipo de mensagem WebSocket não reconhecido (esperado Buffer ou JSON string):', typeof message);
            }
        });

        ws.on('close', () => {
            console.log('👋 Cliente desconectado do WebSocket.');
        });

        ws.on('error', (err) => {
            console.error('❌ Erro no WebSocket do cliente:', err);
        });
    });

    // Fechar o navegador quando o processo for encerrado
    process.on('SIGINT', async () => {
        console.log('Shutting down browser...');
        await browser.close();
        process.exit(0);
    });

    // Opcional: Fechar o navegador após um tempo de inatividade (ex: 1 hora)
    // setTimeout(async () => {
    //     console.log('Fechando navegador por inatividade...');
    //     await browser.close();
    //     process.exit(0);
    // }, 3600 * 1000); // 1 hora
})();