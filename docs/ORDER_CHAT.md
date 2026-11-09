# Order chat (customer ↔ rider, store ↔ rider)

Glovo-style, order-only chat. There is **no direct customer ↔ store chat**: customers reach a business through DOORSTEP Help.

| Channel | Who | Open for writing | Readable |
|---|---|---|---|
| `CUSTOMER_RIDER` | the order's customer and its rider | from the moment a rider **accepts** the job until delivery (or cancellation) | 24 hours after it closes |
| `STORE_RIDER` | the business's team and the rider | from rider accepted until the rider **picks up** | 24 hours after pickup |

Rules live in `server/orderChat.js` (no database, unit-tested); the API is `server/orderChatRoutes.js`.

## What people see

- **Customer** — *Orders › order*: "Chat with your rider" (with an unread badge) while a rider is on the order. Quick replies ("I'm outside", "Leave it at the gate"…), typed messages, **Share my location** (sends a map pin), read ticks, **Report** on the rider's messages, and the Call button when calling is allowed.
- **Rider** — current job card on the dashboard: "Chat with the store" (until pickup) and "Chat with the customer".
- **Business** — Live orders: "Chat with the rider" on each order with a rider assigned.
- **Admin** — *Customers › Order chats* (`/admin/chats`): read-only, recent and reported chats, search by order number. Admins can't post here.

Messages refresh every 4 seconds while a chat is open, and the unread badge every 20 seconds. A new message sends an in-app notification (and a phone push through the existing notification system) to the other side — one alert per chat until it's read, so a burst of messages doesn't flood their phone. Tapping it opens the chat directly.

## Safety

- Phone numbers, bank/account numbers (10+ digits), emails and links are replaced with `•••` **before saving** (the original is never stored); the sender is told why. The Call button still works where calling is allowed.
- 500 characters per message; at most 20 messages per person every 5 minutes.
- Shared locations must be inside Nigeria's bounds.
- Anyone in the chat can report the other side's message (rude/abusive, asked to pay outside DOORSTEP, spam/unsafe). Admins get a security notification with a link to the chat.

## API

```
GET  /api/order-chat/:orderIdOrNumber?channel=CUSTOMER_RIDER|STORE_RIDER
POST /api/order-chat/:ref            { channel, body } | { channel, quickReply: index } | { channel, location: { latitude, longitude } }
POST /api/order-chat/:ref/read       { channel }
POST /api/order-chat/:ref/report     { channel, messageId, reason }
GET  /api/order-chat-unread
GET  /api/admin/chats[?reported=1]   GET /api/admin/chats?order=DS-1234
```

Errors: `403 NOT_IN_THIS_CHAT`, `404 ORDER_NOT_FOUND`, `409 CHAT_CLOSED`, `429 TOO_MANY_MESSAGES`, `400 EMPTY_MESSAGE / INVALID_LOCATION`.

## Database (migration `20261109120000_order_chat`, additive only)

New table `OrderChatMessage` (order, channel, sender, role, kind TEXT/QUICK/LOCATION, body, optional pin, hidden kinds, read/report times), deleted with its order. Nothing existing is changed. Notifications use the existing `DELIVERY` and `SECURITY` types (no enum change).

## Not included (yet)

- **Photos in chat** (e.g. a rider's photo of the gate): needs the upload storage decision first.
- **Masked calls** (calling without seeing each other's number): needs a paid telephony provider (e.g. Africa's Talking or Twilio) — a cost to approve before it's added.
- Real-time sockets: chat uses short polling, which works through Coolify/Cloudflare with no extra set-up.
