# Team matchmaking

Use `/team create game:<name>` to post a joinable team card in the current channel. The host is the first player. Optional fields:

Example: `/team create game:Lien Quan slots:5 rank:Diamond role:Jungle starts_in:60`.

- `slots`: total players, including the host (2-10; default 5).
- `rank`: preferred rank.
- `role`: position or role needed.
- `starts_in`: minutes until the game starts (0-10080; default 0).

Players use **Join** and **Leave** on the card. Join is disabled when all spots are taken and reopens if someone leaves. The host cannot leave; they can use **Cancel** or `/team cancel`. Staff with **Manage Server** can cancel a team with `/team cancel message_id:<id>`. `/team list` shows up to 10 active teams.

For scheduled teams, the bot mentions participants once when the start time arrives. Teams expire two hours after their start time. The bot updates expired cards and removes closed team records after 30 days.

Team data is saved in `data/teams.json`, which is ignored by Git. Back it up before replacing the VPS or disk. Buttons and scheduled reminders continue to work after a bot restart. No AI key or external service is needed.

After deploying code, run `npm run deploy` to register `/team`, then restart the `discordbot` PM2 process.
