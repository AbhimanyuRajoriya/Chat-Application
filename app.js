// app.js - Stable frontend (Email identity, no JWT)

class ChatApp {
    constructor() {
        console.log("🚀 Initializing Chat Application...");

        this.email = this.initializeEmail();
        console.log(`📧 Email: ${this.email}`);

        this.currentRoom = CONFIG.DEFAULT_ROOM;
        this.websocket = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.shouldReconnect = true;
        this.messageBuffer = [];

        this.initializeElements();
        this.attachEventListeners();
        this.showChatUI();

        this.loadMessageHistory().then(() => this.connectWebSocket());
    }

    initializeElements() {
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

    attachEventListeners() {
        this.messageForm.addEventListener("submit", (e) => this.handleSendMessage(e));
        this.roomButtons.forEach(btn => {
            btn.addEventListener("click", () => this.switchRoom(btn.dataset.room));
        });
    }

    initializeEmail() {
        let email = localStorage.getItem("email");
        if (!email) {
            email = (prompt("Enter your email:") || "").trim().toLowerCase();
            if (!email || !email.includes("@")) email = "guest@local";
            localStorage.setItem("email", email);
        }
        return email;
    }

    showChatUI() {
        this.chatContainer.style.display = "flex";
        this.currentUserSpan.textContent = `📧 ${this.email}`;
        this.roomNameSpan.textContent = this.currentRoom;
        this.updateConnectionStatus(false);
    }

    connectWebSocket() {
        // prevent duplicate connects
        if (this.websocket && (this.websocket.readyState === WebSocket.OPEN || this.websocket.readyState === WebSocket.CONNECTING)) {
            return;
        }

        const wsUrl = `${CONFIG.API_GATEWAY_ENDPOINT}/ws/${this.currentRoom}?email=${encodeURIComponent(this.email)}`;
        console.log("Connecting:", wsUrl);

        this.websocket = new WebSocket(wsUrl);

        this.websocket.onopen = () => {
            console.log("✅ WebSocket connected");
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.updateConnectionStatus(true);

            // flush buffered messages
            while (this.messageBuffer.length > 0) {
                const msg = this.messageBuffer.shift();
                try {
                    this.websocket.send(JSON.stringify(msg));
                } catch (e) {
                    console.error("❌ Failed to flush message:", e);
                }
            }
        };

        this.websocket.onclose = () => {
            console.log("📴 WebSocket closed");
            this.isConnected = false;
            this.updateConnectionStatus(false);
            if (this.shouldReconnect) this.attemptReconnect();
        };

        this.websocket.onerror = (e) => {
            console.error("❌ WebSocket error", e);
        };

        this.websocket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleMessageReceived(message);
            } catch (e) {
                console.error("❌ Bad message JSON:", e, event.data);
            }
        };
    }

    attemptReconnect() {
        if (this.reconnectAttempts >= CONFIG.WEBSOCKET_MAX_RETRIES) {
            this.showError("Connection failed. Refresh the page.");
            return;
        }
        this.reconnectAttempts++;
        const delay = CONFIG.WEBSOCKET_RECONNECT_DELAY * this.reconnectAttempts;
        console.log(`🔄 Reconnecting in ${delay}ms...`);
        setTimeout(() => this.connectWebSocket(), delay);
    }

    async loadMessageHistory() {
        try {
            const url = `${CONFIG.API_REST_ENDPOINT}/rooms/${this.currentRoom}/messages?limit=${CONFIG.MESSAGE_LOAD_LIMIT}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            this.messageList.innerHTML = "";

            if (Array.isArray(data.messages)) {
                data.messages.forEach(msg => {
                    if (msg.type === "message") {
                        this.displayMessage(msg.email, msg.text, msg.timestamp);
                    }
                });
            }
        } catch (e) {
            console.warn("⚠️ history load failed:", e.message);
        }
    }

    handleMessageReceived(message) {
        if (message.type === "message") {
            this.displayMessage(message.email, message.text, message.timestamp);
        }
    }

    displayMessage(email, text, timestamp) {
        const messageDiv = document.createElement("div");
        messageDiv.className = "message";

        if (email === this.email) messageDiv.classList.add("own");
        else messageDiv.classList.add("other");

        const time = new Date(timestamp).toLocaleTimeString();

        messageDiv.innerHTML = `
            <div class="message-content">${this.escapeHtml(text)}</div>
            <div class="message-meta">${this.escapeHtml(email)} • ${time}</div>
        `;

        this.messageList.appendChild(messageDiv);
        this.messageList.scrollTop = this.messageList.scrollHeight;
    }

    async handleSendMessage(e) {
        e.preventDefault();

        const text = this.messageInput.value.trim();
        if (!text) return;

        const payload = { text, room_id: this.currentRoom };

        if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN || !this.isConnected) {
            console.warn("⚠️ Not connected, buffering message...");
            this.messageBuffer.push(payload);
            this.showError("Not connected. Reconnecting...");
            this.connectWebSocket();
            return;
        }

        try {
            this.websocket.send(JSON.stringify(payload));
            this.messageInput.value = "";
            this.messageInput.focus();
        } catch (err) {
            console.error("❌ send failed:", err);
            this.showError("Failed to send");
        }
    }

    switchRoom(roomId) {
        this.roomButtons.forEach(btn => btn.classList.remove("active"));
        document.querySelector(`[data-room="${roomId}"]`)?.classList.add("active");

        this.currentRoom = roomId;
        this.roomNameSpan.textContent = roomId;

        // close old socket without triggering reconnect loop
        this.shouldReconnect = false;
        try {
            if (this.websocket) this.websocket.close();
        } catch (_) {}
        this.websocket = null;
        this.isConnected = false;
        this.updateConnectionStatus(false);
        this.shouldReconnect = true;

        this.messageList.innerHTML = "";
        this.loadMessageHistory().then(() => this.connectWebSocket());
    }

    updateConnectionStatus(connected) {
        if (!this.statusIndicator || !this.statusText) return;

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

    showError(message) {
        this.statusText.textContent = message;
        setTimeout(() => {
            this.statusText.textContent = this.isConnected ? "✅ Connected" : "❌ Disconnected";
        }, 2500);
    }

    escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    window.chatApp = new ChatApp();
});