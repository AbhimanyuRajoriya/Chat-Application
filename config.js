// Frontend Configuration
window.CONFIG = window.CONFIG || {};
const CONFIG = {
    // AWS Cognito
    COGNITO_REGION: "us-east-1",
    COGNITO_USER_POOL_ID: "us-east-1_RC8qQwJhl",
    COGNITO_CLIENT_ID: "4ks52pngn4nvenaqtup1ogjhod",
    COGNITO_DOMAIN: "us-east-1-rc8qqwjhl.auth.us-east-1.amazoncognito.com",
    
    // Backend API
    // For local development:
    // API_GATEWAY_ENDPOINT: "ws://54.196.148.112:8000",
    // API_REST_ENDPOINT: "http://54.196.148.112:8000",
    
    // For production (CloudFront):
    API_GATEWAY_ENDPOINT: "wss://d39s9x23h6lb7j.cloudfront.net",
    API_REST_ENDPOINT: "https://d39s9x23h6lb7j.cloudfront.net",
    
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
