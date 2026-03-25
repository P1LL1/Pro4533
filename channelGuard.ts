export function getAllowedChannels(envVarName: string): string[] {
  const value = process.env[envVarName];
  if (!value) return [];
  return value.split(",").map((id) => id.trim()).filter(Boolean);
}

export function isAllowedChannel(channelId: string, envVarName: string): boolean {
  const allowed = getAllowedChannels(envVarName);
  if (allowed.length === 0) return true;
  return allowed.includes(channelId);
}

export function allowedChannelMentions(envVarName: string): string {
  const channels = getAllowedChannels(envVarName);
  if (channels.length === 0) return "the designated channel";
  return channels.map((id) => `<#${id}>`).join(" or ");
}
