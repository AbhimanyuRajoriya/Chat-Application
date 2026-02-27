// app.js (stable)
class ChatApp {
  constructor() {
    this.currentRoom = "general";
    this.websocket = null;

    this.isConnected = false;
    this.manualClose = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;

    this.username = "Loading..."; // will show email
    this.token = this.getTokenFromUrl() || "dummy";

    this.cacheDom();
    this.bindEvents();

    this.init();
  }

  cacheDom() {
    this.usernameEl = document.getElementById("usernameDisplay");
    this.roomsListEl = document.getElementById("roomsList");
    this.currentRoomEl = document.getElementById("currentRoom");
    this.messagesListEl = document.getElementById("messagesList");
    this.messageInputEl = document.getElementById("messageInput");
    this.sendBtnEl = document.getElementById("sendBtn");
    this.connectionStatusEl = document.getElementById("connectionStatus");
  }

  bindEvents() {
    this.sendBtnEl.addEventListener("click", () => this.sendMessage());
    this.messageInputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.sendMessage();
    });

    // Room clicks
    this.roomsListEl.querySelectorAll(".room-item").forEach((li) => {
      li.addEventListener("click", () => {
        const room = li.dataset.room;
        this.switchRoom(room);
      });
    });

    window.addEventListener("beforeunload", () => {
      this.manualClose = true;
      try {
        if (this.websocket) this.websocket.close();
      } catch {}
    });
  }

  init() {
    // email shown in UI = decoded from token (best effort)
    const email = this.emailFromToken(this.token) || "guest@local";
    this.username = email;
    this.usernameEl.textContent = email;

    this.currentRoomEl.textContent = this.currentRoom;

    this.loadHistory(this.currentRoom);
    this.connectWebSocket();
  }

  getTokenFromUrl() {
    // your site uses ?code=... normally; but you already log "Token obtained"
    // If you already have token stored somewhere else, keep it.
    // For stability: allow token to be injected later, but don't break.
    const params = new URLSearchParams(window.location.search);
    // if you have id token in localStorage, use that:
    return localStorage.getItem("id_token") || params.get("token") || null;
  }

  emailFromToken(token) {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
      return (payload.email || payload["cognito:username"] || payload.username || "").toLowerCase();
    } catch {
      return null;
    }
  }

  setStatus(text, ok) {
    this.connectionStatusEl.textContent = text;
    this.connectionStatusEl.classList.toggle("connected", !!ok);
    this.connectionStatusEl.classList.toggle("disconnected", !ok);
  }

  async loadHistory(room) {
    try {
      const res = await fetch(`/rooms/${room}/messages?limit=50`);
      const data = await res.json();

      this.messagesListEl.innerHTML = "";
      (data.messages || []).forEach((m) => this.renderMessage(m));
    } catch (e) {
      console.error("History load failed:", e);
    }
  }

  wsUrlForRoom(room) {
    const isHttps = window.location.protocol === "https:";
    const wsProto = isHttps ? "wss" : "ws";
    // use same host (cloudfront) and pass token
    return `${wsProto}://${window.location.host}/ws/${room}?token=${encodeURIComponent(this.token || "dummy")}`;
  }

  connectWebSocket() {
    // prevent multiple parallel connects
    if (this.websocket && (this.websocket.readyState === WebSocket.OPEN || this.websocket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.manualClose = false;

    const url = this.wsUrlForRoom(this.currentRoom);
    console.log("Connecting WS:", url);

    this.websocket = new WebSocket(url);

    this.websocket.onopen = () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.setStatus("✅ Connected", true);
    };

    this.websocket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.renderMessage(msg);
      } catch (e) {
        console.error("Bad WS message:", e, event.data);
      }
    };

    this.websocket.onclose = () => {
      this.isConnected = false;
      this.setStatus("❌ Disconnected", false);

      if (this.manualClose) return; // do NOT reconnect if we intentionally closed

      this.scheduleReconnect();
    };

    this.websocket.onerror = () => {
      // let onclose handle reconnect
    };
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;

    this.reconnectAttempts += 1;
    const delay = Math.min(10000, 500 * this.reconnectAttempts); // 0.5s, 1s, 1.5s ... max 10s

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectWebSocket();
    }, delay);
  }

  switchRoom(room) {
    if (!room || room === this.currentRoom) return;

    this.currentRoom = room;
    this.currentRoomEl.textContent = room;

    // Close existing socket WITHOUT triggering reconnect loop
    this.manualClose = true;
    try {
      if (this.websocket) this.websocket.close();
    } catch {}
    this.websocket = null;

    this.isConnected = false;
    this.setStatus("❌ Disconnected", false);

    // load and connect to new room
    this.loadHistory(room);
    this.manualClose = false;
    this.connectWebSocket();
  }

  sendMessage() {
    const text = (this.messageInputEl.value || "").trim();
    if (!text) return;

    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      this.setStatus("❌ Disconnected", false);
      this.connectWebSocket();
      return;
    }

    const payload = JSON.stringify({ text, room_id: this.currentRoom });
    this.websocket.send(payload);

    this.messageInputEl.value = "";
  }

  renderMessage(msg) {
    // backend sends: {type, username(email), text, timestamp}
    if (!msg || msg.type !== "message") return;

    const user = msg.username || "unknown";
    const text = msg.text || "";
    const ts = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : "";

    const li = document.createElement("li");
    li.className = "message-item";
    li.innerHTML = `<span class="message-username">${this.escape(user)}</span>
                    <span class="message-timestamp">${this.escape(ts)}</span>
                    <div class="message-text">${this.escape(text)}</div>`;

    this.messagesListEl.appendChild(li);
    this.messagesListEl.scrollTop = this.messagesListEl.scrollHeight;
  }

  escape(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.chatApp = new ChatApp();
});