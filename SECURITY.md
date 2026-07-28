# Security Policy

## Supported Versions

| Version | Supported           |
| ------- | ------------------- |
| 0.x     | Security fixes only |

## Reporting a Vulnerability

If you discover a security vulnerability in xnews, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities.
2. Email **alpha.xone@outlook.com** with:
   - A description of the vulnerability
   - Steps to reproduce
   - Potential impact
3. You should receive an acknowledgment within 48 hours.

We will work with you to understand and address the issue before any public disclosure.

## Scope

xnews fetches and parses untrusted third-party content from public web endpoints, and can
spawn local subprocesses for audio transcription. Security concerns may include:

- Credential exposure through the OpenRouter transcription backend. The backend sends the
  API key only to the official `https://openrouter.ai` origin; a change that lets an
  injected `fetch`, base URL, or redirect move credentials to another origin is a
  vulnerability.
- Server-side request forgery through subject input, feed URLs, or redirect unwrapping
  (for example the Bing and Google News link unwrappers).
- Unsafe parsing of upstream RSS, Atom, JSON, or HTML that leads to resource exhaustion or
  prototype pollution.
- Command or argument injection through the `yt-dlp`, FFmpeg, or Python sidecar invocation
  used by realtime transcription, including wrapper commands such as `uv run`.
- Path traversal when resolving the bundled `moonshine-worker.py` sidecar.
- Dependency vulnerabilities in the published package.

## Hardening

- The package holds no credentials of its own and persists no data.
- OpenRouter requests are pinned to the official origin regardless of the injected `fetch`.
- Event and request queues are bounded, so a hostile or slow upstream applies backpressure
  rather than growing output without limit.
- All HTTP goes through the injected `fetch` in `fetchText`, so consumers can enforce their
  own proxy, allowlist, retry, and metering policy.
- Published artifacts carry npm provenance attestations built from tagged commits via
  GitHub OIDC trusted publishing.
