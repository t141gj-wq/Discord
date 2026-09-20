import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Collection,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} from 'discord.js';
import {
  getVoiceConnection,
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} from '@discordjs/voice';
import yts from 'yt-search';
import play from 'play-dl';

const requiredEnv = ['DISCORD_TOKEN', 'CLIENT_ID'];
for (const key of requiredEnv) {
  if (!process.env[key]) throw new Error(`Missing ${key} in .env`);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();
const musicState = new Map();

const commands = [
  new SlashCommandBuilder().setName('help').setDescription('Show all bot commands'),
  new SlashCommandBuilder().setName('ping').setDescription('Check bot latency'),
  new SlashCommandBuilder().setName('serverinfo').setDescription('Show server information'),
  new SlashCommandBuilder().setName('userinfo').setDescription('Show user information').addUserOption((option) => option.setName('user').setDescription('User to inspect').setRequired(false)),
  new SlashCommandBuilder().setName('announce').setDescription('Send an announcement').addStringOption((option) => option.setName('message').setDescription('Announcement text').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('clear').setDescription('Delete recent messages').addIntegerOption((option) => option.setName('amount').setDescription('1-100 messages').setRequired(true).setMinValue(1).setMaxValue(100)).setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder().setName('kick').setDescription('Kick a user').addUserOption((option) => option.setName('user').setDescription('User to kick').setRequired(true)).addStringOption((option) => option.setName('reason').setDescription('Reason').setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
  new SlashCommandBuilder().setName('ban').setDescription('Ban a user').addUserOption((option) => option.setName('user').setDescription('User to ban').setRequired(true)).addStringOption((option) => option.setName('reason').setDescription('Reason').setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  new SlashCommandBuilder().setName('search').setDescription('Search YouTube').addStringOption((option) => option.setName('query').setDescription('What do you want to search for?').setRequired(true)),
  new SlashCommandBuilder().setName('play').setDescription('Play a YouTube song or URL in voice').addStringOption((option) => option.setName('query').setDescription('YouTube URL or search terms').setRequired(true)),
  new SlashCommandBuilder().setName('queue').setDescription('View the current music queue'),
  new SlashCommandBuilder().setName('pause').setDescription('Pause the current music'),
  new SlashCommandBuilder().setName('resume').setDescription('Resume the current music'),
  new SlashCommandBuilder().setName('skip').setDescription('Skip the current song'),
  new SlashCommandBuilder().setName('stop').setDescription('Stop music and leave the voice channel'),
  new SlashCommandBuilder().setName('ticket').setDescription('Open or manage support tickets')
    .addSubcommand((sub) => sub.setName('create').setDescription('Open a private support ticket').addStringOption((option) => option.setName('reason').setDescription('Reason for the ticket').setRequired(false)))
    .addSubcommand((sub) => sub.setName('close').setDescription('Close the current ticket'))
    .addSubcommand((sub) => sub.setName('claim').setDescription('Claim the current ticket')),
].map((command) => command.toJSON());

function isSupportMember(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.ManageChannels)) return true;
  if (process.env.SUPPORT_ROLE_ID && member.roles.cache.has(process.env.SUPPORT_ROLE_ID)) return true;
  return false;
}

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const route = process.env.GUILD_ID
    ? Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID)
    : Routes.applicationCommands(process.env.CLIENT_ID);

  await rest.put(route, { body: commands });
  console.log('Slash commands registered.');
}

async function searchYouTube(query) {
  const result = await yts(query);
  const videos = result.videos?.slice(0, 5) ?? [];
  if (!videos.length) return null;
  return videos;
}

async function resolveTrack(input) {
  if (/^https?:\/\//i.test(input)) {
    return {
      title: input,
      url: input,
    };
  }

  const videos = await searchYouTube(input);
  if (!videos || !videos.length) return null;

  const first = videos[0];
  return {
    title: first.title,
    url: first.url,
  };
}

function getMusicStateForGuild(guildId) {
  return musicState.get(guildId);
}

async function playNextTrack(guildId) {
  const state = getMusicStateForGuild(guildId);
  if (!state) return;

  if (!state.queue.length) {
    state.textChannel?.send('🎵 Queue finished.').catch(() => {});
    state.connection.destroy();
    musicState.delete(guildId);
    return;
  }

  const track = state.queue.shift();

  try {
    const source = await play.stream(track.url, { discordPlayerCompatibility: true });
    const resource = createAudioResource(source.stream, {
      inputType: source.type,
    });

    state.player.play(resource);
    state.textChannel?.send(`🎶 Now playing: **${track.title}**`).catch(() => {});
  } catch (error) {
    console.error('Music play error:', error);
    state.textChannel?.send('⚠️ Could not play this track. Trying the next one.').catch(() => {});
    await playNextTrack(guildId);
  }
}

function stopMusic(guildId) {
  const state = musicState.get(guildId);
  if (!state) return;
  state.player.stop();
  if (state.connection) state.connection.destroy();
  musicState.delete(guildId);
}

async function handleMusicPlay(interaction, query) {
  const memberVoice = interaction.member.voice?.channel;
  if (!memberVoice) {
    return interaction.reply({ content: 'Join a voice channel first.', ephemeral: true });
  }

  const track = await resolveTrack(query);
  if (!track) {
    return interaction.reply({ content: 'No song was found for that search.', ephemeral: true });
  }

  await interaction.deferReply();

  let state = getMusicStateForGuild(interaction.guildId);

  if (!state) {
    const connection = joinVoiceChannel({
      channelId: memberVoice.id,
      guildId: interaction.guildId,
      adapterCreator: interaction.guild.voiceAdapterCreator,
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

    const player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause,
      },
    });

    connection.subscribe(player);

    state = {
      connection,
      player,
      queue: [],
      textChannel: interaction.channel,
    };

    player.on('stateChange', async (oldState, newState) => {
      if (newState.status === AudioPlayerStatus.Idle && oldState.status !== AudioPlayerStatus.Idle) {
        await playNextTrack(interaction.guildId);
      }
    });

    musicState.set(interaction.guildId, state);
  }

  state.queue.push(track);
  state.textChannel = interaction.channel;

  if (state.player.state.status !== AudioPlayerStatus.Playing) {
    await playNextTrack(interaction.guildId);
  }

  await interaction.editReply(`✅ Added to queue: **${track.title}**`);
}

async function handleQueue(interaction) {
  const state = getMusicStateForGuild(interaction.guildId);
  if (!state || !state.queue.length) {
    return interaction.reply({ content: 'There is no music queued right now.', ephemeral: true });
  }

  const queueText = state.queue.slice(0, 10).map((track, index) => `${index + 1}. ${track.title}`).join('\n');
  return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🎵 Queue').setDescription(queueText).setColor(0x5865f2)] });
}

async function handleTicketCreate(interaction) {
  const existing = interaction.guild.channels.cache.find((channel) => channel.name === `ticket-${interaction.user.id}` && channel.type === ChannelType.GuildText);
  if (existing) {
    return interaction.reply({ content: `You already have a ticket open: ${existing}`, ephemeral: true });
  }

  const reason = interaction.options.getString('reason') || 'No reason provided';
  const supportRoleId = process.env.SUPPORT_ROLE_ID;

  const permissionOverwrites = [
    { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
  ];

  if (supportRoleId) {
    permissionOverwrites.push({
      id: supportRoleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    });
  }

  const channel = await interaction.guild.channels.create({
    name: `ticket-${interaction.user.id}`,
    type: ChannelType.GuildText,
    parent: process.env.TICKET_CATEGORY_ID || undefined,
    permissionOverwrites,
    topic: `Ticket created by ${interaction.user.tag} | Reason: ${reason}`,
  });

  const closeButton = new ButtonBuilder().setCustomId('ticket-close').setLabel('Close ticket').setStyle(ButtonStyle.Danger);
  const row = new ActionRowBuilder().addComponents(closeButton);

  const embed = new EmbedBuilder()
    .setTitle('🎫 Support ticket opened')
    .setDescription(`Hello ${interaction.user}.\nYour support ticket has been created.\n\nReason: **${reason}**\nA support team member will respond shortly.`)
    .setColor(0x5865f2);

  await channel.send({
    content: supportRoleId ? `<@&${supportRoleId}>` : 'Support team has been notified.',
    embeds: [embed],
    components: [row],
  });

  return interaction.reply({ content: `Ticket created: ${channel}`, ephemeral: true });
}

async function handleTicketClose(interaction) {
  if (!interaction.channel || !interaction.channel.name.startsWith('ticket-')) {
    return interaction.reply({ content: 'This command only works in a ticket channel.', ephemeral: true });
  }

  if (!isSupportMember(interaction.member) && interaction.channel.topic?.includes(interaction.user.tag) === false) {
    return interaction.reply({ content: 'Only support staff or the ticket owner can close this ticket.', ephemeral: true });
  }

  await interaction.reply({ content: 'Closing ticket in 5 seconds...' });
  setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
}

async function handleTicketClaim(interaction) {
  if (!interaction.channel || !interaction.channel.name.startsWith('ticket-')) {
    return interaction.reply({ content: 'This command only works in a ticket channel.', ephemeral: true });
  }

  if (!isSupportMember(interaction.member)) {
    return interaction.reply({ content: 'Support members only.', ephemeral: true });
  }

  return interaction.reply({ content: `${interaction.user} claimed this ticket.`, ephemeral: false });
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isButton() && interaction.customId === 'ticket-close') {
      return handleTicketClose(interaction);
    }

    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'help') {
      const helpText = [
        '/help — Show all commands',
        '/ping — Check latency',
        '/serverinfo — Server details',
        '/userinfo — User details',
        '/announce — Announcement',
        '/clear <amount> — Delete messages',
        '/kick <user> — Kick user',
        '/ban <user> — Ban user',
        '/search <query> — YouTube search',
        '/play <query> — Play a YouTube song',
        '/queue — View the music queue',
        '/pause — Pause playback',
        '/resume — Resume playback',
        '/skip — Skip song',
        '/stop — Stop music and leave the call',
        '/ticket create — Open a support ticket',
        '/ticket close — Close ticket',
        '/ticket claim — Claim a ticket',
      ].join('\n');

      return interaction.reply({ embeds: [new EmbedBuilder().setTitle('Bot commands').setDescription(helpText).setColor(0x5865f2)] });
    }

    if (commandName === 'ping') {
      return interaction.reply({ content: `Pong! Latency: ${Date.now() - interaction.createdTimestamp}ms`, ephemeral: true });
    }

    if (commandName === 'serverinfo') {
      const guild = interaction.guild;
      const embed = new EmbedBuilder()
        .setTitle(guild.name)
        .setThumbnail(guild.iconURL({ dynamic: true }))
        .addFields(
          { name: 'Members', value: `${guild.memberCount}`, inline: true },
          { name: 'Channels', value: `${guild.channels.cache.size}`, inline: true },
          { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
        )
        .setColor(0x5865f2);
      return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'userinfo') {
      const target = interaction.options.getUser('user') ?? interaction.user;
      const member = interaction.guild.members.cache.get(target.id);
      const embed = new EmbedBuilder()
        .setTitle(target.tag)
        .setThumbnail(target.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: 'ID', value: target.id },
          { name: 'Joined server', value: member ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Unknown', inline: true },
          { name: 'Account created', value: `<t:${Math.floor(target.createdTimestamp / 1000)}:R>`, inline: true },
        )
        .setColor(0x5865f2);
      return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'announce') {
      const message = interaction.options.getString('message');
      await interaction.reply({ content: 'Announcement sent.', ephemeral: true });
      return interaction.channel.send({
        embeds: [new EmbedBuilder().setTitle('📣 Announcement').setDescription(message).setColor(0xf1c40f)],
      });
    }

    if (commandName === 'clear') {
      const amount = interaction.options.getInteger('amount');
      await interaction.channel.bulkDelete(amount, true);
      return interaction.reply({ content: `Deleted ${amount} messages.`, ephemeral: true });
    }

    if (commandName === 'kick') {
      const target = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const member = interaction.guild.members.cache.get(target.id);
      if (!member) return interaction.reply({ content: 'That user is not in this server.', ephemeral: true });
      await member.kick(reason);
      return interaction.reply({ content: `Kicked ${target.tag} for: ${reason}` });
    }

    if (commandName === 'ban') {
      const target = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      await interaction.guild.members.ban(target, { reason });
      return interaction.reply({ content: `Banned ${target.tag} for: ${reason}` });
    }

    if (commandName === 'search') {
      const query = interaction.options.getString('query');
      const videos = await searchYouTube(query);
      if (!videos || !videos.length) {
        return interaction.reply({ content: 'No results were found.', ephemeral: true });
      }

      const formatted = videos.map((video, index) => `**${index + 1}.** [${video.title}](${video.url})`).join('\n');
      return interaction.reply({ embeds: [new EmbedBuilder().setTitle(`Search results for: ${query}`).setDescription(formatted).setColor(0x5865f2)] });
    }

    if (commandName === 'play') {
      return handleMusicPlay(interaction, interaction.options.getString('query'));
    }

    if (commandName === 'queue') {
      return handleQueue(interaction);
    }

    if (commandName === 'pause') {
      const state = getMusicStateForGuild(interaction.guildId);
      if (!state) return interaction.reply({ content: 'Nothing is playing right now.', ephemeral: true });
      state.player.pause();
      return interaction.reply({ content: '⏸️ Music paused.' });
    }

    if (commandName === 'resume') {
      const state = getMusicStateForGuild(interaction.guildId);
      if (!state) return interaction.reply({ content: 'There is no paused music.', ephemeral: true });
      state.player.unpause();
      return interaction.reply({ content: '▶️ Music resumed.' });
    }

    if (commandName === 'skip') {
      const state = getMusicStateForGuild(interaction.guildId);
      if (!state) return interaction.reply({ content: 'There is no song to skip.', ephemeral: true });
      state.player.stop();
      return interaction.reply({ content: '⏭️ Skipped the current track.' });
    }

    if (commandName === 'stop') {
      stopMusic(interaction.guildId);
      return interaction.reply({ content: '🛑 Stopped the music and left the voice channel.' });
    }

    if (commandName === 'ticket') {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'create') return handleTicketCreate(interaction);
      if (subcommand === 'close') return handleTicketClose(interaction);
      if (subcommand === 'claim') return handleTicketClaim(interaction);
    }
  } catch (error) {
    console.error('Interaction error:', error);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply('Something went wrong while handling that command.').catch(() => {});
    } else {
      await interaction.reply({ content: 'Something went wrong while handling that command.', ephemeral: true }).catch(() => {});
    }
  }
});

await registerCommands();
await client.login(process.env.DISCORD_TOKEN);

