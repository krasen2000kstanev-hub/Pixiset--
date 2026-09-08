import { z } from "zod";

export const galleryCreateSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
});

export const gallerySettingsSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
  coverPhotoId: z.string().nullable().optional(),
  coverLayout: z.enum(["CENTER", "LEFT", "SPLIT"]).optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  password: z.string().max(120).nullable().optional(), // null clears, "" ignored
  requireEmail: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  downloadEnabled: z.boolean().optional(),
  downloadSize: z.enum(["ORIGINAL", "WEB"]).optional(),
  notifyOnSelection: z.boolean().optional(),
  notifyOnBulkDownload: z.boolean().optional(),
  notifyEmails: z.array(z.string().email()).max(10).optional(),
});

export const uploadRequestSchema = z.object({
  files: z
    .array(
      z.object({
        clientId: z.string().min(1).max(64),
        originalExt: z.string().min(1).max(8),
        originalType: z.string().min(1).max(80),
      }),
    )
    .min(1)
    .max(200),
});

export const photosConfirmSchema = z.object({
  photos: z
    .array(
      z.object({
        photoId: z.string().min(1),
        filename: z.string().min(1).max(255),
        keyOriginal: z.string().min(1),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        bytes: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(200),
});

export const reorderSchema = z.object({
  order: z.array(z.string().min(1)).min(1).max(2000),
});

export const galleryAuthSchema = z.object({
  password: z.string().max(120).optional(),
  email: z.string().email().optional(),
});

export const favoriteToggleSchema = z.object({
  photoId: z.string().min(1),
});

export const selectionSubmitSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().email(),
  note: z.string().trim().max(2000).optional().or(z.literal("")),
});

export const downloadSchema = z.union([
  z.object({ photoId: z.string().min(1) }),
  z.object({ all: z.literal(true) }),
]);
