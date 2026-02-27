// Real-Time Chat Application - Frontend (WORKING WEBSOCKET VERSION)

class ChatApp {
    constructor() {
        console.log("🚀 Initializing Chat Application...");

        this.username = this.initializeUsername();
        console.log(`👤 Username: ${this.username}`);

        this.currentRoom = CONFIG.DEFAULT_ROOM;
        this.websocket = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.shouldReconnect = true;
        this.messageBuffer = [];

        this.initializeElements();
        this.attachEventListeners();
        this.showChatUI();

        console.log("🔄 Loading message history...");
        this.loadMessageHistory().then(() => {
            console.log("📡 Connecting WebSocket...");
            this.connectWebSocket();
        });
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
        this.loadingSpinner = document.getElementById("loadingSpinner");
    }

    attachEventListeners() {
        this.messageForm.addEventListener("submit", (e) => this.handleSendMessage(e));
        this.roomButtons.forEach(btn => {
            btn.addEventListener("click", () => this.switchRoom(btn.dataset.room));
        });
    }

    initializeUsername() {
        let username = localStorage.getItem("username");
        if (!username) {
            username = `User_${Math.floor(Math.random() * 9000) + 1000}`;
            localStorage.setItem("username", username);
        }
        return username;
    }

    showChatUI() {
        this.chatContainer.style.display = "flex";
        this.currentUserSpan.textContent = `👤 ${this.username}`;
    }

    connectWebSocket() {
        // Close existing socket if any
        if (this.websocket && (this.websocket.readyState === WebSocket.OPEN || this.websocket.readyState === WebSocket.CONNECTING)) {
            try { this.websocket.close(); } catch (_) {}
        }

        // IMPORTANT: Use CONFIG.API_GATEWAY_ENDPOINT (you already have this in your original project)
        // Your backend currently accepts token but ignores it, so this is safe:
        const wsUrl = `${CONFIG.API_GATEWAY_ENDPOINT}/ws/${this.currentRoom}?token=dummy`;
        console.log("Connecting:", wsUrl);

        this.websocket = new WebSocket(wsUrl);

        this.websocket.onopen = () => {
            console.log("✅ WebSocket connected");
            this.isConnected = true;
            this.updateConnectionStatus(true);
            this.reconnectAttempts = 0;

            // Flush buffered messages
            while (this.messageBuffer.length > 0) {
                const msg = this.messageBuffer.shift();
                try {
                    this.websocket.send(JSON.stringify(msg));
                } catch (e) {
                    console.error("❌ Failed to flush buffered message:", e);
                }
            }
        };

        this.websocket.onclose = () => {
            console.log("📴 WebSocket closed");
            this.isConnected = false;
            this.updateConnectionStatus(false);

            if (this.shouldReconnect) {
                this.attemptReconnect();
            }
        };

        this.websocket.onerror = (e) => {
            console.error("❌ WebSocket error", e);
        };

        this.websocket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleMessageReceived(message);
            } catch (e) {
                console.error("❌ Failed to parse message", e, event.data);
            }
        };
    }

    attemptReconnect() {
        if (this.reconnectAttempts >= CONFIG.WEBSOCKET_MAX_RETRIES) {
            console.error("❌ Max reconnection attempts reached");
            this.showError("Connection failed. Please refresh the page.");
            return;
        }

        this.reconnectAttempts++;
        const delay = CONFIG.WEBSOCKET_RECONNECT_DELAY * this.reconnectAttempts;

        console.log(`🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${CONFIG.WEBSOCKET_MAX_RETRIES})`);

        setTimeout(() => {
            this.connectWebSocket();
        }, delay);
    }

    handleMessageReceived(message) {
        const { type, username, text, timestamp } = message;

        if (type === "system") {
            this.displaySystemMessage(text);
        } else if (type === "message") {
            this.displayMessage(username, text, timestamp);
        }
    }

    displayMessage(username, text, timestamp) {
        const messageDiv = document.createElement("div");
        messageDiv.className = "message";

        if (username === this.username) {
            messageDiv.classList.add("own");
        } else {
            messageDiv.classList.add("other");
        }

        const time = new Date(timestamp).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        messageDiv.innerHTML = `
            <div class="message-content">${this.escapeHtml(text)}</div>
            <div class="message-meta">${username} • ${time}</div>
        `;

        this.messageList.appendChild(messageDiv);
        this.messageList.scrollTop = this.messageList.scrollHeight;

        this.saveMessageToLocalStorage(this.currentRoom, username, text, timestamp);
    }

    displaySystemMessage(text) {
        const messageDiv = document.createElement("div");
        messageDiv.className = "message system";
        messageDiv.innerHTML = `<div class="message-content">${this.escapeHtml(text)}</div>`;

        this.messageList.appendChild(messageDiv);
        this.messageList.scrollTop = this.messageList.scrollHeight;
    }

    async handleSendMessage(e) {
        e.preventDefault();

        const text = this.messageInput.value.trim();
        if (!text) return;

        if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN || !this.isConnected) {
            console.warn("⚠️ Not connected. Buffering message and reconnecting...");
            this.showError("Not connected. Reconnecting...");

            this.messageBuffer.push({
                text: text,
                room_id: this.currentRoom
            });

            this.connectWebSocket();
            return;
        }

        try {
            const message = { text: text, room_id: this.currentRoom };
            this.websocket.send(JSON.stringify(message));
            console.log("✅ Message sent successfully");

            this.messageInput.value = "";
            this.messageInput.focus();
        } catch (error) {
            console.error("❌ Error sending message:", error);
            this.showError("Failed to send message");
        }
    }

    async loadMessageHistory() {
        try {
            const url = `${CONFIG.API_REST_ENDPOINT}/rooms/${this.currentRoom}/messages?limit=${CONFIG.MESSAGE_LOAD_LIMIT}`;
            console.log(`📨 Fetching messages from: ${this.currentRoom}`);

            // Demo backend: no auth header
            const response = await fetch(url);

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            this.messageList.innerHTML = "";

            if (data.messages && data.messages.length > 0) {
                console.log(`✅ Loaded ${data.messages.length} messages from server`);
                data.messages.forEach(msg => {
                    // backend demo sends {type/system/message} too; handle both shapes:
                    if (msg.type === "system") this.displaySystemMessage(msg.text);
                    else this.displayMessage(msg.username, msg.text, msg.timestamp);
                });
            } else {
                console.log("ℹ️ No messages in this room yet");
                this.loadFromLocalStorage();
            }
        } catch (error) {
            console.warn("⚠️ Could not load from server:", error.message);
            this.loadFromLocalStorage();
        }
    }

    loadFromLocalStorage() {
        try {
            const storageKey = `chat_history_${this.currentRoom}`;
            const saved = localStorage.getItem(storageKey);
            if (!saved) return;

            const msgs = JSON.parse(saved);
            this.messageList.innerHTML = "";
            msgs.forEach(msg => this.displayMessage(msg.username, msg.text, msg.timestamp));
        } catch (error) {
            console.error("❌ Error loading from localStorage:", error);
        }
    }

    saveMessageToLocalStorage(roomId, username, text, timestamp) {
        try {
            const storageKey = `chat_history_${roomId}`;
            const saved = localStorage.getItem(storageKey);
            const msgs = saved ? JSON.parse(saved) : [];

            msgs.push({ username, text, timestamp });
            if (msgs.length > 100) msgs.splice(0, msgs.length - 100);

            localStorage.setItem(storageKey, JSON.stringify(msgs));
        } catch (error) {
            console.warn("⚠️ Could not save to localStorage:", error);
        }
    }

    switchRoom(roomId) {
        console.log(`🔄 Switching to room: ${roomId}`);

        this.roomButtons.forEach(btn => btn.classList.remove("active"));
        document.querySelector(`[data-room="${roomId}"]`).classList.add("active");

        this.currentRoom = roomId;
        this.roomNameSpan.textContent = roomId;

        // Close old socket
        if (this.websocket) {
            this.shouldReconnect = false;
            try { this.websocket.close(); } catch (_) {}
            this.shouldReconnect = true;
        }

        this.messageList.innerHTML = "";

        this.loadMessageHistory().then(() => this.connectWebSocket());
    }

    updateConnectionStatus(connected) {
        if (connected) {
            this.statusIndicator.classList.add("connected");
            this.statusIndicator.classList.remove("disconnected");
            this.statusText.textContent = "✅ Connected";
            this.statusText.style.color = "#4caf50";
        } else {
            this.statusIndicator.classList.remove("connected");
            this.statusIndicator.classList.add("disconnected");
            this.statusText.textContent = "❌ Disconnected";
            this.statusText.style.color = "#f44336";
        }
    }

    showError(message) {
        this.statusText.textContent = message;
        this.statusText.style.color = "#f44336";

        setTimeout(() => {
            this.statusText.textContent = this.isConnected ? "✅ Connected" : "❌ Disconnected";
            this.statusText.style.color = this.isConnected ? "#4caf50" : "#f44336";
        }, 3000);
    }

    escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    console.clear();
    console.log("=".repeat(50));
    console.log("🚀 CHAT APPLICATION V2.0 STARTING");
    console.log("=".repeat(50));
    console.log(`🕐 Time: ${new Date().toISOString()}`);
    console.log(`📍 URL: ${window.location.href}`);
    console.log(`🖥️ Host: ${window.location.hostname}:${window.location.port || 'default'}`);
    console.log("=".repeat(50));

    window.chatApp = new ChatApp();

    console.log("✅ Application initialized");
});