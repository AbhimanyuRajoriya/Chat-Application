// Real-Time Chat Application - Frontend

class ChatApp {
    constructor() {
        this.username = null;
        this.token = null;
        this.currentRoom = CONFIG.DEFAULT_ROOM;
        this.websocket = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        
        this.initializeElements();
        this.attachEventListeners();
        this.checkAuthenticationStatus();
    }
    
    initializeElements() {
        // Login elements
        this.loginForm = document.getElementById("loginForm");
        this.loginContainer = document.getElementById("loginContainer");
        this.loginError = document.getElementById("loginError");
        this.usernameInput = document.getElementById("username");
        this.passwordInput = document.getElementById("password");
        
        // Chat elements
        this.chatContainer = document.getElementById("chatContainer");
        this.messageForm = document.getElementById("messageForm");
        this.messageInput = document.getElementById("messageInput");
        this.messageList = document.getElementById("messageList");
        this.currentUserSpan = document.getElementById("currentUser");
        this.roomNameSpan = document.getElementById("roomName");
        this.statusText = document.getElementById("statusText");
        this.statusIndicator = document.querySelector(".status-indicator");
        this.logoutBtn = document.getElementById("logoutBtn");
        this.roomButtons = document.querySelectorAll(".room-btn");
        this.loadingSpinner = document.getElementById("loadingSpinner");
    }
    
    attachEventListeners() {
        // Login
        this.loginForm.addEventListener("submit", (e) => this.handleLogin(e));
        
        // Chat
        this.messageForm.addEventListener("submit", (e) => this.handleSendMessage(e));
        this.logoutBtn.addEventListener("click", () => this.handleLogout());
        
        // Room selection
        this.roomButtons.forEach(btn => {
            btn.addEventListener("click", () => this.switchRoom(btn.dataset.room));
        });
    }
    
    checkAuthenticationStatus() {
        const token = localStorage.getItem("token");
        const username = localStorage.getItem("username");
        
        if (token && username) {
            this.token = token;
            this.username = username;
            this.showChatUI();
            this.connectWebSocket();
            this.loadMessageHistory();
        }
    }
    
    async handleLogin(e) {
        e.preventDefault();
        
        const username = this.usernameInput.value.trim();
        const password = this.passwordInput.value;
        
        if (!username || !password) {
            this.showLoginError("Please enter username and password");
            return;
        }
        
        this.showLoadingSpinner();
        
        try {
            // In production, this would authenticate with AWS Cognito
            // For demo, we'll simulate getting a token
            const token = await this.authenticateWithCognito(username, password);
            
            if (token) {
                this.username = username;
                this.token = token;
                
                // Save to localStorage
                localStorage.setItem("token", token);
                localStorage.setItem("username", username);
                
                // Show chat UI
                this.showChatUI();
                
                // Connect WebSocket
                this.connectWebSocket();
                
                // Load message history
                this.loadMessageHistory();
            }
        } catch (error) {
            this.showLoginError(`Login failed: ${error.message}`);
        } finally {
            this.hideLoadingSpinner();
        }
    }
    
    async authenticateWithCognito(username, password) {
        // This is a simplified version for demo
        // In production, use AWS Amplify or AWS SDK for proper Cognito authentication
        
        try {
            // For demo, we'll create a mock JWT token
            // In production, authenticate with Cognito User Pool
            
            // Mock authentication - replace with real Cognito call
            const mockToken = btoa(JSON.stringify({
                sub: "mock-user-id",
                username: username,
                iss: `https://cognito-idp.${CONFIG.COGNITO_REGION}.amazonaws.com/${CONFIG.COGNITO_USER_POOL_ID}`,
                aud: CONFIG.COGNITO_CLIENT_ID,
                token_use: "id",
                auth_time: Math.floor(Date.now() / 1000),
                exp: Math.floor(Date.now() / 1000) + 3600
            }));
            
            return mockToken;
            
            // Real Cognito authentication would be:
            // const response = await fetch('https://your-cognito-domain/oauth2/authorize?...');
            
        } catch (error) {
            throw new Error(`Authentication failed: ${error.message}`);
        }
    }
    
    showChatUI() {
        this.loginContainer.style.display = "none";
        this.chatContainer.style.display = "flex";
        this.currentUserSpan.textContent = `Welcome, ${this.username}!`;
    }
    
    connectWebSocket() {
        const wsUrl = `${CONFIG.API_GATEWAY_ENDPOINT}/ws/${this.currentRoom}?token=${this.token}`;
        
        console.log(`Connecting to WebSocket: ${wsUrl}`);
        
        this.websocket = new WebSocket(wsUrl);
        
        this.websocket.onopen = () => {
            console.log("WebSocket connected");
            this.isConnected = true;
            this.updateConnectionStatus(true);
            this.reconnectAttempts = 0;
        };
        
        this.websocket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleMessageReceived(message);
            } catch (error) {
                console.error("Error parsing message:", error);
            }
        };
        
        this.websocket.onerror = (error) => {
            console.error("WebSocket error:", error);
            this.updateConnectionStatus(false);
        };
        
        this.websocket.onclose = () => {
            console.log("WebSocket disconnected");
            this.isConnected = false;
            this.updateConnectionStatus(false);
            this.attemptReconnect();
        };
    }
    
    attemptReconnect() {
        if (this.reconnectAttempts < CONFIG.WEBSOCKET_MAX_RETRIES) {
            this.reconnectAttempts++;
            const delay = CONFIG.WEBSOCKET_RECONNECT_DELAY * this.reconnectAttempts;
            
            console.log(`Attempting to reconnect in ${delay}ms...`);
            setTimeout(() => this.connectWebSocket(), delay);
        } else {
            this.showLoginError("Failed to connect. Please refresh the page.");
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
        
        const time = new Date(timestamp).toLocaleTimeString();
        
        messageDiv.innerHTML = `
            <div class="message-content">${this.escapeHtml(text)}</div>
            <div class="message-meta">${username} • ${time}</div>
        `;
        
        this.messageList.appendChild(messageDiv);
        this.messageList.scrollTop = this.messageList.scrollHeight;
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
            return;
        }
        
        try {
            const message = {
                text: text,
                room_id: this.currentRoom
            };
            
            this.websocket.send(JSON.stringify(message));
            this.messageInput.value = "";
        } catch (error) {
            console.error("Error sending message:", error);
            this.showLoginError("Failed to send message");
        }
    }
    
    async loadMessageHistory() {
        try {
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
            
            // Load historical messages
            if (data.messages && data.messages.length > 0) {
                data.messages.forEach(msg => {
                    this.displayMessage(msg.username, msg.text, msg.timestamp);
                });
            }
        } catch (error) {
            console.error("Error loading message history:", error);
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
    }
    
    updateConnectionStatus(connected) {
        if (connected) {
            this.statusIndicator.classList.add("connected");
            this.statusIndicator.classList.remove("disconnected");
            this.statusText.textContent = "Connected";
        } else {
            this.statusIndicator.classList.remove("connected");
            this.statusIndicator.classList.add("disconnected");
            this.statusText.textContent = "Disconnected";
        }
    }
    
    handleLogout() {
        localStorage.removeItem("token");
        localStorage.removeItem("username");
        
        if (this.websocket) {
            this.websocket.close();
        }
        
        this.chatContainer.style.display = "none";
        this.loginContainer.style.display = "flex";
        
        this.usernameInput.value = "";
        this.passwordInput.value = "";
        this.messageList.innerHTML = "";
    }
    
    showLoginError(message) {
        this.loginError.textContent = message;
        this.loginError.style.display = "block";
    }
    
    showLoadingSpinner() {
        this.loadingSpinner.style.display = "flex";
    }
    
    hideLoadingSpinner() {
        this.loadingSpinner.style.display = "none";
    }
    
    escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize app when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
    window.chatApp = new ChatApp();
});
