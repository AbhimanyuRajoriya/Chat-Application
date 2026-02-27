// app.js (stable - no infinite reconnect, uses email)
class ChatApp {
  constructor() {
    this.currentRoom = "general";

    this.websocket = null;
    this.isConnected = false;

    // IMPORTANT: used to stop old sockets from reconnecting after room switch
    this.wsGeneration = 0;

    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.maxReconnectDelayMs = 10000;

    // Auth
    this.token = this.getToken() || "dummy";
    this.email = this.getEmailFromToken(this.token) || "guest@local";

    this.cacheDom();
    this.bindEvents();

    this.init();
  }

  cacheDom() {
    // IDs from your index.html
    this.roomNameEl = document.getElementById("roomName");
    this.currentUserEl = document.getElementById("currentUser");
    this.messageFormEl = document.getElementById("messageForm");
    this.messageInputEl = document.getElementById("messageInput");
    this.messageListEl = document.getElementById("messageList");
    this.statusTextEl = document.getElementById("statusText");
    this.statusDotEl = document.querySelector(".status-indicator");
    this.roomButtons = document.querySelectorAll(".room-btn");
  }

  bindEvents() {
    this.messageFormEl.addEventListener("submit", (e) => {
      e.preventDefault();
      this.sendMessage();
    });

    this.roomButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const room = btn.dataset.room;
        this.switchRoom(room);

        // UI active button
        this.roomButtons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });

    window.addEventListener("beforeunload", () => {
      this.closeSocketHard(); // no reconnect while leaving
    });
  }

  init() {
    this.currentUserEl.textContent = `👤 ${this.email}`;
    this.roomNameEl.textContent = this.currentRoom;

    this.loadHistory(this.currentRoom);
    this.connectWebSocket(); // initial connect
  }

  // --------------------------
  // Token / Email
  // --------------------------
  getToken() {
    // Prefer localStorage (your app already uses it)
    const ls = localStorage.getItem("id_token");
    if (ls) return ls;

    // Optional: token= in query
    const params = new URLSearchParams(window.location.search);
    return params.get("token");
  }

  getEmailFromToken(token) {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;

      const payloadJson = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
      const payload = JSON.parse(payloadJson);

      // Cognito: email exists if you enabled it
      const email =
        payload.email ||
        payload["cognito:username"] || // sometimes email is stored here
        payload.username;

      return email ? String(email).toLowerCase() : null;
    } catch {
      return null;
    }
  }

  // --------------------------
  // API / WS URL helpers
  // --------------------------
  apiBase() {
    // If config.js defines CONFIG.API_BASE, use it; else relative
    if (window.CONFIG && CONFIG.API_BASE) return CONFIG.API_BASE.replace(/\/$/, "");
    return ""; // same origin
  }

  wsBase() {
    // If config.js defines CONFIG.WS_BASE, use it; else same host/protocol
    if (window.CONFIG && CONFIG.WS_BASE) return CONFIG.WS_BASE.replace(/\/$/, "");

    const isHttps = window.location.protocol === "https:";
    const proto = isHttps ? "wss" : "ws";
    return `${proto}://${window.location.host}`;
  }

  messagesUrl(room) {
    return `${this.apiBase()}/rooms/${encodeURIComponent(room)}/messages?limit=50`;
  }

  wsUrl(room) {
    // Pass BOTH token and email so backend can store identity properly
    const t = encodeURIComponent(this.token || "dummy");
    const e = encodeURIComponent(this.email || "guest@local");
    return `${this.wsBase()}/ws/${encodeURIComponent(room)}?token=${t}&email=${e}`;
  }

  // --------------------------
  // Connection status UI
  // --------------------------
  setStatus(connected) {
    this.isConnected = connected;
    this.statusTextEl.textContent = connected ? "Connected" : "Disconnected";
    if (this.statusDotEl) {
      this.statusDotEl.classList.toggle("connected", connected);
      this.statusDotEl.classList.toggle("disconnected", !connected);
    }
  }

  // --------------------------
  // History
  // --------------------------
  async loadHistory(room) {
    try {
      const res = await fetch(this.messagesUrl(room));
      const data = await res.json();

      this.messageListEl.innerHTML = "";
      (data.messages || []).forEach((m) => this.renderMessage(m));
    } catch (err) {
      console.error("History load failed:", err);
    }
  }

  // --------------------------
  // WebSocket core
  // --------------------------
  connectWebSocket() {
    // prevent parallel sockets
    if (
      this.websocket &&
      (this.websocket.readyState === WebSocket.OPEN ||
        this.websocket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    // New generation => old socket reconnects become invalid automatically
    const myGen = ++this.wsGeneration;

    // clear any old reconnect timers
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const url = this.wsUrl(this.currentRoom);
    console.log("WS connecting:", url);

    this.websocket = new WebSocket(url);

    this.websocket.onopen = () => {
      // If this isn’t latest generation, close immediately
      if (myGen !== this.wsGeneration) {
        try { this.websocket.close(); } catch {}
        return;
      }

      this.reconnectAttempts = 0;
      this.setStatus(true);
      console.log("WS connected");
    };

    this.websocket.onmessage = (event) => {
      if (myGen !== this.wsGeneration) return; // ignore old socket messages
      try {
        const msg = JSON.parse(event.data);
        this.renderMessage(msg);
      } catch (e) {
        console.error("Bad WS message:", e, event.data);
      }
    };

    this.websocket.onerror = () => {
      // Let onclose handle retry
    };

    this.websocket.onclose = () => {
      // If this socket is not current gen, DO NOTHING (prevents infinite reconnect on room switch)
      if (myGen !== this.wsGeneration) return;

      this.setStatus(false);
      console.log("WS closed");

      this.scheduleReconnect(myGen);
    };
  }

  scheduleReconnect(gen) {
    // Only reconnect if still current gen
    if (gen !== this.wsGeneration) return;

    if (this.reconnectTimer) return;

    this.reconnectAttempts += 1;
    const delay = Math.min(this.maxReconnectDelayMs, 500 * this.reconnectAttempts);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (gen !== this.wsGeneration) return;
      this.connectWebSocket();
    }, delay);
  }

  closeSocketHard() {
    // Kill reconnect + invalidate any old handlers
    this.wsGeneration += 1;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    try {
      if (this.websocket) this.websocket.close();
    } catch {}

    this.websocket = null;
    this.setStatus(false);
  }

  // --------------------------
  // Room switching
  // --------------------------
  switchRoom(room) {
    if (!room || room === this.currentRoom) return;

    // Hard-close current socket and STOP any reconnect from it
    this.closeSocketHard();

    this.currentRoom = room;
    this.roomNameEl.textContent = room;

    this.loadHistory(room);

    // Connect fresh socket for new room
    this.connectWebSocket();
  }

  // --------------------------
  // Send
  // --------------------------
  sendMessage() {
    const text = (this.messageInputEl.value || "").trim();
    if (!text) return;

    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      this.setStatus(false);
      this.connectWebSocket();
      return;
    }

    const payload = JSON.stringify({
      text,
      room_id: this.currentRoom,
    });

    this.websocket.send(payload);
    this.messageInputEl.value = "";
  }

  // --------------------------
  // Render
  // --------------------------
  renderMessage(msg) {
    if (!msg) return;

    // support both shapes:
    // backend old: {type, username, text, timestamp}
    // backend new: {type, email, text, timestamp}
    if (msg.type !== "message") return;

    const user = msg.email || msg.username || "unknown";
    const text = msg.text || "";
    const ts = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : "";

    const div = document.createElement("div");
    div.className = "message";

    if ((user || "").toLowerCase() === (this.email || "").toLowerCase()) {
      div.classList.add("own");
    } else {
      div.classList.add("other");
    }

    div.innerHTML = `
      <div class="message-content">${this.escape(text)}</div>
      <div class="message-meta">${this.escape(user)} • ${this.escape(ts)}</div>
    `;

    this.messageListEl.appendChild(div);
    this.messageListEl.scrollTop = this.messageListEl.scrollHeight;
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