
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits
} from "discord.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const teams = [
  "Nashville Nightmares",
  "Buffalo Bills",
  "San Francisco Comets",
  "Winchester Widows",
  "Birmingham Bluebirds",
  "Puerto Rico Coquís"
];

let rankings = [...teams];
let week = 1;
const records = Object.fromEntries(
  teams.map(team => [team, "0-0"])
);

const teamOption = option =>
  option.setName("team")
    .setDescription("Choose a UFL team")
    .setRequired(true)
    .addChoices(
      ...teams.map(team => ({
        name: team,
        value: team
      }))
    );

const admin = PermissionFlagsBits.ManageGuild;

const commands = [
  new SlashCommandBuilder()
    .setName("setrank")
    .setDescription("Change a team's ranking")
    .setDefaultMemberPermissions(admin)
    .addIntegerOption(o =>
      o.setName("rank")
        .setDescription("Position 1 to 6")
        .setMinValue(1)
        .setMaxValue(6)
        .setRequired(true))
    .addStringOption(teamOption),

  new SlashCommandBuilder()
    .setName("setrecord")
    .setDescription("Update a team record")
    .setDefaultMemberPermissions(admin)
    .addStringOption(teamOption)
    .addIntegerOption(o =>
      o.setName("wins")
        .setDescription("Wins")
        .setMinValue(0)
        .setRequired(true))
    .addIntegerOption(o =>
      o.setName("losses")
        .setDescription("Losses")
        .setMinValue(0)
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName("setweek")
    .setDescription("Change rankings week")
    .setDefaultMemberPermissions(admin)
    .addIntegerOption(o =>
      o.setName("week")
        .setDescription("Week number")
        .setMinValue(1)
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName("rankings")
    .setDescription("Show UFL rankings"),

  new SlashCommandBuilder()
    .setName("postrankings")
    .setDescription("Post official rankings")
    .setDefaultMemberPermissions(admin)
];

function buildRankings() {
  const lines = rankings.map((team, index) =>
    `\`${String(index + 1).padStart(2, "0")}\` 🏈 **${team}** (${records[team]})`
  );

  return new EmbedBuilder()
    .setColor(0x7851D4)
    .setAuthor({ name: "UFL • SEASON 2" })
    .setTitle(`WEEK ${week} RANKINGS`)
    .setDescription(lines.join("\n\n"))
    .setFooter({ text: "UFL OFFICIAL RANKINGS" });
}

client.once("ready", async () => {
  console.log(`Online as ${client.user.tag}`);

  const rest = new REST({ version: "10" })
    .setToken(process.env.DISCORD_TOKEN);

  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands.map(c => c.toJSON()) }
  );

  console.log("Commands registered");
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = interaction.commandName;

  try {
    if (command === "rankings") {
      return interaction.reply({
        embeds: [buildRankings()]
      });
    }

    if (!interaction.memberPermissions?.has(admin)) {
      return interaction.reply({
        content: "Admins only",
        ephemeral: true
      });
    }

    if (command === "setrank") {
      const team = interaction.options.getString("team");
      const rank = interaction.options.getInteger("rank");

      rankings = rankings.filter(t => t !== team);
      rankings.splice(rank - 1, 0, team);

      return interaction.reply({
        content: `${team} moved to #${rank}`,
        ephemeral: true
      });
    }

    if (command === "setrecord") {
      const team = interaction.options.getString("team");
      const wins = interaction.options.getInteger("wins");
      const losses = interaction.options.getInteger("losses");

      records[team] = `${wins}-${losses}`;

      return interaction.reply({
        content: `${team} updated to ${records[team]}`,
        ephemeral: true
      });
    }

    if (command === "setweek") {
      week = interaction.options.getInteger("week");

      return interaction.reply({
        content: `Week updated to ${week}`,
        ephemeral: true
      });
    }

    if (command === "postrankings") {
      await interaction.channel.send({
        embeds: [buildRankings()]
      });

      return interaction.reply({
        content: "Rankings posted",
        ephemeral: true
      });
    }
  } catch (error) {
    console.error(error);

    if (!interaction.replied) {
      await interaction.reply({
        content: "Something went wrong",
        ephemeral: true
      });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
