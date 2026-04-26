# Clinic Pro WhatsApp Service

This service watches Firestore queue documents and sends WhatsApp booking confirmations using `whatsapp-web.js`.

## How it connects to your app

- Your `index.html` now writes queue docs into `whatsappQueue` after each successful booking.
- This worker listens to that collection and sends the message.
- Queue doc status is updated: `pending` -> `processing` -> `sent` or `failed`.

## Setup

1. Open this folder:
   - `cd whatsapp-service`
2. Install dependencies:
   - `npm install`
3. Copy env file:
   - `cp .env.example .env`
4. Ensure Firebase Admin credentials are available.
   - Recommended: set `GOOGLE_APPLICATION_CREDENTIALS` to your service account JSON path.
5. Start the worker:
   - `npm start`
6. Scan the QR code in terminal using the WhatsApp account you want to send from.

## Notes

- Keep this service running 24/7 (VM, server, or process manager).
- `whatsapp-web.js` is an unofficial integration; account stability is not guaranteed.
- For official production messaging, migrate to WhatsApp Business Cloud API.
