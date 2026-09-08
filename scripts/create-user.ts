/**
 * Create or update an admin user.
 *
 *   npm run create-user -- --email you@studio.com --name "You" --password "secret"
 *
 * If --password is omitted a random one is generated and printed once.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email")?.toLowerCase();
  const name = arg("name") ?? email?.split("@")[0];
  let password = arg("password");

  if (!email || !email.includes("@")) {
    console.error('Usage: npm run create-user -- --email you@studio.com --name "You" [--password secret]');
    process.exit(1);
  }

  let generated = false;
  if (!password) {
    password = randomBytes(9).toString("base64url");
    generated = true;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name: name!, passwordHash },
    update: { name: name!, passwordHash },
  });

  console.log(`\n✔ Admin ready: ${user.email}`);
  if (generated) console.log(`  Temporary password: ${password}`);
  console.log("");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
