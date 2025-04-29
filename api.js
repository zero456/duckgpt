// DuckGPT OpenAI API 兼容服务
// 部署到 Cloudflare Worker 上使用

const MODELS = ['gpt-4o-mini', 'o3-mini', 'claude-3-haiku-20240307', 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', 'mistralai/Mixtral-8x7B-Instruct-v0.1'];
const MAIN_MODEL = 'gpt-4o-mini';
const STATUS_URL = 'https://duckduckgo.com/duckchat/v1/status';
const CHAT_API = 'https://duckduckgo.com/duckchat/v1/chat';

const ERROR_404 = {"action":"error", "status": 404, "usage": "GET /chat/?prompt=<text>&model=<model>&history=<List[Dict{str, str}]>", "models": MODELS};
const ERROR_403 = {"action":"error", "status": 403, "response": "Wrong history syntax", "example":"[{'role': 'user','content': 'Expert python geek'}]"};

const HEAD_JSON = { 'content-type': 'application/json', 'Access-Control-Allow-Origin': "*"};

// 主请求处理
addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request))
});

// 验证 API 密钥
function validateApiKey(request, env) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return false;
    }
    const apiKey = authHeader.substring(7);
    const validKeys = env.API_KEYS ? env.API_KEYS.split(',') : [];
    return validKeys.includes(apiKey);
}

async function handleRequest(request, env) {
    // 处理 OPTIONS 请求
    if (request.method === 'OPTIONS') {
        return new Response(null, { 
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            }
        });
    }

    // 验证 API 密钥
    if (!validateApiKey(request, env)) {
        return new Response(JSON.stringify({
            "error": {
                "message": "Invalid API key",
                "type": "invalid_request_error",
                "code": "invalid_api_key"
            }
        }), { status: 401, headers: HEAD_JSON });
    }

    const url = new URL(request.url);
    
    // 处理 /v1/chat/completions 端点
    if (url.pathname === '/v1/chat/completions' && request.method === 'POST') {
        try {
            const body = await request.json();
            const messages = body.messages || [];
            const model = body.model || MAIN_MODEL;
            
            if (!MODELS.includes(model)) {
                return new Response(JSON.stringify({
                    "error": {
                        "message": `Model ${model} not found. Available models: ${MODELS.join(', ')}`,
                        "type": "invalid_request_error",
                        "code": "model_not_found"
                    }
                }), { status: 404, headers: HEAD_JSON });
            }

            const response = await Chat(messages, model);
            return new Response(JSON.stringify(response), { headers: HEAD_JSON });
        } catch (error) {
            return new Response(JSON.stringify({
                "error": {
                    "message": error.message,
                    "type": "invalid_request_error",
                    "code": "invalid_request"
                }
            }), { status: 400, headers: HEAD_JSON });
        }
    }

    // 处理 /v1/models 端点
    if (url.pathname === '/v1/models' && request.method === 'GET') {
        const models = MODELS.map(model => ({
            id: model,
            object: "model",
            created: Date.now(),
            owned_by: "duckgpt"
        }));
        
        return new Response(JSON.stringify({
            object: "list",
            data: models
        }), { headers: HEAD_JSON });
    }

    return new Response(JSON.stringify(ERROR_404), { status: 404, headers: HEAD_JSON });
}

// DuckGPT 聊天函数
async function Chat(messages, model) {
    let headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Referer': 'https://duckduckgo.com/',
        'Cache-Control': 'no-store',
        'x-vqd-accept': '1',
        'Connection': 'keep-alive',
        'Cookie': 'dcm=3',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Priority': 'u=4',
        'Pragma': 'no-cache',
        'TE': 'trailers'
    }

    const vdq = await fetch(STATUS_URL, { headers: headers });
    headers['x-vqd-4'] = vdq.headers.get('x-vqd-4');
    headers['x-vqd-hash-1'] = vdq.headers.get('x-vqd-hash-1');
    headers['Content-Type'] = 'application/json';

    let Response = await (await fetch(CHAT_API, { 
        method: 'POST', 
        headers: headers, 
        body: JSON.stringify({
            model: model, 
            messages: messages
        }) 
    })).text();
    
    let chatMessages = Response.split('\n')
        .filter(line => line.includes('message'))
        .map(line => JSON.parse(line.split('data: ')[1]).message)
        .join('');
    
    if (chatMessages == "") {return Response;}
    else {
        return {
            id: `chatcmpl-${Date.now()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [{
                index: 0,
                message: {
                    role: "assistant",
                    content: chatMessages
                },
                finish_reason: "stop"
            }],
            usage: {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0
            }
        };
    }
} 