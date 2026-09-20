# Friendly Discord Bot

A warm, feature-rich Discord bot with tickets, music, moderation, search, and human-friendly replies.

## Commands

- **Friendly:** `/8ball`, `/choose`, `/coinflip`, `/compliment`, `/hug`, `/encourage`, `/quote`, `/remind`, `/poll`
- **Music:** `/search`, `/play`, `/queue`, `/pause`, `/resume`, `/skip`, `/stop`
- **Server:** `/ticket create`, `/ticket close`, `/ticket claim`, `/clear`, `/kick`, `/ban`, `/announce`
- **Info:** `/help`, `/ping`, `/serverinfo`, `/userinfo`

## Setup

1. Create a bot application in the Discord Developer Portal.
2. Copy `.env.example` to `.env` and set `DISCORD_TOKEN` and `CLIENT_ID`.
3. Optionally set `GUILD_ID` for instant command updates, plus the ticket role/category IDs.
4. Run `npm install`, then `npm start`.

Invite the bot with the `bot` and `applications.commands` scopes and only the permissions it needs. Never use a normal user token or self-bot. The bot can join voice and play audio, but Discord does not allow bot accounts to screen-share or Go Live.
