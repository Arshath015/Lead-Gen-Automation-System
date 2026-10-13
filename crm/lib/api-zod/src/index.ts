import * as zod from "zod/v4";
export * from "./generated/api";
import { GetCurrentUserResponse } from "./generated/api";
export type AuthUser = zod.infer<typeof GetCurrentUserResponse>;
