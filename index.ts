import {
  Client,
  GatewayIntentBits,
  Collection,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  TextChannel,
  Partials,
} from "discord.js";
import express from "express";
import { handleAIMessage } from "./aiChat.js";
import * as fgen from "./commands/fgen.js";
import * as bgen from "./commands/bgen.js";
import * as xgen from "./commands/xgen.js";
import * as stock from "./commands/stock.js";
import * as help from "./commands/help.js";
import * as addservice from "./commands/addservice.js";
import * as addstock from "./commands/addstock.js";
import * as bulkstock from "./commands/bulkstock.js";
import * as removeservice from "./commands/removeservice.js";
import * as stats from "./commands/stats.js";
import * as resetcooldown from "./commands/resetcooldown.js";
import * as setcooldown from "./commands/setcooldown.js";
import * as setcap from "./commands/setcap.js";
import * as vouch from "./commands/vouch.js";
import * as ban from "./commands/ban.js";
import * as giveaway from "./commands/giveaway.js";
import * as ticket from "./commands/ticket.js";
import * as profile from "./commands/profile.js";
import * as shop from "./commands/shop.js";
import * as leaderboard from "./commands/leaderboard.js";
import { getStockItemById, searchServices } from "./db.js";
import { parseCredentials } from "./dmGen.js";
import { handleGiveawayEntry, restoreGiveaways } from "./commands/giveaway.js";
import { handleTicketCreate, handleTicketClose } from "./commands/ticket.js";
import { addStockItemsBulk } from "./db.js";

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const app = express();
app.get("/", (_req, res) => res.send("COZZZY GEN is alive!"));
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.listen(PORT, "0.0.0.0", () => console.log(`✅ Keep-alive server running on port ${PORT}`));

interface Command {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("DISCORD_TOKEN is not set.");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel],
});

const commands = new Collection<string, Command>();
for (const cmd of [
  fgen, bgen, xgen, stock, help,
  addservice, addstock, bulkstock,
  removeservice, stats, resetcooldown, setcooldown, setcap,
  vouch, ban, giveaway, ticket, profile, shop, leaderboard,
]) {
  commands.set(cmd.data.name, cmd as Command);
}

client.once("clientReady", async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  await restoreGiveaways(c).catch((err) => console.error("Failed to restore giveaways:", err));
});

client.on("messageCreate", async (message) => {
  await handleAIMessage(message).catch((err) => console.error("AI message handler error:", err));
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isAutocomplete()) {
    const { commandName } = interaction;
    const focused = interaction.options.getFocused();
    try {
      if (commandName === "fgen") {
        const services = await searchServices(focused, "free");
        await interaction.respond(services.map((s) => ({ name: s.name, value: s.name })));
      } else if (commandName === "bgen") {
        const services = await searchServices(focused, "basic");
        await interaction.respond(services.map((s) => ({ name: s.name, value: s.name })));
      } else if (commandName === "xgen") {
        const services = await searchServices(focused, "exclusive");
        await interaction.respond(services.map((s) => ({ name: s.name, value: s.name })));
      } else if (commandName === "shop") {
        await shop.handleAutocomplete(interaction);
      } else {
        const services = await searchServices(focused);
        await interaction.respond(services.map((s) => ({ name: s.name, value: s.name })));
      }
    } catch (err) {
      console.error("Autocomplete error:", err);
      await interaction.respond([]).catch(() => {});
    }
    return;
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith("bulkstock_")) {
      try {
        await interaction.deferReply({ flags: 64 });
      } catch {
        return;
      }
      const serviceId = parseInt(interaction.customId.replace("bulkstock_", ""), 10);
      const raw = interaction.fields.getTextInputValue("accounts");

      const lines = raw
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      if (lines.length === 0) {
        await interaction.editReply("❌ No valid lines found.");
        return;
      }

      try {
        const added = await addStockItemsBulk(serviceId, lines);
        const { pool } = await import("./db.js");
        const nameRes = await pool.query<{ name: string }>(
          "SELECT name FROM gen_services WHERE id = $1", [serviceId]
        );
        const svcName = nameRes.rows[0]?.name ?? "service";
        await interaction.editReply(
          `✅ Added **${added}** item${added !== 1 ? "s" : ""} to **${svcName}**.`
        );

        if (process.env.STOCK_LOG_CHANNEL_ID) {
          try {
            const ch = await interaction.client.channels.fetch(process.env.STOCK_LOG_CHANNEL_ID) as TextChannel;
            const chunks: string[] = [];
            const MAX = 1000;
            let current = "";
            for (const line of lines) {
              if ((current + "\n" + line).length > MAX) {
                chunks.push(current);
                current = line;
              } else {
                current = current ? current + "\n" + line : line;
              }
            }
            if (current) chunks.push(current);

            const embed = new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle(`📥 Bulk Stock Added — /bulkstock`)
              .addFields(
                { name: "Admin", value: `${interaction.user} (${interaction.user.tag})`, inline: true },
                { name: "Service", value: svcName, inline: true },
                { name: "Items Added", value: `${added}`, inline: true },
                { name: "Content (part 1)", value: `\`\`\`${chunks[0] ?? ""}\`\`\`` }
              )
              .setTimestamp();

            await ch.send({ embeds: [embed] });

            for (let i = 1; i < chunks.length; i++) {
              await ch.send({
                embeds: [
                  new EmbedBuilder()
                    .setColor(0x5865f2)
                    .setTitle(`📥 Bulk Stock (continued ${i + 1}/${chunks.length})`)
                    .addFields({ name: "Content", value: `\`\`\`${chunks[i]}\`\`\`` })
                    .setTimestamp(),
                ],
              });
            }
          } catch {}
        }
      } catch (err) {
        console.error("Bulk stock error:", err);
        await interaction.editReply("❌ Failed to add stock. Check formatting and try again.");
      }
    }
    return;
  }

  if (interaction.isChatInputCommand()) {
    const command = commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(`Error executing /${interaction.commandName}:`, err);
      const msg = "❌ An error occurred while executing this command.";
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(msg).catch(() => {});
      } else {
        await interaction.reply({ content: msg, flags: 64 }).catch(() => {});
      }
    }
    return;
  }

  if (interaction.isButton()) {
    const { customId } = interaction;

    if (customId === "ticket_create") {
      await handleTicketCreate(interaction).catch(async (err) => {
        console.error("Ticket create error:", err);
        const msg = "❌ Something went wrong creating your ticket.";
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(msg).catch(() => {});
        } else {
          await interaction.reply({ content: msg, flags: 64 }).catch(() => {});
        }
      });
      return;
    }

    if (customId.startsWith("ticket_close_")) {
      const channelId = customId.replace("ticket_close_", "");
      await handleTicketClose(interaction, channelId).catch(async (err) => {
        console.error("Ticket close error:", err);
        const msg = "❌ Something went wrong closing the ticket.";
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(msg).catch(() => {});
        } else {
          await interaction.reply({ content: msg, flags: 64 }).catch(() => {});
        }
      });
      return;
    }

    if (customId.startsWith("giveaway_enter_")) {
      await handleGiveawayEntry(interaction, client).catch(async (err) => {
        console.error("Giveaway entry error:", err);
        await interaction.reply({ content: "❌ Something went wrong.", flags: 64 }).catch(() => {});
      });
      return;
    }

    if (customId.startsWith("copy_user_") || customId.startsWith("copy_pass_")) {
      const isUser = customId.startsWith("copy_user_");
      const itemId = parseInt(
        customId.replace("copy_user_", "").replace("copy_pass_", ""),
        10
      );
      try {
        const item = await getStockItemById(itemId);
        if (!item) {
          await interaction.reply({ content: "❌ Item not found.", flags: 64 });
          return;
        }
        const { username, password } = parseCredentials(item.content);
        await interaction.reply({ content: isUser ? username : password, flags: 64 });
      } catch (err) {
        console.error("Button handler error:", err);
        await interaction.reply({ content: "❌ Something went wrong.", flags: 64 });
      }
    }
  }
});

client.on("error", (err) => console.error("Discord client error:", err));

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

client.login(token);
