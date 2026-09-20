import 'dotenv/config';
import { Client, GatewayIntentBits, PermissionFlagsBits, ChannelType, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } from '@discordjs/voice';
import play from 'play-dl';
import yts from 'yt-search';

const required = ['DISCORD_TOKEN', 'CLIENT_ID'];
for (const key of required) if (!process.env[key]) throw new Error(`Missing ${key} in .env`);

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const players = new Map();

const commands = [
  new SlashCommandBuilder().setName('ticket').setDescription('Create or manage support tickets')
    .addSubcommand(s => s.setName('create').setDescription('Open a private support ticket').addStringOption(o => o.setName('reason').setDescription('What do you need help with?').setRequired(false)))
    .addSubcommand(s => s.setName('close').setDescription('Close the current ticket'))
    .addSubcommand(s => s.setName('claim').setDescription('Claim the current ticket')),
  new SlashCommandBuilder().setName('search').setDescription('Search YouTube').addStringOption(o => o.setName('query').setDescription('Search terms').setRequired(true)),
  new SlashCommandBuilder().setName('play').setDescription('Join your voice channel and play audio').addStringOption(o => o.setName('query').setDescription('YouTube URL or search terms').setRequired(true)),
  new SlashCommandBuilder().setName('stop').setDescription('Stop audio and leave voice'),
  new SlashCommandBuilder().setName('skip').setDescription('Stop the current audio'),
  new SlashCommandBuilder().setName('serverinfo').setDescription('Show server information'),
  new SlashCommandBuilder().setName('userinfo').setDescription('Show user information').addUserOption(o => o.setName('user').setDescription('User').setRequired(false)),
  new SlashCommandBuilder().setName('clear').setDescription('Delete recent messages').addIntegerOption(o => o.setName('amount').setDescription('1-100').setMinValue(1).setMaxValue(100).setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder().setName('announce').setDescription('Send an announcement').addStringOption(o => o.setName('message').setDescription('Announcement text').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const route = process.env.GUILD_ID ? Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID) : Routes.applicationCommands(process.env.CLIENT_ID);
  await rest.put(route, { body: commands });
  console.log('Slash commands registered.');
}

function isSupport(member) {
  return member.permissions.has(PermissionFlagsBits.ManageChannels) || (process.env.SUPPORT_ROLE_ID && member.roles.cache.has(process.env.SUPPORT_ROLE_ID));
}

async function createTicket(interaction) {
  const existing = interaction.guild.channels.cache.find(c => c.name === `ticket-${interaction.user.id}`);
  if (existing) return interaction.reply({ content: `You already have a ticket: ${existing}`, ephemeral: true });
  const support = process.env.SUPPORT_ROLE_ID;
  const overwrites = [
    { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
  ];
  if (support) overwrites.push({ id: support, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  const channel = await interaction.guild.channels.create({ name: `ticket-${interaction.user.id}`, type: ChannelType.GuildText, parent: process.env.TICKET_CATEGORY_ID || undefined, permissionOverwrites: overwrites, topic: `Ticket owner: ${interaction.user.tag}` });
  const close = new ButtonBuilder().setCustomId('ticket-close').setLabel('Close ticket').setStyle(ButtonStyle.Danger);
  const embed = new EmbedBuilder().setTitle('Support ticket').setDescription(`Thanks for contacting support, ${interaction.user}.\n\nReason: ${interaction.options.getString('reason') || 'Not specified'}\nA support member will be with you shortly.`).setColor(0x5865f2);
  await channel.send({ content: support ? `<@&${support}>` : 'Support team', embeds: [embed], components: [new ActionRowBuilder().addComponents(close)] });
  await interaction.reply({ content: `Your ticket is ready: ${channel}`, ephemeral: true });
}

async function playAudio(interaction, query) {
  const voice = interaction.member.voice.channel;
  if (!voice) return interaction.reply({ content: 'Join a voice channel first.', ephemeral: true });
  await interaction.deferReply();
  let result;
  if (/^https?:\/\//i.test(query)) result = { url: query, title: query };
  else { const found = await yts(query); result = found.videos?.[0]; }
  if (!result?.url) return interaction.editReply('No result found.');
  const stream = await play.stream(result.url, { discordPlayerCompatibility: true });
  const connection = joinVoiceChannel({ channelId: voice.id, guildId: voice.guild.id, adapterCreator: voice.guild.voiceAdapterCreator });
  await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  const player = createAudioPlayer();
  player.play(createAudioResource(stream.stream, { inputType: stream.type }));
  connection.subscribe(player);
  players.set(interaction.guildId, { connection, player });
  player.once(AudioPlayerStatus.Idle, () => { connection.destroy(); players.delete(interaction.guildId); });
  await interaction.editReply(`Playing **${result.title || result.url}**`);
}

client.once('ready', () => console.log(`Logged in as ${client.user.tag}`));
client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isButton() && interaction.customId === 'ticket-close') {
      if (!isSupport(interaction.member) && !interaction.channel.topic?.includes(interaction.user.tag)) return interaction.reply({ content: 'Only the ticket owner or support team can close this.', ephemeral: true });
      await interaction.reply('Closing ticket in 5 seconds.');
      return setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
    }
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === 'ticket') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'create') return createTicket(interaction);
      if (!interaction.channel.name.startsWith('ticket-')) return interaction.reply({ content: 'This command must be used in a ticket.', ephemeral: true });
      if (!isSupport(interaction.member) && sub === 'claim') return interaction.reply({ content: 'Support staff only.', ephemeral: true });
      if (sub === 'claim') return interaction.reply(`${interaction.user} claimed this ticket.`);
      await interaction.reply('Closing ticket in 5 seconds.');
      return setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
    }
    if (interaction.commandName === 'search') { await interaction.deferReply(); const r = await yts(interaction.options.getString('query')); return interaction.editReply(r.videos?.slice(0, 5).map((v, i) => `**${i + 1}. ${v.title}**\n${v.url}`).join('\n\n') || 'No results.'); }
    if (interaction.commandName === 'play') return playAudio(interaction, interaction.options.getString('query'));
    if (interaction.commandName === 'stop' || interaction.commandName === 'skip') { const data = players.get(interaction.guildId); if (!data) return interaction.reply({ content: 'Nothing is playing.', ephemeral: true }); data.player.stop(); data.connection.destroy(); players.delete(interaction.guildId); return interaction.reply('Stopped.'); }
    if (interaction.commandName === 'serverinfo') return interaction.reply({ embeds: [new EmbedBuilder().setTitle(interaction.guild.name).addFields({ name: 'Members', value: `${interaction.guild.memberCount}`, inline: true }, { name: 'Channels', value: `${interaction.guild.channels.cache.size}`, inline: true }).setColor(0x5865f2)] });
    if (interaction.commandName === 'userinfo') { const u = interaction.options.getUser('user') || interaction.user; return interaction.reply({ embeds: [new EmbedBuilder().setTitle(u.tag).setThumbnail(u.displayAvatarURL()).addFields({ name: 'ID', value: u.id }, { name: 'Created', value: `<t:${Math.floor(u.createdTimestamp / 1000)}:R>` }).setColor(0x5865f2)] }); }
    if (interaction.commandName === 'clear') { const n = interaction.options.getInteger('amount'); await interaction.channel.bulkDelete(n, true); return interaction.reply({ content: `Deleted ${n} messages.`, ephemeral: true }); }
    if (interaction.commandName === 'announce') return interaction.channel.send({ embeds: [new EmbedBuilder().setTitle('Announcement').setDescription(interaction.options.getString('message')).setColor(0xf1c40f)] }).then(() => interaction.reply({ content: 'Announcement sent.', ephemeral: true }));
  } catch (error) { console.error(error); if (interaction.deferred || interaction.replied) interaction.editReply('Something went wrong.'); else interaction.reply({ content: 'Something went wrong.', ephemeral: true }); }
});

await registerCommands();
await client.login(process.env.DISCORD_TOKEN);
