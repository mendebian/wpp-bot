const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, downloadMediaMessage, makeInMemoryStore } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('.log/');

    const sock = makeWASocket({
        printQRInTerminal: true,
        auth: state,
        logger: pino({
            level: 'silent'
        }),
        browser: [
            'obi-wan',
            'kenobi',
            '1.0.0'
        ],
        syncFullHistory: true,
        generateHighQualityLinkPreview: true
    });


    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed:', lastDisconnect.error?.message || 'Unknown error');

            if (shouldReconnect) {
                console.log('Reconnecting...');
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
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

connectToWhatsApp();