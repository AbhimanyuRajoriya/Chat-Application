// app.js (final: no infinite reconnect on room switch, single instance guard, uses email)

// Prevent multiple ChatApp instances (very common cause of reconnect chaos)
if (window.__CHAT_APP_RUNNING__) {
  console.warn("ChatApp already running. Preventing duplicate instance.");
} else {
  window.__CHAT_APP_RUNNING__ = true;

  class ChatApp {
    constructor() {
      this.currentRoom = "general";

      this.websocket = null;
      this.isConnected = false;

      this.reconnectTimer = null;
      this.reconnectAttempts = 0;
      this.maxReconnectDelayMs = 10000;

      // blocks parallel connects during switch/connect
      this.connectInProgress = false;

      this.token = this.getToken() || "dummy";
      this.email = this.getEmailFromToken(this.token) || "guest@local";

      this.cacheDom();
      this.bindEvents();
      this.init();
    }

    cacheDom() {
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

          this.roomButtons.forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
        });
      });

      window.addEventListener("beforeunload", () => {
        this.closeSocketHard(); // no reconnect
      });
    }

    init() {
      this.currentUserEl.textContent = `👤 ${this.email}`;
      this.roomNameEl.textContent = this.currentRoom;

      this.loadHistory(this.currentRoom);
      this.connectWebSocket();
    }

    // --------------------------
    // Token / Email
    // --------------------------
    getToken() {
      const ls = localStorage.getItem("id_token");
      if (ls) return ls;

      const params = new URLSearchParams(window.location.search);
      return params.get("token");
    }

    getEmailFromToken(token) {
      try {
        const parts = token.split(".");
        if (parts.length !== 3) return null;

        const payloadJson = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
        const payload = JSON.parse(payloadJson);

        const email = payload.email || payload["cognito:username"] || payload.username;
        return email ? String(email).toLowerCase() : null;
      } catch {
        return null;
      }
    }

    // --------------------------
    // API / WS base
    // --------------------------
    apiBase() {
      if (window.CONFIG && CONFIG.API_BASE) return CONFIG.API_BASE.replace(/\/$/, "");
      return "";
    }

    wsBase() {
      if (window.CONFIG && CONFIG.WS_BASE) return CONFIG.WS_BASE.replace(/\/$/, "");
      const isHttps = window.location.protocol === "https:";
      return `${isHttps ? "wss" : "ws"}://${window.location.host}`;
    }

    messagesUrl(room) {
      return `${this.apiBase()}/rooms/${encodeURIComponent(room)}/messages?limit=50`;
    }

    wsUrl(room) {
      const t = encodeURIComponent(this.token || "dummy");
      const e = encodeURIComponent(this.email || "guest@local");
      return `${this.wsBase()}/ws/${encodeURIComponent(room)}?token=${t}&email=${e}`;
    }

    // --------------------------
    // UI status
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
    // WebSocket (robust)
    // --------------------------
    connectWebSocket() {
      if (this.connectInProgress) return;

      // prevent parallel sockets
      if (
        this.websocket &&
        (this.websocket.readyState === WebSocket.OPEN ||
          this.websocket.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }

      // clear reconnect timer
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      this.connectInProgress = true;

      const url = this.wsUrl(this.currentRoom);
      console.log("WS connecting:", url);

      const ws = new WebSocket(url);
      this.websocket = ws;

      ws.onopen = () => {
        // if this.websocket changed meanwhile, ignore
        if (this.websocket !== ws) return;

        this.reconnectAttempts = 0;
        this.connectInProgress = false;
        this.setStatus(true);
        console.log("WS connected");
      };

      ws.onmessage = (event) => {
        if (this.websocket !== ws) return;

        try {
          const msg = JSON.parse(event.data);
          this.renderMessage(msg);
        } catch (e) {
          console.error("Bad WS message:", e, event.data);
        }
      };

      ws.onerror = () => {
        // let onclose handle retry
      };

      ws.onclose = () => {
        // CRITICAL: if this socket is not the current one, do nothing
        if (this.websocket !== ws) return;

        this.connectInProgress = false;
        this.setStatus(false);
        console.log("WS closed");

        this.scheduleReconnect();
      };
    }

    scheduleReconnect() {
      if (this.reconnectTimer) return;

      this.reconnectAttempts += 1;
      const delay = Math.min(this.maxReconnectDelayMs, 800 * this.reconnectAttempts);

      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connectWebSocket();
      }, delay);
    }

    closeSocketHard() {
      // stop reconnect timer
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      this.connectInProgress = false;

      if (this.websocket) {
        // IMPORTANT: detach handlers so close() cannot trigger reconnect logic
        try {
          this.websocket.onopen = null;
          this.websocket.onmessage = null;
          this.websocket.onerror = null;
          this.websocket.onclose = null;
          this.websocket.close();
        } catch {}
      }

      this.websocket = null;
      this.setStatus(false);
    }

    // --------------------------
    // Room switching
    // --------------------------
    switchRoom(room) {
      if (!room || room === this.currentRoom) return;

      // fully kill current ws (no handlers -> no reconnect)
      this.closeSocketHard();

      this.currentRoom = room;
      this.roomNameEl.textContent = room;

      this.loadHistory(room);
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

      this.websocket.send(JSON.stringify({ text, room_id: this.currentRoom }));
      this.messageInputEl.value = "";
    }

    // --------------------------
    // Render
    // --------------------------
    renderMessage(msg) {
      if (!msg || msg.type !== "message") return;

      const user = msg.email || msg.username || "unknown";
      const text = msg.text || "";
      const ts = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : "";

      const div = document.createElement("div");
      div.className = "message";
      div.classList.add(
        (user || "").toLowerCase() === (this.email || "").toLowerCase() ? "own" : "other"
      );

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
}