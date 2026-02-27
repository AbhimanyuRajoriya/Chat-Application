class ChatApp {
  constructor() {
    this.currentRoom = "general";
    this.websocket = null;

    this.manualClose = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;

    // unique id for each socket; used to ignore stale callbacks
    this.wsGen = 0;

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
    this.messageFormEl.addEventListener("submit", (e) => {
      e.preventDefault();
      this.sendMessage();
    });

    this.roomButtons.forEach((btn) => {
      btn.addEventListener("click", () => this.switchRoom(btn.dataset.room));
    });

    window.addEventListener("beforeunload", () => {
      this.manualClose = true;
      this.clearReconnectTimer();
      this.bumpWsGen(); // invalidate callbacks
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

  bumpWsGen() {
    // invalidates callbacks from older sockets
    this.wsGen += 1;
  }

  getToken() {
    const stored = localStorage.getItem("id_token");
    if (stored) return stored;
    const params = new URLSearchParams(window.location.search);
    return params.get("token");
  }

  emailFromToken(token) {
    try {
      const parts = String(token || "").split(".");
      if (parts.length !== 3) return null;
      const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const payload = JSON.parse(atob(payloadB64));
      const email = (payload.email || payload["cognito:username"] || "").trim().toLowerCase();
      return email || null;
    } catch {
      return null;
    }
  }

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

  wsUrlForRoom(room) {
    const wsProto = window.location.protocol === "https:" ? "wss" : "ws";
    const qs = new URLSearchParams({
      token: this.token || "dummy",
      email: this.email || "guest@local",
    });
    return `${wsProto}://${window.location.host}/ws/${encodeURIComponent(room)}?${qs.toString()}`;
  }

  connectWebSocket() {
    // block if already connecting/open
    if (this.websocket && (this.websocket.readyState === WebSocket.OPEN || this.websocket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.manualClose = false;
    this.clearReconnectTimer();

    const myGen = ++this.wsGen; // this socket's generation id
    const url = this.wsUrlForRoom(this.currentRoom);

    this.setStatus("Connecting...", false);

    const ws = new WebSocket(url);
    this.websocket = ws;

    ws.onopen = () => {
      if (myGen !== this.wsGen) return; // stale
      this.reconnectAttempts = 0;
      this.setStatus("Connected", true);
    };

    ws.onmessage = (event) => {
      if (myGen !== this.wsGen) return; // stale
      try {
        const msg = JSON.parse(event.data);
        this.renderMessage(msg);
      } catch {
        // ignore garbage
      }
    };

    ws.onclose = () => {
      if (myGen !== this.wsGen) return; // stale close from older socket

      this.websocket = null;
      this.setStatus("Disconnected", false);

      // CRITICAL: do NOT reconnect if we closed for room switch/unload
      if (this.manualClose) return;

      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // let onclose handle it
    };
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;

    this.reconnectAttempts += 1;
    const delay = Math.min(10000, 700 * this.reconnectAttempts);

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

  switchRoom(room) {
    if (!room || room === this.currentRoom) return;

    // UI active
    this.roomButtons.forEach((b) => b.classList.toggle("active", b.dataset.room === room));

    // STOP ALL reconnect behavior for this close
    this.manualClose = true;
    this.clearReconnectTimer();

    // invalidate all old ws handlers
    this.bumpWsGen();

    // close old socket
    try {
      if (this.websocket) this.websocket.close(1000, "switch room");
    } catch {}
    this.websocket = null;

    // set room + load + connect new socket
    this.currentRoom = room;
    this.roomNameEl.textContent = room;

    this.setStatus("Connecting...", false);
    this.loadHistory(room);

    // allow reconnect for the NEW socket only
    this.manualClose = false;
    this.connectWebSocket();
  }

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

  renderMessage(msg) {
    if (!msg) return;
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