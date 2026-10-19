
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

const db = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const bot = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const SEASON = 2;
const PURPLE = 0x7950b9;

const TEAMS = [
  { name: "Nashville Nightmares", emoji: "nightmares", conf: "AFC" },
  { name: "Buffalo Bills", emoji: "bills", conf: "AFC" },
  { name: "San Francisco Comets", emoji: "comets", conf: "AFC" },
  { name: "Detroit Lions", emoji: "lions", conf: "AFC" },
  { name: "Winchester Widows", emoji: "widows", conf: "NFC" },
  { name: "Birmingham Bluebirds", emoji: "bluebirds", conf: "NFC" },
  { name: "Puerto Rico Coquís", emoji: "coquis", conf: "NFC" },
  { name: "Cincinnati Bengals", emoji: "bengals", conf: "NFC" }
];

const teamNames = TEAMS.map(t => t.name);
const adminPermission = PermissionFlagsBits.ManageGuild;

function teamOption(option, label = "team") {
  return option
    .setName(label)
    .setDescription("Choose a UFL team")
    .setRequired(true)
    .addChoices(...teamNames.map(name => ({
      name,
      value: name
    })));
}

const commands = [
  new SlashCommandBuilder()
    .setName("rankings")
    .setDescription("View UFL power rankings"),

  new SlashCommandBuilder()
    .setName("postrankings")
    .setDescription("Post official rankings")
    .setDefaultMemberPermissions(adminPermission),

  new SlashCommandBuilder()
    .setName("standings")
    .setDescription("View AFC and NFC standings"),

  new SlashCommandBuilder()
    .setName("schedule")
    .setDescription("View UFL games")
    .addIntegerOption(o =>
      o.setName("week")
        .setDescription("Week number (defaults to current week)")
        .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName("addgame")
    .setDescription("Add a game to the schedule")
    .setDefaultMemberPermissions(adminPermission)
    .addIntegerOption(o =>
      o.setName("week")
        .setDescription("Game week")
        .setRequired(true)
        .setMinValue(1)
    )
    .addStringOption(o => teamOption(o, "home"))
    .addStringOption(o => teamOption(o, "away")),

  new SlashCommandBuilder()
    .setName("setscore")
    .setDescription("Enter a final game score")
    .setDefaultMemberPermissions(adminPermission)
    .addIntegerOption(o =>
      o.setName("game_id")
        .setDescription("Game ID shown in /schedule")
        .setRequired(true)
        .setMinValue(1)
    )
    .addIntegerOption(o =>
      o.setName("home_score")
        .setDescription("Home team points")
        .setRequired(true)
        .setMinValue(0)
    )
    .addIntegerOption(o =>
      o.setName("away_score")
        .setDescription("Away team points")
        .setRequired(true)
        .setMinValue(0)
    ),

  new SlashCommandBuilder()
    .setName("setrank")
    .setDescription("Change a team's power ranking")
    .setDefaultMemberPermissions(adminPermission)
    .addStringOption(o => teamOption(o))
    .addIntegerOption(o =>
      o.setName("rank")
        .setDescription("New ranking position")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(8)
    ),

  new SlashCommandBuilder()
    .setName("setrecord")
    .setDescription("Set a team's power rankings record")
    .setDefaultMemberPermissions(adminPermission)
    .addStringOption(o => teamOption(o))
    .addIntegerOption(o =>
      o.setName("wins")
        .setDescription("Wins")
        .setRequired(true)
        .setMinValue(0)
    )
    .addIntegerOption(o =>
      o.setName("losses")
        .setDescription("Losses")
        .setRequired(true)
        .setMinValue(0)
    ),

  new SlashCommandBuilder()
    .setName("setweek")
    .setDescription("Advance to the next rankings week")
    .setDefaultMemberPermissions(adminPermission)
    .addIntegerOption(o =>
      o.setName("week")
        .setDescription("New week")
        .setRequired(true)
        .setMinValue(1)
    )
];

function check(result) {
  if (result.error) throw result.error;
  return result.data;
}

async function getWeek() {
  const data = check(
    await db.from("ufl_power_rankings")
      .select("week")
      .eq("season", SEASON)
      .order("week", { ascending: false })
      .limit(1)
  );

  return data?.[0]?.week ?? 1;
}

async function getRankings(week) {
  return check(
    await db.from("ufl_power_rankings")
      .select("*")
      .eq("season", SEASON)
      .eq("week", week)
      .order("rank")
  );
}

async function ensureWeek(week) {
  const existing = await getRankings(week);

  if (existing.length) return existing;

  const previous = week > 1
    ? await getRankings(week - 1)
    : [];

  const rows = TEAMS.map((team, index) => {
    const old = previous.find(r => r.team_name === team.name);

    return {
      season: SEASON,
      week,
      team_name: team.name,
      rank: old?.rank ?? index + 1,
      previous_rank: old?.rank ?? null,
      wins: old?.wins ?? 0,
      losses: old?.losses ?? 0
    };
  });

  check(
    await db.from("ufl_power_rankings")
      .upsert(rows, {
        onConflict: "season,week,team_name",
        ignoreDuplicates: true
      })
  );

  return getRankings(week);
}

async function getGames(week = null) {
  let query = db.from("ufl_bot_games")
    .select("*")
    .eq("season", SEASON)
    .order("week")
    .order("id");

  if (week !== null) query = query.eq("week", week);

  return check(await query);
}

async function getEmojis(guild) {
  if (!guild) return new Map();

  try {
    const emojis = await guild.emojis.fetch();
    return new Map(
      emojis.map(e => [e.name.toLowerCase(), e.toString()])
    );
  } catch {
    return new Map();
  }
}

function logo(name, emojis) {
  const team = TEAMS.find(t => t.name === name);
  return emojis.get(team?.emoji) ?? "🏈";
}

function embed(title, description) {
  return new EmbedBuilder()
    .setColor(PURPLE)
    .setAuthor({ name: "UFL • SEASON 2" })
    .setTitle(title)
    .setDescription(description || "Nothing to display yet.")
    .setTimestamp();
}

async function rankingsEmbed(emojis) {
  const week = await getWeek();
  const rows = await ensureWeek(week);

  const lines = rows.map(r => {
    const change = r.previous_rank == null
      ? 0
      : r.previous_rank - r.rank;

    const movement = change > 0
      ? ` 🟢 ▲${change}`
      : change < 0
        ? ` 🔴 ▼${Math.abs(change)}`
        : "";

    return `\`${String(r.rank).padStart(2, "0")}\` ${logo(r.team_name, emojis)} **${r.team_name}** (${r.wins}-${r.losses})${movement}`;
  });

  return embed(
    `WEEK ${week} • POWER RANKINGS`,
    lines.join("\n")
  );
}

async function standingsEmbed(emojis) {
  const games = await getGames();

  const records = new Map(
    TEAMS.map(t => [
      t.name,
      {
        name: t.name,
        conf: t.conf,
        wins: 0,
        losses: 0,
        ties: 0,
        pf: 0,
        pa: 0
      }
    ])
  );

  for (const game of games) {
    if (game.home_score == null || game.away_score == null) {
      continue;
    }

    const home = records.get(game.home_team);
    const away = records.get(game.away_team);

    if (!home || !away) continue;

    home.pf += game.home_score;
    home.pa += game.away_score;

    away.pf += game.away_score;
    away.pa += game.home_score;

    if (game.home_score > game.away_score) {
      home.wins++;
      away.losses++;
    } else if (game.away_score > game.home_score) {
      away.wins++;
      home.losses++;
    } else {
      home.ties++;
      away.ties++;
    }
  }

  const sections = ["AFC", "NFC"].map(conf => {
    const sorted = [...records.values()]
      .filter(t => t.conf === conf)
      .sort((a, b) => {
        const aPlayed = a.wins + a.losses + a.ties;
        const bPlayed = b.wins + b.losses + b.ties;

        const aPct = aPlayed
          ? (a.wins + a.ties / 2) / aPlayed
          : 0;

        const bPct = bPlayed
          ? (b.wins + b.ties / 2) / bPlayed
          : 0;

        return bPct - aPct
          || (b.pf - b.pa) - (a.pf - a.pa);
      });

    const lines = sorted.map((t, i) => {
      const pd = t.pf - t.pa;
      const pdText = pd > 0 ? `+${pd}` : String(pd);
      const record = t.ties
        ? `${t.wins}-${t.losses}-${t.ties}`
        : `${t.wins}-${t.losses}`;

      return `\`${i + 1}.\` ${logo(t.name, emojis)} **${t.name}**\n       ${record} • PD: ${pdText}`;
    });

    return `**${conf} STANDINGS**\n${lines.join("\n")}`;
  });

  return embed(
    "OFFICIAL LEAGUE STANDINGS",
    sections.join("\n\n")
  );
}

async function scheduleEmbed(week, emojis) {
  const games = await getGames(week);

  if (!games.length) {
    return embed(
      `WEEK ${week} • SCHEDULE`,
      "No games have been scheduled yet."
    );
  }

  const lines = games.map(g => {
    const finished = g.home_score != null
      && g.away_score != null;

    const home = `${logo(g.home_team, emojis)} **${g.home_team}**`;
    const away = `${logo(g.away_team, emojis)} **${g.away_team}**`;

    if (finished) {
      return `**GAME #${g.id} • FINAL**\n${away} ${g.away_score}\n${home} ${g.home_score}`;
    }

    return `**GAME #${g.id} • SCHEDULED**\n${away}\n**VS**\n${home}`;
  });

  return embed(
    `WEEK ${week} • SCHEDULE`,
    lines.join("\n\n")
  );
}

bot.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const cmd = interaction.commandName;

  try {
    const publicCommands = [
      "rankings",
      "standings",
      "schedule"
    ];

    await interaction.deferReply({
      flags: publicCommands.includes(cmd) ? 0 : 64
    });

    const emojis = await getEmojis(interaction.guild);

    if (cmd === "rankings") {
      return interaction.editReply({
        embeds: [await rankingsEmbed(emojis)]
      });
    }

    if (cmd === "standings") {
      return interaction.editReply({
        embeds: [await standingsEmbed(emojis)]
      });
    }

    if (cmd === "schedule") {
      const week = interaction.options.getInteger("week")
        ?? await getWeek();

      return interaction.editReply({
        embeds: [await scheduleEmbed(week, emojis)]
      });
    }

    if (!interaction.memberPermissions?.has(adminPermission)) {
      return interaction.editReply(
        "Only league admins can use this command."
      );
    }

    if (cmd === "postrankings") {
      await interaction.channel.send({
        embeds: [await rankingsEmbed(emojis)]
      });

      return interaction.editReply("Rankings posted!");
    }

    if (cmd === "addgame") {
      const week = interaction.options.getInteger("week");
      const home = interaction.options.getString("home");
      const away = interaction.options.getString("away");

      if (home === away) {
        return interaction.editReply(
          "A team cannot play itself."
        );
      }

      const existing = await getGames(week);

      if (existing.some(g =>
        g.home_team === home && g.away_team === away
      )) {
        return interaction.editReply(
          "That matchup is already scheduled for this week."
        );
      }

      const result = check(
        await db.from("ufl_bot_games")
          .insert({
            season: SEASON,
            week,
            home_team: home,
            away_team: away
          })
          .select("id")
          .single()
      );

      return interaction.editReply(
        `Game #${result.id} added: ${away} @ ${home}, Week ${week}.`
      );
    }

    if (cmd === "setscore") {
      const id = interaction.options.getInteger("game_id");
      const homeScore = interaction.options.getInteger("home_score");
      const awayScore = interaction.options.getInteger("away_score");

      const game = check(
        await db.from("ufl_bot_games")
          .select("*")
          .eq("id", id)
          .eq("season", SEASON)
          .maybeSingle()
      );

      if (!game) {
        return interaction.editReply("Game not found.");
      }

      check(
        await db.from("ufl_bot_games")
          .update({
            home_score: homeScore,
            away_score: awayScore
          })
          .eq("id", id)
          .eq("season", SEASON)
      );

      return interaction.editReply(
        `FINAL: ${game.away_team} ${awayScore} — ${game.home_team} ${homeScore}\nStandings updated automatically!`
      );
    }

    const week = await getWeek();

    if (cmd === "setweek") {
      const next = interaction.options.getInteger("week");

      if (next !== week + 1) {
        return interaction.editReply(
          `Current week is ${week}. You can advance to Week ${week + 1}.`
        );
      }

      await ensureWeek(next);

      return interaction.editReply(
        `Power rankings advanced to Week ${next}!`
      );
    }

    await ensureWeek(week);

    if (cmd === "setrecord") {
      const team = interaction.options.getString("team");
      const wins = interaction.options.getInteger("wins");
      const losses = interaction.options.getInteger("losses");

      check(
        await db.from("ufl_power_rankings")
          .update({ wins, losses })
          .eq("season", SEASON)
          .eq("week", week)
          .eq("team_name", team)
      );

      return interaction.editReply(
        `${team} rankings record set to ${wins}-${losses}.`
      );
    }

    if (cmd === "setrank") {
      const team = interaction.options.getString("team");
      const rank = interaction.options.getInteger("rank");

      check(
        await db.rpc("ufl_move_rank", {
          p_season: SEASON,
          p_week: week,
          p_team: team,
          p_rank: rank
        })
      );

      return interaction.editReply(
        `${team} moved to #${rank}!`
      );
    }

  } catch (error) {
    console.error("COMMAND ERROR:", error);

    const message =
      "Something went wrong. Check your Render logs.";

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message).catch(console.error);
    } else {
      await interaction.reply({
        content: message,
        flags: 64
      }).catch(console.error);
    }
  }
});

bot.once("ready", async () => {
  console.log(`ONLINE: ${bot.user.tag}`);

  try {
    const rest = new REST({ version: "10" })
      .setToken(DISCORD_TOKEN);

    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands.map(c => c.toJSON()) }
    );

    console.log("UFL commands registered");
  } catch (error) {
    console.error("Command registration failed:", error);
  }
});

http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain"
  });

  res.end("UFLLEAGUEBOT service running");
}).listen(process.env.PORT || 3000, "0.0.0.0");

bot.login(DISCORD_TOKEN);
