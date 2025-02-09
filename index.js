const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, downloadMediaMessage, makeInMemoryStore } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('.log/');

    const sock = makeWASocket({
        printQRInTerminal: true,
        auth: state,
        logger: pino({
            level: 'silent'
        }),
        browser: [
            'kenobi',
            'bot',
            '1.0.0'
        ],
        syncFullHistory: false,
        generateHighQualityLinkPreview: false
    });


    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed:', lastDisconnect.error?.message || 'Unknown error');

            if (shouldReconnect) {
                console.log('Reconnecting...');
                connectToWhatsApp();
            } else {
                console.log('Session logged out. Please re-authenticate.');
            }
        } else if (connection === 'open') {
            console.log('Connection established successfully!');
        }
    });
 
    sock.ev.on('messages.upsert', async (data) => {
        const message = data.messages[0];

        const alt = message?.message ? Object.keys(message.message) : [];
        if (alt.length === 0) return;

        const id = message.key.remoteJid;

        const sent = async (text, mentions = {}) => {
            await sock.sendMessage(
                id,
                { 
                    text: text,
                    mentions: mentions
                },
                { 
                    quoted: message 
                }
            );
        };

        const type = alt[0] == "senderKeyDistributionMessage" ? alt[1] == "messagecontextInfo" ? alt[2] : alt[1] : alt[0];
        const body = type === "conversation" ? message.message.conversation : type == "imageMessage" ? message.message.imageMessage.caption : type == "videoMessage" ? message.message.videoMessage.caption : type == "extendedTextMessage" ? message.message.extendedTextMessage.text : "";
        
        const prefix = '!';
        
        const [cmd, ...args] = body.startsWith(prefix) 
        ? body.slice(prefix.length).toLocaleLowerCase().trim().split(/\s+/) 
        : [];
        
        switch(cmd) {
            case 'ping':
                sent('Pong!');
                break;
            case 's':
                const mediaType = alt[0] === 'imageMessage' ? 'image' : alt[0] === 'videoMessage' ? 'video' : null;
                if (!mediaType) return sent('Unknown media.');
                sticker(await downloadMediaMessage(message, 'buffer'), mediaType);
                break;
        }
        
        async function sticker(mediaBuffer, mediaType) {
            try {
                let inputPath, outputPath;

                if (mediaType === 'image') {
                    inputPath = path.join(__dirname, 'temp.png');
                    outputPath = path.join(__dirname, 'temp.webp');
                    fs.writeFileSync(inputPath, mediaBuffer);

                    await sharp(inputPath)
                        .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                        .webp({ quality: 80 })
                        .toFile(outputPath);
                } else {
                    inputPath = path.join(__dirname, 'temp.mp4');
                    outputPath = path.join(__dirname, 'temp.webp');
                    fs.writeFileSync(inputPath, mediaBuffer);

                    await new Promise((resolve, reject) => {
                        ffmpeg(inputPath)
                            .inputOptions('-t 6')
                            .size('512x512')
                            .outputOptions([
                                '-vcodec', 'libwebp',
                                '-loop', '0',
                                '-preset', 'default',
                                '-an',
                                '-vsync', '0',
                                '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,fps=15',
                            ])
                            .output(outputPath)
                            .on('end', () => resolve())
                            .on('error', (err) => reject(err))
                            .run();
                    });
                }
                          
                await sock.sendMessage(id, { sticker: fs.readFileSync(outputPath) }, { quoted: message });

                fs.unlinkSync(inputPath);
                fs.unlinkSync(outputPath);
            } catch (err) {
                console.error('Error converting media to sticker:', err);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

connectToWhatsApp();
