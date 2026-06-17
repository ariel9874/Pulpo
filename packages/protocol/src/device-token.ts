import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.js";

/** Plataforma del dispositivo para push. */
export const devicePlatformSchema = z.enum(["ios", "android", "web"]);
export type DevicePlatform = z.infer<typeof devicePlatformSchema>;

/** Token de push de un dispositivo, asociado a un usuario. */
export const deviceTokenSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  token: z.string().min(1),
  platform: devicePlatformSchema,
  createdAt: isoDateTimeSchema,
});
export type DeviceToken = z.infer<typeof deviceTokenSchema>;

export const parseDeviceToken = (input: unknown): DeviceToken => deviceTokenSchema.parse(input);
