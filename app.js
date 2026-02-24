// Real-Time Chat Application - Frontend (No Login, Direct Chat)

class ChatApp {
    constructor() {
        // Get username from Cognito token or generate one
        this.username = this.initializeUsername();
        this.token = this.getToken();
        this.currentRoom = CONFIG.DEFAULT_ROOM;
        this.websocket = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        
        this.initializeElements();
        this.attachEventListeners();
        
        // Start directly in chat mode
        this.showChatUI();
        this.loadMessageHistory();
        this.connectWebSocket();
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
        // Chat
        this.messageForm.addEventListener("submit", (e) => this.handleSendMessage(e));
        
        // Room selection
        this.roomButtons.forEach(btn => {
            btn.addEventListener("click", () => this.switchRoom(btn.dataset.room));
        });
    }
    
    initializeUsername() {
        /**
         * Get username from:
         * 1. localStorage (if already set)
         * 2. Cognito token (if available)
         * 3. Generate unique username
         */
        let username = localStorage.getItem("username");
        
        if (!username) {
            // Try to get from Cognito token
            const token = this.getToken();
            if (token) {
                try {
                    const decoded = JSON.parse(atob(token));
                    username = decoded.username || decoded['cognito:username'];
                } catch (e) {
                    // Token not valid, generate random
                }
            }
            
            // If still no username, generate one
            if (!username) {
                username = this.generateUsername();
            }
            
            localStorage.setItem("username", username);
        }
        
        return username;
    }
    
    generateUsername() {
        /**
         * Generate unique username if not provided
         * Format: User_XXXX (random 4 digits)
         */
        const randomId = Math.floor(Math.random() * 9000) + 1000;
        return `User_${randomId}`;
    }
    
    getToken() {
        /**
         * Get JWT token from:
         * 1. localStorage
         * 2. URL query parameter (after Cognito redirect)
         * 3. Generate mock token
         */
        let token = localStorage.getItem("token");
        
        if (!token) {
            // Check URL for token from Cognito redirect
            const params = new URLSearchParams(window.location.search);
            token = params.get("token");
            
            if (token) {
                localStorage.setItem("token", token);
            }
        }
        
        if (!token) {
            // Generate mock token for demo
            token = this.generateMockToken(this.username);
            localStorage.setItem("token", token);
        }
        
        return token;
    }
    
    generateMockToken(username) {
        /**
         * Generate a mock JWT token
         * In production, this comes from Cognito
         */
        const mockToken = btoa(JSON.stringify({
            sub: `user-${Date.now()}`,
            username: username,
            'cognito:username': username,
            iss: `https://cognito-idp.${CONFIG.COGNITO_REGION}.amazonaws.com/${CONFIG.COGNITO_USER_POOL_ID}`,
            aud: CONFIG.COGNITO_CLIENT_ID,
            token_use: "id",
            auth_time: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 86400  // 24 hours
        }));
        
        return mockToken;
    }
    
    showChatUI() {
        // Chat is always visible (no login screen)
        this.chatContainer.style.display = "flex";
        this.currentUserSpan.textContent = `👤 ${this.username}`;
    }
    
    connectWebSocket() {
        const wsUrl = `${CONFIG.API_GATEWAY_ENDPOINT}/ws/${this.currentRoom}?token=${this.token}`;
        
        console.log(`🔗 Connecting to WebSocket: ${wsUrl.split('?')[0]}...`);
        
        this.websocket = new WebSocket(wsUrl);
        
        this.websocket.onopen = () => {
            console.log("✅ WebSocket connected");
            this.isConnected = true;
            this.updateConnectionStatus(true);
            this.reconnectAttempts = 0;
        };
        
        this.websocket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleMessageReceived(message);
            } catch (error) {
                console.error("❌ Error parsing message:", error);
            }
        };
        
        this.websocket.onerror = (error) => {
            console.error("❌ WebSocket error:", error);
            this.updateConnectionStatus(false);
        };
        
        this.websocket.onclose = () => {
            console.log("⏹️ WebSocket disconnected");
            this.isConnected = false;
            this.updateConnectionStatus(false);
            this.attemptReconnect();
        };
    }
    
    attemptReconnect() {
        if (this.reconnectAttempts < CONFIG.WEBSOCKET_MAX_RETRIES) {
            this.reconnectAttempts++;
            const delay = CONFIG.WEBSOCKET_RECONNECT_DELAY * this.reconnectAttempts;
            
            console.log(`🔄 Attempting to reconnect in ${delay}ms... (attempt ${this.reconnectAttempts})`);
            setTimeout(() => this.connectWebSocket(), delay);
        } else {
            console.error("❌ Max reconnection attempts reached");
            this.showError("Connection failed. Please refresh the page.");
        }
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
        
        // Auto-scroll to bottom
        this.messageList.scrollTop = this.messageList.scrollHeight;
        
        // Save to localStorage for persistence
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
        e.preventDefault();
        
        const text = this.messageInput.value.trim();
        
        if (!text || !this.isConnected) {
            if (!this.isConnected) {
                this.showError("Not connected to server");
            }
            return;
        }
        
        try {
            const message = {
                text: text,
                room_id: this.currentRoom
            };
            
            this.websocket.send(JSON.stringify(message));
            this.messageInput.value = "";
            this.messageInput.focus();
        } catch (error) {
            console.error("❌ Error sending message:", error);
            this.showError("Failed to send message");
        }
    }
    
    async loadMessageHistory() {
        /**
         * Load message history from:
         * 1. DynamoDB via API (if connected)
         * 2. localStorage (if API fails)
         */
        try {
            // Try loading from API first
            const url = `${CONFIG.API_REST_ENDPOINT}/rooms/${this.currentRoom}/messages?limit=${CONFIG.MESSAGE_LOAD_LIMIT}`;
            
            const response = await fetch(url, {
                headers: {
                    "Authorization": `Bearer ${this.token}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            // Clear current messages
            this.messageList.innerHTML = "";
            
            // Load historical messages from API
            if (data.messages && data.messages.length > 0) {
                data.messages.forEach(msg => {
                    this.displayMessage(msg.username, msg.text, msg.timestamp);
                });
                console.log(`✅ Loaded ${data.messages.length} messages from server`);
            } else {
                // No messages on server, load from localStorage
                this.loadFromLocalStorage();
            }
        } catch (error) {
            console.warn("⚠️ Could not load from server:", error.message);
            // Fallback to localStorage
            this.loadFromLocalStorage();
        }
    }
    
    loadFromLocalStorage() {
        /**
         * Load message history from browser localStorage
         * Useful when offline or API unavailable
         */
        try {
            const storageKey = `chat_history_${this.currentRoom}`;
            const saved = localStorage.getItem(storageKey);
            
            if (saved) {
                const messages = JSON.parse(saved);
                this.messageList.innerHTML = "";
                
                messages.forEach(msg => {
                    this.displayMessage(msg.username, msg.text, msg.timestamp);
                });
                
                console.log(`✅ Loaded ${messages.length} messages from local storage`);
            }
        } catch (error) {
            console.error("❌ Error loading from localStorage:", error);
        }
    }
    
    saveMessageToLocalStorage(roomId, username, text, timestamp) {
        /**
         * Save messages to localStorage for persistence
         * Stores up to 100 most recent messages per room
         */
        try {
            const storageKey = `chat_history_${roomId}`;
            let messages = [];
            
            const saved = localStorage.getItem(storageKey);
            if (saved) {
                messages = JSON.parse(saved);
            }
            
            // Add new message
            messages.push({
                username,
                text,
                timestamp
            });
            
            // Keep only last 100 messages
            if (messages.length > 100) {
                messages = messages.slice(-100);
            }
            
            // Save to localStorage
            localStorage.setItem(storageKey, JSON.stringify(messages));
        } catch (error) {
            console.error("❌ Error saving to localStorage:", error);
        }
    }
    
    switchRoom(roomId) {
        // Update active button
        this.roomButtons.forEach(btn => btn.classList.remove("active"));
        document.querySelector(`[data-room="${roomId}"]`).classList.add("active");
        
        // Update current room
        this.currentRoom = roomId;
        this.roomNameSpan.textContent = roomId;
        
        // Disconnect old WebSocket
        if (this.websocket) {
            this.websocket.close();
        }
        
        // Clear messages
        this.messageList.innerHTML = "";
        
        // Load new room history and connect
        this.loadMessageHistory();
        this.connectWebSocket();
        
        console.log(`🚀 Switched to room: ${roomId}`);
    }
    
    updateConnectionStatus(connected) {
        if (connected) {
            this.statusIndicator.classList.add("connected");
            this.statusIndicator.classList.remove("disconnected");
            this.statusText.textContent = "Connected";
            this.statusIndicator.title = "Connected to server";
        } else {
            this.statusIndicator.classList.remove("connected");
            this.statusIndicator.classList.add("disconnected");
            this.statusText.textContent = "Disconnected";
            this.statusIndicator.title = "Trying to reconnect...";
        }
    }
    
    showError(message) {
        /**
         * Show error message in a subtle way
         */
        console.error("❌ Error:", message);
        
        // Could add a toast notification here
        // For now, just log and show in status
        this.statusText.textContent = message;
        this.statusText.style.color = "#f44336";
        
        setTimeout(() => {
            this.statusText.textContent = this.isConnected ? "Connected" : "Disconnected";
            this.statusText.style.color = "#666";
        }, 5000);
    }
    
    escapeHtml(text) {
        /**
         * Prevent XSS by escaping HTML
         */
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize app when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
    console.log("🚀 Chat Application Starting...");
    window.chatApp = new ChatApp();
    console.log("✅ Chat Application Ready");
});
