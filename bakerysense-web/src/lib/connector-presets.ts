export type PresetId =
	| "openrouter" | "groq" | "together" | "cloudflare-ai"
	| "openai" | "anthropic-via-oai" | "ollama-tunnel" | "custom";

export interface Preset {
	id: PresetId;
	label: string;
	defaultBaseUrl: string;
	suggestedModels: string[];
	supportsOAuth: boolean;
	supportsApiKey: boolean;
}

export const PRESETS: Record<PresetId, Preset> = {
	"openrouter":        { id: "openrouter",        label: "OpenRouter",        defaultBaseUrl: "https://openrouter.ai/api/v1",        suggestedModels: ["google/gemma-4-e4b-it", "google/gemma-4-26b-it"], supportsOAuth: true,  supportsApiKey: true },
	"groq":              { id: "groq",              label: "Groq",              defaultBaseUrl: "https://api.groq.com/openai/v1",     suggestedModels: ["gemma-4-e4b-it"],                                  supportsOAuth: false, supportsApiKey: true },
	"together":          { id: "together",          label: "Together AI",       defaultBaseUrl: "https://api.together.xyz/v1",        suggestedModels: ["google/gemma-4-27b-it"],                           supportsOAuth: false, supportsApiKey: true },
	"cloudflare-ai":     { id: "cloudflare-ai",     label: "Cloudflare Workers AI", defaultBaseUrl: "cloudflare-ai:",                 suggestedModels: ["@cf/google/gemma-4-e4b-it"],                       supportsOAuth: false, supportsApiKey: false },
	"openai":            { id: "openai",            label: "OpenAI",            defaultBaseUrl: "https://api.openai.com/v1",          suggestedModels: [],                                                  supportsOAuth: false, supportsApiKey: true },
	"anthropic-via-oai": { id: "anthropic-via-oai", label: "Anthropic (via OAI proxy)", defaultBaseUrl: "",                          suggestedModels: [],                                                  supportsOAuth: false, supportsApiKey: true },
	"ollama-tunnel":     { id: "ollama-tunnel",     label: "Local Ollama (tunnel)", defaultBaseUrl: "",                              suggestedModels: ["gemma4:e4b-it-q4_K_M"],                            supportsOAuth: false, supportsApiKey: false },
	"custom":            { id: "custom",            label: "Custom OpenAI-compatible", defaultBaseUrl: "",                           suggestedModels: [],                                                  supportsOAuth: false, supportsApiKey: true },
};
