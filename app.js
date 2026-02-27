// app.js (stable, matches your index.html)
(() => {
  // Prevent double init (helps with extensions / hot reload)
  if (window.chatAppInitialized) return;
  window.chatAppInitialized = true;

  class ChatApp {
    constructor() {
      this.currentRoom = "general";
      this.ws = null;

      this.manualClose = false;
      this.reconnectTimer = null;
      this.reconnectAttempts = 0;

      this.token = this.getToken() || "dummy";
      this.email = this.emailFromToken(this.token) || "guest@local";

      this.cacheDom();
      this.bindEvents();

      this.setUser(this.email);
      this.setRoom(this.currentRoom);

      this.loadHistory(this.currentRoom);
      this.connect();
    }

    cacheDom() {
      this.roomNameEl = document.getElementById("roomName");
      this.currentUserEl = document.getElementById("currentUser");

      // In your HTML: room list does NOT have id, so we select by class
      this.roomListEl = document.querySelector(".room-list");

      this.messageListEl = document.getElementById("messageList");

      this.messageFormEl = document.getElementById("messageForm");
      this.messageInputEl = document.getElementById("messageInput");

      // In your HTML: status dot has no id, it is the span with class "status-indicator"
      this.statusDotEl = document.querySelector("#connectionStatus .status-indicator");
      this.statusTextEl = document.getElementById("statusText");

      this.messagesContainerEl = document.getElementById("messagesContainer");
    }

    bindEvents() {
      // Send message
      this.messageFormEl.addEventListener("submit", (e) => {
        e.preventDefault();
        this.sendMessage();
      });

      // Room switch (buttons are inside .room-list)
      this.roomListEl.querySelectorAll(".room-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const room = btn.dataset.room;
          this.switchRoom(room);

          // UI active class
          this.roomListEl.querySelectorAll(".room-btn").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
        });
      });

      // Clean close on tab close
      window.addEventListener("beforeunload", () => {
        this.manualClose = true;
        try {
          if (this.ws) this.ws.close();
        } catch {}
      });
    }

    setUser(email) {
      this.currentUserEl.textContent = email;
    }

    setRoom(room) {
      this.roomNameEl.textContent = room;
    }

    setStatus(connected) {
      if (connected) {
        this.statusTextEl.textContent = "Connected";
        this.statusDotEl.classList.remove("disconnected");
        this.statusDotEl.classList.add("connected");
      } else {
        this.statusTextEl.textContent = "Disconnected";
        this.statusDotEl.classList.remove("connected");
        this.statusDotEl.classList.add("disconnected");
      }
    }

    getToken() {
      const params = new URLSearchParams(window.location.search);
      return (
        localStorage.getItem("id_token") ||
        localStorage.getItem("token") ||
        params.get("token") ||
        null
      );
    }

    emailFromToken(token) {
      try {
        const parts = token.split(".");
        if (parts.length !== 3) return null;

        const payload = JSON.parse(this.b64urlDecode(parts[1]));
        const email =
          payload.email ||
          payload["cognito:username"] ||
          payload.username ||
          "";

        return email.toString().trim().toLowerCase() || null;
      } catch {
        return null;
      }
    }

    b64urlDecode(str) {
      str = str.replace(/-/g, "+").replace(/_/g, "/");
      while (str.length % 4) str += "=";
      return atob(str);
    }

    apiFetch(path) {
      return fetch(path, { cache: "no-store" });
    }

    async loadHistory(room) {
      try {
        const res = await this.apiFetch(`/rooms/${room}/messages?limit=50`);
        const data = await res.json();

        this.messageListEl.innerHTML = "";
        (data.messages || []).forEach((m) => this.renderMessage(m));
        this.scrollToBottom();
      } catch (e) {
        console.error("History load failed:", e);
      }
    }

    wsUrl(room) {
      const wsProto = window.location.protocol === "https:" ? "wss" : "ws";
      const host = window.location.host;

      const token = encodeURIComponent(this.token || "dummy");
      const email = encodeURIComponent(this.email || "guest@local");

      // backend should accept token (ignored) + email
      return `${wsProto}://${host}/ws/${room}?token=${token}&email=${email}`;
    }

    connect() {
      // Block parallel connects
      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
        return;
      }

      this.manualClose = false;

      const url = this.wsUrl(this.currentRoom);
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.setStatus(true);
        this.reconnectAttempts = 0;

        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.renderMessage(msg);
          this.scrollToBottom();
        } catch (e) {
          console.error("Bad WS message:", e, event.data);
        }
      };

      this.ws.onclose = () => {
        this.setStatus(false);

        if (this.manualClose) return;
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        // Do nothing here; onclose will handle reconnect
      };
    }

    scheduleReconnect() {
      if (this.reconnectTimer) return;

      this.reconnectAttempts += 1;

      // Backoff: 0.5s, 1s, 1.5s ... up to 10s
      const delay = Math.min(10000, 500 * this.reconnectAttempts);

      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, delay);
    }

    switchRoom(room) {
      if (!room || room === this.currentRoom) return;

      // Stop reconnect + close socket
      this.manualClose = true;
      try {
        if (this.ws) this.ws.close();
      } catch {}
      this.ws = null;

      this.currentRoom = room;
      this.setRoom(room);

      this.loadHistory(room);

      this.manualClose = false;
      this.connect();
    }

    sendMessage() {
      const text = (this.messageInputEl.value || "").trim();
      if (!text) return;

      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.setStatus(false);
        this.connect();
        return;
      }

      // Send JSON (your backend accepts this)
      this.ws.send(JSON.stringify({ text }));

      this.messageInputEl.value = "";
    }

    renderMessage(msg) {
      if (!msg) return;

      // Only show real messages
      if (msg.type && msg.type !== "message") return;

      // Backend might send "email" OR "username". Prefer email.
      const who = (msg.email || msg.username || "unknown").toString();
      const text = (msg.text || "").toString();
      const ts = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : "";

      const wrapper = document.createElement("div");
      wrapper.className = "message";

      wrapper.innerHTML = `
        <div class="message-meta">
          <span class="message-user">${this.escape(who)}</span>
          <span class="message-time">${this.escape(ts)}</span>
        </div>
        <div class="message-text">${this.escape(text)}</div>
      `;

      this.messageListEl.appendChild(wrapper);
    }

    scrollToBottom() {
      if (!this.messagesContainerEl) return;
      this.messagesContainerEl.scrollTop = this.messagesContainerEl.scrollHeight;
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
})();