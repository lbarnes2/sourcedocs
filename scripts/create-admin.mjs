#!/usr/bin/env node
/**
 * Creates an admin account, or resets an existing account's password and makes it an admin
 * (the way back in if every admin is locked out).
 *
 *   npm run create-admin -- you@example.com "Your Name"
 *
 * Uses the R2 bucket from .env.local when R2 is configured, otherwise data/users.json.
 * Must match lib/auth/password.ts (hash format) and lib/auth/userStore.ts (storage locations).
 */
import { randomBytes, randomUUID, scrypt as scryptCb } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const R2_KEY = "auth/users.json";
const FS_PATH = path.join(process.cwd(), "data", "users.json");
const MIN_PASSWORD_LENGTH = 12;

function hashPassword(password) {
  const N = 16384, r = 8, p = 1;
  const salt = randomBytes(16);
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, 64, { N, r, p }, (err, key) =>
      err ? reject(err) : resolve(`scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`)
    );
  });
}

function r2() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = process.env;
  if (!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME)) return null;
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY }
  });
  return { client, bucket: R2_BUCKET_NAME };
}

async function readUsers(store) {
  let raw = null;
  if (store) {
    try {
      const out = await store.client.send(new GetObjectCommand({ Bucket: store.bucket, Key: R2_KEY }));
      raw = await out.Body.transformToString("utf8");
    } catch (error) {
      if (error?.name !== "NoSuchKey") throw error;
    }
  } else {
    try {
      raw = await fs.readFile(FS_PATH, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return raw ? JSON.parse(raw) : { version: 1, users: [] };
}

async function writeUsers(store, file) {
  const body = JSON.stringify(file, null, 2);
  if (store) {
    await store.client.send(
      new PutObjectCommand({ Bucket: store.bucket, Key: R2_KEY, Body: body, ContentType: "application/json; charset=utf-8" })
    );
  } else {
    await fs.mkdir(path.dirname(FS_PATH), { recursive: true });
    await fs.writeFile(FS_PATH, body, "utf8");
  }
}

/** One reader for all prompts. Typed characters are not echoed; piped input works too. */
function createPrompter() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  rl._writeToOutput = () => {};
  const lines = rl[Symbol.asyncIterator]();
  return {
    async askHidden(question) {
      process.stdout.write(question);
      const { value } = await lines.next();
      process.stdout.write("\n");
      return value ?? "";
    },
    close: () => rl.close()
  };
}

async function main() {
  const [emailArg, ...nameParts] = process.argv.slice(2);
  const email = emailArg?.trim().toLowerCase();
  const name = nameParts.join(" ").trim();
  if (!email || !email.includes("@") || !name) {
    console.error('Usage: npm run create-admin -- you@example.com "Your Name"');
    process.exit(1);
  }

  const prompter = createPrompter();
  const password = await prompter.askHidden(`Password for ${email} (at least ${MIN_PASSWORD_LENGTH} characters): `);
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exit(1);
  }
  if ((await prompter.askHidden("Repeat password: ")) !== password) {
    console.error("Passwords do not match.");
    process.exit(1);
  }
  prompter.close();

  const store = r2();
  const file = await readUsers(store);
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);
  const existing = file.users.find((u) => u.email === email);
  if (existing) {
    Object.assign(existing, {
      name,
      role: "admin",
      passwordHash,
      active: true,
      mustChangePassword: false,
      failedLogins: 0,
      lockedUntil: null,
      updatedAt: now
    });
  } else {
    file.users.push({
      id: randomUUID(),
      email,
      name,
      role: "admin",
      passwordHash,
      active: true,
      mustChangePassword: false,
      failedLogins: 0,
      lockedUntil: null,
      createdAt: now,
      updatedAt: now
    });
  }
  await writeUsers(store, file);
  const where = store ? `R2 bucket "${store.bucket}"` : FS_PATH;
  console.log(`${existing ? "Updated" : "Created"} admin ${email} in ${where}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
