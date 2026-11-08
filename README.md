# X Thread Export

Export a whole X thread as Markdown and JSON - author, text, time and media URLs.

## What it does

Starts at any tweet, walks the parent chain to the thread root, collects the conversation, previews every post, then writes a Markdown file and a JSON file locally.

## Install

Read the shared **[userscript install guide](https://github.com/chirag127/userscript-install-guide)** once (ScriptCat / Tampermonkey setup), then install:

**[Install x-thread-export-userscript.user.js](https://github.com/chirag127/x-thread-export-userscript/raw/main/x-thread-export-userscript.user.js)**

## Use

1. Open the tweet and press **Alt+Shift+E** (panel is on the top left).
2. The URL field is prefilled from the address bar; paste a different tweet if needed.
3. Press **Scan thread** and review the preview - the root post is highlighted.
4. Press **Export Markdown**, **Export JSON**, or **Copy list**.

Everything runs in a floating panel: drag it by the header, resize from the corner, collapse it to a chip. The dry run always comes first; exactly one confirm starts the work.

## Limits

- Ancestors are capped at 40 and posts at the configured maximum (default 400).
- Replies come from the `2/timeline/conversation` endpoint; if it refuses, the script falls back to tweets currently rendered in the DOM.
- Deleted or protected parents stop the ancestor walk at that point.
- Media URLs point at `pbs.twimg.com` / `video.twimg.com` and can expire.

## Risk note

Read-only - nothing on X changes. The only risk is exporting someone else's thread without attribution; the Markdown keeps author handles and source URLs.

The script acts with your own signed-in session against your own account. It is not an anti-bot bypass - it uses the same endpoints the site's own page uses.

## Documentation

- [AGENTS.md](AGENTS.md) - implementation notes and test steps
- [okf/](okf/index.md) - knowledge bundle for humans and agents

## License

[MIT](LICENSE) (c) 2026 chirag127
