# Integrations & developer tools

VoxStudio's voices aren't limited to the app. Scripts, AI agents, code editors and automation tools on your computer can use them too. Everything still runs locally.

## 1. Create an API key
Open **Integrations** (or **Developer**), type what the key is for, such as “Claude” or “n8n”, and click **Create key**.

Copy the key right away, because it's shown only once. The setup instructions on the page fill it in for you. You can revoke a key at any time; each key shows when it was last used.

## 2. Connect something
Pick an integration on the left. Every snippet already has the right address and your new key filled in:

| Integration | What you can do |
|---|---|
| **OpenAI SDKs** | Existing code for OpenAI's speech and transcription APIs works as is. Change the base URL and the key, and it runs locally. |
| **Claude Code** | One command. Then ask Claude to read text aloud, transcribe a recording, or clean up audio. |
| **Claude Desktop** | Paste a small block into its config. It uses VoxStudio's built-in bridge script. |
| **Cursor & VS Code** | MCP over HTTP: paste the JSON into the editor's MCP settings. |
| **Your own agents** | Any MCP client, or plain JSON-RPC over HTTP. |
| **n8n & automations** | An HTTP Request node: narrate posts, or transcribe files as they arrive. |
| **Terminal & Shortcuts** | One-liners, such as hearing “Build finished” when a long command ends. |

Agents get these tools:
- **speak**: optionally save to a file or play aloud.
- **list_voices**
- **transcribe**
- **clean_audio**
- **convert_voice**
- **add_pronunciation**

## The Developer page
- **Connection** lists the base URL, the OpenAI-compatible base and the MCP endpoint, each with a copy button.
- **API explorer** lists every endpoint grouped by area, with search. For each one you see:
  - its parameters and body fields, with descriptions and defaults
  - ready-to-copy examples in **curl**, **Python** and **JavaScript**
  - **Try it**: edit the path and JSON body, click **Send**, and see the status, time and response.

For the complete reference, see the [API docs](../api/overview.md).

> VoxStudio listens only on this computer (`127.0.0.1`). Keys let local apps in; nothing is exposed to your network.
