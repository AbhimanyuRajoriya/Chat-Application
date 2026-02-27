// app.js (final - Cognito code exchange + real email + stable WS switching)

// Prevent multiple app instances (CloudFront cache weirdness / duplicate loads)
if (window.__CHAT_APP_RUNNING__) {
  console.warn("ChatApp already running - skipping duplicate init");
} else {
  window.__CHAT_APP_RUNNING__ = true;

  class ChatApp {
    constructor() {
      this.currentRoom = (window.CONFIG && CONFIG.DEFAULT_ROOM) ? CONFIG.DEFAULT_ROOM : "general";

      this.websocket = null;
      this.wsGen = 0;

      this.reconnectTimer = null;
      this.reconnectAttempts = 0;
      this.maxReconnectDelayMs = 10000;

      // Auth
      this.token = this.getIdToken() || null; // id_token
      this.email = this.getEmailFromJwt(this.token) || "guest@local";

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

      // Start
      this.init().catch((e) => console.error("Init failed:", e));
    }

    // --------------------------
    // Init
    // --------------------------
    async init() {
      // 1) If we came back from Cognito Hosted UI with ?code=..., exchange it
      const code = this.getAuthCodeFromUrl();
      if (code) {
        const ok = await this.exchangeCodeForTokens(code);
        if (ok) {
          // remove ?code from URL (prevents re-exchange on refresh)
          this.cleanUrl();
        }
      }

      // 2) Re-read token/email after exchange
      this.token = this.getIdToken() || "dummy";
      this.email = this.getEmailFromJwt(this.token) || "guest@local";

      // 3) UI
      this.currentUserEl.textContent = `👤 ${this.email}`;
      this.roomNameEl.textContent = this.currentRoom;
      this.setStatus(false);

      // 4) Load history and connect
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
      // IMPORTANT:
      // Your config has API_GATEWAY_ENDPOINT = "wss://cloudfront..."
      if (window.CONFIG && CONFIG.API_GATEWAY_ENDPOINT) {
        return String(CONFIG.API_GATEWAY_ENDPOINT).replace(/\/$/, "");
      }

      const isHttps = window.location.protocol === "https:";
      const proto = isHttps ? "wss" : "ws";
      return `${proto}://${window.location.host}`;
    }

    // --------------------------
    // Cognito code exchange (server-side)
    // --------------------------
    getAuthCodeFromUrl() {
      const params = new URLSearchParams(window.location.search);
      return params.get("code");
    }

    cleanUrl() {
      // remove query params completely (simple + safe)
      const clean = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, clean);
    }

    getIdToken() {
      return localStorage.getItem("id_token");
    }

    async exchangeCodeForTokens(code) {
      try {
        const redirectUri = window.location.origin; // matches your Hosted UI redirect
        const url = `${this.apiBase()}/auth/exchange`;

        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, redirect_uri: redirectUri }),
        });

        const data = await res.json();
        if (!data.ok) {
          console.error("Token exchange failed:", data.error);
          return false;
        }

        const tokens = data.tokens || {};
        if (tokens.id_token) localStorage.setItem("id_token", tokens.id_token);
        if (tokens.access_token) localStorage.setItem("access_token", tokens.access_token);

        return true;
      } catch (e) {
        console.error("Token exchange error:", e);
        return false;
      }
    }

    // --------------------------
    // JWT email extraction (frontend display)
    // --------------------------
    getEmailFromJwt(token) {
      try {
        if (!token) return null;
        const parts = String(token).split(".");
        if (parts.length !== 3) return null;

        const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const pad = "=".repeat((4 - (b64.length % 4)) % 4);
        const payload = JSON.parse(atob(b64 + pad));

        const email =
          payload.email ||
          payload["cognito:username"] ||
          payload.username ||
          payload.preferred_username;

        return email ? String(email).toLowerCase() : null;
      } catch {
        return null;
      }
    }

    // --------------------------
    // UI status
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
        const url = `${this.apiBase()}/rooms/${encodeURIComponent(room)}/messages?limit=50`;
        const res = await fetch(url);
        const data = await res.json();

        this.messageListEl.innerHTML = "";
        (data.messages || []).forEach((m) => this.renderMessage(m));
      } catch (e) {
        console.error("History load failed:", e);
      }
    }

    // --------------------------
    // WebSocket (stable)
    // --------------------------
    wsUrl(room) {
      const t = encodeURIComponent(this.token || "dummy");
      const e = encodeURIComponent(this.email || "guest@local");
      return `${this.wsBase()}/ws/${encodeURIComponent(room)}?token=${t}&email=${e}`;
    }

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

    switchRoom(room) {
      if (!room || room === this.currentRoom) return;

      this.closeSocketHard();

      this.currentRoom = room;
      this.roomNameEl.textContent = room;

      this.messageListEl.innerHTML = "";
      this.loadHistory(room);
      this.connectWebSocket();
    }

    // --------------------------
    // Send + Render
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