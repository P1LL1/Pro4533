import { REST, Routes } from "discord.js";
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

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("DISCORD_TOKEN is not set.");

const commands = [
  fgen, bgen, xgen, stock, help,
  addservice, addstock, bulkstock,
  removeservice, stats, resetcooldown, setcooldown, setcap,
  vouch, ban, giveaway, ticket, profile, shop, leaderboard,
].map((cmd) => cmd.data.toJSON());

const rest = new REST().setToken(token);

(async () => {
  console.log("Registering slash commands globally...");
  const data = await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID ?? ""),
    { body: commands }
  ) as unknown[];
  console.log(`✅ Registered ${data.length} commands.`);
})();
