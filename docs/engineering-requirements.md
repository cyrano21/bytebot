# Engineering Requirements

## Capability Preservation

When a user reports that a feature is broken, do not "fix" it by removing the
capability or returning a generic error. First provide an operational
replacement path, fallback, or explicit integration point that can satisfy the
same user intent.

Concrete lesson from the TikTok comments task: blocking TikTok comment
extraction because the active LLM was weak was the wrong product behavior. The
correct behavior is to add a deterministic TikTok collection path first, then
fall back to browser automation when the collector is unavailable.
