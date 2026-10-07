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

## Community cards and rewards

Install the updated dependencies (`npm install`), register commands with `npm run deploy`, then restart the bot (`pm2 restart discordbot --update-env`). The image renderer uses `sharp` and will fall back to text for team and welcome cards if an image cannot be generated.

- `/team create` now posts a live image poster with avatar slots and a READY state when full. Join/leave/cancel buttons still work; members earn one-time XP for hosting or joining each team.
- `/profile [user]` shows a shareable level card with activity, equipped title and frame, and earned badges.
- `/daily` grants XP once per Vietnam calendar day, with streak bonuses. `/quests` shows badge challenges; `/cosmetic frame` and `/cosmetic title` equip unlocked styles.
- `/season board` shows this week's leaderboard and `/season recap` shows last week's card. Staff can use `/season set channel:#recaps` to post a recap automatically once a new week begins, or `/season off` to stop. Empty weeks are skipped. Team activity, daily claims, and up to two hours of voice participation per day contribute XP. Voice time is credited on leaving a voice channel after at least ten minutes; an interrupted bot process cannot credit an unfinished session.
- Staff with **Manage Server** can use `/welcome set channel:#welcome`, `/welcome preview`, and `/welcome off`. Use `/welcome role_add role:<role>` for up to five self-select roles, `/welcome role_remove` to remove one, and `/welcome roles` to inspect them. The bot needs **Manage Roles** and its highest role must be above each offered role. Privileged and managed roles are blocked.

Community progress and welcome settings are stored in `data/community.json` (ignored by Git). Back this file up with the other `data/` files before replacing the VPS. All current cards are generated locally; no image or activity data is sent to an AI service.
