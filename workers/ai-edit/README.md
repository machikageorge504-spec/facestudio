# FaceStudio AI editing API

This Worker is the private server-side bridge between the static GitHub Pages app and OpenAI's image-edit endpoint. The OpenAI key is stored as a Cloudflare Worker secret and is never shipped to the browser.

## Configure once

1. Create a Cloudflare account and deploy this Worker from `workers/ai-edit` (Wrangler or Cloudflare's Git integration).
2. Add a Worker secret named `OPENAI_API_KEY` in **Workers & Pages → facestudio-ai-edit → Settings → Variables and Secrets**. Use the Secret type. Never put the value in this repository or a Vite `VITE_*` variable.
3. Set `ALLOWED_ORIGIN` as a plain variable to `https://machikageorge504-spec.github.io` if using a different Pages origin.
4. Add API billing/usage limits in the OpenAI platform before enabling public use.
5. Set the GitHub Actions/repository variable `VITE_AI_EDIT_API_URL` to the deployed Worker URL (for example, `https://facestudio-ai-edit.<your-subdomain>.workers.dev`). Rebuild the Pages site after setting it.

## Request contract

POST multipart form data to `/` with:
- `image`: one JPG, PNG, or WebP image, maximum 10 MB
- `prompt`: natural-language editing instructions, maximum 4,000 characters

Returns JSON `{ "image": "<base64 PNG>", "mimeType": "image/png" }`. Errors return a user-safe `error` message.

## Security and cost notes

- No API key is sent to the client.
- Each image is a separate paid image-edit request. Batch processing can cost money per image; check the current model price and API usage before editing a large batch.
- This endpoint limits image size and prompt length, validates content type, checks browser origin, and never caches results. Origin checks are not authentication and do not prevent all automated abuse; configure Cloudflare rate limiting / Turnstile or add user authentication before broad public release.
- Image models can change details despite explicit identity-preservation instructions. Always review output before using it.
- Uploaded images are sent to the AI provider for processing, unlike FaceStudio's existing on-device tools. Do not upload photos unless you have permission and are comfortable with the provider's data terms.
