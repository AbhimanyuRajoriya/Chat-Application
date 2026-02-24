// Frontend Configuration

const CONFIG = {
    // AWS Cognito
    COGNITO_REGION: "us-east-1",
    COGNITO_USER_POOL_ID: "us-east-1_xxxxxxxxx",
    COGNITO_CLIENT_ID: "1234567890abcdefghijklmnop",
    COGNITO_DOMAIN: "your-domain.auth.us-east-1.amazoncognito.com",
    
    // Backend API
    // For local development:
    // API_GATEWAY_ENDPOINT: "ws://localhost:8000",
    // API_REST_ENDPOINT: "http://localhost:8000",
    
    // For production (CloudFront):
    API_GATEWAY_ENDPOINT: "wss://13.218.244.88:8000/ws",
    API_REST_ENDPOINT: "https://13.218.244.88:8000",
    
    // WebSocket configuration
    WEBSOCKET_RECONNECT_DELAY: 3000,  // 3 seconds
    WEBSOCKET_MAX_RETRIES: 5,
    
    // UI
    DEFAULT_ROOM: "general",
    MESSAGE_LOAD_LIMIT: 50
};

// Helper: Get Cognito authorization code URL
function getCognitoAuthUrl() {
    const redirectUri = window.location.origin;
    const params = new URLSearchParams({
        client_id: CONFIG.COGNITO_CLIENT_ID,
        response_type: "code",
        scope: "openid profile email",
        redirect_uri: redirectUri
    });
    
    return `https://${CONFIG.COGNITO_DOMAIN}/oauth2/authorize?${params.toString()}`;
}
