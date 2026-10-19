import { z } from "zod";
import { ROLES } from "@/lib/auth/roles";

export const storedUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  name: z.string().trim().min(1).max(120),
  role: z.enum(ROLES),
  passwordHash: z.string().min(1),
  active: z.boolean(),
  mustChangePassword: z.boolean().default(false),
  failedLogins: z.number().int().min(0).default(0),
  lockedUntil: z.string().nullable().default(null),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
});

export const usersFileSchema = z.object({
  version: z.literal(1),
  users: z.array(storedUserSchema)
});

export const loginBodySchema = z.object({
  email: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(1000)
});
