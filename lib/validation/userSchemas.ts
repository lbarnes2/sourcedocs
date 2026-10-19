import { z } from "zod";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/passwordRules";
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

export const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1).max(1000),
  newPassword: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
    .max(1000)
});

const nameField = z.string().trim().min(1, "Name is required.").max(120);

export const createUserBodySchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  name: nameField,
  role: z.enum(ROLES)
});

export const updateUserBodySchema = z
  .object({
    name: nameField.optional(),
    role: z.enum(ROLES).optional(),
    active: z.boolean().optional(),
    /** Issue a new temporary password (also clears any lockout). */
    resetPassword: z.literal(true).optional()
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), "Nothing to change.");
