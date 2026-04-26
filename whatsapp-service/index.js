require("dotenv").config();

const admin = require("firebase-admin");
const qrcode = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");

const QUEUE_COLLECTION = process.env.WHATSAPP_QUEUE_COLLECTION || "whatsappQueue";
const PROCESSING_TTL_MS = Number(process.env.PROCESSING_TTL_MS || 5 * 60 * 1000);
const processingDocs = new Map();

admin.initializeApp();
const db = admin.firestore();

const waClient = new Client({
  authStrategy: new LocalAuth({ clientId: process.env.WA_CLIENT_ID || "clinic-pro" }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  }
});

waClient.on("qr", (qr) => {
  console.log("Scan this QR with WhatsApp:");
  qrcode.generate(qr, { small: true });
});

waClient.on("ready", () => {
  console.log("WhatsApp client ready.");
  startQueueListener();
});

waClient.on("auth_failure", (msg) => {
  console.error("WhatsApp auth failure:", msg);
});

waClient.on("disconnected", (reason) => {
  console.error("WhatsApp disconnected:", reason);
});

function normalizeToChatId(phoneE164) {
  const numeric = String(phoneE164 || "").replace(/[^\d]/g, "");
  if (!numeric) return "";
  return `${numeric}@c.us`;
}

function isProcessing(docId) {
  const started = processingDocs.get(docId);
  if (!started) return false;
  if (Date.now() - started > PROCESSING_TTL_MS) {
    processingDocs.delete(docId);
    return false;
  }
  return true;
}

async function markResult(docRef, updates) {
  await docRef.set(
    {
      ...updates,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    },
    { merge: true }
  );
}

async function processQueueDoc(docSnap) {
  if (!docSnap.exists) return;
  const docId = docSnap.id;
  if (isProcessing(docId)) return;
  processingDocs.set(docId, Date.now());

  try {
    const data = docSnap.data() || {};
    const chatId = normalizeToChatId(data.phoneE164);
    const message = String(data.message || "").trim();

    if (!chatId || !message) {
      await markResult(docSnap.ref, {
        status: "failed",
        error: "Missing phoneE164 or message."
      });
      return;
    }

    await markResult(docSnap.ref, {
      status: "processing",
      processingStartedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const isRegistered = await waClient.isRegisteredUser(chatId);
    if (!isRegistered) {
      await markResult(docSnap.ref, {
        status: "failed",
        error: "Phone is not registered on WhatsApp."
      });
      return;
    }

    const sent = await waClient.sendMessage(chatId, message);
    await markResult(docSnap.ref, {
      status: "sent",
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      whatsappMessageId: sent?.id?._serialized || ""
    });
    console.log(`Sent WhatsApp for queue item ${docId}`);
  } catch (error) {
    console.error(`Queue item ${docId} failed:`, error);
    await markResult(docSnap.ref, {
      status: "failed",
      error: error?.message || "Unknown send error"
    });
  } finally {
    processingDocs.delete(docId);
  }
}

function startQueueListener() {
  console.log(`Listening for pending docs in "${QUEUE_COLLECTION}"...`);
  db.collection(QUEUE_COLLECTION)
    .where("status", "==", "pending")
    .onSnapshot(
      async (snap) => {
        const tasks = [];
        snap.docChanges().forEach((change) => {
          if (change.type === "added") tasks.push(processQueueDoc(change.doc));
        });
        await Promise.all(tasks);
      },
      (error) => {
        console.error("Firestore listener error:", error);
      }
    );
}

waClient.initialize();
