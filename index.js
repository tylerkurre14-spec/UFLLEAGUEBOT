
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  SlashCommandBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
  Events
} from "discord.js";

import { createClient } from "@supabase/supabase-js";
import http from "node:http";

// ======================================
// UFL SEASON 2 — DISCORD BOT
// ======================================

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
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
}

const db = createClient(
  SUPABASE_URL,
  SUPABASE_SECRET_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

const bot = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const SEASON = 2;
const COLOR = 0x7950b9;

// ======================================
// TEAMS
// ======================================

const TEAMS = [
  {
    name: "Nashville Nightmares",
    emoji: "nightmares",
    conference: "AFC"
  },
  {
    name: "Buffalo Bills",
    emoji: "bills",
    conference: "AFC"
  },
  {
    name: "San Francisco Comets",
    emoji: "comets",
    conference: "AFC"
  },
  {
    name: "Detroit Lions",
    emoji: "lions",
    conference: "AFC"
  },
  {
    name: "Winchester Widows",
    emoji: "widows",
    conference: "NFC"
  },
  {
    name: "Birmingham Bluebirds",
    emoji: "bluebirds",
    conference: "NFC"
  },
  {
    name: "Puerto Rico Coquís",
    emoji: "coquis",
    conference: "NFC"
  },
  {
    name: "Cincinnati Bengals",
    emoji: "bengals",
    conference: "NFC"
  }
];

const ADMIN = PermissionFlagsBits.ManageGuild;

function teamOption(option, name = "team") {
  return option
    .setName(name)
    .setDescription("Select a UFL team")
    .setRequired(true)
    .addChoices(
      ...TEAMS.map(team => ({
        name: team.name,
        value: team.name
      }))
    );
}

// ======================================
// SLASH COMMANDS
// ======================================

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check whether UFLLEAGUEBOT is responding"),

  new SlashCommandBuilder()
    .setName("rankings")
    .setDescription("View UFL power rankings"),

  new SlashCommandBuilder()
    .setName("postrankings")
    .setDescription("Post official power rankings")
    .setDefaultMemberPermissions(ADMIN),

  new SlashCommandBuilder()
    .setName("standings")
    .setDescription("View AFC and NFC standings"),

  new SlashCommandBuilder()
    .setName("schedule")
    .setDescription("View the weekly UFL schedule")
    .addIntegerOption(option =>
      option
        .setName("week")
        .setDescription("Week number")
        .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName("addgame")
    .setDescription("Add a matchup")
    .setDefaultMemberPermissions(ADMIN)
    .addIntegerOption(option =>
      option
        .setName("week")
        .setDescription("Game week")
        .setRequired(true)
        .setMinValue(1)
    )
    .addStringOption(option =>
      teamOption(option, "home")
    )
    .addStringOption(option =>
      teamOption(option, "away")
    ),

  new SlashCommandBuilder()
    .setName("setscore")
    .setDescription("Enter a final score")
    .setDefaultMemberPermissions(ADMIN)
    .addIntegerOption(option =>
      option
        .setName("game_id")
        .setDescription("Game ID from /schedule")
        .setRequired(true)
        .setMinValue(1)
    )
    .addIntegerOption(option =>
      option
        .setName("home_score")
        .setDescription("Home team score")
        .setRequired(true)
        .setMinValue(0)
    )
    .addIntegerOption(option =>
      option
        .setName("away_score")
        .setDescription("Away team score")
        .setRequired(true)
        .setMinValue(0)
    ),

  new SlashCommandBuilder()
    .setName("setrank")
    .setDescription("Change a team's power ranking")
    .setDefaultMemberPermissions(ADMIN)
    .addStringOption(option =>
      teamOption(option)
    )
    .addIntegerOption(option =>
      option
        .setName("rank")
        .setDescription("New rank")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(8)
    ),

  new SlashCommandBuilder()
    .setName("setrecord")
    .setDescription("Update a team's rankings record")
    .setDefaultMemberPermissions(ADMIN)
    .addStringOption(option =>
      teamOption(option)
    )
    .addIntegerOption(option =>
      option
        .setName("wins")
        .setDescription("Wins")
        .setRequired(true)
        .setMinValue(0)
    )
    .addIntegerOption(option =>
      option
        .setName("losses")
        .setDescription("Losses")
        .setRequired(true)
        .setMinValue(0)
    ),

  new SlashCommandBuilder()
    .setName("setweek")
    .setDescription("Advance the power rankings week")
    .setDefaultMemberPermissions(ADMIN)
    .addIntegerOption(option =>
      option
        .setName("week")
        .setDescription("New week")
        .setRequired(true)
        .setMinValue(1)
    )
];

// ======================================
// DATABASE HELPERS
// ======================================

function checked(result) {
  if (result.error) {
    console.error(
      "SUPABASE ERROR:",
      result.error.message,
      result.error.code
    );

    throw result.error;
  }

  return result.data;
}

async function getWeek() {
  const rows = checked(
    await db
      .from("ufl_power_rankings")
      .select("week")
      .eq("season", SEASON)
      .order("week", { ascending: false })
      .limit(1)
  );

  return rows?.[0]?.week ?? 4;
}

async function getRankings(week) {
  return checked(
    await db
      .from("ufl_power_rankings")
      .select("*")
      .eq("season", SEASON)
      .eq("week", week)
      .order("rank")
  );
}

async function ensureWeek(week) {
  const existing = await getRankings(week);

  if (existing.length) {
    return existing;
  }

  const previous = week > 1
    ? await getRankings(week - 1)
    : [];

  const rows = TEAMS.map((team, index) => {
    const old = previous.find(
      row => row.team_name === team.name
    );

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

  // Do not insert duplicate ranking positions.
  const used = new Set();

  for (const row of rows) {
    if (used.has(row.rank)) {
      row.rank = Array.from(
        { length: TEAMS.length },
        (_, i) => i + 1
      ).find(rank => !used.has(rank));
    }

    used.add(row.rank);
  }

  checked(
    await db
      .from("ufl_power_rankings")
      .upsert(rows, {
        onConflict: "season,week,team_name",
        ignoreDuplicates: true
      })
  );

  return getRankings(week);
}

async function getGames(week = null) {
  let query = db
    .from("ufl_bot_games")
    .select("*")
    .eq("season", SEASON)
    .order("week")
    .order("id");

  if (week !== null) {
    query = query.eq("week", week);
  }

  return checked(await query);
}

// ======================================
// DISCORD TEAM EMOJIS
// ======================================

async function getEmojis(guild) {
  const result = new Map();

  if (!guild) return result;

  try {
    const emojis = await guild.emojis.fetch();

    for (const emoji of emojis.values()) {
      result.set(
        emoji.name.toLowerCase(),
        emoji.toString()
      );
    }

    console.log(
      "EMOJIS LOADED:",
      [...result.keys()].join(", ")
    );
  } catch (error) {
    console.error(
      "EMOJI ERROR:",
      error.message
    );
  }

  return result;
}

function logo(name, emojis) {
  const team = TEAMS.find(
    item => item.name === name
  );

  return emojis.get(team?.emoji) ?? "🏈";
}

// ======================================
// EMBED DESIGN
// ======================================

function makeEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(COLOR)
    .setAuthor({
      name: "UFL • SEASON 2"
    })
    .setTitle(title)
    .setDescription(
      description || "No information available."
    )
    .setTimestamp();
}

// ======================================
// POWER RANKINGS
// ======================================

async function rankingsEmbed(emojis) {
  const week = await getWeek();
  const rows = await getRankings(week);

  console.log(
    "RANKINGS:",
    "week =", week,
    "teams =", rows.length
  );

  if (!rows.length) {
    return makeEmbed(
      `WEEK ${week} POWER RANKINGS`,
      "No rankings have been entered."
    );
  }

  const lines = rows.map(row => {
    const movement =
      row.previous_rank == null
        ? 0
        : row.previous_rank - row.rank;

    let arrow = "";

    if (movement > 0) {
      arrow = ` 🟢 ▲${movement}`;
    } else if (movement < 0) {
      arrow = ` 🔴 ▼${Math.abs(movement)}`;
    }

    return (
      `\`${String(row.rank).padStart(2, "0")}\` ` +
      `${logo(row.team_name, emojis)} ` +
      `**${row.team_name}** ` +
      `(${row.wins}-${row.losses})${arrow}`
    );
  });

  return makeEmbed(
    `WEEK ${week} • POWER RANKINGS`,
    lines.join("\n")
  );
}

// ======================================
// STANDINGS
// ======================================

async function standingsEmbed(emojis) {
  const games = await getGames();

  const records = new Map(
    TEAMS.map(team => [
      team.name,
      {
        ...team,
        wins: 0,
        losses: 0,
        ties: 0,
        pf: 0,
        pa: 0
      }
    ])
  );

  for (const game of games) {
    if (
      game.home_score == null ||
      game.away_score == null
    ) {
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

  const sections = [];

  for (const conference of ["AFC", "NFC"]) {
    const teams = [...records.values()]
      .filter(
        team => team.conference === conference
      )
      .sort((a, b) => {
        const ap = a.wins + a.losses + a.ties;
        const bp = b.wins + b.losses + b.ties;

        const aPct = ap
          ? (a.wins + a.ties * 0.5) / ap
          : 0;

        const bPct = bp
          ? (b.wins + b.ties * 0.5) / bp
          : 0;

        return (
          bPct - aPct ||
          (b.pf - b.pa) - (a.pf - a.pa)
        );
      });

    const formatTeam = (team, index) => {
      const pd = team.pf - team.pa;

      const record = team.ties
        ? `${team.wins}-${team.losses}-${team.ties}`
        : `${team.wins}-${team.losses}`;

      return (
        `\`${index + 1}.\` ` +
        `${logo(team.name, emojis)} ` +
        `**${team.name}**\n` +
        `Record: ${record} • ` +
        `PD: ${pd > 0 ? "+" : ""}${pd}`
      );
    };

    const top2 = teams
      .slice(0, 2)
      .map(formatTeam)
      .join("\n");

    const wildcard = teams[2]
      ? formatTeam(teams[2], 2)
      : "None";

    const hunt = teams[3]
      ? formatTeam(teams[3], 3)
      : "None";

    sections.push(
      `# ${conference} STANDINGS\n` +
      `**TOP 2 — PLAYOFF SPOTS**\n${top2}\n\n` +
      `**WILD CARD**\n${wildcard}\n\n` +
      `**IN THE HUNT**\n${hunt}`
    );
  }

  return makeEmbed(
    "OFFICIAL UFL STANDINGS",
    sections.join("\n\n")
  );
}

// ======================================
// SCHEDULE
// ======================================

async function scheduleEmbed(week, emojis) {
  const games = await getGames(week);

  if (!games.length) {
    return makeEmbed(
      `WEEK ${week} • SCHEDULE`,
      "No matchups scheduled yet."
    );
  }

  const lines = games.map(game => {
    const away =
      `${logo(game.away_team, emojis)} ` +
      `**${game.away_team}**`;

    const home =
      `${logo(game.home_team, emojis)} ` +
      `**${game.home_team}**`;

    if (
      game.home_score != null &&
      game.away_score != null
    ) {
      return (
        `**GAME #${game.id} • FINAL**\n` +
        `${away} — ${game.away_score}\n` +
        `${home} — ${game.home_score}`
      );
    }

    return (
      `**GAME #${game.id} • SCHEDULED**\n` +
      `${away}\n**VS**\n${home}`
    );
  });

  return makeEmbed(
    `WEEK ${week} • SCHEDULE`,
    lines.join("\n\n")
  );
}

// ======================================
// DIAGNOSTIC LOGGING
// ======================================

bot.on(Events.Error, error => {
  console.error(
    "DISCORD CLIENT ERROR:",
    error
  );
});

bot.on(Events.Warn, warning => {
  console.warn(
    "DISCORD WARNING:",
    warning
  );
});

bot.on(Events.ShardDisconnect, (event, id) => {
  console.error(
    "DISCORD DISCONNECTED:",
    "shard =", id,
    "code =", event.code
  );
});

bot.on(Events.ShardReconnecting, id => {
  console.log(
    "DISCORD RECONNECTING:",
    id
  );
});

bot.on(Events.ShardResume, id => {
  console.log(
    "DISCORD RECONNECTED:",
    id
  );
});

// ======================================
// HANDLE COMMANDS
// ======================================

bot.on(Events.InteractionCreate, async interaction => {
  console.log(
    "DISCORD INTERACTION RECEIVED:",
    interaction.id,
    interaction.commandName ?? "unknown",
    "GUILD:",
    interaction.guildId
  );

  if (!interaction.isChatInputCommand()) {
    return;
  }

  const command = interaction.commandName;

  try {
    // Respond immediately to diagnose Discord connectivity.
    if (command === "ping") {
      console.log("PING COMMAND SUCCESS");

      await interaction.reply({
        content: "🏈 UFLLEAGUEBOT IS ONLINE!"
      });

      return;
    }

    const publicCommands = [
      "rankings",
      "standings",
      "schedule"
    ];

    await interaction.deferReply({
      flags: publicCommands.includes(command)
        ? 0
        : 64
    });

    console.log(
      "COMMAND DEFERRED:",
      command
    );

    const emojis = await getEmojis(
      interaction.guild
    );

    // PUBLIC COMMANDS

    if (command === "rankings") {
      const result = await rankingsEmbed(emojis);

      await interaction.editReply({
        embeds: [result]
      });

      console.log(
        "RANKINGS RESPONSE SENT"
      );

      return;
    }

    if (command === "standings") {
      const result = await standingsEmbed(emojis);

      await interaction.editReply({
        embeds: [result]
      });

      console.log(
        "STANDINGS RESPONSE SENT"
      );

      return;
    }

    if (command === "schedule") {
      const week =
        interaction.options.getInteger("week") ??
        await getWeek();

      const result = await scheduleEmbed(
        week,
        emojis
      );

      await interaction.editReply({
        embeds: [result]
      });

      console.log(
        "SCHEDULE RESPONSE SENT"
      );

      return;
    }

    // ADMIN PERMISSION CHECK

    if (
      !interaction.memberPermissions?.has(ADMIN)
    ) {
      await interaction.editReply(
        "Only league admins can use this command."
      );

      return;
    }

    if (command === "postrankings") {
      await interaction.channel.send({
        embeds: [await rankingsEmbed(emojis)]
      });

      await interaction.editReply(
        "Official rankings posted!"
      );

      return;
    }

    if (command === "addgame") {
      const week =
        interaction.options.getInteger("week");

      const home =
        interaction.options.getString("home");

      const away =
        interaction.options.getString("away");

      if (home === away) {
        return interaction.editReply(
          "A team cannot play itself."
        );
      }

      const existing = await getGames(week);

      if (
        existing.some(game =>
          game.home_team === home &&
          game.away_team === away
        )
      ) {
        return interaction.editReply(
          "That matchup is already scheduled."
        );
      }

      const game = checked(
        await db
          .from("ufl_bot_games")
          .insert({
            season: SEASON,
            week,
            home_team: home,
            away_team: away
          })
          .select("id")
          .single()
      );

      await interaction.editReply(
        `Game #${game.id} added!\n` +
        `${away} @ ${home} — Week ${week}`
      );

      return;
    }

    if (command === "setscore") {
      const id =
        interaction.options.getInteger("game_id");

      const homeScore =
        interaction.options.getInteger("home_score");

      const awayScore =
        interaction.options.getInteger("away_score");

      const game = checked(
        await db
          .from("ufl_bot_games")
          .select("*")
          .eq("id", id)
          .eq("season", SEASON)
          .maybeSingle()
      );

      if (!game) {
        return interaction.editReply(
          "Game not found."
        );
      }

      checked(
        await db
          .from("ufl_bot_games")
          .update({
            home_score: homeScore,
            away_score: awayScore
          })
          .eq("id", id)
          .eq("season", SEASON)
      );

      await interaction.editReply(
        `FINAL\n` +
        `${game.away_team}: ${awayScore}\n` +
        `${game.home_team}: ${homeScore}\n\n` +
        `Standings updated!`
      );

      return;
    }

    const week = await getWeek();

    if (command === "setweek") {
      const next =
        interaction.options.getInteger("week");

      if (next <= week) {
        return interaction.editReply(
          `The current week is already ${week}.`
        );
      }

      if (next !== week + 1) {
        return interaction.editReply(
          `Advance one week at a time. ` +
          `Current week: ${week}.`
        );
      }

      await ensureWeek(next);

      await interaction.editReply(
        `Rankings advanced to Week ${next}!`
      );

      return;
    }

    if (command === "setrecord") {
      const team =
        interaction.options.getString("team");

      const wins =
        interaction.options.getInteger("wins");

      const losses =
        interaction.options.getInteger("losses");

      checked(
        await db
          .from("ufl_power_rankings")
          .update({ wins, losses })
          .eq("season", SEASON)
          .eq("week", week)
          .eq("team_name", team)
      );

      await interaction.editReply(
        `${team} updated to ${wins}-${losses}.`
      );

      return;
    }

    if (command === "setrank") {
      const team =
        interaction.options.getString("team");

      const rank =
        interaction.options.getInteger("rank");

      checked(
        await db.rpc("ufl_move_rank", {
          p_season: SEASON,
          p_week: week,
          p_team: team,
          p_rank: rank
        })
      );

      await interaction.editReply(
        `${team} moved to #${rank}!`
      );

      return;
    }

    await interaction.editReply(
      "Unknown command."
    );

  } catch (error) {
    console.error(
      "COMMAND ERROR:",
      command,
      error
    );

    const message =
      "Command failed. Check Render logs.";

    try {
      if (
        interaction.deferred ||
        interaction.replied
      ) {
        await interaction.editReply(message);
      } else {
        await interaction.reply({
          content: message,
          flags: 64
        });
      }
    } catch (replyError) {
      console.error(
        "REPLY ERROR:",
        replyError
      );
    }
  }
});

// ======================================
// DISCORD STARTUP
// ======================================

bot.once(Events.ClientReady, async client => {
  console.log(
    "ONLINE:",
    client.user.tag
  );

  console.log(
    "CONNECTED SERVERS:",
    client.guilds.cache.map(g => g.name)
  );

  try {
    const rest = new REST({
      version: "10"
    }).setToken(DISCORD_TOKEN);

    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      {
        body: commands.map(command =>
          command.toJSON()
        )
      }
    );

    console.log(
      "UFL COMMANDS REGISTERED:",
      commands.map(c => c.name).join(", ")
    );
  } catch (error) {
    console.error(
      "COMMAND REGISTRATION ERROR:",
      error
    );
  }
});

// ======================================
// RENDER WEB SERVER
// ======================================

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain"
  });

  res.end(
    `UFLLEAGUEBOT service running\n` +
    `Discord ready: ${bot.isReady()}\n` +
    `Servers: ${bot.guilds.cache.size}\n`
  );
});

server.listen(
  process.env.PORT || 3000,
  "0.0.0.0",
  () => {
    console.log(
      "WEB SERVER STARTED"
    );
  }
);

console.log("STARTING DISCORD LOGIN");

console.log("Token exists:", Boolean(DISCORD_TOKEN));

const loginTimeout = setTimeout(() => {
  if (!bot.isReady()) {
    console.error("DISCORD LOGIN TIMEOUT: Bot not ready after 30 seconds");
  }
}, 30000);

bot.login(DISCORD_TOKEN)
  .then(() => {
    console.log("DISCORD LOGIN REQUEST COMPLETED");
  })
  .catch(error => {
    console.error("DISCORD LOGIN FAILED:", error);
  })
  .finally(() => {
    clearTimeout(loginTimeout);
  });
