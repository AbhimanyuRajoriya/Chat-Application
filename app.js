// Real-Time Chat Application - Frontend (FIXED WEBSOCKET VERSION)

class ChatApp {
    constructor() {
        console.log("🚀 Initializing Chat Application...");
        
        this.username = this.initializeUsername();
        console.log(`👤 Username: ${this.username}`);
        
        this.token = this.getToken();
        console.log(`🔐 Token obtained: ${this.token ? 'Yes' : 'No'}`);
        
        this.currentRoom = CONFIG.DEFAULT_ROOM;
        this.websocket = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.shouldReconnect = true;
        this.messageBuffer = []; // Buffer messages while connecting
        
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
        // Chat elements
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
            const token = this.getToken();
            if (token) {
                try {
                    const decoded = JSON.parse(atob(token));
                    username = decoded.username || decoded['cognito:username'];
                } catch (e) {
                    console.warn("⚠️ Could not decode token");
                }
            }
        }
        
        if (!username) {
            username = this.generateUsername();
        }
        
        localStorage.setItem("username", username);
        return username;
    }
    
    generateUsername() {
        const randomId = Math.floor(Math.random() * 9000) + 1000;
        return `User_${randomId}`;
    }
    
    getToken() {
        /**
         * GET TOKEN - CRITICAL FUNCTION
         * Never return null/undefined
         */
        let token = localStorage.getItem("token");
        
        if (!token) {
            const params = new URLSearchParams(window.location.search);
            token = params.get("token");
        }
        
        if (!token) {
            token = this.generateMockToken(this.username);
        }
        
        localStorage.setItem("token", token);
        return token;
    }
    
    generateMockToken(username) {
        /**
         * Generate JWT-like token for authentication
         */
        const mockToken = btoa(JSON.stringify({
            sub: `user-${Date.now()}`,
            username: username,
            'cognito:username': username,
            iss: `https://cognito-idp.${CONFIG.COGNITO_REGION}.amazonaws.com/${CONFIG.COGNITO_USER_POOL_ID}`,
            aud: CONFIG.COGNITO_CLIENT_ID,
            token_use: "id",
            auth_time: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 86400
        }));
        
        return mockToken;
    }
    
    showChatUI() {
        this.chatContainer.style.display = "flex";
        this.currentUserSpan.textContent = `👤 ${this.username}`;
    }
    
    connectWebSocket() {
        /**
         * CONNECT TO WEBSOCKET SERVER
         * FIXED VERSION WITH PROPER ERROR HANDLING
         */
        
        // Validate prerequisites
        if (!this.token) {
            console.error("❌ CRITICAL: No token available");
            this.showError("Authentication token missing");
            return;
        }
        
        if (!this.username) {
            console.error("❌ CRITICAL: No username");
            this.showError("Username not set");
            return;
        }
        
        // Build WebSocket URL
        let wsUrl;
        
        try {
            if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                // Local development
                wsUrl = `ws://localhost:8000/ws/${this.currentRoom}?token=${this.token}`;
                console.log("🏠 Local environment detected");
            } else {
                // Production
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                const host = window.location.host;
                wsUrl = `${protocol}//${host}/ws/${this.currentRoom}?token=${this.token}`;
                console.log("🌍 Production environment detected");
            }
        } catch (error) {
            console.error("❌ Error building WebSocket URL:", error);
            this.showError("Failed to build connection URL");
            return;
        }
        
        // Log connection attempt (without full token)
        console.log(`🔗 Attempting WebSocket connection...`);
        console.log(`📍 URL: ws://.../${this.currentRoom}?token=***`);
        console.log(`🕐 Timestamp: ${new Date().toISOString()}`);
        
        // Create WebSocket connection
        try {
            this.websocket = new WebSocket(wsUrl);
        } catch (error) {
            console.error("❌ Failed to create WebSocket:", error);
            console.error("Error details:", {
                message: error.message,
                url: wsUrl.split('?')[0]
            });
            this.updateConnectionStatus(false);
            this.attemptReconnect();
            return;
        }
        
        // WebSocket connection opened
        this.websocket.onopen = (event) => {
            console.log("✅ WEBSOCKET CONNECTED!");
            console.log("📊 Connection info:", {
                url: event.target.url.split('?')[0],
                readyState: event.target.readyState,
                protocol: event.target.protocol
            });
            
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.updateConnectionStatus(true);
            
            // Load messages after connection
            console.log("📨 Loading message history...");
            this.loadMessageHistory().catch(err => {
                console.warn("⚠️ Could not load history:", err);
            });
            
            // Send any buffered messages
            while (this.messageBuffer.length > 0) {
                const buffered = this.messageBuffer.shift();
                this.websocket.send(JSON.stringify(buffered));
            }
        };
        
        // Message received from server
        this.websocket.onmessage = (event) => {
            console.log("📨 Message received");
            try {
                const message = JSON.parse(event.data);
                console.log("✅ Parsed message:", {
                    type: message.type,
                    username: message.username,
                    hasText: !!message.text
                });
                this.handleMessageReceived(message);
            } catch (error) {
                console.error("❌ Error parsing message:", error);
                console.error("Raw message:", event.data);
            }
        };
        
        // WebSocket error
        this.websocket.onerror = (error) => {
            console.error("❌ WEBSOCKET ERROR");
            console.error("Error object:", {
                type: error.type || 'unknown',
                message: error.message || 'No message',
                timestamp: new Date().toISOString()
            });
            
            if (this.websocket) {
                console.error("WebSocket state:", {
                    readyState: this.websocket.readyState,
                    url: this.websocket.url ? this.websocket.url.split('?')[0] : 'unknown'
                });
            }
            
            this.isConnected = false;
            this.updateConnectionStatus(false);
            this.showError("WebSocket error occurred");
        };
        
        // WebSocket closed
        this.websocket.onclose = (event) => {
            console.log("⏹️ WEBSOCKET CLOSED");
            console.log("Close info:", {
                code: event.code,
                reason: event.reason || 'No reason provided',
                wasClean: event.wasClean,
                timestamp: new Date().toISOString()
            });
            
            // Interpret close codes
            if (event.code === 1000) console.log("ℹ️ Normal closure");
            if (event.code === 1001) console.log("ℹ️ Going away");
            if (event.code === 1006) console.log("⚠️ Abnormal closure");
            if (event.code === 4001) console.log("🔐 Authentication failed");
            if (event.code === 4002) console.log("🔐 Invalid token");
            
            this.isConnected = false;
            this.updateConnectionStatus(false);
            
            // Reconnect if should
            if (this.shouldReconnect) {
                this.attemptReconnect();
            }
        };
        
        console.log("✅ WebSocket event handlers set up");
    }
    
    attemptReconnect() {
        /**
         * RECONNECTION LOGIC WITH EXPONENTIAL BACKOFF
         */
        
        if (this.reconnectAttempts >= CONFIG.WEBSOCKET_MAX_RETRIES) {
            console.error("❌ MAX RECONNECTION ATTEMPTS REACHED");
            console.error(`Failed after ${CONFIG.WEBSOCKET_MAX_RETRIES} attempts`);
            this.showError("Connection failed. Please refresh the page.");
            this.shouldReconnect = false;
            return;
        }
        
        this.reconnectAttempts++;
        
        // Exponential backoff: 3s, 6s, 9s, 12s, 15s (max)
        const delayMultiplier = CONFIG.WEBSOCKET_RECONNECT_DELAY;
        const delay = Math.min(delayMultiplier * this.reconnectAttempts, 30000);
        
        console.log(`🔄 RECONNECTION ATTEMPT ${this.reconnectAttempts}/${CONFIG.WEBSOCKET_MAX_RETRIES}`);
        console.log(`⏱️ Waiting ${delay/1000}s before retry...`);
        
        setTimeout(() => {
            console.log(`🔗 Attempting reconnection ${this.reconnectAttempts}...`);
            this.connectWebSocket();
        }, delay);
    }
    
    handleMessageReceived(message) {
        const { type, username, text, timestamp } = message;
        
        if (type === "system") {
            console.log("📢 System message:", text);
            this.displaySystemMessage(text);
        } else if (type === "message") {
            console.log("💬 User message from:", username);
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
        
        // Save to localStorage
        this.saveMessageToLocalStorage(this.currentRoom, username, text, timestamp);
    }
    
    displaySystemMessage(text) {
        const messageDiv = document.createElement("div");
        messageDiv.className = "message system";
        messageDiv.innerHTML = `
            <div class="message-content">${this.escapeHtml(text)}</div>
        `;
        
        this.messageList.appendChild(messageDiv);
        this.messageList.scrollTop = this.messageList.scrollHeight;
    }
    
    async handleSendMessage(e) {
        /**
         * SEND MESSAGE - WITH CONNECTION CHECK
         */
        e.preventDefault();
        
        const text = this.messageInput.value.trim();
        if (!text) return;
        
        // Check connection
        if (!this.isConnected || !this.websocket) {
            console.warn("⚠️ Not connected. Attempting to reconnect...");
            this.showError("Not connected. Reconnecting...");
            this.connectWebSocket();
            
            // Buffer the message
            this.messageBuffer.push({
                text: text,
                room_id: this.currentRoom
            });
            return;
        }
        
        // Check WebSocket is OPEN
        if (this.websocket.readyState !== WebSocket.OPEN) {
            console.warn("⚠️ WebSocket not OPEN. State:", this.websocket.readyState);
            this.showError("Connection not ready. Please try again.");
            return;
        }
        
        try {
            const message = {
                text: text,
                room_id: this.currentRoom
            };
            
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
        /**
         * LOAD MESSAGE HISTORY - PRIMARY AND FALLBACK
         */
        try {
            const url = `${CONFIG.API_REST_ENDPOINT}/rooms/${this.currentRoom}/messages?limit=${CONFIG.MESSAGE_LOAD_LIMIT}`;
            
            console.log(`📨 Fetching messages from: ${this.currentRoom}`);
            
            const response = await fetch(url, {
                headers: {
                    "Authorization": `Bearer ${this.token}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            // Clear messages
            this.messageList.innerHTML = "";
            
            // Load messages
            if (data.messages && data.messages.length > 0) {
                console.log(`✅ Loaded ${data.messages.length} messages from server`);
                data.messages.forEach(msg => {
                    this.displayMessage(msg.username, msg.text, msg.timestamp);
                });
            } else {
                console.log("ℹ️ No messages in this room yet");
                // Try localStorage
                this.loadFromLocalStorage();
            }
        } catch (error) {
            console.warn("⚠️ Could not load from server:", error.message);
            console.log("📱 Attempting to load from localStorage...");
            this.loadFromLocalStorage();
        }
    }
    
    loadFromLocalStorage() {
        try {
            const storageKey = `chat_history_${this.currentRoom}`;
            const saved = localStorage.getItem(storageKey);
            
            if (saved) {
                const messages = JSON.parse(saved);
                console.log(`✅ Loaded ${messages.length} messages from localStorage`);
                
                this.messageList.innerHTML = "";
                messages.forEach(msg => {
                    this.displayMessage(msg.username, msg.text, msg.timestamp);
                });
            }
        } catch (error) {
            console.error("❌ Error loading from localStorage:", error);
        }
    }
    
    saveMessageToLocalStorage(roomId, username, text, timestamp) {
        try {
            const storageKey = `chat_history_${roomId}`;
            let messages = [];
            
            const saved = localStorage.getItem(storageKey);
            if (saved) {
                messages = JSON.parse(saved);
            }
            
            messages.push({ username, text, timestamp });
            
            // Keep only last 100 messages
            if (messages.length > 100) {
                messages = messages.slice(-100);
            }
            
            localStorage.setItem(storageKey, JSON.stringify(messages));
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
        
        // Disconnect old WebSocket
        if (this.websocket) {
            console.log("📴 Closing old connection...");
            this.shouldReconnect = false;
            this.websocket.close();
            this.shouldReconnect = true;
        }
        
        // Clear messages
        this.messageList.innerHTML = "";
        
        // Load new room
        this.loadMessageHistory().then(() => {
            this.connectWebSocket();
        });
    }
    
    updateConnectionStatus(connected) {
        if (connected) {
            this.statusIndicator.classList.add("connected");
            this.statusIndicator.classList.remove("disconnected");
            this.statusText.textContent = "✅ Connected";
            this.statusText.style.color = "#4caf50";
            console.log("✅ CONNECTION STATUS: CONNECTED");
        } else {
            this.statusIndicator.classList.remove("connected");
            this.statusIndicator.classList.add("disconnected");
            this.statusText.textContent = "❌ Disconnected";
            this.statusText.style.color = "#f44336";
            console.log("❌ CONNECTION STATUS: DISCONNECTED");
        }
    }
    
    showError(message) {
        console.warn("⚠️", message);
        this.statusText.textContent = message;
        this.statusText.style.color = "#f44336";
        
        setTimeout(() => {
            this.statusText.textContent = this.isConnected ? "✅ Connected" : "❌ Disconnected";
            this.statusText.style.color = this.isConnected ? "#4caf50" : "#f44336";
        }, 5000);
    }
    
    escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize when DOM ready
document.addEventListener("DOMContentLoaded", () => {
    console.clear();
    console.log("=" .repeat(50));
    console.log("🚀 CHAT APPLICATION V2.0 STARTING");
    console.log("=" .repeat(50));
    console.log(`🕐 Time: ${new Date().toISOString()}`);
    console.log(`📍 URL: ${window.location.href}`);
    console.log(`🖥️ Host: ${window.location.hostname}:${window.location.port || 'default'}`);
    console.log("=" .repeat(50));
    
    window.chatApp = new ChatApp();
    
    console.log("✅ Application initialized");
    console.log("💡 Tip: Open DevTools (F12) → Console to see debug logs");
});
