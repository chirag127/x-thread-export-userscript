---
type: Script
title: X Thread Export
description: Export a whole X thread as Markdown and JSON - author, text, time and media URLs.
repo: https://github.com/chirag127/x-thread-export-userscript
install: https://github.com/chirag127/x-thread-export-userscript/raw/main/x-thread-export-userscript.user.js
version: "1.0.0"
tags: [userscript, x, twitter, thread, export, markdown]
timestamp: 2026-11-09T00:00:00Z
---

# X Thread Export

Starts at any tweet, walks the parent chain to the thread root, collects the conversation, previews every post, then writes a Markdown file and a JSON file locally.

## Method

Ancestor chain via `statuses/show` `in_reply_to_status_id_str`, replies via the conversation timeline, then a Blob download of Markdown and JSON. No server, no clipboard dependency for the export path.

Endpoints:

- `GET /i/api/1.1/statuses/show.json?id=&tweet_mode=extended` - one post, used to walk `in_reply_to_status_id_str` upwards.
- `GET /i/api/2/timeline/conversation/:rootId.json` - replies, paginated with the bottom cursor.
- DOM fallback: `article[data-testid="tweet"]` when the conversation endpoint fails.

## Limitations

- Ancestors are capped at 40 and posts at the configured maximum (default 400).
- Replies come from the `2/timeline/conversation` endpoint; if it refuses, the script falls back to tweets currently rendered in the DOM.
- Deleted or protected parents stop the ancestor walk at that point.
- Media URLs point at `pbs.twimg.com` / `video.twimg.com` and can expire.

## Risk

Read-only - nothing on X changes. The only risk is exporting someone else's thread without attribution; the Markdown keeps author handles and source URLs.

## Install

Read the shared [install guide](https://github.com/chirag127/userscript-install-guide) once, then install the raw file above.
