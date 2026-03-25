import {
  User,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { StockItem, ServiceTier } from "./db.js";

export function parseCredentials(content: string): { username: string; password: string } {
  const colonIndex = content.indexOf(":");
  if (colonIndex === -1) {
    return { username: content, password: "" };
  }
  return {
    username: content.slice(0, colonIndex),
    password: content.slice(colonIndex + 1),
  };
}

const TIER_CONFIG: Record<ServiceTier, { color: number; title: string }> = {
  free:      { color: 0x57f287, title: "🎁 Your Free Gen" },
  basic:     { color: 0x5865f2, title: "💎 Your Basic Gen" },
  exclusive: { color: 0xfee75c, title: "👑 Your Exclusive Gen" },
};

export async function sendGenDM(
  user: User,
  serviceName: string,
  item: StockItem,
  tier: ServiceTier
): Promise<boolean> {
  const { username, password } = parseCredentials(item.content);
  const { color, title } = TIER_CONFIG[tier];

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(`Here are your **${serviceName}** credentials.`)
    .addFields(
      { name: "📧 Username / Email", value: `\`${username}\``, inline: true },
      {
        name: "🔑 Password",
        value: password ? `\`${password}\`` : "*N/A*",
        inline: true,
      }
    )
    .setFooter({ text: "Do not share these credentials with anyone." })
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`copy_user_${item.id}`)
      .setLabel("Copy Username")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("📋"),
    new ButtonBuilder()
      .setCustomId(`copy_pass_${item.id}`)
      .setLabel("Copy Password")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🔑")
  );

  try {
    await user.send({ embeds: [embed], components: [row] });
    return true;
  } catch {
    return false;
  }
}
