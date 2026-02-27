// app.js - Stable frontend (Email identity, NO JWT)

class ChatApp {
  constructor() {
    this.email = this.initEmail();
    this.currentRoom = CONFIG.DEFAULT_ROOM;

    this.websocket = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.shouldReconnect = true;
    this.messageBuffer = [];

    this.initElements();
    this.attachEvents();
    this.showUI();

    this.loadMessageHistory().then(() => this.connectWebSocket());
  }

  initElements() {
    this.chatContainer = document.getElementById("chatContainer");
    this.messageForm = document.getElementById("messageForm");
    this.messageInput = document.getElementById("messageInput");
    this.messageList = document.getElementById("messageList");
    this.currentUserSpan = document.getElementById("currentUser");
    this.roomNameSpan = document.getElementById("roomName");
    this.statusText = document.getElementById("statusText");
    this.statusIndicator = document.querySelector(".status-indicator");
    this.roomButtons = document.querySelectorAll(".room-btn");
  }

  attachEvents() {
    this.messageForm.addEventListener("submit", (e) => this.sendMessage(e));
    this.roomButtons.forEach(btn => {
      btn.addEventListener("click", () => this.switchRoom(btn.dataset.room));
    });
  }

  initEmail() {
    let email = localStorage.getItem("email");
    if (!email) {
      email = (prompt("Enter your email:") || "").trim().toLowerCase();
      if (!email || !email.includes("@")) email = "guest@local";
      localStorage.setItem("email", email);
    }
    return email;
  }

  showUI() {
    this.chatContainer.style.display = "flex";
    this.currentUserSpan.textContent = `📧 ${this.email}`;
    this.roomNameSpan.textContent = this.currentRoom;
    this.setStatus(false);
  }

  setStatus(connected) {
    this.isConnected = connected;

    if (connected) {
      this.statusIndicator.classList.add("connected");
      this.statusIndicator.classList.remove("disconnected");
      this.statusText.textContent = "✅ Connected";
    } else {
      this.statusIndicator.classList.remove("connected");
      this.statusIndicator.classList.add("disconnected");
      this.statusText.textContent = "❌ Disconnected";
    }
  }

  connectWebSocket() {
    // ✅ Guard: don't open multiple sockets
    if (this.websocket && (this.websocket.readyState === WebSocket.OPEN || this.websocket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const email = encodeURIComponent(localStorage.getItem("email") || "guest@local");
    const wsUrl = `${CONFIG.API_GATEWAY_ENDPOINT}/ws/${this.currentRoom}?email=${email}&token=dummy`;
    console.log("Connecting:", wsUrl);

    this.websocket = new WebSocket(wsUrl);

    this.websocket.onopen = () => {
      console.log("✅ WebSocket connected");
      this.reconnectAttempts = 0;
      this.setStatus(true);

      // flush buffered messages
      while (this.messageBuffer.length > 0) {
        const payload = this.messageBuffer.shift();
        try {
          this.websocket.send(JSON.stringify(payload));
        } catch (e) {
          console.error("Flush send failed:", e);
        }
      }
    };

    this.websocket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "message") {
          this.displayMessage(msg.email, msg.text, msg.timestamp);
        }
      } catch (e) {
        console.error("Bad message:", event.data);
      }
    };

    this.websocket.onerror = (e) => {
      console.error("❌ WebSocket error", e);
    };

    this.websocket.onclose = () => {
      console.log("📴 WebSocket closed");
      this.setStatus(false);

      if (this.shouldReconnect) {
        this.tryReconnect();
      }
    };
  }

  tryReconnect() {
    if (this.reconnectAttempts >= CONFIG.WEBSOCKET_MAX_RETRIES) {
      console.error("Max retries reached");
      return;
    }
    this.reconnectAttempts++;
    const delay = CONFIG.WEBSOCKET_RECONNECT_DELAY * this.reconnectAttempts;
    setTimeout(() => this.connectWebSocket(), delay);
  }

  async loadMessageHistory() {
    try {
      const url = `${CONFIG.API_REST_ENDPOINT}/rooms/${this.currentRoom}/messages?limit=${CONFIG.MESSAGE_LOAD_LIMIT}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      this.messageList.innerHTML = "";
      (data.messages || []).forEach(m => {
        if (m.type === "message") {
          this.displayMessage(m.email, m.text, m.timestamp);
        }
      });
    } catch (e) {
      console.warn("History load failed:", e.message);
    }
  }

  displayMessage(email, text, timestamp) {
    const div = document.createElement("div");
    div.className = "message";
    div.classList.add(email === this.email ? "own" : "other");

    const time = new Date(timestamp).toLocaleTimeString();

    div.innerHTML = `
      <div class="message-content">${this.escapeHtml(text)}</div>
      <div class="message-meta">${this.escapeHtml(email)} • ${time}</div>
    `;

    this.messageList.appendChild(div);
    this.messageList.scrollTop = this.messageList.scrollHeight;
  }

  async sendMessage(e) {
    e.preventDefault();
    const text = this.messageInput.value.trim();
    if (!text) return;

    const payload = { text, room_id: this.currentRoom };

    // ✅ If socket not ready, buffer and reconnect ONCE
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN || !this.isConnected) {
      this.messageBuffer.push(payload);
      this.connectWebSocket();
      return;
    }

    this.websocket.send(JSON.stringify(payload));
    this.messageInput.value = "";
    this.messageInput.focus();
  }

  switchRoom(roomId) {
    if (!roomId || roomId === this.currentRoom) return;

    this.roomButtons.forEach(btn => btn.classList.remove("active"));
    document.querySelector(`[data-room="${roomId}"]`)?.classList.add("active");

    this.currentRoom = roomId;
    this.roomNameSpan.textContent = roomId;

    // ✅ Intentional close without reconnect spam
    this.shouldReconnect = false;
    try { this.websocket?.close(); } catch (_) {}
    this.websocket = null;
    this.setStatus(false);
    this.shouldReconnect = true;

    this.messageList.innerHTML = "";
    this.loadMessageHistory().then(() => this.connectWebSocket());
  }

  escapeHtml(text) {
    const d = document.createElement("div");
    d.textContent = text;
    return d.innerHTML;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.chatApp = new ChatApp();
});