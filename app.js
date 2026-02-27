// app.js (final - code->token exchange, real email, no infinite reconnect, single instance guard)

if (window.__CHAT_APP_RUNNING__) {
  console.warn("ChatApp already running - skipping duplicate init");
} else {
  window.__CHAT_APP_RUNNING__ = true;

  class ChatApp {
    constructor() {
      this.currentRoom = (window.CONFIG && CONFIG.DEFAULT_ROOM) || "general";

      this.websocket = null;

      // Generation counter: invalidates old socket callbacks on room switch
      this.wsGen = 0;

      this.reconnectTimer = null;
      this.reconnectAttempts = 0;
      this.maxReconnectDelayMs = 10000;

      // Auth
      this.token = null;  // id_token
      this.email = "guest@local";

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

      // 1) If we have ?code=..., exchange it to tokens and store.
      await this.tryExchangeCodeForTokens();

      // 2) Load token from storage and derive email
      this.token = this.getIdToken() || "dummy";
      this.email = this.getEmailFromIdToken(this.token) || "guest@local";
      this.currentUserEl.textContent = `👤 ${this.email}`;

      // 3) Load history and connect WS
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

          // active UI
          this.roomButtons.forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
        });
      });

      window.addEventListener("beforeunload", () => {
        this.closeSocketHard();
      });
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
      // IMPORTANT: WebSocket must NOT be via CloudFront unless you configured it properly for WS.
      // But since you are already connecting via CloudFront, keep it.
      if (window.CONFIG && CONFIG.API_GATEWAY_ENDPOINT) {
        return String(CONFIG.API_GATEWAY_ENDPOINT).replace(/\/$/, "");
      }

      const isHttps = window.location.protocol === "https:";
      const proto = isHttps ? "wss" : "ws";
      return `${proto}://${window.location.host}`;
    }

    messagesUrl(room) {
      const limit = (window.CONFIG && CONFIG.MESSAGE_LOAD_LIMIT) || 50;
      return `${this.apiBase()}/rooms/${encodeURIComponent(room)}/messages?limit=${limit}`;
    }

    wsUrl(room) {
      const t = encodeURIComponent(this.token || "dummy");
      const e = encodeURIComponent(this.email || "guest@local");
      return `${this.wsBase()}/ws/${encodeURIComponent(room)}?token=${t}&email=${e}`;
    }

    // --------------------------
    // Cognito Code -> Tokens (FIXES guest@local)
    // --------------------------
    getAuthCodeFromUrl() {
      const params = new URLSearchParams(window.location.search);
      return params.get("code");
    }

    clearCodeFromUrl() {
      // remove ?code=... after successful exchange (prevents re-exchange loops)
      const url = new URL(window.location.href);
      url.searchParams.delete("code");
      url.searchParams.delete("state");
      window.history.replaceState({}, document.title, url.toString());
    }

    getIdToken() {
      return localStorage.getItem("id_token");
    }

    async tryExchangeCodeForTokens() {
      const code = this.getAuthCodeFromUrl();
      if (!code) return;

      // If already have a token, don’t re-exchange
      if (localStorage.getItem("id_token")) {
        this.clearCodeFromUrl();
        return;
      }

      // MUST have Cognito domain + client id
      if (!window.CONFIG || !CONFIG.COGNITO_DOMAIN || !CONFIG.COGNITO_CLIENT_ID) {
        console.error("Missing Cognito config - cannot exchange code.");
        return;
      }

      try {
        const tokenUrl = `https://${CONFIG.COGNITO_DOMAIN}/oauth2/token`;

        const redirectUri = window.location.origin; // must match app client callback URL
        const body = new URLSearchParams({
          grant_type: "authorization_code",
          client_id: CONFIG.COGNITO_CLIENT_ID,
          code: code,
          redirect_uri: redirectUri
        });

        const res = await fetch(tokenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString()
        });

        if (!res.ok) {
          const txt = await res.text();
          console.error("Token exchange failed:", res.status, txt);
          return;
        }

        const data = await res.json();

        // Store tokens
        if (data.id_token) localStorage.setItem("id_token", data.id_token);
        if (data.access_token) localStorage.setItem("access_token", data.access_token);
        if (data.refresh_token) localStorage.setItem("refresh_token", data.refresh_token);

        this.clearCodeFromUrl();
        console.log("✅ Code exchanged. Tokens stored.");
      } catch (e) {
        console.error("Token exchange error:", e);
      }
    }

    getEmailFromIdToken(token) {
      try {
        const parts = String(token).split(".");
        if (parts.length !== 3) return null;

        const payloadJson = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
        const payload = JSON.parse(payloadJson);

        // Cognito email flow: email claim exists when scope includes email and attribute present
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
    // Status UI
    // --------------------------
    setStatus(connected) {
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
    // WebSocket (stable, no infinite reconnect on room switch)
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
    // Room switch
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