# Discord Bot Starter

This bot includes a large command set for a Discord support server, including:

- Ticket system
- Moderation commands
- YouTube search and playback
- Music queue and playback controls
- Server and user info
- Helpful admin tools
- Announcement support

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in your values:
   - `DISCORD_TOKEN`
   - `CLIENT_ID`
   - Optional: `GUILD_ID`, `SUPPORT_ROLE_ID`, `TICKET_CATEGORY_ID`
3. Install dependencies:

```bash
npm install
```

4. Start the bot:

```bash
npm start
```

## Main commands

- `/help`
- `/ping`
- `/serverinfo`
- `/userinfo`
- `/announce`
- `/clear <amount>`
- `/kick <user>`
- `/ban <user>`
- `/search <query>`
- `/play <query>`
- `/queue`
- `/pause`
- `/resume`
- `/skip`
- `/stop`
- `/ticket create`
- `/ticket close`
- `/ticket claim`

## Important limitations

Discord bots cannot act as a normal user account for screen sharing, Go Live, or desktop screen recording. Those features require a real human account. This bot is designed to stay within Discord bot permissions and rules.

## Notes

- Use a proper bot account from the Discord Developer Portal.
- Never use a normal user account token for automation.
- Keep the token in `.env` and do not commit it to Git.
