import { GitHubApiError } from "../github/github-client.js";
import { LlmApiError } from "../llm/llm-client.js";
import { WikiGenerationError } from "../pipeline/wiki-generator.js";

export function mapErrorToMessage(err) {
  if (err instanceof GitHubApiError) {
    switch (err.kind) {
      case "not_found":
        return "We couldn't find that repository (or branch). Check the URL and try again.";
      case "rate_limited":
        return "GitHub's API rate limit was hit (60 requests/hour for unauthenticated access). Wait a bit and retry.";
      case "network":
        return "Network error reaching GitHub. Check your connection and try again.";
      default:
        return `GitHub API returned an unexpected error${err.status ? ` (status ${err.status})` : ""}.`;
    }
  }
  if (err instanceof LlmApiError) {
    switch (err.kind) {
      case "auth":
        return "Authentication with the LLM endpoint failed — check your API key in Settings.";
      case "network":
        return "Network error contacting the LLM endpoint. Check the Base URL in Settings and your connection.";
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
