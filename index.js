
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  SlashCommandBuilder,
  PermissionFlagsBits,
  REST,
  Routes
} from "discord.js";

import { createClient } from "@supabase/supabase-js";
import http from "node:http";

const {
  DISCORD_TOKEN,
  CLIENT_ID,
  SUPABASE_URL,
  SUPABASE_SECRET_KEY
} = process.env;

for (const [name, value] of Object.entries({
  DISCORD_TOKEN,
  CLIENT_ID,
  SUPABASE_URL,
  SUPABASE_SECRET_KEY
})) {
  if (!value) throw new Error(`Missing ${name}`);
}

const db = createClient(
  SUPABASE_URL,
  SUPABASE_SECRET_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

const bot = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const SEASON = 2;

const teams = [
  "Nashville Nightmares",
  "Buffalo Bills",
  "San Francisco Comets",
  "Winchester Widows",
  "Birmingham Bluebirds",
  "Puerto Rico Coquís"
];

const admin = PermissionFlagsBits.ManageGuild;

const teamOption = option =>
  option
    .setName("team")
    .setDescription("Select your UFL team")
    .setRequired(true)
    .addChoices(
      ...teams.map(t => ({
        name: t,
        value: t
      }))
    );

const commands = [
  new SlashCommandBuilder()
    .setName("rankings")
    .setDescription("View official UFL rankings"),

  new SlashCommandBuilder()
    .setName("postrankings")
    .setDescription("Post official UFL rankings")
    .setDefaultMemberPermissions(admin),

  new SlashCommandBuilder()
    .setName("setrank")
    .setDescription("Manually rank a team")
    .setDefaultMemberPermissions(admin)
    .addStringOption(teamOption)
    .addIntegerOption(o =>
      o.setName("rank")
        .setDescription("Rank 1 through 6")
        .setMinValue(1)
        .setMaxValue(6)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("setrecord")
    .setDescription("Change a team's record")
    .setDefaultMemberPermissions(admin)
    .addStringOption(teamOption)
    .addIntegerOption(o =>
      o.setName("wins")
        .setDescription("Wins")
        .setMinValue(0)
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("losses")
        .setDescription("Losses")
        .setMinValue(0)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("setweek")
    .setDescription("Start a rankings week")
    .setDefaultMemberPermissions(admin)
    .addIntegerOption(o =>
      o.setName("week")
        .setDescription("Week number")
        .setMinValue(1)
        .setRequired(true)
    )
];

async function getWeek() {
  const { data, error } = await db
    .from("ufl_power_rankings")
    .select("week")
    .eq("season", SEASON)
    .order("week", { ascending: false })
    .limit(1);

  if (error) throw error;
  return data.length ? data[0].week : 1;
}

async function getRankings(week) {
  const { data, error } = await db
    .from("ufl_power_rankings")
    .select("*")
    .eq("season", SEASON)
    .eq("week", week)
    .order("rank");

  if (error) throw error;
  return data;
}

async function ensureWeek(week) {
  const existing = await getRankings(week);
  if (existing.length) return existing;

  const previous = await getRankings(week - 1);

  const rows = previous.length
    ? previous.map(r => ({
        season: SEASON,
        week,
        team_name: r.team_name,
        rank: r.rank,
        previous_rank: r.rank,
        wins: r.wins,
        losses: r.losses,
        team_logo: r.team_logo
      }))
    : teams.map((team, i) => ({
        season: SEASON,
        week,
        team_name: team,
        rank: i + 1,
        previous_rank: null,
        wins: 0,
        losses: 0
      }));

  const { error } = await db
    .from("ufl_power_rankings")
    .upsert(rows, {
      onConflict: "season,week,team_name",
      ignoreDuplicates: true
    });

  if (error) throw error;
  return getRankings(week);
}

async function makeEmbed() {
  const week = await getWeek();
  const rows = await ensureWeek(week);

  const lines = rows.map(r => {
    let movement = "";

    if (r.previous_rank !== null) {
      const difference = r.previous_rank - r.rank;

      if (difference > 0)
        movement = ` 🟢 ▲ ${difference}`;

      if (difference < 0)
        movement = ` 🔻 ${Math.abs(difference)}`;
    }

    const logo = "🏈";

    return (
      `\`${String(r.rank).padStart(2, "0")}\` ` +
      `${logo} **${r.team_name}** ` +
      `(${r.wins}-${r.losses})${movement}`
    );
  });

  const unranked = teams.filter(
    t => !rows.some(r => r.team_name === t)
  );

  let description = lines.join("\n");

  if (unranked.length) {
    description += "\n\n**UNRANKED**\n";
    description += unranked.map(
      t => `\`NR\` ${t}`
    ).join("\n");
  }

  return new EmbedBuilder()
    .setColor(0x7950B9)
    .setAuthor({
      name: "UFL — SEASON 2"
    })
    .setTitle(`WEEK ${week} RANKINGS`)
    .setDescription(description)
    .setTimestamp();
}

bot.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const cmd = interaction.commandName;

  try {
    await interaction.deferReply({
      flags: cmd === "rankings" ? 0 : 64
    });

    if (cmd === "rankings") {
      return interaction.editReply({
        embeds: [await makeEmbed()]
      });
    }

    if (!interaction.memberPermissions?.has(admin)) {
      return interaction.editReply(
        "Only league admins can use this."
      );
    }

    if (cmd === "postrankings") {
      await interaction.channel.send({
        embeds: [await makeEmbed()]
      });

      return interaction.editReply(
        "Official rankings posted!"
      );
    }

    const week = await getWeek();

    if (cmd === "setweek") {
      const next = interaction.options.getInteger("week");

      if (next < week) {
        return interaction.editReply(
          "You cannot go backwards with this command."
        );
      }

      if (next > week + 1) {
        return interaction.editReply(
          "Advance one week at a time."
        );
      }

      await ensureWeek(next);

      return interaction.editReply(
        `Rankings set to Week ${next}`
      );
    }

    await ensureWeek(week);

    if (cmd === "setrecord") {
      const team = interaction.options.getString("team");
      const wins = interaction.options.getInteger("wins");
      const losses = interaction.options.getInteger("losses");

      const { error } = await db
        .from("ufl_power_rankings")
        .update({ wins, losses })
        .eq("season", SEASON)
        .eq("week", week)
        .eq("team_name", team);

      if (error) throw error;

      return interaction.editReply(
        `${team} is now ${wins}-${losses}`
      );
    }

    if (cmd === "setrank") {
      const team = interaction.options.getString("team");
      const rank = interaction.options.getInteger("rank");

      const { error } = await db.rpc(
        "ufl_move_rank",
        {
          p_season: SEASON,
          p_week: week,
          p_team: team,
          p_rank: rank
        }
      );

      if (error) throw error;

      return interaction.editReply(
        `${team} moved to #${rank}`
      );
    }

  } catch (err) {
    console.error(err);
    if (interaction.deferred) {
      await interaction.editReply(
        "Something went wrong. Check Render logs."
      );
    }
  }
});

bot.once("ready", async () => {
  console.log(`ONLINE: ${bot.user.tag}`);

  const rest = new REST({ version: "10" })
    .setToken(DISCORD_TOKEN);

  await rest.put(
    Routes.applicationCommands(CLIENT_ID),
    {
      body: commands.map(c => c.toJSON())
    }
  );

  console.log("UFL commands registered");
});

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain"
  });
  res.end("UFLLEAGUEBOT service running");
});

server.listen(process.env.PORT || 3000, "0.0.0.0");

bot.login(DISCORD_TOKEN);
