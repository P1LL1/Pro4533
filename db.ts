import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set.");
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export type ServiceTier = "free" | "basic" | "exclusive";

export interface Service {
  id: number;
  name: string;
  is_free: boolean;
  tier: ServiceTier;
  cooldown_minutes: number | null;
  daily_cap: number | null;
  created_at: Date;
}

export interface StockItem {
  id: number;
  service_id: number;
  content: string;
  used: boolean;
  created_at: Date;
}

export interface GenStats {
  totalAllTime: number;
  totalToday: number;
  topService: string | null;
  topServiceCount: number;
}

export interface LeaderboardEntry {
  user_id: string;
  username: string;
  total_gens: number;
  rank: number;
}

export async function getServices(tier?: ServiceTier): Promise<Service[]> {
  const query = tier
    ? "SELECT * FROM gen_services WHERE tier = $1 ORDER BY name"
    : "SELECT * FROM gen_services ORDER BY name";
  const params = tier ? [tier] : [];
  const result = await pool.query<Service>(query, params);
  return result.rows;
}

export async function getServiceByName(name: string): Promise<Service | null> {
  const result = await pool.query<Service>(
    "SELECT * FROM gen_services WHERE LOWER(name) = LOWER($1)",
    [name]
  );
  return result.rows[0] ?? null;
}

export async function getAllStockCounts(): Promise<
  Array<{ service: Service; available: number; total: number }>
> {
  const result = await pool.query<{
    id: number;
    name: string;
    is_free: boolean;
    tier: ServiceTier;
    cooldown_minutes: number | null;
    daily_cap: number | null;
    created_at: Date;
    available: string;
    total: string;
  }>(
    `SELECT s.id, s.name, s.is_free, s.tier, s.cooldown_minutes, s.daily_cap, s.created_at,
       COUNT(st.id) FILTER (WHERE st.used = false) AS available,
       COUNT(st.id) AS total
     FROM gen_services s
     LEFT JOIN gen_stock st ON s.id = st.service_id
     GROUP BY s.id
     ORDER BY s.name`
  );
  return result.rows.map((r) => ({
    service: {
      id: r.id,
      name: r.name,
      is_free: r.is_free,
      tier: r.tier,
      cooldown_minutes: r.cooldown_minutes,
      daily_cap: r.daily_cap,
      created_at: r.created_at,
    },
    available: parseInt(r.available, 10),
    total: parseInt(r.total, 10),
  }));
}

export async function getServiceStockCounts(
  serviceId: number
): Promise<{ available: number; total: number }> {
  const result = await pool.query<{ available: string; total: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE used = false) AS available,
       COUNT(*) AS total
     FROM gen_stock WHERE service_id = $1`,
    [serviceId]
  );
  return {
    available: parseInt(result.rows[0]?.available ?? "0", 10),
    total: parseInt(result.rows[0]?.total ?? "0", 10),
  };
}

export async function claimStockItem(
  serviceId: number
): Promise<StockItem | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<StockItem>(
      `SELECT * FROM gen_stock
       WHERE service_id = $1 AND used = false
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [serviceId]
    );
    const item = result.rows[0];
    if (!item) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query("UPDATE gen_stock SET used = true WHERE id = $1", [
      item.id,
    ]);
    await client.query("COMMIT");
    return item;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function unclaimStockItem(itemId: number): Promise<void> {
  await pool.query("UPDATE gen_stock SET used = false WHERE id = $1", [itemId]);
}

export async function addService(name: string, tier: ServiceTier): Promise<Service> {
  const isFree = tier === "free";
  const result = await pool.query<Service>(
    `INSERT INTO gen_services (name, is_free, tier)
     VALUES ($1, $2, $3)
     ON CONFLICT (name) DO UPDATE SET is_free = $2, tier = $3
     RETURNING *`,
    [name, isFree, tier]
  );
  return result.rows[0]!;
}

export async function setServiceCooldown(
  serviceId: number,
  minutes: number | null
): Promise<void> {
  await pool.query(
    "UPDATE gen_services SET cooldown_minutes = $1 WHERE id = $2",
    [minutes, serviceId]
  );
}

export async function setServiceDailyCap(
  serviceId: number,
  cap: number | null
): Promise<void> {
  await pool.query(
    "UPDATE gen_services SET daily_cap = $1 WHERE id = $2",
    [cap, serviceId]
  );
}

export async function getDailyUsage(
  userId: string,
  serviceId: number
): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COALESCE(count, 0) AS count FROM gen_daily
     WHERE user_id = $1 AND service_id = $2 AND date = CURRENT_DATE`,
    [userId, serviceId]
  );
  return parseInt(result.rows[0]?.count ?? "0", 10);
}

export async function incrementDailyUsage(
  userId: string,
  serviceId: number
): Promise<void> {
  await pool.query(
    `INSERT INTO gen_daily (user_id, service_id, date, count)
     VALUES ($1, $2, CURRENT_DATE, 1)
     ON CONFLICT (user_id, service_id, date)
     DO UPDATE SET count = gen_daily.count + 1`,
    [userId, serviceId]
  );
}

export async function addStockItem(serviceId: number, content: string): Promise<StockItem> {
  const result = await pool.query<StockItem>(
    "INSERT INTO gen_stock (service_id, content) VALUES ($1, $2) RETURNING *",
    [serviceId, content]
  );
  return result.rows[0]!;
}

export async function addStockItemsBulk(
  serviceId: number,
  lines: string[]
): Promise<number> {
  if (lines.length === 0) return 0;
  const values = lines
    .map((_, i) => `($1, $${i + 2})`)
    .join(", ");
  const params: (number | string)[] = [serviceId, ...lines];
  const result = await pool.query(
    `INSERT INTO gen_stock (service_id, content) VALUES ${values}`,
    params
  );
  return result.rowCount ?? 0;
}

export async function clearUsedItems(serviceId: number): Promise<number> {
  const result = await pool.query(
    "DELETE FROM gen_stock WHERE service_id = $1 AND used = true",
    [serviceId]
  );
  return result.rowCount ?? 0;
}

export async function deleteService(serviceId: number): Promise<void> {
  await pool.query("DELETE FROM gen_services WHERE id = $1", [serviceId]);
}

export async function searchServices(query: string, tier?: ServiceTier): Promise<Service[]> {
  const sql = tier
    ? "SELECT * FROM gen_services WHERE tier = $1 AND LOWER(name) LIKE LOWER($2) ORDER BY name LIMIT 25"
    : "SELECT * FROM gen_services WHERE LOWER(name) LIKE LOWER($1) ORDER BY name LIMIT 25";
  const params = tier ? [tier, `%${query}%`] : [`%${query}%`];
  const result = await pool.query<Service>(sql, params);
  return result.rows;
}

export async function getStockItemById(id: number): Promise<StockItem | null> {
  const result = await pool.query<StockItem>(
    "SELECT * FROM gen_stock WHERE id = $1",
    [id]
  );
  return result.rows[0] ?? null;
}

export async function logGen(
  userId: string,
  username: string,
  serviceName: string
): Promise<void> {
  await pool.query(
    "INSERT INTO gen_logs (user_id, username, service_name) VALUES ($1, $2, $3)",
    [userId, username, serviceName]
  );
}

export async function saveVouch(
  userId: string,
  username: string,
  serviceName: string,
  stars: number,
  imageUrl: string | null,
  comment: string | null
): Promise<void> {
  await pool.query(
    "INSERT INTO vouches (user_id, username, service_name, stars, image_url, comment) VALUES ($1,$2,$3,$4,$5,$6)",
    [userId, username, serviceName, stars, imageUrl, comment]
  );
}

export interface Giveaway {
  id: number;
  channel_id: string;
  message_id: string | null;
  guild_id: string;
  prize: string;
  end_time: Date;
  winner_count: number;
  ended: boolean;
  created_by: string;
}

export async function createGiveaway(
  channelId: string,
  guildId: string,
  prize: string,
  endTime: Date,
  winnerCount: number,
  createdBy: string
): Promise<Giveaway> {
  const result = await pool.query<Giveaway>(
    `INSERT INTO giveaways (channel_id, guild_id, prize, end_time, winner_count, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [channelId, guildId, prize, endTime, winnerCount, createdBy]
  );
  return result.rows[0]!;
}

export async function setGiveawayMessageId(
  giveawayId: number,
  messageId: string
): Promise<void> {
  await pool.query("UPDATE giveaways SET message_id = $1 WHERE id = $2", [messageId, giveawayId]);
}

export async function getActiveGiveaways(): Promise<Giveaway[]> {
  const result = await pool.query<Giveaway>(
    "SELECT * FROM giveaways WHERE ended = false ORDER BY end_time ASC"
  );
  return result.rows;
}

export async function getGiveaway(id: number): Promise<Giveaway | null> {
  const result = await pool.query<Giveaway>("SELECT * FROM giveaways WHERE id = $1", [id]);
  return result.rows[0] ?? null;
}

export async function markGiveawayEnded(id: number): Promise<void> {
  await pool.query("UPDATE giveaways SET ended = true WHERE id = $1", [id]);
}

export async function toggleGiveawayEntry(
  giveawayId: number,
  userId: string
): Promise<"entered" | "left"> {
  const existing = await pool.query(
    "SELECT 1 FROM giveaway_entries WHERE giveaway_id = $1 AND user_id = $2",
    [giveawayId, userId]
  );
  if (existing.rows.length > 0) {
    await pool.query(
      "DELETE FROM giveaway_entries WHERE giveaway_id = $1 AND user_id = $2",
      [giveawayId, userId]
    );
    return "left";
  }
  await pool.query(
    "INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES ($1, $2)",
    [giveawayId, userId]
  );
  return "entered";
}

export async function getGiveawayEntries(giveawayId: number): Promise<string[]> {
  const result = await pool.query<{ user_id: string }>(
    "SELECT user_id FROM giveaway_entries WHERE giveaway_id = $1",
    [giveawayId]
  );
  return result.rows.map((r) => r.user_id);
}

export interface UserProfile {
  userId: string;
  username: string;
  totalVouches: number;
  averageStars: number | null;
  starBreakdown: Record<1 | 2 | 3 | 4 | 5, number>;
  topService: string | null;
  totalGens: number;
  firstActivity: Date | null;
  recentVouches: Array<{
    service_name: string;
    stars: number;
    comment: string | null;
    created_at: Date;
  }>;
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const [vouchRes, genRes, recentRes] = await Promise.all([
    pool.query<{
      username: string;
      total: string;
      avg_stars: string | null;
      s1: string; s2: string; s3: string; s4: string; s5: string;
      top_service: string | null;
      first_at: Date | null;
    }>(
      `SELECT
         MAX(username) AS username,
         COUNT(*) AS total,
         AVG(stars)::numeric(3,2) AS avg_stars,
         COUNT(*) FILTER (WHERE stars = 1) AS s1,
         COUNT(*) FILTER (WHERE stars = 2) AS s2,
         COUNT(*) FILTER (WHERE stars = 3) AS s3,
         COUNT(*) FILTER (WHERE stars = 4) AS s4,
         COUNT(*) FILTER (WHERE stars = 5) AS s5,
         (SELECT service_name FROM vouches WHERE user_id = $1
          GROUP BY service_name ORDER BY COUNT(*) DESC LIMIT 1) AS top_service,
         MIN(created_at) AS first_at
       FROM vouches WHERE user_id = $1`,
      [userId]
    ),
    pool.query<{ total: string; first_at: Date | null }>(
      `SELECT COUNT(*) AS total, MIN(created_at) AS first_at FROM gen_logs WHERE user_id = $1`,
      [userId]
    ),
    pool.query<{ service_name: string; stars: number; comment: string | null; created_at: Date }>(
      `SELECT service_name, stars, comment, created_at FROM vouches
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT 3`,
      [userId]
    ),
  ]);

  const row = vouchRes.rows[0];
  const genRow = genRes.rows[0];
  const totalVouches = parseInt(row?.total ?? "0", 10);
  const totalGens = parseInt(genRow?.total ?? "0", 10);

  if (totalVouches === 0 && totalGens === 0) return null;

  const firstVouch = row?.first_at ?? null;
  const firstGen = genRow?.first_at ?? null;
  const firstActivity =
    firstVouch && firstGen
      ? firstVouch < firstGen ? firstVouch : firstGen
      : firstVouch ?? firstGen;

  return {
    userId,
    username: row?.username ?? "Unknown",
    totalVouches,
    averageStars: row?.avg_stars ? parseFloat(row.avg_stars) : null,
    starBreakdown: {
      1: parseInt(row?.s1 ?? "0", 10),
      2: parseInt(row?.s2 ?? "0", 10),
      3: parseInt(row?.s3 ?? "0", 10),
      4: parseInt(row?.s4 ?? "0", 10),
      5: parseInt(row?.s5 ?? "0", 10),
    },
    topService: row?.top_service ?? null,
    totalGens,
    firstActivity,
    recentVouches: recentRes.rows,
  };
}

export interface ShopItem {
  id: number;
  name: string;
  description: string | null;
  price: string;
  created_by: string;
  created_at: Date;
}

export async function getShopItems(): Promise<ShopItem[]> {
  const result = await pool.query<ShopItem>(
    "SELECT * FROM shop_items ORDER BY created_at ASC"
  );
  return result.rows;
}

export async function getShopItemByName(name: string): Promise<ShopItem | null> {
  const result = await pool.query<ShopItem>(
    "SELECT * FROM shop_items WHERE LOWER(name) = LOWER($1)",
    [name]
  );
  return result.rows[0] ?? null;
}

export async function searchShopItems(query: string): Promise<ShopItem[]> {
  const result = await pool.query<ShopItem>(
    "SELECT * FROM shop_items WHERE LOWER(name) LIKE LOWER($1) ORDER BY name LIMIT 25",
    [`%${query}%`]
  );
  return result.rows;
}

export async function addShopItem(
  name: string,
  price: string,
  description: string | null,
  createdBy: string
): Promise<ShopItem> {
  const result = await pool.query<ShopItem>(
    `INSERT INTO shop_items (name, price, description, created_by)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [name, price, description, createdBy]
  );
  return result.rows[0]!;
}

export async function removeShopItem(id: number): Promise<void> {
  await pool.query("DELETE FROM shop_items WHERE id = $1", [id]);
}

export async function getGenStats(): Promise<GenStats> {
  const [totalRes, todayRes, topRes] = await Promise.all([
    pool.query<{ count: string }>("SELECT COUNT(*) AS count FROM gen_logs"),
    pool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM gen_logs WHERE created_at >= CURRENT_DATE"
    ),
    pool.query<{ service_name: string; count: string }>(
      "SELECT service_name, COUNT(*) AS count FROM gen_logs GROUP BY service_name ORDER BY count DESC LIMIT 1"
    ),
  ]);
  return {
    totalAllTime: parseInt(totalRes.rows[0]?.count ?? "0", 10),
    totalToday: parseInt(todayRes.rows[0]?.count ?? "0", 10),
    topService: topRes.rows[0]?.service_name ?? null,
    topServiceCount: parseInt(topRes.rows[0]?.count ?? "0", 10),
  };
}

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  const result = await pool.query<{ user_id: string; username: string; total_gens: string }>(
    `SELECT user_id, MAX(username) AS username, COUNT(*) AS total_gens
     FROM gen_logs
     GROUP BY user_id
     ORDER BY total_gens DESC
     LIMIT 10`
  );
  return result.rows.map((r, i) => ({
    user_id: r.user_id,
    username: r.username,
    total_gens: parseInt(r.total_gens, 10),
    rank: i + 1,
  }));
}
