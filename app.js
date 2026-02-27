// app.js (final: fixes guest@local by exchanging Cognito ?code= to id_token)
// - single instance guard
// - no infinite reconnect on room switch
// - uses Cognito email (from id_token) as identity
// - expects backend endpoint: GET /auth/exchange?code=...&redirect_uri=...

if (window.__CHAT_APP_RUNNING__) {
  console.warn("ChatApp already running - skipping duplicate init");
} else {
  window.__CHAT_APP_RUNNING__ = true;

  class ChatApp {
    constructor() {
      this.currentRoom = (window.CONFIG && CONFIG.DEFAULT_ROOM) || "general";

      this.websocket = null;
      this.wsGen = 0; // generation counter to kill old socket reconnects

      this.reconnectTimer = null;
      this.reconnectAttempts = 0;
      this.maxReconnectDelayMs = 10000;

      // Tokens + identity
      this.idToken = localStorage.getItem("id_token") || null;
      this.accessToken = localStorage.getItem("access_token") || null;

      this.email = this.getEmailFromToken(this.idToken) || "guest@local";

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
    // Init
    // --------------------------
    async init() {
      this.roomNameEl.textContent = this.currentRoom;
      this.setStatus(false);

      // 1) If we came from Cognito Hosted UI, we have ?code=
      //    Exchange code -> tokens -> store -> set email
      await this.handleAuthCodeIfPresent();

      // 2) Update UI with real email (after exchange)
      this.email = this.getEmailFromToken(localStorage.getItem("id_token")) || "guest@local";
      this.currentUserEl.textContent = `👤 ${this.email}`;

      // 3) Load messages + connect WS
      await this.loadHistory(this.currentRoom);
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

          this.roomButtons.forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
        });
      });

      window.addEventListener("beforeunload", () => {
        this.closeSocketHard();
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
    // Config helpers
    // --------------------------
    apiBase() {
      if (window.CONFIG && CONFIG.API_REST_ENDPOINT) {
        return String(CONFIG.API_REST_ENDPOINT).replace(/\/$/, "");
      }
      return "";
    }

    wsBase() {
      // Use config.js gateway endpoint if present, else same host
      if (window.CONFIG && CONFIG.API_GATEWAY_ENDPOINT) {
        return String(CONFIG.API_GATEWAY_ENDPOINT).replace(/\/$/, "");
      }
      const isHttps = window.location.protocol === "https:";
      const proto = isHttps ? "wss" : "ws";
      return `${proto}://${window.location.host}`;
    }

    messagesUrl(room) {
      return `${this.apiBase()}/rooms/${encodeURIComponent(room)}/messages?limit=50`;
    }

    wsUrl(room) {
      const token = localStorage.getItem("id_token") || "dummy";
      const email = this.getEmailFromToken(token) || "guest@local";

      // Pass both: backend can store/use email directly
      return `${this.wsBase()}/ws/${encodeURIComponent(room)}?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
    }

    // --------------------------
    // Auth Code Exchange (THIS FIXES guest@local)
    // --------------------------
    async handleAuthCodeIfPresent() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      if (!code) return;

      try {
        const redirectUri = window.location.origin;

        // backend should exchange code for tokens
        const url = `${this.apiBase()}/auth/exchange?code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
        const res = await fetch(url);

        if (!res.ok) {
          console.error("Auth exchange failed:", res.status, await res.text());
          return;
        }

        const data = await res.json();

        if (data.id_token) localStorage.setItem("id_token", data.id_token);
        if (data.access_token) localStorage.setItem("access_token", data.access_token);
        if (data.refresh_token) localStorage.setItem("refresh_token", data.refresh_token);

        // Clean URL (remove ?code=...) so refresh doesn’t re-exchange endlessly
        params.delete("code");
        const newUrl = `${window.location.pathname}${params.toString() ? "?" + params.toString() : ""}`;
        window.history.replaceState({}, document.title, newUrl);
      } catch (e) {
        console.error("Auth exchange error:", e);
      }
    }

    getEmailFromToken(token) {
      try {
        if (!token) return null;
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
    // WebSocket (no infinite reconnect)
    // --------------------------
    connectWebSocket() {
      if (
        this.websocket &&
        (this.websocket.readyState === WebSocket.OPEN ||
          this.websocket.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }

      const myGen = ++this.wsGen;

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

      ws.onclose = () => {
        if (myGen !== this.wsGen) return;
        this.setStatus(false);
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
    async switchRoom(room) {
      if (!room || room === this.currentRoom) return;

      this.closeSocketHard();

      this.currentRoom = room;
      this.roomNameEl.textContent = room;
      this.messageListEl.innerHTML = "";

      await this.loadHistory(room);
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

      const me = (this.getEmailFromToken(localStorage.getItem("id_token")) || "guest@local").toLowerCase();
      if (String(user).toLowerCase() === me) div.classList.add("own");
      else div.classList.add("other");

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