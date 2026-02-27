// app.js (final: no infinite reconnect on room switch, single instance guard, uses email)

// Prevent multiple ChatApp instances (this alone fixes a LOT of reconnect chaos)
if (window.__CHAT_APP_RUNNING__) {
  console.warn("ChatApp already running - skipping duplicate init");
} else {
  window.__CHAT_APP_RUNNING__ = true;

  class ChatApp {
    constructor() {
      this.currentRoom = "general";

      this.websocket = null;

      // Generation counter: any old socket events become invalid after room switch
      this.wsGen = 0;

      this.reconnectTimer = null;
      this.reconnectAttempts = 0;
      this.maxReconnectDelayMs = 10000;

      // Auth: token + email
      this.token = this.getToken() || "dummy";
      this.email = this.getEmailFromToken(this.token) || "guest@local";

      // DOM
      this.roomNameEl = document.getElementById("roomName");
      this.currentUserEl = document.getElementById("currentUser");
      this.messageFormEl = document.getElementById("messageForm");
      this.messageInputEl = document.getElementById("messageInput");
      this.messageListEl = document.getElementById("messageList");
      this.statusTextEl = document.getElementById("statusText");
      this.statusDotEl = document.querySelector(".status-indicator");
      this.roomButtons = document.querySelectorAll(".room-btn");

      this.bindEvents();
      this.init();
    }

    // --------------------------
    // Init / UI
    // --------------------------
    init() {
      this.currentUserEl.textContent = `👤 ${this.email}`;
      this.roomNameEl.textContent = this.currentRoom;

      this.setStatus(false);

      this.loadHistory(this.currentRoom);
      this.connectWebSocket();
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

          // active UI
          this.roomButtons.forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
        });
      });

      window.addEventListener("beforeunload", () => {
        this.closeSocketHard(); // stop reconnects on page close
      });
    }

    setStatus(connected) {
      this.statusTextEl.textContent = connected ? "Connected" : "Disconnected";
      if (this.statusDotEl) {
        this.statusDotEl.classList.toggle("connected", connected);
        this.statusDotEl.classList.toggle("disconnected", !connected);
      }
    }

    // --------------------------
    // Token / Email
    // --------------------------
    getToken() {
      // Prefer your stored token
      const ls = localStorage.getItem("id_token");
      if (ls) return ls;

      // Optional: token in query
      const params = new URLSearchParams(window.location.search);
      return params.get("token");
    }

    getEmailFromToken(token) {
      try {
        const parts = String(token).split(".");
        if (parts.length !== 3) return null;

        const payloadJson = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
        const payload = JSON.parse(payloadJson);

        const email =
          payload.email ||
          payload["cognito:username"] ||
          payload.username;

        return email ? String(email).toLowerCase() : null;
      } catch {
        return null;
      }
    }

    // --------------------------
    // Config helpers
    // --------------------------
    apiBase() {
      // config.js: CONFIG.API_REST_ENDPOINT
      if (window.CONFIG && CONFIG.API_REST_ENDPOINT) {
        return String(CONFIG.API_REST_ENDPOINT).replace(/\/$/, "");
      }
      return ""; // same origin
    }

    wsBase() {
      // config.js: CONFIG.WS_ENDPOINT (if you have it)
      if (window.CONFIG && CONFIG.WS_ENDPOINT) {
        return String(CONFIG.WS_ENDPOINT).replace(/\/$/, "");
      }

      const isHttps = window.location.protocol === "https:";
      const proto = isHttps ? "wss" : "ws";
      return `${proto}://${window.location.host}`;
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
    // WebSocket (NO infinite reconnect)
    // --------------------------
    connectWebSocket() {
      // Don’t open a second WS if already open/connecting
      if (
        this.websocket &&
        (this.websocket.readyState === WebSocket.OPEN ||
          this.websocket.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }

      const myGen = ++this.wsGen;

      // cancel pending reconnect
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      const url = this.wsUrl(this.currentRoom);
      console.log("WS connecting:", url);

      const ws = new WebSocket(url);
      this.websocket = ws;

      ws.onopen = () => {
        if (myGen !== this.wsGen) {
          try { ws.close(); } catch {}
          return;
        }
        this.reconnectAttempts = 0;
        this.setStatus(true);
        console.log("WS connected");
      };

      ws.onmessage = (event) => {
        if (myGen !== this.wsGen) return;
        try {
          const msg = JSON.parse(event.data);
          this.renderMessage(msg);
        } catch (e) {
          console.error("Bad WS message:", e, event.data);
        }
      };

      ws.onerror = () => {
        // allow onclose to handle it
      };

      ws.onclose = () => {
        // CRITICAL: if room switched, ignore old close
        if (myGen !== this.wsGen) return;

        this.setStatus(false);
        console.log("WS closed");

        this.scheduleReconnect(myGen);
      };
    }

    scheduleReconnect(gen) {
      if (gen !== this.wsGen) return;
      if (this.reconnectTimer) return;

      this.reconnectAttempts += 1;
      const delay = Math.min(this.maxReconnectDelayMs, 500 * this.reconnectAttempts);

      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (gen !== this.wsGen) return;
        this.connectWebSocket();
      }, delay);
    }

    closeSocketHard() {
      // Invalidate old socket handlers + stop reconnect timer
      this.wsGen += 1;

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

      // hard close current socket (prevents its onclose from reconnecting)
      this.closeSocketHard();

      this.currentRoom = room;
      this.roomNameEl.textContent = room;

      this.messageListEl.innerHTML = "";

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

      if (String(user).toLowerCase() === String(this.email).toLowerCase()) {
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
}