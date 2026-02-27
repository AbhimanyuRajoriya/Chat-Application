// app.js (stable - room switching + no reconnect storm + email identity)
class ChatApp {
  constructor() {
    this.currentRoom = "general";
    this.websocket = null;

    this.manualClose = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;

    // Used to ignore stale events from older sockets
    this.socketSeq = 0;

    this.token = this.getToken() || "dummy";
    this.email = this.emailFromToken(this.token) || "guest@local";

    this.cacheDom();
    this.bindEvents();
    this.init();
  }

  cacheDom() {
    this.roomNameEl = document.getElementById("roomName");
    this.currentUserEl = document.getElementById("currentUser");

    this.messageListEl = document.getElementById("messageList");
    this.messageInputEl = document.getElementById("messageInput");
    this.messageFormEl = document.getElementById("messageForm");

    this.statusTextEl = document.getElementById("statusText");
    this.statusIndicatorEl = document.querySelector("#connectionStatus .status-indicator");

    this.roomButtons = Array.from(document.querySelectorAll(".room-btn"));
  }

  bindEvents() {
    // Send message via form submit
    this.messageFormEl.addEventListener("submit", (e) => {
      e.preventDefault();
      this.sendMessage();
    });

    // Room switching
    this.roomButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const room = btn.dataset.room;
        this.switchRoom(room);
      });
    });

    // Close socket cleanly on tab close
    window.addEventListener("beforeunload", () => {
      this.manualClose = true;
      this.clearReconnectTimer();
      try {
        if (this.websocket) this.websocket.close(1000, "page unload");
      } catch {}
    });
  }

  init() {
    this.currentUserEl.textContent = this.email;
    this.roomNameEl.textContent = this.currentRoom;

    this.setStatus("Connecting...", false);

    this.loadHistory(this.currentRoom);
    this.connectWebSocket();
  }

  // -------------------------
  // Token + Email
  // -------------------------
  getToken() {
    // Prefer localStorage (stable for CloudFront SPA)
    const stored = localStorage.getItem("id_token");
    if (stored) return stored;

    // Optional fallback if you ever pass ?token=
    const params = new URLSearchParams(window.location.search);
    return params.get("token");
  }

  emailFromToken(token) {
    try {
      const parts = String(token || "").split(".");
      if (parts.length !== 3) return null;

      // base64url -> base64
      const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const json = JSON.parse(atob(payloadB64));

      // Cognito commonly has "email"
      const email = (json.email || json["cognito:username"] || "").trim().toLowerCase();
      return email || null;
    } catch {
      return null;
    }
  }

  // -------------------------
  // REST history
  // -------------------------
  async loadHistory(room) {
    try {
      const res = await fetch(`/rooms/${encodeURIComponent(room)}/messages?limit=50`);
      const data = await res.json();

      this.messageListEl.innerHTML = "";
      (data.messages || []).forEach((m) => this.renderMessage(m));
    } catch (e) {
      console.error("History load failed:", e);
    }
  }

  // -------------------------
  // WebSocket
  // -------------------------
  wsUrlForRoom(room) {
    const isHttps = window.location.protocol === "https:";
    const wsProto = isHttps ? "wss" : "ws";

    // Send email so backend can identify user without username in Cognito
    const qs = new URLSearchParams({
      token: this.token || "dummy",
      email: this.email || "guest@local",
    });

    return `${wsProto}://${window.location.host}/ws/${encodeURIComponent(room)}?${qs.toString()}`;
  }

  connectWebSocket() {
    // prevent parallel sockets
    if (this.websocket && (this.websocket.readyState === WebSocket.OPEN || this.websocket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.manualClose = false;
    this.clearReconnectTimer();

    const mySeq = ++this.socketSeq; // mark this socket generation
    const url = this.wsUrlForRoom(this.currentRoom);

    console.log("Connecting WS:", url);
    this.setStatus("Connecting...", false);

    const ws = new WebSocket(url);
    this.websocket = ws;

    ws.onopen = () => {
      // Ignore stale events
      if (mySeq !== this.socketSeq) return;

      this.reconnectAttempts = 0;
      this.setStatus("Connected", true);
    };

    ws.onmessage = (event) => {
      if (mySeq !== this.socketSeq) return;

      try {
        const msg = JSON.parse(event.data);
        this.renderMessage(msg);
      } catch {
        // If backend ever sends plain text
        this.renderMessage({ type: "message", email: "system", text: String(event.data), timestamp: new Date().toISOString() });
      }
    };

    ws.onclose = () => {
      if (mySeq !== this.socketSeq) return;

      this.websocket = null;
      this.setStatus("Disconnected", false);

      // If we closed intentionally (room switch / unload), DO NOT reconnect
      if (this.manualClose) return;

      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // Let onclose do the reconnect path
    };
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;

    this.reconnectAttempts += 1;
    const delay = Math.min(10000, 500 * this.reconnectAttempts); // 0.5s -> 10s max

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectWebSocket();
    }, delay);
  }

  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // -------------------------
  // Room switching
  // -------------------------
  switchRoom(room) {
    if (!room || room === this.currentRoom) return;

    // UI active state
    this.roomButtons.forEach((b) => b.classList.toggle("active", b.dataset.room === room));

    // Stop reconnects from old socket
    this.manualClose = true;
    this.clearReconnectTimer();

    // Invalidate current socket generation so old callbacks become NO-OP
    this.socketSeq += 1;

    try {
      if (this.websocket) this.websocket.close(1000, "switch room");
    } catch {}
    this.websocket = null;

    this.currentRoom = room;
    this.roomNameEl.textContent = room;

    this.setStatus("Connecting...", false);

    this.loadHistory(room);

    // Now connect cleanly for new room
    this.manualClose = false;
    this.connectWebSocket();
  }

  // -------------------------
  // Send message
  // -------------------------
  sendMessage() {
    const text = (this.messageInputEl.value || "").trim();
    if (!text) return;

    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      this.setStatus("Disconnected", false);
      this.connectWebSocket();
      return;
    }

    this.websocket.send(JSON.stringify({ text, room_id: this.currentRoom }));
    this.messageInputEl.value = "";
  }

  // -------------------------
  // Render
  // -------------------------
  renderMessage(msg) {
    if (!msg) return;

    // Ignore system spam if it ever comes back
    if (msg.type && msg.type !== "message") return;

    const who = (msg.email || msg.username || "unknown").toString();
    const text = (msg.text || "").toString();
    const ts = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : "";

    const row = document.createElement("div");
    row.className = "message-row";
    row.innerHTML = `
      <div class="message-meta">
        <span class="message-user">${this.escape(who)}</span>
        <span class="message-time">${this.escape(ts)}</span>
      </div>
      <div class="message-text">${this.escape(text)}</div>
    `;

    this.messageListEl.appendChild(row);
    this.messageListEl.scrollTop = this.messageListEl.scrollHeight;
  }

  setStatus(text, connected) {
    this.statusTextEl.textContent = text;

    if (this.statusIndicatorEl) {
      this.statusIndicatorEl.classList.toggle("connected", !!connected);
      this.statusIndicatorEl.classList.toggle("disconnected", !connected);
    }
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