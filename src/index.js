import 'dotenv/config';
import {
  Client, GatewayIntentBits, PermissionFlagsBits, REST, Routes,
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, ChannelType,
} from 'discord.js';
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  NoSubscriberBehavior, AudioPlayerStatus, VoiceConnectionStatus, entersState,
} from '@discordjs/voice';
import yts from 'yt-search';
import play from 'play-dl';

for (const key of ['DISCORD_TOKEN', 'CLIENT_ID']) {
  if (!process.env[key]) throw new Error(`Missing ${key} in .env`);
}

const client = new Client({ intents: [
  GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages,
] });
const music = new Map();
const pick = (items) => items[Math.floor(Math.random() * items.length)];
const friendly = [
  'I’m here with you. You do not have to handle everything alone 💙',
  'That sounds like a lot. Take a breath — one small step at a time.',
  'Thank you for telling me. I’m listening, and I’m glad you reached out.',
];
const encouragement = [
  'You are doing better than you think.', 'Your feelings are valid.',
  'It is okay to rest. You do not have to earn a break.',
  'I believe in you — keep going, gently.',
];

const commands = [
  ['help', 'Show the complete command guide'],
  ['ping', 'Check bot latency'], ['serverinfo', 'Show server information'],
  ['userinfo', 'Show information about a member'],
  ['8ball', 'Ask the magic 8-ball a question'], ['choose', 'Choose between options'],
  ['coinflip', 'Flip a coin'], ['compliment', 'Send someone a kind compliment'],
  ['hug', 'Send someone a virtual hug'], ['encourage', 'Get a little encouragement'],
  ['quote', 'Get a thoughtful quote'],
  ['remind', 'Send yourself a reminder later'], ['poll', 'Create a simple poll'],
  ['search', 'Search YouTube'], ['play', 'Play audio in your voice channel'],
  ['queue', 'Show the music queue'], ['pause', 'Pause music'],
  ['resume', 'Resume music'], ['skip', 'Skip the current song'],
  ['stop', 'Stop music and leave voice'],
].map(([name, description]) => new SlashCommandBuilder().setName(name).setDescription(description));

commands[3].addUserOption(o => o.setName('user').setDescription('Member').setRequired(false));
commands[5].addStringOption(o => o.setName('options').setDescription('Separate choices with commas').setRequired(true));
commands[7].addUserOption(o => o.setName('user').setDescription('Who should receive it?').setRequired(false));
commands[8].addUserOption(o => o.setName('user').setDescription('Who should receive it?').setRequired(false));
commands[11].addStringOption(o => o.setName('message').setDescription('Reminder text').setRequired(true))
  .addIntegerOption(o => o.setName('minutes').setDescription('Minutes from now').setMinValue(1).setMaxValue(10080).setRequired(true));
commands[12].addStringOption(o => o.setName('question').setDescription('Poll question').setRequired(true));
for (const i of [4]) commands[i].addStringOption(o => o.setName('question').setDescription('Your question').setRequired(true));
for (const i of [13, 14]) commands[i].addStringOption(o => o.setName('query').setDescription('Search terms or a YouTube URL').setRequired(true));

commands.push(new SlashCommandBuilder().setName('announce').setDescription('Post an announcement')
  .addStringOption(o => o.setName('message').setDescription('Announcement text').setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild));
commands.push(new SlashCommandBuilder().setName('clear').setDescription('Delete messages')
  .addIntegerOption(o => o.setName('amount').setDescription('1 to 100').setMinValue(1).setMaxValue(100).setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages));
commands.push(new SlashCommandBuilder().setName('kick').setDescription('Kick a member')
  .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
  .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false))
  .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers));
commands.push(new SlashCommandBuilder().setName('ban').setDescription('Ban a member')
  .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
  .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false))
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers));
commands.push(new SlashCommandBuilder().setName('ticket').setDescription('Open or manage a private support ticket')
  .addSubcommand(s => s.setName('create').setDescription('Open a ticket').addStringOption(o => o.setName('reason').setDescription('What do you need help with?')))
  .addSubcommand(s => s.setName('close').setDescription('Close this ticket'))
  .addSubcommand(s => s.setName('claim').setDescription('Claim this ticket')));

async function register() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const route = process.env.GUILD_ID ? Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID) : Routes.applicationCommands(process.env.CLIENT_ID);
  await rest.put(route, { body: commands.map(c => c.toJSON()) });
  console.log('Commands registered.');
}
function support(member) { return member?.permissions.has(PermissionFlagsBits.ManageChannels) || (process.env.SUPPORT_ROLE_ID && member.roles.cache.has(process.env.SUPPORT_ROLE_ID)); }
async function yt(query) { const r = await yts(query); return r.videos?.[0] ?? null; }
async function stop(guildId) { const s = music.get(guildId); if (!s) return false; s.player.stop(); s.connection.destroy(); music.delete(guildId); return true; }
async function next(guildId) {
  const s = music.get(guildId); if (!s) return;
  if (!s.queue.length) { s.text.send('🎵 The queue is finished. Thanks for listening with me 💙').catch(() => {}); return stop(guildId); }
  const track = s.queue.shift();
  try {
    const stream = await play.stream(track.url, { discordPlayerCompatibility: true });
    s.player.play(createAudioResource(stream.stream, { inputType: stream.type }));
    s.text.send(`🎶 Now playing **${track.title}**`).catch(() => {});
  } catch { s.text.send('I could not play that one, so I’ll try the next song.').catch(() => {}); next(guildId); }
}
async function playTrack(interaction, query) {
  const voice = interaction.member.voice?.channel;
  if (!voice) return interaction.reply({ content: 'Join a voice channel first, and I’ll come with you 🎧', ephemeral: true });
  const result = /^https?:\/\//i.test(query) ? { url: query, title: query } : await yt(query);
  if (!result) return interaction.reply({ content: 'I could not find that song. Try another search?', ephemeral: true });
  await interaction.deferReply();
  let s = music.get(interaction.guildId);
  if (!s) {
    const connection = joinVoiceChannel({ channelId: voice.id, guildId: interaction.guildId, adapterCreator: interaction.guild.voiceAdapterCreator });
    await entersState(connection, VoiceConnectionStatus.Ready, 20000);
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    connection.subscribe(player); s = { connection, player, queue: [], text: interaction.channel }; music.set(interaction.guildId, s);
    player.on('stateChange', (oldState, newState) => { if (newState.status === AudioPlayerStatus.Idle && oldState.status !== AudioPlayerStatus.Idle) next(interaction.guildId); });
  }
  s.queue.push({ title: result.title, url: result.url }); s.text = interaction.channel;
  if (s.player.state.status !== AudioPlayerStatus.Playing) await next(interaction.guildId);
  return interaction.editReply(`✅ Added **${result.title}** to the queue. I’ll keep the music going.`);
}
async function createTicket(i) {
  const old = i.guild.channels.cache.find(c => c.name === `ticket-${i.user.id}`);
  if (old) return i.reply({ content: `You already have a ticket here: ${old}`, ephemeral: true });
  const role = process.env.SUPPORT_ROLE_ID;
  const overwrites = [{ id: i.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }, { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }];
  if (role) overwrites.push({ id: role, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  const c = await i.guild.channels.create({ name: `ticket-${i.user.id}`, type: ChannelType.GuildText, parent: process.env.TICKET_CATEGORY_ID || undefined, permissionOverwrites: overwrites, topic: `Ticket owner: ${i.user.tag}` });
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket-close').setLabel('Close ticket').setStyle(ButtonStyle.Danger));
  await c.send({ content: role ? `<@&${role}>` : 'Support team', embeds: [new EmbedBuilder().setTitle('🎫 I’m here to help').setDescription(`Welcome ${i.user}!\n\nTell us what is going on and someone will be with you soon.\nReason: **${i.options.getString('reason') || 'Not specified'}**`).setColor(0x5865f2)], components: [row] });
  return i.reply({ content: `Your private ticket is ready: ${c}`, ephemeral: true });
}
function ticketClose(i) { if (!i.channel?.name.startsWith('ticket-')) return i.reply({ content: 'This is not a ticket channel.', ephemeral: true }); if (!support(i.member) && !i.channel.topic?.includes(i.user.tag)) return i.reply({ content: 'Only the ticket owner or support team can close this.', ephemeral: true }); i.reply('I’ll close this ticket in 5 seconds. Take care 💙'); setTimeout(() => i.channel.delete().catch(() => {}), 5000); }

client.on('ready', () => console.log(`Logged in as ${client.user.tag}`));
client.on('interactionCreate', async i => {
  try {
    if (i.isButton() && i.customId === 'ticket-close') return ticketClose(i);
    if (!i.isChatInputCommand()) return;
    const n = i.commandName;
    if (n === 'help') return i.reply({ embeds: [new EmbedBuilder().setTitle('💙 Everything I can do').setDescription('**Kind & fun**\n`/8ball` `/choose` `/coinflip` `/compliment` `/hug` `/encourage` `/quote` `/remind` `/poll`\n\n**Music**\n`/search` `/play` `/queue` `/pause` `/resume` `/skip` `/stop`\n\n**Server tools**\n`/ticket create` `/ticket close` `/ticket claim` `/clear` `/kick` `/ban` `/announce`\n\n**Info**\n`/ping` `/serverinfo` `/userinfo`\n\nI’m always happy to help — just ask.').setColor(0x5865f2)] });
    if (n === 'ping') return i.reply(`Pong! I’m here — ${Date.now() - i.createdTimestamp}ms 💙`);
    if (n === 'coinflip') return i.reply(pick(['Heads! 🪙', 'Tails! 🪙']));
    if (n === '8ball') return i.reply(pick(['Absolutely ✨', 'Probably!', 'I think so 💙', 'Not today, but keep going.', 'The future is still being written.', 'Ask me again in a little while.']));
    if (n === 'choose') return i.reply(`I choose **${pick(i.options.getString('options').split(',').map(x => x.trim()).filter(Boolean))}** — trust your instincts too 💙`);
    if (n === 'encourage') return i.reply(pick(encouragement));
    if (n === 'quote') return i.reply(`“${pick(['Small steps still move you forward.', 'You can be a work in progress and still be proud of yourself.', 'There is no shame in beginning again.'])}”`);
    if (n === 'compliment') { const u = i.options.getUser('user') || i.user; return i.reply(`${u}, you make this server a warmer place just by being here ✨`); }
    if (n === 'hug') { const u = i.options.getUser('user') || i.user; return i.reply(`${i.user} gives ${u} a big virtual hug 🤗 You’re not alone.`); }
    if (n === 'remind') { const mins = i.options.getInteger('minutes'); const message = i.options.getString('message'); await i.reply(`I’ll remind you in ${mins} minute${mins === 1 ? '' : 's'} 💙`); setTimeout(() => i.user.send(`⏰ You asked me to remind you: **${message}**`).catch(() => i.channel.send(`${i.user}, reminder: **${message}**`).catch(() => {})), mins * 60000); return; }
    if (n === 'poll') { const q = i.options.getString('question'); const m = await i.reply({ content: `📊 **${q}**\nReact with ✅ for yes or ❌ for no.`, fetchReply: true }); await m.react('✅'); await m.react('❌'); return; }
    if (n === 'search') { const r = await yt(i.options.getString('query')); return i.reply(r ? `🔎 **${r.title}**\n${r.url}` : 'I found nothing this time.'); }
    if (n === 'play') return playTrack(i, i.options.getString('query'));
    if (n === 'queue') { const s = music.get(i.guildId); return i.reply(s?.queue.length ? s.queue.slice(0, 15).map((x, k) => `${k + 1}. ${x.title}`).join('\n') : 'The queue is empty. Add something with `/play` 🎵'); }
    if (n === 'pause' || n === 'resume') { const s = music.get(i.guildId); if (!s) return i.reply({ content: 'Nothing is playing right now.', ephemeral: true }); n === 'pause' ? s.player.pause() : s.player.unpause(); return i.reply(n === 'pause' ? '⏸️ Paused — I’ll be ready when you are.' : '▶️ Music resumed.'); }
    if (n === 'skip') { const s = music.get(i.guildId); if (!s) return i.reply({ content: 'Nothing is playing.', ephemeral: true }); s.player.stop(); return i.reply('⏭️ Skipped. Let’s find the next vibe.'); }
    if (n === 'stop') { await stop(i.guildId); return i.reply('🛑 Music stopped. I’ll be here whenever you want me back.'); }
    if (n === 'serverinfo') return i.reply(`**${i.guild.name}** has ${i.guild.memberCount} members and ${i.guild.channels.cache.size} channels.`);
    if (n === 'userinfo') { const u = i.options.getUser('user') || i.user; return i.reply({ embeds: [new EmbedBuilder().setTitle(u.tag).setThumbnail(u.displayAvatarURL()).setDescription(`Account created <t:${Math.floor(u.createdTimestamp / 1000)}:R>`).setColor(0x5865f2)] }); }
    if (n === 'announce') { await i.reply({ content: 'Announcement posted.', ephemeral: true }); return i.channel.send({ embeds: [new EmbedBuilder().setTitle('📣 Announcement').setDescription(i.options.getString('message')).setColor(0xf1c40f)] }); }
    if (n === 'clear') { const amount = i.options.getInteger('amount'); await i.channel.bulkDelete(amount, true); return i.reply({ content: `Deleted ${amount} messages.`, ephemeral: true }); }
    if (n === 'kick' || n === 'ban') { const u = i.options.getUser('user'); const reason = i.options.getString('reason') || 'No reason given'; n === 'kick' ? await i.guild.members.kick(u, reason) : await i.guild.members.ban(u, { reason }); return i.reply(`${n === 'kick' ? 'Kicked' : 'Banned'} ${u.tag}. Reason: ${reason}`); }
    if (n === 'ticket') { const sub = i.options.getSubcommand(); if (sub === 'create') return createTicket(i); if (sub === 'close') return ticketClose(i); if (sub === 'claim') return i.channel?.name.startsWith('ticket-') && support(i.member) ? i.reply(`${i.user} has claimed this ticket and will help you 💙`) : i.reply({ content: 'Support members only, inside a ticket.', ephemeral: true }); }
  } catch (e) { console.error(e); const message = 'Something went wrong, but I’m still here — please try that again.'; if (i.deferred || i.replied) i.editReply(message).catch(() => {}); else i.reply({ content: message, ephemeral: true }).catch(() => {}); }
});
await register();
await client.login(process.env.DISCORD_TOKEN);
