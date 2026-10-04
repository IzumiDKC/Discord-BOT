# Music and assistant features

After pulling the branch and installing dependencies, run `npm run deploy` once to register the new slash commands, then `pm2 restart discordbot --update-env`.

- `/music alternatives`: choose another YouTube audio version for the current song. Only the user who opened the menu can select, and they must be in the bot's voice channel.
- `/library favorite`, `favorites`, `unfavorite`: manage your favorite songs.
- `/library save`, `playlists`, `load`, `delete`: manage personal playlists. A playlist stores up to 25 songs.
- `/library history`: see recently played songs in this server.
- `/library resume`: manually restore the queue saved before a restart. The bot never auto-joins voice on startup.
- `/dj start mood:<text>`, `stop`, `status`: keep playing fresh music for a mood. Smart DJ stops after three failed searches. `/music stop` also turns it off.
- `/assistant faq add`, `remove`, `list`: save official server FAQ answers. Adding or removing requires **Manage Server**.
- `/assistant ask`, `music`: ask a question grounded in the saved FAQ or give a natural-language music request.
- `/assistant summarize`, `triage`: analyze up to 50 recent user messages in a ticket channel. These commands require **Manage Channels**.

The library is stored in `data/music-library.json` and ignored by Git. Back up this file before replacing the VPS or its disk. Restarting the bot does not enable Smart DJ again automatically.

AI is disabled unless `OPENAI_API_KEY` is set in the bot's environment. Optionally set `OPENAI_MODEL` (default: `gpt-5.6-luna`). AI calls are only made by explicit `/assistant` commands. Ticket transcripts are sent to the configured API only when authorized staff run summarize or triage; they are not saved to the library. AI calls have a 30-second per-user cooldown, one concurrent call per server, and an in-memory limit of 60 requests per server per UTC day. Restarting the bot resets that in-memory limit. API usage may cost money.
