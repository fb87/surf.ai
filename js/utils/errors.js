import { ProviderApiError } from "../providers/provider-error.js";
import { LlmApiError } from "../llm/llm-client.js";
import { WikiGenerationError } from "../pipeline/wiki-generator.js";

export function mapErrorToMessage(err) {
  if (err instanceof ProviderApiError) {
    switch (err.kind) {
      case "not_found":
        return "We couldn't find that repository (or branch). Check the URL and try again.";
      case "rate_limited":
        return err.message || "The repository host's API rate limit was hit (unauthenticated access is rate-limited). Wait a bit and retry.";
      case "unauthorized":
        return err.message || "That host rejected the request (401/403) — it likely requires authentication, which isn't supported for repository hosts, only public/anonymous access.";
      case "network":
        return "Network error reaching the repository host. Check your connection and try again.";
      default:
        return `The repository host returned an unexpected error${err.status ? ` (status ${err.status})` : ""}.`;
    }
  }
  if (err instanceof LlmApiError) {
    switch (err.kind) {
      case "auth":
        return "Authentication with the LLM endpoint failed — check your API key in Settings.";
      case "network":
        return "Network error contacting the LLM endpoint. Check the Base URL in Settings and your connection.";
      case "rate_limited":
        return `Rate limit hit on the LLM endpoint — wait a moment and try again.${err.detail ? ` (${err.detail})` : ""}`;
      case "bad_response":
        return "The LLM endpoint returned a response this app couldn't understand.";
      default:
        return err.detail
          ? `The LLM endpoint returned an error${err.status ? ` (status ${err.status})` : ""}: ${err.detail}`
          : `The LLM endpoint returned an unexpected error${err.status ? ` (status ${err.status})` : ""}.`;
    }
  }
  if (err instanceof WikiGenerationError) return err.message;
  return err.message || "An unexpected error occurred.";
}
