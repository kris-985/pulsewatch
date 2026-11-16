import { z } from 'zod'

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().trim().max(254),
  password: z.string().min(12).max(128).refine((value) => Buffer.byteLength(value, 'utf8') <= 72),
}).strict()

export const loginSchema = z.object({
  email: z.email().trim().max(254),
  password: z.string().min(1).max(128).refine((value) => Buffer.byteLength(value, 'utf8') <= 72),
}).strict()
