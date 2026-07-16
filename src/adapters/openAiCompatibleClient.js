import { AppError } from "../core/errors.js";
export function buildOpenAiChatRequest(input) {
const apiBaseUrl = (input.apiBaseUrl ?? "").replace(/\/+$/, "");
const apiKey = input.apiKey ?? "";
const model = input.model ?? "";
const prompt = input.prompt ?? "";
if (!apiBaseUrl) throw new AppError("api_base_url_required", "API base URL is required.");
if (!apiKey) throw new AppError("api_key_required", "API key is required.");
if (!model) throw new AppError("api_model_required", "Model is required.");
if (!prompt.trim()) {
throw new AppError("api_prompt_empty", "Prompt is empty.");
}
return {
url: `${apiBaseUrl}/chat/completions`,
headers: {
"content-type": "application/json",
authorization: `Bearer ${apiKey}`
},
body: {
model,
messages: [
{
role: "user",
content: prompt
}
],
temperature: input.temperature ?? 0.2
}
};
}
async function readProviderPayload(response) {
try {
return await response.json();
} catch {
throw new AppError("api_response_non_json", `AI API returned a non-JSON response with status ${response.status}.`, {
status: response.status
});
}
}

function textFromContent(content) {
if (typeof content === "string") return content;
if (!Array.isArray(content)) return "";
return content.map((part) => {
if (typeof part === "string") return part;
if (typeof part?.text === "string") return part.text;
if (typeof part?.text?.value === "string") return part.text.value;
return "";
}).filter(Boolean).join("\n");
}

export function extractProviderText(payload) {
if (!payload || typeof payload !== "object") return "";
const openAiMessage = textFromContent(payload.choices?.[0]?.message?.content);
if (openAiMessage) return openAiMessage;
if (typeof payload.choices?.[0]?.text === "string") return payload.choices[0].text;
if (typeof payload.output_text === "string") return payload.output_text;
const responsesApiText = (payload.output ?? []).flatMap((item) => item?.content ?? [])
.map((part) => textFromContent([part])).filter(Boolean).join("\n");
if (responsesApiText) return responsesApiText;
return (payload.candidates ?? []).flatMap((candidate) => candidate?.content?.parts ?? [])
.map((part) => typeof part?.text === "string" ? part.text : "")
.filter(Boolean).join("\n");
}

function responseMetadata(payload, status) {
return {
status,
topLevelKeys: payload && typeof payload === "object" ? Object.keys(payload).slice(0, 12) : [],
finishReason: payload?.choices?.[0]?.finish_reason ?? payload?.candidates?.[0]?.finishReason,
blockReason: payload?.promptFeedback?.blockReason
};
}

function providerErrorCode(status) {
return ({
401: "api_authentication_failed",
403: "api_permission_denied",
404: "api_endpoint_or_model_not_found",
429: "api_rate_limited",
503: "api_service_unavailable"
})[status] || "api_request_failed";
}

function providerErrorMessage(status, payload) {
const message = payload?.error?.message || payload?.message;
if (message) return message;
return ({
401: "The AI provider rejected the API key (HTTP 401).",
403: "The API project does not have permission to use this endpoint or model (HTTP 403).",
404: "The API endpoint or model was not found (HTTP 404).",
429: "The AI provider rate limit or project quota was exceeded (HTTP 429).",
503: "The AI provider is temporarily unavailable (HTTP 503)."
})[status] || `API request failed with status ${status}.`;
}

export function createOpenAiCompatibleClient(sender = fetch) {
return {
name: "openai-compatible-client",
async send(input) {
const request = buildOpenAiChatRequest(input);
const response = await sender(request.url, {
method: "POST",
headers: request.headers,
body: JSON.stringify(request.body)
});
const payload = await readProviderPayload(response);
if (!response.ok) {
throw new AppError(providerErrorCode(response.status), providerErrorMessage(response.status, payload), {
status: response.status,
providerErrorCode: payload.error?.code,
providerErrorType: payload.error?.type || payload.error?.status,
retryAfter: response.headers?.get?.("retry-after") || undefined
});
}
const text = extractProviderText(payload);
if (!text.trim()) {
const metadata = responseMetadata(payload, response.status);
if (metadata.blockReason || ["SAFETY", "BLOCKED", "PROHIBITED_CONTENT"].includes(metadata.finishReason)) {
throw new AppError("api_response_blocked", "The AI provider blocked the response before returning text.", metadata);
}
throw new AppError("api_response_empty", "The AI provider returned a successful response without text content.", metadata);
}
return {
provider: this.name,
model: input.model,
text,
raw: payload
};
}
};
}
