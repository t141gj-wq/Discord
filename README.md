# Discord support, ticket, search and voice bot

## Important account limitation
Create the bot through the [Discord Developer Portal](https://discord.com/developers/applications). Do **not** use a normal user account or a user token. Automating a user account (a self-bot) violates Discord rules and can get the account banned. A bot account can join voice channels and play audio, but Discord does not provide bots with normal user screen sharing/Go Live access.

## Setup

1. Create an application and bot in the Developer Portal.
2. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN` and `CLIENT_ID`.
3. Invite it with the `bot` and `applications.commands` scopes. Grant only the permissions it needs, including View Channels, Send Messages, Manage Channels, Manage Messages, Connect, and Speak.
4. Run:

```bash
npm install
npm start
```

Set `GUILD_ID` while testing for instant command registration. Without it, commands are registered globally and can take time to appear.

## Included commands

`/ticket create`, `/ticket close`, `/ticket claim`, `/search`, `/play`, `/stop`, `/skip`, `/serverinfo`, `/userinfo`, `/clear`, and `/announce`.

The ticket system creates private channels, supports a support role, adds a close button, and can place tickets in a category. Configure `SUPPORT_ROLE_ID`, `TICKET_CATEGORY_ID`, and `LOG_CHANNEL_ID` in `.env`.

Only use media you are allowed to access and stream. This starter intentionally does not implement a self-bot or screen-share workaround.
