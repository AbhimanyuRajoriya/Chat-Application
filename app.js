// app.js (clean: never shows guest@local anywhere)
// - single instance guard
// - no infinite reconnect on room switch
// - if email not available => shows "Anonymous" (NOT guest@local)
// - ws url: does NOT send email param unless we have a real email
// - messages: if stored sender is guest@local => display "Anonymous"

if (window.__CHAT_APP_RUNNING__) {
  console.warn("ChatApp already running - skipping duplicate init");
} else {
  window.__CHAT_APP_RUNNING__ = true;

  class ChatApp {
    constructor() {
      this.currentRoom = (window.CONFIG && CONFIG.DEFAULT_ROOM) || "general";

      this.websocket = null;
      this.wsGen = 0;

      this.reconnectTimer = null;
      this.reconnectAttempts = 0;
      this.maxReconnectDelayMs = 10000;

      // Tokens
      this.idToken = localStorage.getItem("id_token") || null;

      // Identity (NEVER default to guest@local)
      this.email = this.getEmailFromToken(this.idToken); // can be null
      this.displayName = this.safeDisplayName(this.email);

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

      // Always show safe name (never guest@local)
      this.refreshIdentityUI();

      await this.loadHistory(this.currentRoom);
      this.connectWebSocket();
    }

    refreshIdentityUI() {
      // Re-read token in case it was set later
      this.idToken = localStorage.getItem("id_token") || null;
      this.email = this.getEmailFromToken(this.idToken);
      this.displayName = this.safeDisplayName(this.email);

      // UI shows Anonymous if no email
      if (this.currentUserEl) this.currentUserEl.textContent = `👤 ${this.displayName}`;
    }

    bindEvents() {
      if (this.messageFormEl) {
        this.messageFormEl.addEventListener("submit", (e) => {
          e.preventDefault();
          this.sendMessage();
        });
      }

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
      if (this.statusTextEl) this.statusTextEl.textContent = connected ? "Connected" : "Disconnected";
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
      if (window.CONFIG && CONFIG.API_GATEWAY_ENDPOINT) {
        return String(CONFIG.API_GATEWAY_ENDPOINT).replace(/\/$/, "");
      }
      const isHttps = window.location.protocol === "https:";
      return `${isHttps ? "wss" : "ws"}://${window.location.host}`;
    }

    messagesUrl(room) {
      return `${this.apiBase()}/rooms/${encodeURIComponent(room)}/messages?limit=50`;
    }

    wsUrl(room) {
      // Token: if missing, use "dummy" but DO NOT attach guest email
      const token = localStorage.getItem("id_token") || "dummy";
      const email = this.getEmailFromToken(token); // null if not real

      let url = `${this.wsBase()}/ws/${encodeURIComponent(room)}?token=${encodeURIComponent(token)}`;

      // Only attach email param if we actually have a real email
      if (email) url += `&email=${encodeURIComponent(email)}`;

      return url;
    }

    // --------------------------
    // Identity helpers
    // --------------------------
    safeDisplayName(email) {
      // Hard rule: never show guest@local anywhere
      if (!email) return "Anonymous";

      const e = String(email).toLowerCase().trim();
      if (!e || e === "guest@local") return "Anonymous";
      return e;
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

        if (!email) return null;

        const e = String(email).toLowerCase().trim();
        if (!e || e === "guest@local") return null;
        return e;
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
      ) return;

      const myGen = ++this.wsGen;

      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      // Refresh UI identity before connecting (in case token was set)
      this.refreshIdentityUI();

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
    // Render (never show guest@local)
    // --------------------------
    renderMessage(msg) {
      if (!msg || msg.type !== "message") return;

      // Backends may send: email or username
      const rawUser = msg.email || msg.username || "";
      const user = this.safeDisplayName(rawUser); // converts guest@local -> Anonymous
      const text = msg.text || "";
      const ts = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : "";

      const div = document.createElement("div");
      div.className = "message";

      // Own/other only if we have real email AND message has real email
      const me = this.getEmailFromToken(localStorage.getItem("id_token"));
      if (me && rawUser && String(rawUser).toLowerCase() === String(me).toLowerCase()) {
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